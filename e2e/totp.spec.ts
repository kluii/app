// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of input.toUpperCase()) {
    const index = BASE32.indexOf(character);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The same RFC 6238 code an authenticator app would show, computed here. */
function codeFor(secret: string, atMs: number = Date.now()): string {
  const step = Math.floor(atMs / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, '0');
}

async function csrf(request: APIRequestContext): Promise<string> {
  const state = await request.storageState();
  const cookie = state.cookies.find((entry) => entry.name === 'klui_csrf');
  if (!cookie) throw new Error('the signup did not set a CSRF cookie');
  return cookie.value;
}

async function signUpWithTotp(
  request: APIRequestContext,
  username: string,
): Promise<{ secret: string }> {
  const signup = await request.post('/api/v1/auth/signup', {
    data: { email: `${username}@klui.test`, username, password: 'a-long-passphrase-9' },
  });
  expect(signup.status()).toBe(201);

  const enrolled = await request.post('/api/v1/auth/totp/enroll', {
    headers: { 'x-klui-csrf': await csrf(request) },
  });
  expect(enrolled.status()).toBe(201);
  const { secret } = (await enrolled.json()) as { secret: string };

  const verified = await request.post('/api/v1/auth/totp/verify', {
    headers: { 'x-klui-csrf': await csrf(request) },
    data: { code: codeFor(secret) },
  });
  expect(verified.status()).toBe(200);
  return { secret };
}

async function signInWithPassword(page: Page, username: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email or username').fill(username);
  await page.getByLabel('Password').fill('a-long-passphrase-9');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('a password login stops at the second factor and continues with the code', async ({
  request,
  browser,
}) => {
  const username = 'factor-user';
  const { secret } = await signUpWithTotp(request, username);

  const context = await browser.newContext();
  const page = await context.newPage();
  await signInWithPassword(page, username);

  const codeField = page.getByLabel('Six-digit code');
  await expect(codeField).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

  // The next step: the enrolment already spent this one (replay protection).
  await codeField.fill(codeFor(secret, Date.now() + 30_000));
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Boards' })).toBeVisible();
  await context.close();
});

test('the account page reveals the secret and the recovery codes once', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'No account yet? Create one' }).click();
  await page.getByLabel('Email').fill('panel@klui.test');
  await page.getByLabel('Username').fill('panel-user');
  await page.getByLabel('Password').fill('a-long-passphrase-9');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Boards' })).toBeVisible();

  await page.getByRole('link', { name: 'Account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();

  await page.getByRole('button', { name: 'Turn on two-factor' }).click();
  await expect(page.getByTestId('recovery-code')).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Turn it on' })).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('recovery-code')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Turn on two-factor' })).toBeVisible();
});
