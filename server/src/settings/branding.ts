// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Instance branding administration (K5-01, DESIGN.md §2.4, §13, docs/security.md §6).
 *
 * Defaults and custom branding travel through the same DTO and CSS custom
 * properties — there is no separate "unbranded" code path.
 *
 * Accent validation uses WCAG 2.1 relative luminance:
 * 1. Computes the readable foreground (light ink vs dark ink) on the accent
 *    fill and requires ≥ 4.5:1 (AA normal text).
 * 2. Measures the accent against both dark and light surfaces and requires
 *    ≥ 3.0:1 (AA UI component & focus contrast) on every surface it lands on.
 * Any failure is rejected with the measured ratio in the error message.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireUser } from '../auth/request.js';
import { AppError, fromZod } from '../lib/errors.js';

type Rgb = readonly [number, number, number];

// The four surfaces an accent can land on, copied from web/src/styles/tokens.css
// (dark: --canvas #121110, --surface #1a1817; light: --canvas #f7f5f0,
// --surface #fcfbf7). DESIGN.md §2. A gate that measures a palette the app no
// longer ships is measuring nothing.
const INK_DARK: Rgb = [12, 12, 12];
const INK_LIGHT: Rgb = [255, 255, 255];

const SURFACES: readonly { name: string; rgb: Rgb }[] = [
  { name: 'dark canvas', rgb: [18, 17, 16] },
  { name: 'dark surface', rgb: [26, 24, 23] },
  { name: 'light canvas', rgb: [247, 245, 240] },
  { name: 'light surface', rgb: [252, 251, 247] },
];

const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/u;
const MAX_ASSET_BYTES = 256 * 1024;
const MAX_DIMENSION = 512;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type BrandingDto = {
  instance_name: string;
  tab_title: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  accent_color: string | null;
  accent_foreground: string | null;
};

function rgbToHex(rgb: Rgb): string {
  return `#${rgb
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function srgbChannel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * srgbChannel(rgb[0]) + 0.7152 * srgbChannel(rgb[1]) + 0.0722 * srgbChannel(rgb[2]);
}

export function contrastRatio(left: Rgb, right: Rgb): number {
  const a = relativeLuminance(left);
  const b = relativeLuminance(right);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export function readableForegroundFor(hex: string): { hex: string; ratio: number } {
  const rgb = hexToRgb(hex);
  const darkRatio = contrastRatio(INK_DARK, rgb);
  const lightRatio = contrastRatio(INK_LIGHT, rgb);
  return lightRatio >= darkRatio
    ? { hex: rgbToHex(INK_LIGHT), ratio: lightRatio }
    : { hex: rgbToHex(INK_DARK), ratio: darkRatio };
}

export function validateAccentColor(raw: string): { color: string; foreground: string } {
  const normalized = raw.trim().toUpperCase();
  if (!HEX_PATTERN.test(normalized)) {
    throw new AppError('validation_failed', {
      message: `Accent "${raw}" must be a 6-digit hex colour.`,
      hint: 'Use a six-digit hex colour such as #2563EB.',
      details: [{ path: 'accent_color', code: 'custom', message: 'expected #RRGGBB' }],
    });
  }

  const rgb = hexToRgb(normalized);
  const fg = readableForegroundFor(normalized);
  if (fg.ratio < 4.5) {
    throw new AppError('validation_failed', {
      message: `Accent ${normalized} fails WCAG AA text contrast (measured ${fg.ratio.toFixed(2)}:1, minimum 4.5:1).`,
      hint: 'Choose a darker or lighter hue so button text reaches at least 4.5:1.',
      details: [
        {
          path: 'accent_color',
          code: 'custom',
          message: `measured ${fg.ratio.toFixed(2)}:1 against foreground (min 4.5:1)`,
        },
      ],
    });
  }

  let worst = { name: '', ratio: Number.POSITIVE_INFINITY };
  for (const surface of SURFACES) {
    const measured = contrastRatio(rgb, surface.rgb);
    if (measured < worst.ratio) worst = { name: surface.name, ratio: measured };
  }
  if (worst.ratio < 3.0) {
    throw new AppError('validation_failed', {
      message: `Accent ${normalized} fails WCAG AA contrast on ${worst.name} (measured ${worst.ratio.toFixed(2)}:1, minimum 3.0:1).`,
      hint: 'Choose a mid-luminance hue that remains visible on both dark and light surfaces.',
      details: [
        {
          path: 'accent_color',
          code: 'custom',
          message: `measured ${worst.ratio.toFixed(2)}:1 on ${worst.name} (min 3.0:1)`,
        },
      ],
    });
  }

  return { color: normalized, foreground: fg.hex };
}

function validatePng(buffer: Buffer): string {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new AppError('validation_failed', {
      message: 'The uploaded file is not a valid PNG image.',
      hint: 'Upload a PNG or SVG image up to 512x512 pixels.',
      details: [{ path: 'file', code: 'custom', message: 'invalid PNG signature' }],
    });
  }
  const chunkType = buffer.subarray(12, 16).toString('ascii');
  if (chunkType !== 'IHDR') {
    throw new AppError('validation_failed', {
      message: 'The uploaded PNG is missing its header chunk.',
      hint: 'Re-export the PNG and try again.',
      details: [{ path: 'file', code: 'custom', message: 'missing IHDR' }],
    });
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new AppError('validation_failed', {
      message: `PNG dimensions ${width}x${height} exceed the ${MAX_DIMENSION}x${MAX_DIMENSION} limit.`,
      hint: `Resize the image to at most ${MAX_DIMENSION}x${MAX_DIMENSION} pixels.`,
      details: [{ path: 'file', code: 'custom', message: 'exceeds 512x512' }],
    });
  }
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

const UNSAFE_SVG =
  /<script\b|<foreignObject\b|<iframe\b|<embed\b|<object\b|\bon[a-z]+\s*=|javascript:|data:text\/html|(?:xlink:)?href\s*=\s*["']\s*https?:/iu;

function validateSvg(buffer: Buffer): string {
  const text = buffer.toString('utf8').trim();
  if (!/^(?:<\?xml[\s\S]*?\?>\s*)?<svg\b/iu.test(text) || !/<\/svg>\s*$/iu.test(text)) {
    throw new AppError('validation_failed', {
      message: 'The uploaded file is not a valid SVG document.',
      hint: 'Upload a standalone SVG or PNG image.',
      details: [{ path: 'file', code: 'custom', message: 'invalid SVG root' }],
    });
  }
  if (UNSAFE_SVG.test(text)) {
    throw new AppError('validation_failed', {
      message:
        'The uploaded SVG contains disallowed scripts, event handlers or external references.',
      hint: 'Remove scripts, event attributes and external URLs before uploading.',
      details: [{ path: 'file', code: 'custom', message: 'unsafe SVG content' }],
    });
  }
  const openTag = /<svg\b[^>]*>/iu.exec(text)?.[0] ?? '';
  for (const attr of ['width', 'height'] as const) {
    const match = new RegExp(`\\b${attr}\\s*=\\s*["']([0-9.]+)(?:px)?["']`, 'iu').exec(openTag);
    if (match?.[1] !== undefined && Number(match[1]) > MAX_DIMENSION) {
      throw new AppError('validation_failed', {
        message: `SVG ${attr} exceeds ${MAX_DIMENSION}px.`,
        hint: `Keep SVG dimensions at or below ${MAX_DIMENSION}x${MAX_DIMENSION}.`,
        details: [{ path: 'file', code: 'custom', message: `${attr} exceeds 512` }],
      });
    }
  }
  return `data:image/svg+xml;base64,${Buffer.from(text, 'utf8').toString('base64')}`;
}

export function validateUploadedAsset(buffer: Buffer, mimeType: string): string {
  if (buffer.length === 0) {
    throw new AppError('validation_failed', {
      message: 'The uploaded image is empty.',
      hint: 'Choose a PNG or SVG file.',
      details: [{ path: 'file', code: 'custom', message: 'empty file' }],
    });
  }
  if (buffer.length > MAX_ASSET_BYTES) {
    throw new AppError('payload_too_large', {
      message: 'The uploaded image exceeds the 256 KB limit.',
      hint: 'Compress the PNG or SVG below 256 KB.',
    });
  }
  const lower = mimeType.toLowerCase();
  if (lower === 'image/png') return validatePng(buffer);
  if (lower === 'image/svg+xml') return validateSvg(buffer);
  throw new AppError('validation_failed', {
    message: `Unsupported image type "${mimeType}".`,
    hint: 'Upload a PNG (image/png) or SVG (image/svg+xml) file.',
    details: [{ path: 'file', code: 'custom', message: 'expected image/png or image/svg+xml' }],
  });
}

function toBrandingDto(row: {
  instance_name: string;
  tab_title: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  accent_color: string | null;
}): BrandingDto {
  const accent = row.accent_color;
  return {
    instance_name: row.instance_name,
    tab_title: row.tab_title,
    logo_url: row.logo_url,
    favicon_url: row.favicon_url,
    accent_color: accent,
    accent_foreground:
      accent && HEX_PATTERN.test(accent) ? readableForegroundFor(accent).hex : null,
  };
}

const brandingPatchSchema = z
  .object({
    instance_name: z.string().trim().min(1).max(60).optional(),
    tab_title: z.string().trim().min(1).max(80).nullable().optional(),
    accent_color: z.string().trim().nullable().optional(),
    logo_url: z.null().optional(),
    favicon_url: z.null().optional(),
  })
  .strict();

async function requireAdmin(db: Db, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { is_instance_admin: true },
  });
  if (!user?.is_instance_admin) {
    throw new AppError('forbidden', {
      message: 'Only an instance admin can change instance branding.',
      hint: null,
    });
  }
}

export async function readBranding(db: Db): Promise<BrandingDto> {
  const row = await db.instanceSettings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
    select: {
      instance_name: true,
      tab_title: true,
      logo_url: true,
      favicon_url: true,
      accent_color: true,
    },
  });
  return toBrandingDto(row);
}

export function registerBrandingRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) {
      throw new AppError('internal', { message: 'database is required', hint: null });
    }
    return context.db;
  };

  app.get('/api/v1/branding', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return readBranding(database());
  });

  app.patch('/api/v1/admin/branding', async (request) => {
    const adminId = requireUser(request);
    const db = database();
    await requireAdmin(db, adminId);

    const parsed = brandingPatchSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const input = parsed.data;

    let accentColor: string | null | undefined = undefined;
    if (input.accent_color !== undefined) {
      accentColor =
        input.accent_color === null ? null : validateAccentColor(input.accent_color).color;
    }

    const updated = await db.instanceSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        ...(input.instance_name === undefined ? {} : { instance_name: input.instance_name }),
        ...(input.tab_title === undefined ? {} : { tab_title: input.tab_title }),
        ...(accentColor === undefined ? {} : { accent_color: accentColor }),
        ...(input.logo_url === undefined ? {} : { logo_url: input.logo_url }),
        ...(input.favicon_url === undefined ? {} : { favicon_url: input.favicon_url }),
      },
      update: {
        ...(input.instance_name === undefined ? {} : { instance_name: input.instance_name }),
        ...(input.tab_title === undefined ? {} : { tab_title: input.tab_title }),
        ...(accentColor === undefined ? {} : { accent_color: accentColor }),
        ...(input.logo_url === undefined ? {} : { logo_url: input.logo_url }),
        ...(input.favicon_url === undefined ? {} : { favicon_url: input.favicon_url }),
      },
      select: {
        instance_name: true,
        tab_title: true,
        logo_url: true,
        favicon_url: true,
        accent_color: true,
      },
    });
    return toBrandingDto(updated);
  });

  app.post('/api/v1/admin/branding/logo', async (request) => {
    const adminId = requireUser(request);
    const db = database();
    await requireAdmin(db, adminId);

    const file = await request.file();
    if (!file) {
      throw new AppError('validation_failed', {
        message: 'A file upload named "file" is required.',
        hint: 'Send multipart/form-data with a PNG or SVG file.',
        details: [{ path: 'file', code: 'custom', message: 'missing file' }],
      });
    }
    const buffer = await file.toBuffer();
    const dataUri = validateUploadedAsset(buffer, file.mimetype);
    const query = request.query as { kind?: string };
    const field = query.kind === 'favicon' ? 'favicon_url' : 'logo_url';

    const updated = await db.instanceSettings.upsert({
      where: { id: 1 },
      create: { id: 1, [field]: dataUri },
      update: { [field]: dataUri },
      select: {
        instance_name: true,
        tab_title: true,
        logo_url: true,
        favicon_url: true,
        accent_color: true,
      },
    });
    return toBrandingDto(updated);
  });
}
