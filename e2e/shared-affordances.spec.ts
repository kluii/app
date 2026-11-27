// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K3-08 — the board tells a visitor what it will actually let them do.
 *
 * A control that exists and refuses is worse than a control that is absent: a
 * read-only visitor with a Members button, an Import input or an "Add the first
 * column" prompt has been lied to three times. The tests below open the same
 * board as three actors and assert the surface, not the API.
 */
import { expect, request as playwrightRequest, test } from '@playwright/test';
import { BOARD_NAME, PASSWORD, patch, post, seedBoard, uniqueUsername } from './support';

type Link = { id: string; token: string; url: string; role: string };

async function linkBoard(
  request: Parameters<typeof seedBoard>[0],
  options: { role: 'read' | 'edit'; anonWrite?: 'off' | 'open' | 'moderated' },
): Promise<{ boardId: string; columns: { id: string }[]; link: Link }> {
  const username = uniqueUsername(`shared-${options.role}`);
  const seeded = await seedBoard(request, username, ['Alpha']);
  await patch(request, `/api/v1/boards/${seeded.boardId}`, {
    visibility: 'link',
    link_role: options.role,
    ...(options.anonWrite === undefined ? {} : { anon_write: options.anonWrite }),
  });
  const link = await post<Link>(request, `/api/v1/boards/${seeded.boardId}/links`, {
    role: options.role,
  });
  return { ...seeded, link };
}

test('a read-only link sees no edit affordance at all, not a disabled one', async ({
  browser,
  request,
}) => {
  const { boardId, columns, link } = await linkBoard(request, { role: 'read' });

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link.url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: BOARD_NAME })).toBeVisible();

  // The chip says what the visitor is, so a missing button is not a mystery.
  await expect(page.getByTestId('caller-chip')).toHaveText('Read-only link');

  // Nothing that would write, and nothing that manages the board.
  const column = columns[0];
  if (!column) throw new Error('no column');
  await expect(
    page.getByTestId(`column-${column.id}`).getByRole('button', { name: 'Add card' }),
  ).toHaveCount(0);
  await expect(page.getByTestId('open-members')).toHaveCount(0);
  await expect(page.getByTestId('open-share')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add column' })).toHaveCount(0);
  await expect(page.getByTestId('open-close-board')).toHaveCount(0);

  // Export carries the member list and the whole log: it is a member's verb, so
  // a link visitor gets no Data button at all rather than a download that 403s.
  await expect(page.getByTestId('open-board-data')).toHaveCount(0);

  // An empty column says so in the visitor's own terms.
  await expect(page.getByTestId(`column-${columns[1]?.id ?? ''}`)).toContainText(
    'No cards in this column.',
  );
  await expect(page).toHaveURL(new RegExp(`/boards/${boardId}$`, 'u'));
  await context.close();
});

test('a write link says so, and its empty column offers the write it can do', async ({
  browser,
  request,
}) => {
  const { columns, link } = await linkBoard(request, { role: 'edit' });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link.url, { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('caller-chip')).toHaveText('You can edit');
  const second = columns[1];
  if (!second) throw new Error('no second column');
  await expect(
    page.getByTestId(`column-${second.id}`).getByRole('button', { name: 'Add card' }),
  ).toBeVisible();
  // A write link is not a member: sharing and membership stay closed to it.
  await expect(page.getByTestId('open-members')).toHaveCount(0);
  await context.close();
});

test('the owner sees how many cards are waiting for review in the header', async ({
  browser,
  request,
}) => {
  const username = uniqueUsername('modbanner');
  const seeded = await seedBoard(request, username, ['Alpha']);
  await patch(request, `/api/v1/boards/${seeded.boardId}`, {
    visibility: 'link',
    link_role: 'read',
    anon_write: 'moderated',
  });

  // A visitor submits a card: the board must say so without being asked. A
  // cookie-free context, because the fixture's jar holds the owner's session and
  // a cookie-authenticated write needs the CSRF header.
  const visitor = await playwrightRequest.newContext({
    baseURL: test.info().project.use.baseURL,
  });
  const joined = await visitor.post(`/api/v1/boards/${seeded.boardId}/anon`, {
    data: { label: 'Reviewer bait' },
  });
  expect(joined.status()).toBe(200);
  const column = seeded.columns[0];
  if (!column) throw new Error('no column');
  const submitted = await visitor.post(`/api/v1/boards/${seeded.boardId}/cards`, {
    data: { column: column.id, title: 'Please review me' },
  });
  expect(submitted.status()).toBe(202);
  await visitor.dispose();

  const page = await browser.newPage();
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(`/boards/${seeded.boardId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: BOARD_NAME })).toBeVisible();
  await expect(page.getByTestId('open-moderation')).toHaveText('1 waiting');

  // The owner is a member: export and import are both theirs to see.
  await page.getByTestId('open-board-data').click();
  await expect(page.getByTestId('export-json')).toBeVisible();
  await expect(page.getByTestId('import-file')).toBeAttached();
});

test('an empty board tells a visitor who can add the columns, not "add the first one"', async ({
  browser,
  request,
}) => {
  const username = uniqueUsername('emptyboard');
  await request.post('/api/v1/auth/signup', {
    data: { email: `${username}@klui.test`, username, password: PASSWORD },
  });
  const board = await post<{ id: string }>(request, '/api/v1/boards', {
    name: BOARD_NAME,
    template: 'blank',
  });
  await patch(request, `/api/v1/boards/${board.id}`, { visibility: 'link', link_role: 'read' });
  const link = await post<Link>(request, `/api/v1/boards/${board.id}/links`, { role: 'read' });

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link.url, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { level: 2, name: 'No columns yet' })).toBeVisible();
  await expect(
    page.getByText('The board has no columns yet. Whoever owns it can add them.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add column' })).toHaveCount(0);
  await context.close();
});
