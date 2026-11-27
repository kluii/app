// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'a-long-passphrase-9';
// The suite runs against a schema that may hold earlier runs (a targeted
// `npx playwright test e2e/…` does not reset it). A fixed username turns the
// second run into a 409 on signup and a red that has nothing to do with the
// product; the suffix costs nothing and keeps the test re-runnable.
const RUN = Date.now().toString(36);

function identity(name: string): { email: string; username: string } {
  return { email: `${name}-${RUN}@klui.test`, username: `${name}-${RUN}` };
}

async function signUp(page: Page, input: { email: string; username: string }): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'No account yet? Create one' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create an account');

  await page.getByLabel('Email').fill(input.email);
  await page.getByLabel('Username').fill(input.username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Boards' })).toBeVisible();
}

test('signs up, creates a board with a column and a card, and keeps them across a reload', async ({
  page,
}) => {
  await signUp(page, identity('first'));

  await page.getByRole('button', { name: 'New board' }).click();
  await page.getByLabel('Board name').fill('Launch plan');
  await page.getByRole('button', { name: 'Create board' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Launch plan' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'To do' })).toBeVisible();

  const toDo = page.locator('[data-testid^="column-"]').first();
  await toDo.getByRole('button', { name: 'Add card' }).click();
  await page.getByLabel('Card title').fill('Write the release note');
  await page.getByRole('button', { name: 'Create card' }).click();

  await expect(page.getByText('Write the release note')).toBeVisible();

  await page.getByRole('button', { name: 'Add column' }).click();
  await page.getByLabel('Column name').fill('Shipped');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'Shipped' })).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { level: 1, name: 'Launch plan' })).toBeVisible();
  await expect(page.getByText('Write the release note')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Shipped' })).toBeVisible();
});

test('a second account gets the same answer for a foreign board as for one that never existed', async ({
  browser,
}) => {
  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await signUp(ownerPage, identity('owner'));

  await ownerPage.getByRole('button', { name: 'New board' }).click();
  await ownerPage.getByLabel('Board name').fill('Owner only');
  await ownerPage.getByRole('button', { name: 'Create board' }).click();
  await expect(ownerPage.getByRole('heading', { level: 1, name: 'Owner only' })).toBeVisible();

  const foreignUrl = ownerPage.url();
  const missingUrl = foreignUrl.replace(/\/boards\/[^/]+$/, '/boards/brd_0000000000000000000000');
  expect(missingUrl).not.toBe(foreignUrl);

  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await signUp(strangerPage, identity('stranger'));

  await strangerPage.goto(foreignUrl, { waitUntil: 'domcontentloaded' });
  await expect(
    strangerPage.getByRole('heading', { level: 1, name: 'This board could not be loaded' }),
  ).toBeVisible();
  const foreignBody = await strangerPage.textContent('main');

  await strangerPage.goto(missingUrl, { waitUntil: 'domcontentloaded' });
  await expect(
    strangerPage.getByRole('heading', { level: 1, name: 'This board could not be loaded' }),
  ).toBeVisible();
  const missingBody = await strangerPage.textContent('main');

  // Unreadable means non-existent: the two pages are the same page.
  expect(foreignBody).toBe(missingBody);
  expect(foreignBody).toContain('It does not exist, or you cannot read it.');

  await owner.close();
  await stranger.close();
});

test('the reset page fails closed when the instance cannot send mail', async ({ page }) => {
  await page.goto('/reset', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeVisible();

  await page.getByLabel('Email').fill('someone@klui.test');
  await page.getByRole('button', { name: 'Send the link' }).click();

  // No SMTP in the e2e server: the page says so instead of faking a send.
  await expect(page.getByRole('alert')).toHaveText(
    'This instance cannot send mail. Ask an instance admin for a link.',
  );
});
