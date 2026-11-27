// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K3-03 in a browser that has never signed in: open a shared URL, give a name,
 * add a card, tick it done — and see none of the affordances a member has.
 */
import { expect, test } from '@playwright/test';
import { BOARD_NAME, patch, seedBoard, uniqueUsername } from './support';

test('a stranger names themselves, adds a card and marks it done', async ({ browser, request }) => {
  const username = uniqueUsername('anonwrite');
  const { boardId, columns } = await seedBoard(request, username, ['Alpha']);
  const board = await patch<{ slug: string; link_suffix: string | null }>(
    request,
    `/api/v1/boards/${boardId}`,
    { visibility: 'link', link_role: 'read', anon_write: 'open' },
  );

  const stranger = await browser.newContext();
  const page = await stranger.newPage();
  await page.goto(`/${username}/${board.slug}-${String(board.link_suffix)}`, {
    waitUntil: 'domcontentloaded',
  });

  // The name gate: it knows the board's own name, and nothing else.
  await expect(page.getByRole('heading', { level: 1, name: BOARD_NAME })).toBeVisible();
  await page.getByLabel('Your name').fill('A passer-by');
  await page.getByRole('button', { name: 'Join the board' }).click();

  const column = columns[0];
  if (!column) throw new Error('no column');
  const columnRegion = page.getByTestId(`column-${column.id}`);
  await expect(columnRegion.getByRole('button', { name: 'Add card' })).toBeVisible();
  await columnRegion.getByRole('button', { name: 'Add card' }).click();
  await page.getByLabel('Card title').fill('Written without an account');
  await page.getByRole('button', { name: 'Create card' }).click();

  await expect(
    page.getByTestId('card-title').filter({ hasText: 'Written without an account' }),
  ).toBeVisible();
  // The title sits under the card's own button, so the button is what opens it.
  await page.getByRole('button', { name: /Open Written without an account/u }).click();
  await expect(page.getByRole('dialog').getByText('by A passer-by')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark done' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Reopen' })).toBeVisible();
  await page.keyboard.press('Escape');

  // No comment composer, no delete, no column management, no move.
  await page.getByRole('button', { name: /Open Written without an account/u }).click();
  await expect(page.getByRole('textbox', { name: 'Comment' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Add column' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Card actions' }).first().click();
  await expect(page.getByRole('menuitem', { name: /Move to/u })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await stranger.close();
});

test("a second visitor cannot tick the first visitor's card", async ({ browser, request }) => {
  const username = uniqueUsername('anontwo');
  const { boardId, columns } = await seedBoard(request, username, ['Alpha']);
  const board = await patch<{ slug: string; link_suffix: string | null }>(
    request,
    `/api/v1/boards/${boardId}`,
    { visibility: 'link', link_role: 'read', anon_write: 'open' },
  );
  const url = `/${username}/${board.slug}-${String(board.link_suffix)}`;
  const column = columns[0];
  if (!column) throw new Error('no column');

  const first = await browser.newContext();
  const firstPage = await first.newPage();
  await firstPage.goto(url, { waitUntil: 'domcontentloaded' });
  await firstPage.getByLabel('Your name').fill('First visitor');
  await firstPage.getByRole('button', { name: 'Join the board' }).click();
  await firstPage
    .getByTestId(`column-${column.id}`)
    .getByRole('button', { name: 'Add card' })
    .click();
  await firstPage.getByLabel('Card title').fill('Owned by the first');
  await firstPage.getByRole('button', { name: 'Create card' }).click();
  await expect(
    firstPage.getByTestId('card-title').filter({ hasText: 'Owned by the first' }),
  ).toBeVisible();

  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await secondPage.goto(url, { waitUntil: 'domcontentloaded' });
  await secondPage.getByLabel('Your name').fill('Second visitor');
  await secondPage.getByRole('button', { name: 'Join the board' }).click();
  await secondPage.getByRole('button', { name: /Open Owned by the first/u }).click();

  // The tick is not offered on someone else's card, and the API refuses it too.
  await expect(
    secondPage.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }),
  ).toHaveCount(0);
  const state = (await (
    await secondPage.request.get(`/api/v1/boards/${boardId}/state`)
  ).json()) as {
    cards: { id: string; title: string }[];
  };
  const refused = await secondPage.request.patch(`/api/v1/cards/${state.cards[0]?.id ?? ''}`, {
    data: { done: true },
  });
  expect(refused.status()).toBe(403);

  await first.close();
  await second.close();
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
