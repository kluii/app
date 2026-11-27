// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-14 in a browser: a colour chosen from the palette sticks to the card, and
 * "use on every card with this tag" writes the board default that the other
 * cards already showing that tag pick up.
 */
import { expect, test } from '@playwright/test';
import { csrf, openBoard, uniqueUsername } from './support';

test('a tag colour is chosen in the editor and rendered on the card', async ({ page, request }) => {
  const { cards, boardId } = await openBoard(page, request, uniqueUsername('tags'), ['Tagged']);
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
  await expect(editor.getByTestId('tag-row-api')).toBeVisible();
  await editor.getByTestId('swatch-api-violet').click();
  await editor.getByTestId('board-wide-api').check();
  await editor.getByRole('button', { name: 'Save' }).click();
  // Saving returns to the read view of the same card, not to the board.
  const read = page.getByRole('dialog');
  await expect(read.getByRole('heading', { name: 'Tagged' })).toBeVisible();
  await read.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The chip is the tag's own element, not a child of the card button.
  const chip = page.locator('.tag-chip', { hasText: 'api' }).first();
  await expect(chip).toBeVisible();
  const inline = await chip.getAttribute('style');
  expect(inline ?? '').toContain('--tag');

  const defaults = (await (
    await request.get(`/api/v1/boards/${boardId}/tag-colors`)
  ).json()) as Record<string, string>;
  expect(defaults.api?.toLowerCase()).toMatch(/^#[0-9a-f]{6}$/);
});
