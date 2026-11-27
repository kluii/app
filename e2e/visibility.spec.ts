// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K3-01 through the app a human uses: a public board is listed on its owner's
 * profile and opens from the clean URL, a link board only opens from its
 * suffixed URL, and rotating the suffix kills the old one.
 */
import { expect, request as playwrightRequest, test } from '@playwright/test';
import { BOARD_NAME, csrf, patch, seedBoard, uniqueUsername } from './support';

type Board = { id: string; slug: string; link_suffix: string | null; url: string | null };

test('a public board is listed on the profile and opens from its clean URL', async ({
  page,
  request,
}) => {
  const username = uniqueUsername('public');
  const { boardId } = await seedBoard(request, username, ['Alpha']);
  const board = await patch<Board>(request, `/api/v1/boards/${boardId}`, {
    visibility: 'public',
  });
  await page.context().addCookies((await request.storageState()).cookies);

  await page.goto(`/${username}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: `@${username}` })).toBeVisible();
  const link = page.getByRole('link', { name: BOARD_NAME });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/boards/${boardId}$`, 'u'));
  await expect(page.getByRole('heading', { level: 1, name: BOARD_NAME })).toBeVisible();
  const origin = test.info().project.use.baseURL ?? '';
  expect(board.url).toBe(`${origin}/${username}/${board.slug}`);
});

test('a link board opens only from its suffix, and rotation invalidates the old one', async ({
  page,
  request,
}) => {
  const username = uniqueUsername('suffixed');
  const { boardId } = await seedBoard(request, username, ['Alpha']);
  const board = await patch<Board>(request, `/api/v1/boards/${boardId}`, {
    visibility: 'link',
    link_role: 'read',
  });
  expect(board.link_suffix).not.toBeNull();
  await page.context().addCookies((await request.storageState()).cookies);

  const bare = await page.goto(`/${username}/${board.slug}`, { waitUntil: 'domcontentloaded' });
  expect(bare?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();

  await page.goto(`/${username}/${board.slug}-${String(board.link_suffix)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('heading', { level: 1, name: BOARD_NAME })).toBeVisible();

  const rotated = await request.post(`/api/v1/boards/${boardId}/link-suffix/rotate`, {
    headers: { 'x-klui-csrf': await csrf(request) },
    data: { confirm: true },
  });
  expect(rotated.ok()).toBeTruthy();
  const next = (await rotated.json()) as Board;
  expect(next.link_suffix).not.toBe(board.link_suffix);

  await page.goto(`/${username}/${board.slug}-${String(board.link_suffix)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();

  await page.goto(`/${username}/${board.slug}-${String(next.link_suffix)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('heading', { level: 1, name: BOARD_NAME })).toBeVisible();
});

test('the served HTML tells a crawler which boards to index', async ({ page, request }) => {
  const username = uniqueUsername('crawlable');
  const { boardId } = await seedBoard(request, username, ['Alpha']);
  const open = await patch<Board>(request, `/api/v1/boards/${boardId}`, { visibility: 'public' });
  const privateOne = await request.post('/api/v1/boards', {
    headers: { 'x-klui-csrf': await csrf(request) },
    data: { name: 'Not yet' },
  });
  const hidden = (await privateOne.json()) as Board;

  const publicPage = await request.get(`/${username}/${open.slug}`, {
    headers: { accept: 'text/html' },
  });
  const publicHtml = await publicPage.text();
  expect(publicPage.headers()['x-robots-tag']).toBeUndefined();
  const origin = test.info().project.use.baseURL ?? '';
  expect(publicHtml).toContain(
    `<link rel="canonical" href="${origin}/${username}/${open.slug}" />`,
  );

  // A member sees the board's own name in the tab; a stranger never does.
  const asMember = await request.get(`/${username}/${hidden.slug}`, {
    headers: { accept: 'text/html' },
  });
  expect(asMember.headers()['x-robots-tag']).toBe('noindex');
  expect(await asMember.text()).toContain('Not yet');

  const anonymous = await playwrightRequest.newContext({ baseURL: origin });
  const asStranger = await anonymous.get(`/${username}/${hidden.slug}`, {
    headers: { accept: 'text/html' },
  });
  expect(asStranger.headers()['x-robots-tag']).toBe('noindex');
  expect(await asStranger.text()).not.toContain('Not yet');
  await anonymous.dispose();

  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(`/${username}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: BOARD_NAME })).toBeVisible();
  await expect(page.getByText('Not yet')).toHaveCount(0);
});
