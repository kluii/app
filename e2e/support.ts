// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The board a browser test needs, built over the real API and then handed to the
 * page's cookie jar. Every username is unique per run: retries reuse the same
 * schema, so a fixed name collides with itself.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const PASSWORD = 'a-long-passphrase-9';

export function uniqueUsername(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1000)}`;
}

export async function csrf(request: APIRequestContext): Promise<string> {
  const state = await request.storageState();
  const cookie = state.cookies.find((entry) => entry.name === 'klui_csrf');
  if (!cookie) throw new Error('no CSRF cookie');
  return cookie.value;
}

export async function post<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post(path, {
    headers: { 'x-klui-csrf': await csrf(request) },
    data,
  });
  expect(response.ok(), `${path} answered ${response.status()}`).toBeTruthy();
  return (await response.json()) as T;
}

export async function patch<T>(
  request: APIRequestContext,
  path: string,
  data: unknown,
): Promise<T> {
  const response = await request.patch(path, {
    headers: { 'x-klui-csrf': await csrf(request) },
    data,
  });
  expect(response.ok(), `PATCH ${path} answered ${response.status()}`).toBeTruthy();
  return (await response.json()) as T;
}

export type Column = { id: string; name: string };
export type Card = { id: string; title: string };

export const BOARD_NAME = 'Board under test';

export async function seedBoard(
  request: APIRequestContext,
  username: string,
  titles: string[] = ['Alpha', 'Bravo', 'Charlie'],
): Promise<{ boardId: string; columns: Column[]; cards: Card[] }> {
  await request.post('/api/v1/auth/signup', {
    data: { email: `${username}@klui.test`, username, password: PASSWORD },
  });
  const board = await post<{ id: string }>(request, '/api/v1/boards', { name: BOARD_NAME });
  const state = (await (await request.get(`/api/v1/boards/${board.id}/state`)).json()) as {
    columns: Column[];
  };
  const [toDo] = state.columns;
  if (!toDo) throw new Error('no columns');

  const cards: Card[] = [];
  for (const title of titles) {
    cards.push(
      await post<Card>(request, `/api/v1/boards/${board.id}/cards`, {
        column: toDo.id,
        title,
      }),
    );
  }
  return { boardId: board.id, columns: state.columns, cards };
}

export async function openBoard(
  page: Page,
  request: APIRequestContext,
  username: string,
  titles?: string[],
): Promise<{ boardId: string; columns: Column[]; cards: Card[] }> {
  const seeded = await seedBoard(request, username, titles);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(`/boards/${seeded.boardId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: BOARD_NAME })).toBeVisible();
  return seeded;
}

export async function titlesIn(page: Page, column: Column): Promise<string[]> {
  return page.getByTestId(`column-${column.id}`).getByTestId('card-title').allTextContents();
}
