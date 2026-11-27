// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K3-04 in a browser: a moderated write vanishes into the queue, the owner sees
 * the count, approves it, and the card appears with the visitor's own name.
 */
import { expect, test } from '@playwright/test';
import { BOARD_NAME, openBoard, patch, uniqueUsername } from './support';

test('a moderated write waits, then becomes a card on approval', async ({
  page,
  browser,
  request,
}) => {
  const username = uniqueUsername('moderate');
  const { boardId, columns } = await openBoard(page, request, username, ['Alpha']);
  const board = await patch<{ slug: string; link_suffix: string | null }>(
    request,
    `/api/v1/boards/${boardId}`,
    { visibility: 'link', link_role: 'read', anon_write: 'moderated' },
  );
  const column = columns[0];
  if (!column) throw new Error('no column');

  // The stranger writes; the card exists nowhere yet.
  const stranger = await browser.newContext();
  const visitor = await stranger.newPage();
  await visitor.goto(`/${username}/${board.slug}-${String(board.link_suffix)}`, {
    waitUntil: 'domcontentloaded',
  });
  await visitor.getByLabel('Your name').fill('Under review');
  await visitor.getByRole('button', { name: 'Join the board' }).click();
  await visitor
    .getByTestId(`column-${column.id}`)
    .getByRole('button', { name: 'Add card' })
    .click();
  await visitor.getByLabel('Card title').fill('Proposed by a stranger');
  await visitor.getByRole('button', { name: 'Create card' }).click();
  await expect(
    visitor.getByTestId('card-title').filter({ hasText: 'Proposed by a stranger' }),
  ).toHaveCount(0);
  await stranger.close();

  // The owner sees one waiting and approves it.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('open-moderation').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Proposed by a stranger')).toBeVisible();
  await expect(dialog.getByText('by Under review')).toBeVisible();
  await dialog.getByRole('button', { name: 'Approve' }).click();
  await page.keyboard.press('Escape');

  const card = page.getByTestId('card-title').filter({ hasText: 'Proposed by a stranger' });
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: /Open Proposed by a stranger/u }).click();
  await expect(page.getByRole('dialog').getByText('by Under review')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: BOARD_NAME })).toBeVisible();
});
