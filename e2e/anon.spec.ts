// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Nobody writes without an account, and a readable URL is not a credential.
 *
 * A stranger who opens the board's readable URL holds no `klui_link` cookie, so
 * the page tells them to open the link they were given instead of offering a
 * write. The display-name gate that used to turn that URL into a session is
 * closed: the API refuses the join.
 */
import { expect, test } from '@playwright/test';
import { patch, seedBoard, uniqueUsername } from './support';

test('a readable URL alone grants nothing: no name gate, no write', async ({
  browser,
  request,
}) => {
  const username = uniqueUsername('anonwrite');
  const { boardId } = await seedBoard(request, username, ['Alpha']);
  const board = await patch<{ slug: string; link_suffix: string | null }>(
    request,
    `/api/v1/boards/${boardId}`,
    { visibility: 'link', link_role: 'read' },
  );

  const stranger = await browser.newContext();
  const page = await stranger.newPage();
  await page.goto(`/${username}/${board.slug}-${String(board.link_suffix)}`, {
    waitUntil: 'domcontentloaded',
  });

  // The URL alone resolves to nothing: a link board's URL is its credential,
  // and the credential here is the `/l/<token>` cookie, not the address.
  await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View the board' })).toHaveCount(0);
  await stranger.close();
});

test('the join gate is closed: the API refuses every anonymous write', async ({ request }) => {
  const username = uniqueUsername('anontwo');
  const { boardId, columns } = await seedBoard(request, username, ['Alpha']);
  await patch(request, `/api/v1/boards/${boardId}`, { visibility: 'link', link_role: 'read' });
  const column = columns[0];
  if (!column) throw new Error('no column');

  const joined = await request.post(`/api/v1/boards/${boardId}/anon`, {
    data: { label: 'A passer-by' },
  });
  expect(joined.status()).toBe(403);

  const card = await request.post(`/api/v1/boards/${boardId}/cards`, {
    data: { column: column.id, title: 'Written without an account' },
  });
  expect(card.status()).toBe(403);
});

test('a private board does not offer the gate', async ({ page, request }) => {
  const username = uniqueUsername('anonprivate');
  const { boardId } = await seedBoard(request, username, ['Alpha']);
  await page.goto(`/boards/${boardId}`, { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { level: 1, name: 'This board could not be loaded' }),
  ).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveCount(0);
});
