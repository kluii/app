// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

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

  await page.getByRole('link', { name: 'Account' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Active sessions' })).toBeVisible();

  const currentRow = page.getByTestId('session-row').filter({ hasText: 'Current' });
  await expect(currentRow).toHaveCount(1);
  await currentRow.getByRole('button', { name: 'Revoke' }).click();

  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
});
