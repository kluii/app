// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';
import { PASSWORD, uniqueUsername } from './support';

const RUN = Date.now().toString(36);

test('revoking the current session in /settings signs out immediately (K5-08)', async ({
  page,
}) => {
  const username = `sess-ui-${RUN}`;
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill(`${username}@klui.test`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill('a-long-passphrase-9');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Boards' })).toBeVisible();

  // The bar carries one identity: the avatar opens the menu, the menu opens the
  // screen, the rail opens the section.
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Account settings' }).click();
  await page.getByTestId('settings-tab-sessions').click();
  await expect(page.getByRole('heading', { level: 2, name: 'Active sessions' })).toBeVisible();

  const currentRow = page.getByTestId('session-row').filter({ hasText: 'Current' });
  await expect(currentRow).toHaveCount(1);
  await currentRow.getByRole('button', { name: 'Revoke' }).click();

  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
});

test('a notification switch saves at once and the preference survives a reload (K5-04)', async ({
  page,
  request,
}) => {
  const username = uniqueUsername('notif');
  await request.post('/api/v1/auth/signup', {
    data: { email: `${username}@klui.test`, username, password: PASSWORD },
  });
  await page.context().addCookies((await request.storageState()).cookies);

  await page.goto('/settings?section=notifications', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 2, name: 'Notifications' })).toBeVisible();

  // Six kinds, one switch each, all on by default.
  await expect(page.getByRole('switch')).toHaveCount(6);

  const mention = page.getByRole('switch', { name: /Mentioned in a comment/u });
  await expect(mention).toHaveAttribute('aria-checked', 'true');
  await mention.click();
  await expect(mention).toHaveAttribute('aria-checked', 'false');

  // Saved server-side, not only on screen.
  await expect
    .poll(async () => {
      const response = await request.get('/api/v1/me/notifications/prefs');
      const body = (await response.json()) as { muted_kinds: string[] };
      return body.muted_kinds;
    })
    .toContain('mention');

  // The switch also works from the keyboard alone.
  const dueSoon = page.getByRole('switch', { name: /due within 24 hours/u });
  await dueSoon.focus();
  await page.keyboard.press('Space');
  await expect(dueSoon).toHaveAttribute('aria-checked', 'false');

  // A reload keeps the stored preference.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('switch', { name: /Mentioned in a comment/u })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(page.getByRole('switch', { name: /due within 24 hours/u })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});
