// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K5-01 — instance branding admin (DESIGN.md §2.4, §13).
 *
 * - `GET /api/v1/branding` serves defaults and customised values through the
 *   same shape (no special "unbranded" code path).
 * - `PATCH /api/v1/admin/branding` validates `accent_color` against WCAG AA
 *   and rejects `#FFFF00` with the measured ratio in the message.
 * - `POST /api/v1/admin/branding/logo` validates PNG/SVG ≤ 512×512 and blocks
 *   scripted SVGs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';

type BrandingDto = {
  instance_name: string;
  tab_title: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  accent_color: string | null;
  accent_foreground: string | null;
};

/** Minimal valid PNG with arbitrary IHDR width/height for dimension checks. */
function makePng(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from('IHDR', 'ascii');
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // RGBA
  const crc = Buffer.alloc(4);
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return Buffer.concat([sig, ihdrLen, ihdrType, ihdrData, crc, iend]);
}

function multipartFile(filename: string, contentType: string, content: Buffer | string) {
  const boundary = '----KluiBrandingTestBoundary';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    typeof content === 'string' ? Buffer.from(content, 'utf8') : content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { boundary, body };
}

let harness: Awaited<ReturnType<typeof startServer>>;
let admin: TestClient;
let member: TestClient;

beforeAll(async () => {
  harness = await startServer();
  admin = harness.client();
  await admin.signup(`brand-admin-${admin.suffix}`);
  const me = (await admin.request('GET', '/api/v1/me')).json() as { id: string };
  await harness.db.user.update({ where: { id: me.id }, data: { is_instance_admin: true } });

  member = harness.client();
  await member.signup(`brand-user-${member.suffix}`);
  const memberMe = (await member.request('GET', '/api/v1/me')).json() as { id: string };
  await harness.db.user.update({ where: { id: memberMe.id }, data: { is_instance_admin: false } });
});

afterAll(async () => {
  await harness.db.instanceSettings.updateMany({
    where: { id: 1 },
    data: {
      instance_name: 'Klui',
      tab_title: null,
      logo_url: null,
      favicon_url: null,
      accent_color: null,
    },
  });
  await harness.close();
});

describe('instance branding admin (K5-01)', () => {
  it('serves defaults publicly through GET /api/v1/branding', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/branding' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as BrandingDto;
    expect(body).toEqual({
      instance_name: 'Klui',
      tab_title: null,
      logo_url: null,
      favicon_url: null,
      accent_color: null,
      accent_foreground: null,
    });
  });

  it('refuses non-admins on PATCH /api/v1/admin/branding with 403', async () => {
    const response = await member.request('PATCH', '/api/v1/admin/branding', {
      instance_name: 'Hijacked',
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects #FFFF00 as accent_color with the measured WCAG AA ratio in the message', async () => {
    const yellow = await admin.request('PATCH', '/api/v1/admin/branding', {
      accent_color: '#FFFF00',
    });
    expect(yellow.statusCode).toBe(400);
    const body = yellow.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.message).toMatch(/\d+\.\d+:1/u);
    expect(body.error.message).toContain('#FFFF00');

    const tooDark = await admin.request('PATCH', '/api/v1/admin/branding', {
      accent_color: '#111111',
    });
    expect(tooDark.statusCode).toBe(400);
    expect((tooDark.json() as { error: { message: string } }).error.message).toMatch(/\d+\.\d+:1/u);
  });

  it('saves valid instance_name, tab_title and AA-compliant accent_color and computes foreground', async () => {
    const saved = await admin.request('PATCH', '/api/v1/admin/branding', {
      instance_name: 'Acme Boards',
      tab_title: 'Acme Kanban',
      accent_color: '#2563EB',
    });
    expect(saved.statusCode).toBe(200);
    const body = saved.json() as BrandingDto;
    expect(body.instance_name).toBe('Acme Boards');
    expect(body.tab_title).toBe('Acme Kanban');
    expect(body.accent_color).toBe('#2563EB');
    expect(body.accent_foreground).toBe('#FFFFFF');

    const readBack = await harness.app.inject({ method: 'GET', url: '/api/v1/branding' });
    expect(readBack.statusCode).toBe(200);
    expect(readBack.json()).toEqual(body);

    // Clearing accent_color returns to default variables cleanly.
    const cleared = await admin.request('PATCH', '/api/v1/admin/branding', {
      accent_color: null,
    });
    expect(cleared.statusCode).toBe(200);
    expect((cleared.json() as BrandingDto).accent_color).toBeNull();
    expect((cleared.json() as BrandingDto).accent_foreground).toBeNull();
  });

  it('accepts safe SVG and <=512x512 PNG logos/favicons and rejects unsafe SVGs and oversized PNGs', async () => {
    const postUpload = async (
      url: string,
      filename: string,
      contentType: string,
      content: Buffer | string,
    ) => {
      const { boundary, body } = multipartFile(filename, contentType, content);
      return harness.app.inject({
        method: 'POST',
        url,
        headers: admin.headers({
          'content-type': `multipart/form-data; boundary=${boundary}`,
        }),
        payload: body,
      });
    };

    const evilSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script></svg>';
    const rejectedSvg = await postUpload(
      '/api/v1/admin/branding/logo',
      'evil.svg',
      'image/svg+xml',
      evilSvg,
    );
    expect(rejectedSvg.statusCode).toBe(400);

    const hugePng = await postUpload(
      '/api/v1/admin/branding/logo',
      'big.png',
      'image/png',
      makePng(1024, 1024),
    );
    expect(hugePng.statusCode).toBe(400);

    const safeSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><rect width="64" height="64"/></svg>';
    const okLogo = await postUpload(
      '/api/v1/admin/branding/logo',
      'logo.svg',
      'image/svg+xml',
      safeSvg,
    );
    expect(okLogo.statusCode).toBe(200);
    expect((okLogo.json() as BrandingDto).logo_url).toMatch(/^data:image\/svg\+xml;base64,/u);

    const okFavicon = await postUpload(
      '/api/v1/admin/branding/logo?kind=favicon',
      'favicon.png',
      'image/png',
      makePng(64, 64),
    );
    expect(okFavicon.statusCode).toBe(200);
    expect((okFavicon.json() as BrandingDto).favicon_url).toMatch(/^data:image\/png;base64,/u);
  });
});
