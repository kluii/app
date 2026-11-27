// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-12 in a browser: the close dialog refuses until it is acknowledged, the
 * board turns read-only, and the summary page is what the link opens.
 */
import { expect, test } from '@playwright/test';
import { csrf, openBoard, patch, uniqueUsername } from './support';

test('closing a board freezes it and opens a summary a reader can use', async ({
  page,
  request,
}) => {
  const { cards, boardId } = await openBoard(page, request, uniqueUsername('close'), [
    'Finished thing',
    'Unfinished thing',
  ]);
  const first = cards[0];
  if (!first) throw new Error('no card');

  // Mark one card done through the API so the summary has both sections.
  await patch(request, `/api/v1/cards/${first.id}`, { done: true });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('open-close-board').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Irreversible, so the confirm stays disabled until it is acknowledged.
  await expect(dialog.getByTestId('close-board-confirm')).toBeDisabled();
  await dialog.getByTestId('close-board-ack').check();
  await dialog.getByTestId('close-board-note').fill('Cut the export scope, shipped the rest.');
  await dialog.getByTestId('close-board-confirm').click();

  await expect(page.getByTestId('board-closed-chip')).toBeVisible();
  await expect(page.getByTestId('open-close-board')).toHaveCount(0);
  // No write affordance survives: no composer button, no card tick.
  await expect(page.getByTestId(`card-reopen-${first.id}`)).toHaveCount(0);

  await page.getByTestId('open-board-summary').click();
  await expect(page.getByTestId('summary')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Board under test');
  await expect(page.getByText('Finished thing', { exact: true })).toBeVisible();
  await expect(page.getByText('Unfinished thing', { exact: true })).toBeVisible();
  await expect(page.getByText('Cut the export scope, shipped the rest.')).toBeVisible();

  // A reload of the board URL still shows the closed state, and the API refuses.
  await page.goto(`/boards/${boardId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('board-closed-chip')).toBeVisible();
  const write = await request.patch(`/api/v1/cards/${first.id}`, {
    headers: { 'x-klui-csrf': await csrf(request) },
    data: { title: 'Not any more' },
  });
  expect(write.status()).toBe(403);
  expect(((await write.json()) as { error: { code: string } }).error.code).toBe('board_closed');
});
