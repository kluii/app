// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test';

/**
 * K2-01: the theme is applied by the inline bootstrap in `index.html`, before
 * React mounts. The proof is the computed background at `domcontentloaded`:
 * if the attribute were set after hydration, this is where the dark canvas
 * would still be visible.
 *
 * The pair of images this file writes to `test-results/theme` is recorded for
 * the verify file; the assertion does not depend on them.
 */
const LIGHT_CANVAS = 'rgb(245, 245, 244)';
const DARK_CANVAS = 'rgb(11, 11, 12)';

async function backgroundAtLoad(page: Page): Promise<string> {
  const value = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return { theme: document.documentElement.dataset.theme, colour: style.backgroundColor };
  });
  return `${String(value.theme)}:${value.colour}`;
}

test('a stored light theme is the very first thing painted, even on a dark OS', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    localStorage.setItem('klui-theme', 'light');
  });

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  expect(await backgroundAtLoad(page)).toBe(`light:${LIGHT_CANVAS}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('a stored dark theme is not overridden by a light OS', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    localStorage.setItem('klui-theme', 'dark');
  });

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  expect(await backgroundAtLoad(page)).toBe(`dark:${DARK_CANVAS}`);
});

test('with nothing stored, the OS preference decides', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await backgroundAtLoad(page)).toBe(`light:${LIGHT_CANVAS}`);
});

/**
 * The interface block (fix pass). The theme and the language left the account
 * menu for Settings, where a choice made once belongs: two icon buttons for the
 * theme, two words for the language, no native select. Both are stored by the
 * browser, so both survive a reload.
 */
test('the interface block in Settings switches the theme and the language', async ({ page }) => {
  const run = Date.now().toString(36);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill(`interface-${run}@klui.test`);
  await page.getByLabel('Username').fill(`interface-${run}`);
  await page.getByLabel('Password').fill('a-long-passphrase-9');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Boards' })).toBeVisible();

  await page.getByTestId('account-avatar').click();
  // The menu no longer offers a language: it states who you are and the theme.
  await expect(page.getByRole('menuitemradio', { name: 'English' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Account settings' }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Interface' })).toBeVisible();

  // The theme: the light button is pressed on a light OS, and dark is one click.
  const light = page.getByRole('button', { name: 'Light' });
  const dark = page.getByRole('button', { name: 'Dark' });
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await dark.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
  ).toBe(DARK_CANVAS);
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect(light).toHaveAttribute('aria-pressed', 'false');

  // The language: French renames the screen and the document, and sticks.
  await page.getByRole('button', { name: 'Français' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Paramètres');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
