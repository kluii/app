// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-14 in a browser: a tag added through the editor's input takes a preset
 * colour from the chip's panel, and the card's chip carries it after a save and
 * a reload; a custom colour picked through the native colour input persists the
 * same way. "Use on every card with this tag" writes the board default that the
 * other cards already showing that tag pick up. The chip stays readable — the
 * contrast test covers the tint algebra.
 */
import { expect, test } from '@playwright/test';
import { csrf, openBoard, uniqueUsername } from './support';

test('a tag added in the editor takes a preset colour that survives a save and a reload', async ({
  page,
  request,
}) => {
  const { cards, boardId } = await openBoard(page, request, uniqueUsername('tags'), ['Tagged']);
  const card = cards[0];
  if (!card) throw new Error('no card');

  await page.getByTestId(`card-${card.id}`).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog');

  // The input adds the tag on Enter, normalised to lowercase.
  await editor.getByTestId('tag-add-input').fill('API');
  await editor.getByTestId('tag-add-input').press('Enter');
  const chipButton = editor.getByTestId('tag-chip-api');
  await expect(chipButton).toBeVisible();

  // Clicking the chip opens its colour panel; the preset applies to the preview live.
  await chipButton.click();
  const panel = editor.getByTestId('tag-panel-api');
  await expect(panel).toBeVisible();
  const violet = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--tag-violet').trim(),
  );
  await panel.getByTestId('swatch-api-violet').click();
  await expect(panel.locator('.tag-chip')).toHaveAttribute(
    'style',
    new RegExp(`--tag:\\s*${violet}`, 'i'),
  );
  await panel.getByTestId('board-wide-api').check();
  await editor.getByRole('button', { name: 'Save' }).click();

  // Saving returns to the read view of the same card, not to the board.
  const read = page.getByRole('dialog');
  await expect(read.getByRole('heading', { name: 'Tagged' })).toBeVisible();
  await read.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // After a reload the card's chip is the tag's own element, carrying its colour.
  await page.reload({ waitUntil: 'domcontentloaded' });
  const chip = page.locator('.tag-chip', { hasText: 'api' }).first();
  await expect(chip).toBeVisible();
  const inline = await chip.getAttribute('style');
  expect(inline ?? '').toContain('--tag');
  expect(inline ?? '').toContain(violet);

  const defaults = (await (
    await request.get(`/api/v1/boards/${boardId}/tag-colors`)
  ).json()) as Record<string, string>;
  expect(defaults.api?.toLowerCase()).toBe(violet.toLowerCase());
});

test('a custom colour picked through the colour input persists', async ({ page, request }) => {
  const { cards } = await openBoard(page, request, uniqueUsername('tags'), ['Tagged']);
  const card = cards[0];
  if (!card) throw new Error('no card');

  // Give the card a tag through the API so the editor has one to colour.
  const tagged = await request.patch(`/api/v1/cards/${card.id}`, {
    headers: { 'x-klui-csrf': await csrf(request) },
    data: { tags: [{ name: 'api' }] },
  });
  expect(tagged.ok()).toBeTruthy();
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.getByTestId(`card-${card.id}`).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog');
  await editor.getByTestId('tag-chip-api').click();
  const panel = editor.getByTestId('tag-panel-api');
  await expect(panel).toBeVisible();

  // The eyedropper opens the native colour input; the chosen hex applies live
  // to the preview (the native value setter, so React sees the change).
  await panel.getByTestId('color-input-api').evaluate((input: HTMLInputElement) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(input, '#12ab34');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(panel.locator('.tag-chip')).toHaveAttribute('style', /--tag:\s*#12ab34/i);

  await editor.getByRole('button', { name: 'Save' }).click();
  const read = page.getByRole('dialog');
  await expect(read.getByRole('heading', { name: 'Tagged' })).toBeVisible();
  await read.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  const chip = page.locator('.tag-chip', { hasText: 'api' }).first();
  await expect(chip).toBeVisible();
  const inline = await chip.getAttribute('style');
  expect(inline ?? '').toContain('--tag');
  expect(inline ?? '').toMatch(/--tag:\s*#12ab34/i);
});
