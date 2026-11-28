// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * K2-03: the board shell and its filters. The cards are seeded through the API
 * on purpose: this test is about filtering, and a UI that cannot yet attach a
 * tag must not be the reason a filter test passes or fails.
 */
const PASSWORD = 'a-long-passphrase-9';

/** Unique per attempt: the e2e schema is not reset between a retry and its first run. */
function uniqueUsername(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).slice(-6)}`;
}

async function csrf(request: APIRequestContext): Promise<string> {
  const state = await request.storageState();
  const cookie = state.cookies.find((entry) => entry.name === 'klui_csrf');
  if (!cookie) throw new Error('no CSRF cookie');
  return cookie.value;
}

type Board = { id: string; name: string };
type Column = { id: string; name: string };

async function post<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post(path, {
    headers: { 'x-klui-csrf': await csrf(request) },
    data,
  });
  expect(response.ok(), `${path} answered ${response.status()}`).toBeTruthy();
  return (await response.json()) as T;
}

async function seedBoard(
  request: APIRequestContext,
  username: string,
): Promise<{ board: Board; columns: Column[] }> {
  const signup = await request.post('/api/v1/auth/signup', {
    data: { email: `${username}@klui.test`, username, password: PASSWORD },
  });
  expect(signup.status()).toBe(201);

  const board = await post<Board>(request, '/api/v1/boards', { name: 'Filter proof' });
  const state = (await (await request.get(`/api/v1/boards/${board.id}/state`)).json()) as {
    columns: Column[];
  };
  const [toDo, doing] = state.columns;
  if (!toDo || !doing) throw new Error('the classic template did not create three columns');

  await post(request, `/api/v1/boards/${board.id}/cards`, {
    column: toDo.id,
    title: 'Ship the release note',
    tags: ['docs'],
  });
  await post(request, `/api/v1/boards/${board.id}/cards`, {
    column: toDo.id,
    title: 'Fix the drag bug',
    tags: ['bug'],
  });
  await post(request, `/api/v1/boards/${board.id}/cards`, {
    column: doing.id,
    title: 'Review the copy',
    tags: ['docs'],
  });
  await post(request, `/api/v1/boards/${board.id}/cards`, {
    column: doing.id,
    title: 'Untagged errand',
  });

  return { board, columns: state.columns };
}

async function openBoard(page: Page, request: APIRequestContext, username: string): Promise<void> {
  const { board } = await seedBoard(request, username);
  // The API context and the page have separate cookie jars; the page needs the
  // session the seeding created.
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(`/boards/${board.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Filter proof' })).toBeVisible();
}

test('two filters narrow the board, and removing one chip restores the cards', async ({
  page,
  request,
}) => {
  await openBoard(page, request, uniqueUsername('filter'));

  // The bar carries no count any more: the rail is what says how many cards
  // are on screen, so the test reads the rendered titles.
  const titles = page.getByTestId('board-scroll').getByTestId('card-title');
  await expect(titles).toHaveCount(4);

  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  // `exact` because a card's button carries its tag names as part of its name.
  await page.getByRole('button', { name: 'docs', exact: true }).click();
  await page.getByRole('button', { name: 'bug', exact: true }).click();

  // `docs` keeps two cards, `bug` one, and they do not overlap.
  await expect(titles).toHaveCount(3);
  await expect(page.getByTestId('active-filter')).toHaveCount(2);

  // The column with no match explains itself instead of looking broken.
  await expect(page.getByText('No cards match the filters')).toHaveCount(1);

  // The panel is light-dismiss: it has to be closed before the chips under it
  // can be reached, which is the same gesture a person makes.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { level: 2, name: 'Filter' })).toBeHidden();

  await page
    .getByTestId('active-filter')
    .filter({ hasText: 'bug' })
    .getByRole('button', { name: 'Dismiss' })
    .click();

  // Only the two `docs` cards are left.
  await expect(titles).toHaveCount(2);
  await expect(titles).toHaveText(['Ship the release note', 'Review the copy']);
  await expect(page.getByTestId('active-filter')).toHaveCount(1);
});

test('a text filter keeps the stored order and clears with one action', async ({
  page,
  request,
}) => {
  await openBoard(page, request, uniqueUsername('filter-text'));

  const titles = page.getByTestId('board-scroll').getByTestId('card-title');
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('textbox', { name: 'Text' }).fill('release');
  await expect(titles).toHaveCount(1);
  await expect(titles).toHaveText(['Ship the release note']);

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(titles).toHaveCount(4);
  await expect(page.getByTestId('active-filter')).toHaveCount(0);
});
