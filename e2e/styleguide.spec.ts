// SPDX-License-Identifier: AGPL-3.0-only
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * K2-02 and K2-15: the states page is the one place every primitive appears, so
 * it is where axe runs on the component layer. The board routes get their own
 * runs; this one is about the parts that only exist inside a component.
 */
for (const theme of ['dark', 'light'] as const) {
  test(`the component states page has no axe violations in ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('klui-theme', value);
    }, theme);

    await page.goto('/styleguide', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
}

test('the states page shows every primitive in every state', async ({ page }) => {
  await page.goto('/styleguide', { waitUntil: 'domcontentloaded' });

  for (const section of [
    'Button',
    'Input, textarea, select',
    'Checkbox',
    'Chip and tag chip',
    'Dialog',
    'Popover and menu',
    'Tooltip',
    'Toast',
    'Table row',
    'Separator',
    'Spinner',
  ]) {
    await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible();
  }

  // Six specimens: default, hover, active, focus, disabled, loading. The last
  // two are inert by construction (one disabled, one busy).
  const saveButtons = page.getByRole('button', { name: 'Save' });
  await expect(saveButtons).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Save', disabled: true })).toHaveCount(2);

  await page.getByRole('button', { name: 'Open' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByRole('button', { name: 'Show a toast' }).first().click();
  await expect(page.getByTestId('toast')).toBeVisible();
});
