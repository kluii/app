// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-09 in a browser: the thread on a card, and the activity feed grouped by
 * day with an actor filter that actually filters.
 *
 * The first assertion is a regression guard for K2-07: the read panel still
 * opens with no input in it, because the composer appears only when asked for.
 */
import { expect, test } from '@playwright/test';
import { openBoard, openBoardMenu, patch, uniqueUsername } from './support';

test('a comment is written from the card, marked when edited, and survives a reload', async ({
  page,
  request,
}) => {
  const { cards } = await openBoard(page, request, uniqueUsername('comment'), ['Discuss me']);
  const card = cards[0];
  if (!card) throw new Error('no card');

  await page.getByTestId(`card-${card.id}`).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // K2-07 still holds: opening the panel does not hand focus to an input.
  expect(await dialog.locator('input, textarea').count()).toBe(0);

  await dialog.getByTestId('comment-open').click();
  await dialog.getByTestId('comment-input').fill('First pass on the importer.');
  await dialog.getByTestId('comment-submit').click();
  await expect(dialog.getByText('First pass on the importer.')).toBeVisible();

  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId(`card-${card.id}`).click();
  await expect(dialog.getByText('First pass on the importer.')).toBeVisible();

  // The footer's "Edit" opens the whole-card editor; the thread's own control
  // carries a test id so the two never collide.
  await dialog
    .getByTestId(/^comment-edit-/)
    .first()
    .click();
  await dialog.getByTestId('comment-edit-input').fill('Rewritten after review.');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Rewritten after review.')).toBeVisible();
  await expect(dialog.getByText('edited', { exact: true })).toBeVisible();
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
