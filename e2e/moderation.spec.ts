// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K3-04 in a browser, after the rule that a board is written by its members.
 *
 * A moderated board still has a queue and an owner who can read it; what it no
 * longer has is a way to put a row in it. The dialog says so in one line.
 */
import { expect, test } from '@playwright/test';
import { openBoard, openBoardMenu, patch, uniqueUsername } from './support';

test('an anonymous write is refused, and nothing waits for approval', async ({ page, request }) => {
  const username = uniqueUsername('moderate');
  const { boardId, columns } = await openBoard(page, request, username, ['Alpha']);
  await patch(request, `/api/v1/boards/${boardId}`, { visibility: 'link', link_role: 'read' });
  const column = columns[0];
  if (!column) throw new Error('no column');

  // The write the queue was built for is refused at the door now.
  const refused = await request.post(`/api/v1/boards/${boardId}/cards`, {
    data: { column: column.id, title: 'Proposed by a stranger' },
  });
  expect(refused.status()).toBe(403);

  const pending = await request.get(`/api/v1/boards/${boardId}/pending`);
  expect((await pending.json()) as { items: unknown[] }).toEqual({ items: [] });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openBoardMenu(page);
  await page.getByTestId('open-moderation').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Nothing waiting.');
  await expect(dialog.getByRole('button', { name: 'Approve' })).toHaveCount(0);
});
