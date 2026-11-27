// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-10 on a built server: the stream is the only reason two tabs see the same
 * board without a reload.
 *
 * The server publishes after commit and before the HTTP response, so a create
 * normally *does* echo first: the "exactly one card" assertions are the race,
 * measured rather than simulated.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { openBoard, seedBoard, titlesIn, uniqueUsername } from './support';

async function secondTab(
  page: Page,
  boardId: string,
): Promise<{ context: BrowserContext; tab: Page }> {
  const context = await page.context().browser()?.newContext();
  if (!context) throw new Error('no browser');
  await context.addCookies(await page.context().cookies());
  const tab = await context.newPage();
  await tab.goto(`/boards/${boardId}`, { waitUntil: 'domcontentloaded' });
  await expect(tab.getByRole('heading', { level: 1, name: 'Board under test' })).toBeVisible();
  return { context, tab };
}

test('a card created in one tab appears in the other without a reload', async ({
  page,
  request,
}) => {
  const { boardId, columns } = await openBoard(page, request, uniqueUsername('live'), []);
  const [toDo] = columns;
  if (!toDo) throw new Error('no column');

  const { context, tab } = await secondTab(page, boardId);

  await tab.getByTestId(`column-${toDo.id}`).getByRole('button', { name: 'Add card' }).click();
  await tab.getByLabel('Card title').fill('Seen live');
  await tab.getByLabel('Card title').press('Control+Enter');
  await expect(tab.getByRole('dialog')).toBeHidden();

  // No reload on the first tab: the stream delivered it.
  await expect.poll(() => titlesIn(page, toDo), { timeout: 10_000 }).toEqual(['Seen live']);
  expect(await page.getByText('Seen live').count()).toBe(1);

  await context.close();
});

test('the echo for a create never duplicates the card', async ({ page, request }) => {
  const { boardId, columns } = await openBoard(page, request, uniqueUsername('dupe'), []);
  const [toDo] = columns;
  if (!toDo) throw new Error('no column');

  await page.getByTestId(`column-${toDo.id}`).getByRole('button', { name: 'Add card' }).click();
  await page.getByLabel('Card title').fill('Exactly one');
  await page.getByLabel('Card title').press('Control+Enter');
  await expect(page.getByRole('dialog')).toBeHidden();

  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Exactly one']);
  // Let a late echo land, then count again: an append would show two.
  await page.waitForTimeout(750);
  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Exactly one']);
  expect(await page.getByTestId('card-title').filter({ hasText: 'Exactly one' }).count()).toBe(1);

  const state = (await (await request.get(`/api/v1/boards/${boardId}/state`)).json()) as {
    cards: { title: string }[];
  };
  expect(state.cards.filter((card) => card.title === 'Exactly one')).toHaveLength(1);
});

test('a killed stream says so, reconnects on its own, and converges', async ({ page, request }) => {
  const { boardId, columns } = await seedBoard(request, uniqueUsername('reconnect'), []);
  const [toDo] = columns;
  if (!toDo) throw new Error('no column');

  // Break the stream before the board mounts: this is what a proxy or a
  // redeploy does to a client that is trying to subscribe.
  await page.route('**/api/v1/stream*', (route) => route.abort());
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(`/boards/${boardId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Board under test' })).toBeVisible();
  await expect(page.getByTestId('board-live')).toBeVisible({ timeout: 10_000 });

  // Let it through again: the client retries on its own backoff and the header
  // stops saying "Reconnecting".
  await page.unroute('**/api/v1/stream*');
  await expect(page.getByTestId('board-live')).toHaveCount(0, { timeout: 20_000 });

  // A card created elsewhere converges on the reconnected stream, once.
  const csrf = (await request.storageState()).cookies.find((cookie) => cookie.name === 'klui_csrf');
  const created = await request.post(`/api/v1/boards/${boardId}/cards`, {
    headers: { 'x-klui-csrf': csrf?.value ?? '' },
    data: { column: toDo.id, title: 'After the reconnect' },
  });
  expect(created.ok()).toBeTruthy();

  await expect
    .poll(() => titlesIn(page, toDo), { timeout: 10_000 })
    .toEqual(['After the reconnect']);
  expect(
    await page.getByTestId('card-title').filter({ hasText: 'After the reconnect' }).count(),
  ).toBe(1);
});
