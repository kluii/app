// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-08 on a built server: the tick renders only on a done card, it writes one
 * request, and a done card stays in its column.
 *
 * The read-only half — a static mark instead of a control a reader cannot use —
 * needs a second membership role, which arrives with K3-05; it is asserted at
 * the API level in server/test/boards-cards.test.ts.
 */
import { expect, test, type Locator } from '@playwright/test';
import { openBoard, patch, titlesIn, uniqueUsername } from './support';

function titleOf(card: Locator): Locator {
  return card.locator('..').getByTestId('card-title');
}

test('the read view ticks a card done, and the mark survives a reload', async ({
  page,
  request,
}) => {
  const { cards, columns } = await openBoard(page, request, uniqueUsername('done'), ['Finish me']);
  const card = cards[0];
  const [toDo] = columns;
  if (!card || !toDo) throw new Error('no card');

  // A card that is not done shows no empty checkbox anywhere.
  await expect(page.getByTestId(`card-reopen-${card.id}`)).toHaveCount(0);

  await page.getByTestId(`card-${card.id}`).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark done' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  // The card stays in its column, struck through, with a reopen control.
  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Finish me']);
  await expect(page.getByTestId(`card-reopen-${card.id}`)).toBeVisible();
  await expect(titleOf(page.getByTestId(`card-${card.id}`))).toHaveCSS(
    'text-decoration-line',
    'line-through',
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Finish me']);
  await expect(page.getByTestId(`card-reopen-${card.id}`)).toBeVisible();
});

test('the row tick reopens a done card in one request', async ({ page, request }) => {
  const { cards, columns } = await openBoard(page, request, uniqueUsername('reopen'), ['Already']);
  const card = cards[0];
  const [toDo] = columns;
  if (!card || !toDo) throw new Error('no card');
  await patch(request, `/api/v1/cards/${card.id}`, { done: true });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId(`card-reopen-${card.id}`)).toBeVisible();
  await page.getByTestId(`card-reopen-${card.id}`).click();
  await expect(page.getByTestId(`card-reopen-${card.id}`)).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Already']);
  await expect(page.getByTestId(`card-${card.id}`)).toHaveAttribute('aria-label', 'Open Already');
});
