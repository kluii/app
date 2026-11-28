// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-09 in a browser, after the comment thread left the card panel: the panel
 * carries no thread and asks the API for nothing, while the activity feed is
 * still grouped by day and its actor filter still filters.
 *
 * The API, the table and the activity events stay (a client that still reads
 * them is unaffected), so the first test is a guard on the client, not on the
 * feature.
 */
import { expect, test } from '@playwright/test';
import { openBoard, openBoardMenu, patch, uniqueUsername } from './support';

test('a card panel carries no comment thread', async ({ page, request }) => {
  const { cards } = await openBoard(page, request, uniqueUsername('nocomment'), ['Read only']);
  const card = cards[0];
  if (!card) throw new Error('no card');

  await page.getByTestId(`card-${card.id}`).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // No thread, no heading, no composer — and therefore no input to focus
  // (K2-07), which the read view promises on its own.
  await expect(dialog.getByTestId('card-thread')).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'Comments' })).toHaveCount(0);
  await expect(dialog.locator('input, textarea')).toHaveCount(0);

  // The endpoint still answers: the panel is empty because the client does not
  // ask, not because the comments are gone from the server.
  const response = await request.get(`/api/v1/cards/${card.id}/comments`);
  expect(response.ok(), 'the comments API still answers').toBeTruthy();
});

test('the activity feed groups by day and keeps only the actor kind asked for', async ({
  page,
  request,
}) => {
  const { cards, boardId } = await openBoard(page, request, uniqueUsername('activity'), [
    'Feed me',
  ]);
  const card = cards[0];
  if (!card) throw new Error('no card');

  await patch(request, `/api/v1/cards/${card.id}`, { done: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openBoardMenu(page);
  await page.getByTestId('open-activity').click();

  const list = page.getByTestId('activity-list');
  await expect(list).toBeVisible();
  // A day heading is not repeated per row.
  const headings = list.locator('h3');
  await expect(headings.first()).toBeVisible();
  expect(await headings.count()).toBe(1);

  await page.getByTestId('activity-filter-agent').click();
  await expect(page.getByTestId('activity-empty')).toBeVisible();

  await page.getByTestId('activity-filter-all').click();
  await expect(list).toBeVisible();

  // A row that names a card opens it.
  await list.getByRole('button').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Feed me')).toBeVisible();
  void boardId;
});
