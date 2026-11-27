// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K3-02 in a browser that has never signed in: a write link opens the board,
 * the token leaves the URL bar, the visitor can add a card, and revoking the
 * link ends their access on the next load.
 */
import { expect, test } from '@playwright/test';
import { BOARD_NAME, csrf, patch, post, seedBoard, uniqueUsername } from './support';

type Link = { id: string; token: string; url: string; role: string };

test('a write link is a credential a stranger can use, and revoking it ends that', async ({
  browser,
  request,
}) => {
  const username = uniqueUsername('linkdoor');
  const { boardId, columns } = await seedBoard(request, username, ['Alpha']);
  await patch(request, `/api/v1/boards/${boardId}`, { visibility: 'link', link_role: 'read' });
  const link = await post<Link>(request, `/api/v1/boards/${boardId}/links`, { role: 'edit' });

  const stranger = await browser.newContext();
  const page = await stranger.newPage();

  await page.goto(link.url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: BOARD_NAME })).toBeVisible();
  expect(page.url()).not.toContain(link.token);
  await expect(page).toHaveURL(new RegExp(`/boards/${boardId}$`, 'u'));

  // The link actor can write: the add-card affordance is there and works.
  const column = columns[0];
  if (!column) throw new Error('no column');
  await page.getByTestId(`column-${column.id}`).getByRole('button', { name: 'Add card' }).click();
  await page.getByLabel('Card title').fill('Added from a link');
  await page.getByRole('button', { name: 'Create card' }).click();
  await expect(
    page.getByTestId('card-title').filter({ hasText: 'Added from a link' }),
  ).toBeVisible();

  // Revoking ends the link on the next request, with no session to refresh.
  const revoked = await request.delete(`/api/v1/boards/${boardId}/links/${link.id}`, {
    headers: { 'x-klui-csrf': await csrf(request) },
  });
  expect(revoked.status()).toBe(204);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { level: 1, name: 'This board could not be loaded' }),
  ).toBeVisible();
  await stranger.close();
});

test('a read link sees the board and no write affordance at all', async ({ browser, request }) => {
  const username = uniqueUsername('linkread');
  const { boardId, columns } = await seedBoard(request, username, ['Alpha']);
  await patch(request, `/api/v1/boards/${boardId}`, { visibility: 'link', link_role: 'read' });
  const link = await post<Link>(request, `/api/v1/boards/${boardId}/links`, { role: 'read' });

  const stranger = await browser.newContext();
  const page = await stranger.newPage();
  await page.goto(link.url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: BOARD_NAME })).toBeVisible();

  const column = columns[0];
  if (!column) throw new Error('no column');
  await expect(
    page.getByTestId(`column-${column.id}`).getByRole('button', { name: 'Add card' }),
  ).toHaveCount(0);
  await stranger.close();
});

test('an unknown token is a 404 page, not a redirect', async ({ page }) => {
  await page.goto('/l/aaaaaaaaaaaaaaaaaaaaaaaa', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();
});
