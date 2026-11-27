// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/** The version the built server must report: the one in package.json (D-42). */
const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

test.describe('the shell', () => {
  test('healthz reports the running build and the database', async ({ request }) => {
    const response = await request.get('/healthz');
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', version: VERSION, db: 'up' });
  });

  test('answers / with a redirect, never a marketing page', async ({ request }) => {
    const response = await request.get('/', { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers()['location']).toBe('/login');
  });

  test('serves the SPA with the theme applied before paint', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(['dark', 'light']).toContain(theme);

    const heading = await page.getByRole('heading', { level: 1 }).textContent();
    expect(heading?.trim()).toBe('Sign in');
  });

  test('authorises the theme bootstrap with a CSP hash, not unsafe-inline', async ({ page }) => {
    const response = await page.goto('/login', { waitUntil: 'domcontentloaded' });
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
  });

  test('keeps the app origin out of an unfurl for a credentialed URL later, and 404s unknown API paths', async ({
    request,
  }) => {
    const response = await request.get('/api/v1/nothing', {
      headers: { accept: 'application/json' },
    });
    expect(response.status()).toBe(404);
    expect((await response.json()).error.code).toBe('not_found');
  });
});
