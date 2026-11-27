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
const LIGHT_CANVAS = 'rgb(247, 245, 240)';
const DARK_CANVAS = 'rgb(18, 17, 16)';

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
