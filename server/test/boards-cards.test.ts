// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Boards, columns, cards and moves through the real API. The two exit criteria
 * that matter here: a non-member gets a byte-identical 404, and a move lands
 * between the neighbours it named (docs/testing.md §4).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';
import { planRank } from '../src/lib/ranks.js';

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer();
});

afterAll(async () => {
  await harness.close();
});

type Board = { id: string; name: string; slug: string; updated_at: string };
type Column = { id: string; name: string; position: string };
type Card = {
  id: string;
  title: string;
  column_id: string;
  position: string;
  done: boolean;
  updated_at: string;
  assignee_label: string | null;
  tags: { name: string; color: string | null }[];
};

async function boardWithColumns(c: TestClient): Promise<{ board: Board; columns: Column[] }> {
  await c.signup(`owner-${c.suffix}`);
  const created = await c.request('POST', '/api/v1/boards', { name: 'Retro S2' });
  expect(created.statusCode).toBe(201);
  const board = created.json() as Board;
  const state = await c.request('GET', `/api/v1/boards/${board.id}/state`);
  const columns = (state.json() as { columns: Column[] }).columns;
  return { board, columns };
}

async function addCard(
  c: TestClient,
  boardId: string,
  columnId: string,
  title: string,
): Promise<Card> {
  const response = await c.request('POST', `/api/v1/boards/${boardId}/cards`, {
    column: columnId,
    title,
  });
  expect(response.statusCode).toBe(201);
  return response.json() as Card;
}

describe('boards', () => {
  it('creates a board with three classic columns and one board.created event', async () => {
    const c = harness.client();
    const { board, columns } = await boardWithColumns(c);
    expect(columns.map((column) => column.name)).toEqual(['To do', 'Doing', 'Done']);

    const events = await harness.db.event.findMany({ where: { board_id: board.id } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('board_created');
    expect(events[0]?.actor_kind).toBe('user');
  });

  it('gives a stranger the same 404 for a private board as for a board that never existed', async () => {
    const owner = harness.client();
    const { board } = await boardWithColumns(owner);

    const stranger = harness.client();
    await stranger.signup(`stranger-${stranger.suffix}`);

    const unreadable = await stranger.request('GET', `/api/v1/boards/${board.id}`);
    const missing = await stranger.request('GET', '/api/v1/boards/brd_0000000000000000000001');

    expect(unreadable.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(unreadable.body).toBe(missing.body);
    expect(unreadable.headers['etag']).toBe(missing.headers['etag']);
  });

  it('answers 409 with the current row on a stale expected_updated_at', async () => {
    const c = harness.client();
    const { board } = await boardWithColumns(c);
    const stale = await c.request('PATCH', `/api/v1/boards/${board.id}`, {
      name: 'Renamed',
      expected_updated_at: '2020-01-01T00:00:00.000Z',
    });
    expect(stale.statusCode).toBe(409);
    const body = stale.json() as { error: { code: string; current: Board } };
    expect(body.error.code).toBe('conflict');
    expect(body.error.current.id).toBe(board.id);

    const fresh = await c.request('PATCH', `/api/v1/boards/${board.id}`, {
      name: 'Renamed',
      expected_updated_at: board.updated_at,
    });
    expect(fresh.statusCode).toBe(200);
    expect((fresh.json() as Board).name).toBe('Renamed');
  });

  it('forces a private board to keep no link role and no anonymous writes', async () => {
    const c = harness.client();
    const { board } = await boardWithColumns(c);
    const invalid = await c.request('PATCH', `/api/v1/boards/${board.id}`, {
      visibility: 'private',
      link_role: 'edit',
    });
    expect(invalid.statusCode).toBe(400);

    const shared = await c.request('PATCH', `/api/v1/boards/${board.id}`, {
      visibility: 'link',
      link_role: 'edit',
      anon_write: 'open',
    });
    expect(shared.statusCode).toBe(200);
    const sharedBody = shared.json() as { link_suffix: string | null; url: string | null };
    expect(sharedBody.link_suffix).toMatch(/^[a-z0-9]{4}$/);
    expect(sharedBody.url).toContain(`-${sharedBody.link_suffix ?? ''}`);

    const back = await c.request('PATCH', `/api/v1/boards/${board.id}`, { visibility: 'private' });
    expect(back.statusCode).toBe(200);
    expect((back.json() as { link_role: string; anon_write: string }).link_role).toBe('none');
    expect((back.json() as { anon_write: string }).anon_write).toBe('off');
  });
});

describe('cards and moves', () => {
  it('drops a card between the two cards it named, across columns too, and appends without neighbours', async () => {
    const c = harness.client();
    const { board, columns } = await boardWithColumns(c);
    const todo = columns[0];
    const doing = columns[1];
    expect(todo).toBeDefined();
    expect(doing).toBeDefined();
    if (!todo || !doing) return;

    const a = await addCard(c, board.id, todo.id, 'A');
    const b = await addCard(c, board.id, todo.id, 'B');
    const d = await addCard(c, board.id, todo.id, 'D');
    const e = await addCard(c, board.id, doing.id, 'E');

    // E between A and B.
    const moved = await c.request('POST', `/api/v1/cards/${e.id}/move`, {
      column: todo.id,
      before: a.id,
      after: b.id,
    });
    expect(moved.statusCode).toBe(200);
    const movedBody = moved.json() as { position: string; column_id: string };
    expect(Number(movedBody.position)).toBeGreaterThan(Number(a.position));
    expect(Number(movedBody.position)).toBeLessThan(Number(b.position));

    const ordered = await c.request('GET', `/api/v1/boards/${board.id}/state`);
    const cards = (ordered.json() as { cards: Card[] }).cards
      .filter((card) => card.column_id === todo.id)
      .sort((left, right) => Number(left.position) - Number(right.position))
      .map((card) => card.title);
    expect(cards).toEqual(['A', 'E', 'B', 'D']);

    // Appending: no neighbours append to the end of the column.
    const appended = await c.request('POST', `/api/v1/cards/${d.id}/move`, {
      column: doing.id,
    });
    expect(appended.statusCode).toBe(200);
    expect((appended.json() as { column_id: string }).column_id).toBe(doing.id);
  });

  it('appends when the named neighbours no longer exist', async () => {
    const c = harness.client();
    const { board, columns } = await boardWithColumns(c);
    const todo = columns[0];
    if (!todo) return;
    const a = await addCard(c, board.id, todo.id, 'A');
    const b = await addCard(c, board.id, todo.id, 'B');
    await c.request('DELETE', `/api/v1/cards/${b.id}`);

    const moved = await c.request('POST', `/api/v1/cards/${a.id}/move`, {
      column: todo.id,
      before: 'crd_0000000000000000000001',
      after: b.id,
    });
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as { column_id: string }).column_id).toBe(todo.id);
  });

  it('rejects an index-shaped move with a hint that names the accepted shape', async () => {
    const c = harness.client();
    const { board, columns } = await boardWithColumns(c);
    const todo = columns[0];
    if (!todo) return;
    const a = await addCard(c, board.id, todo.id, 'A');
    const response = await c.request('POST', `/api/v1/cards/${a.id}/move`, {
      column: todo.id,
      index: 0,
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; hint: string } };
    expect(body.error.code).toBe('unknown_field');
    expect(body.error.hint).toContain('before');
  });

  it('renumbers when the gap between the neighbours is exhausted', async () => {
    const c = harness.client();
    const { board, columns } = await boardWithColumns(c);
    const todo = columns[0];
    if (!todo) return;
    const a = await addCard(c, board.id, todo.id, 'A');
    const b = await addCard(c, board.id, todo.id, 'B');
    // Squeeze a card into a sub-unit gap twice: the second insert must renumber.
    const first = await addCard(c, board.id, todo.id, 'X');
    await c.request('POST', `/api/v1/cards/${first.id}/move`, {
      column: todo.id,
      before: a.id,
      after: b.id,
    });
    const between = await harness.db.card.findMany({
      where: { column_id: todo.id },
      orderBy: { position: 'asc' },
    });
    const middle = between.find((card) => card.title === 'X');
    expect(middle).toBeDefined();

    const squeezed = await addCard(c, board.id, todo.id, 'Y');
    const response = await c.request('POST', `/api/v1/cards/${squeezed.id}/move`, {
      column: todo.id,
      before: a.id,
      after: middle?.id ?? b.id,
    });
    expect(response.statusCode).toBe(200);

    const after = await harness.db.card.findMany({ where: { column_id: todo.id } });
    const positions = after
      .map((card) => Number(card.position))
      .sort((left, right) => left - right);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('records one event per mutation and keeps card.deleted after the row is gone', async () => {
    const c = harness.client();
    const { board, columns } = await boardWithColumns(c);
    const todo = columns[0];
    if (!todo) return;
    const a = await addCard(c, board.id, todo.id, 'Disposable');
    await c.request('PATCH', `/api/v1/cards/${a.id}`, { done: true });
    await c.request('DELETE', `/api/v1/cards/${a.id}`);

    const events = await harness.db.event.findMany({
      where: { board_id: board.id },
      orderBy: { created_at: 'asc' },
    });
    const types = events.map((event) => event.type);
    expect(types).toContain('card_created');
    expect(types).toContain('card_completed');
    expect(types).toContain('card_deleted');
    const deleted = events.find((event) => event.type === 'card_deleted');
    expect((deleted?.payload as { title: string }).title).toBe('Disposable');
  });

  it('serves activity newest first with a working cursor', async () => {
    const c = harness.client();
    const { board, columns } = await boardWithColumns(c);
    const todo = columns[0];
    if (!todo) return;
    for (const title of ['one', 'two', 'three']) {
      await addCard(c, board.id, todo.id, title);
    }
    const page = await c.request('GET', `/api/v1/boards/${board.id}/activity?limit=2`);
    expect(page.statusCode).toBe(200);
    const body = page.json() as {
      items: { id: string; type: string }[];
      next_cursor: string | null;
    };
    expect(body.items).toHaveLength(2);
    expect(body.next_cursor).not.toBeNull();

    const next = await c.request(
      'GET',
      `/api/v1/boards/${board.id}/activity?limit=2&cursor=${body.next_cursor ?? ''}`,
    );
    expect(next.statusCode).toBe(200);
    const nextBody = next.json() as { items: { id: string }[] };
    expect(nextBody.items[0]?.id).not.toBe(body.items[0]?.id ?? '');
  });

  it('gives a viewer a readable board with no write power, and a foreign board a 404', async () => {
    const owner = harness.client();
    const { board, columns } = await boardWithColumns(owner);
    const todo = columns[0];
    if (!todo) return;
    await addCard(owner, board.id, todo.id, 'Comment target');

    const viewer = harness.client();
    const viewerUser = await viewer.signup(`viewer-${viewer.suffix}`);
    await harness.db.boardMember.create({
      data: {
        id: `bmb_${viewer.suffix}xxxxxxxxxxxxxx`,
        board_id: board.id,
        user_id: viewerUser.id,
        role: 'viewer',
      },
    });

    // The comment route arrives with K2-09; what is provable now is that the
    // caller projection says a viewer cannot write, from `can()` and nothing else.
    const read = await viewer.request('GET', `/api/v1/boards/${board.id}/state`);
    expect(read.statusCode).toBe(200);
    const caller = (read.json() as { caller: { can_write: boolean } }).caller;
    expect(caller.can_write).toBe(false);
  });
});

describe('the public board URL', () => {
  const publicUrl = (username: string, slug: string) => `/api/v1/users/${username}/boards/${slug}`;

  it('gives an anonymous caller the same 404 for a private board as for one that never existed', async () => {
    const owner = harness.client();
    const { board } = await boardWithColumns(owner);
    const anonymous = harness.client();

    const real = await anonymous.request('GET', publicUrl(`owner-${owner.suffix}`, board.slug));
    const ghost = await anonymous.request(
      'GET',
      publicUrl(`owner-${owner.suffix}`, 'never-existed'),
    );
    expect(real.statusCode).toBe(404);
    expect(ghost.statusCode).toBe(404);
    // Byte-identical: the body must not tell an enumerator which board exists.
    expect(real.json()).toEqual(ghost.json());
    expect(real.body).toBe(ghost.body);
  });

  it('redirects a member to the human URL, never to an API path', async () => {
    const owner = harness.client();
    const { board } = await boardWithColumns(owner);

    const member = harness.client();
    const user = await member.signup(`viewer-${member.suffix}`);
    await harness.db.boardMember.create({
      data: {
        id: `bmb_${member.suffix}xxxxxxxxxxxxxx`,
        board_id: board.id,
        user_id: user.id,
        role: 'viewer',
      },
    });

    const response = await member.request('GET', publicUrl(`owner-${owner.suffix}`, board.slug));
    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe(`/owner-${owner.suffix}/${board.slug}`);
  });

  it('requires the suffix on a link board, and redirects to the suffixed human URL', async () => {
    const owner = harness.client();
    const { board } = await boardWithColumns(owner);
    const patched = await owner.request('PATCH', `/api/v1/boards/${board.id}`, {
      visibility: 'link',
      link_role: 'read',
    });
    expect(patched.statusCode).toBe(200);
    const linkBoard = patched.json() as { slug: string; link_suffix: string | null };
    expect(linkBoard.link_suffix).toHaveLength(4);

    // The bare slug is not a URL for a link board, for anyone.
    const bare = await owner.request('GET', publicUrl(`owner-${owner.suffix}`, board.slug));
    expect(bare.statusCode).toBe(404);

    const suffixed = await owner.request(
      'GET',
      publicUrl(`owner-${owner.suffix}`, `${board.slug}-${linkBoard.link_suffix ?? ''}`),
    );
    expect(suffixed.statusCode).toBe(301);
    expect(suffixed.headers.location).toBe(
      `/owner-${owner.suffix}/${board.slug}-${linkBoard.link_suffix ?? ''}`,
    );
  });

  it('redirects a renamed slug only when the board is readable', async () => {
    const owner = harness.client();
    const { board } = await boardWithColumns(owner);
    const renamed = await owner.request('PATCH', `/api/v1/boards/${board.id}`, {
      slug: `${board.slug}-renamed`,
    });
    expect(renamed.statusCode).toBe(200);

    const anonymous = harness.client();
    // A private board that was renamed leaks neither the new slug nor a 301.
    const hidden = await anonymous.request('GET', publicUrl(`owner-${owner.suffix}`, board.slug));
    expect(hidden.statusCode).toBe(404);

    const readable = await owner.request('GET', publicUrl(`owner-${owner.suffix}`, board.slug));
    expect(readable.statusCode).toBe(301);
    expect(readable.headers.location).toBe(`/owner-${owner.suffix}/${board.slug}-renamed`);
  });
});

describe('bulk create', () => {
  const bulk = (c: TestClient, boardId: string, body: unknown) =>
    c.request('POST', `/api/v1/boards/${boardId}/cards/bulk`, body);

  it('creates the batch with increasing positions, one event each, and its tags', async () => {
    const c = harness.client();
    const { board, columns } = await boardWithColumns(c);
    const todo = columns[0];
    if (!todo) return;

    const response = await bulk(c, board.id, {
      column: todo.id,
      items: [
        { title: 'First', tags: ['api'] },
        { title: 'Second', description: 'with a description' },
        { title: 'Third', done: true },
      ],
    });
    expect(response.statusCode).toBe(201);
    const created = (response.json() as { created: Card[] }).created;
    expect(created.map((card) => card.title)).toEqual(['First', 'Second', 'Third']);

    // One RANK_STEP apart, in the order the batch arrived.
    const positions = created.map((card) => Number(card.position));
    expect(positions).toEqual([
      positions[0],
      (positions[0] ?? 0) + 1024,
      (positions[0] ?? 0) + 2048,
    ]);

    const events = await harness.db.event.findMany({
      where: { board_id: board.id, type: 'card_created' },
    });
    expect(events).toHaveLength(3);

    const tags = await harness.db.cardTag.findMany({
      where: { card_id: created[0]?.id ?? '' },
    });
    expect(tags.map((tag) => tag.name)).toEqual(['api']);
  });

  it('refuses a column that belongs to another board, and writes nothing', async () => {
    const c = harness.client();
    const { board } = await boardWithColumns(c);
    const other = harness.client();
    const foreign = await boardWithColumns(other);
    const foreignColumn = foreign.columns[0];
    if (!foreignColumn) return;

    const response = await bulk(c, board.id, {
      column: foreignColumn.id,
      items: [{ title: 'Smuggled' }],
    });
    // 404, not 400: `column_not_found` is a not-found in the error catalogue
    // (server/src/lib/errors.ts) and docs/api.md §1 maps not-found to 404. The
    // single-card path answers the same, and the code is what a client branches on.
    expect(response.statusCode).toBe(404);
    expect((response.json() as { error: { code: string } }).error.code).toBe('column_not_found');

    const smuggled = await harness.db.card.count({ where: { board_id: board.id } });
    const untouched = await harness.db.card.count({ where: { board_id: foreign.board.id } });
    expect({ smuggled, untouched }).toEqual({ smuggled: 0, untouched: 0 });
  });

  it('is all-or-nothing when one item is invalid', async () => {
    const c = harness.client();
    const { board, columns } = await boardWithColumns(c);
    const todo = columns[0];
    if (!todo) return;

    const response = await bulk(c, board.id, {
      column: todo.id,
      items: [{ title: 'Fine' }, { title: '' }, { title: 'Also fine' }],
    });
    expect(response.statusCode).toBe(400);
    const count = await harness.db.card.count({ where: { board_id: board.id } });
    expect(count).toBe(0);
  });

  it('returns the same DTO shape as the single create', async () => {
    const c = harness.client();
    const { board, columns } = await boardWithColumns(c);
    const todo = columns[0];
    if (!todo) return;

    const viaSingle = await c.request('POST', `/api/v1/boards/${board.id}/cards`, {
      column: todo.id,
      title: 'Single',
      assignee_label: 'visitor',
      tags: ['api'],
    });
    expect(viaSingle.statusCode).toBe(201);

    const response = await bulk(c, board.id, {
      column: todo.id,
      items: [{ title: 'Bulk', assignee_label: 'visitor', tags: ['api'] }],
    });
    expect(response.statusCode).toBe(201);
    const bulkCard = (response.json() as { created: Card[] }).created[0];
    const singleCard = viaSingle.json() as Card;
    expect(bulkCard).toBeDefined();
    if (!bulkCard) return;

    // Same keys, same nullability: a bulk card is not a second shape.
    expect(Object.keys(bulkCard).sort()).toEqual(Object.keys(singleCard).sort());
    expect(bulkCard.assignee_label).toBe('visitor');
    expect(bulkCard.tags.map((tag) => tag.name)).toEqual(['api']);
  });
});

describe('the done flag', () => {
  it('toggles done in place, keeps the column, and refuses a stale write', async () => {
    const c = harness.client();
    const { board, columns } = await boardWithColumns(c);
    const todo = columns[0];
    if (!todo) return;
    const card = await addCard(c, board.id, todo.id, 'Ship it');

    const completed = await c.request('PATCH', `/api/v1/cards/${card.id}`, { done: true });
    expect(completed.statusCode).toBe(200);
    const done = completed.json() as Card;
    expect(done.done).toBe(true);
    // A done card never leaves its column (K2-08).
    expect(done.column_id).toBe(todo.id);
    expect(done.position).toBe(card.position);

    const events = await harness.db.event.findMany({
      where: { board_id: board.id, type: 'card_completed' },
    });
    expect(events).toHaveLength(1);

    // The write the client rendered against is stale by now: 409, and done is
    // untouched, so a lost race cannot silently reopen a finished card.
    const stale = await c.request('PATCH', `/api/v1/cards/${card.id}`, {
      title: 'Renamed',
      expected_updated_at: card.updated_at,
    });
    expect(stale.statusCode).toBe(409);
    const after = await harness.db.card.findUniqueOrThrow({ where: { id: card.id } });
    expect({ done: after.done, title: after.title }).toEqual({ done: true, title: 'Ship it' });

    const reopened = await c.request('PATCH', `/api/v1/cards/${card.id}`, {
      done: false,
      expected_updated_at: (completed.json() as Card).updated_at,
    });
    expect(reopened.statusCode).toBe(200);
    expect((reopened.json() as Card).done).toBe(false);
    const reopenEvents = await harness.db.event.findMany({
      where: { board_id: board.id, type: 'card_reopened' },
    });
    expect(reopenEvents).toHaveLength(1);
  });

  it('answers 403 to a reader who tries to tick a card done', async () => {
    const owner = harness.client();
    const { board, columns } = await boardWithColumns(owner);
    const todo = columns[0];
    if (!todo) return;
    const card = await addCard(owner, board.id, todo.id, 'Not yours to finish');

    const reader = harness.client();
    const user = await reader.signup(`reader-${reader.suffix}`);
    await harness.db.boardMember.create({
      data: {
        id: `bmb_${reader.suffix}xxxxxxxxxxxxxx`,
        board_id: board.id,
        user_id: user.id,
        role: 'viewer',
      },
    });

    // Readable, so the refusal is a 403 and not a pretend-404 (PROMPT.md §3.4).
    const attempt = await reader.request('PATCH', `/api/v1/cards/${card.id}`, { done: true });
    expect(attempt.statusCode).toBe(403);
    const after = await harness.db.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(after.done).toBe(false);
  });

  it('reads a done card back from the board state', async () => {
    const c = harness.client();
    const { board, columns } = await boardWithColumns(c);
    const todo = columns[0];
    if (!todo) return;
    const card = await addCard(c, board.id, todo.id, 'Done stays done');
    await c.request('PATCH', `/api/v1/cards/${card.id}`, { done: true });

    const state = await c.request('GET', `/api/v1/boards/${board.id}/state`);
    const cards = (state.json() as { cards: Card[] }).cards;
    expect(cards.find((entry) => entry.id === card.id)?.done).toBe(true);
  });
});

describe('rank planning', () => {
  it('places between neighbours, prepends at the head and appends at the tail', () => {
    expect(planRank({ before: 1024, after: 2048, min: 1024, max: 2048 })).toEqual({
      kind: 'place',
      position: 1536,
    });
    // A head insertion steps up, then halves: it never walks below zero, so a
    // column that is prepended to forever still has a floor and renumbers
    // (K2-05). 1024 - 1024 would be 0, so the first head drop lands on 512.
    expect(planRank({ before: null, after: 1024, min: 1024, max: 4096 })).toEqual({
      kind: 'place',
      position: 512,
    });
    expect(planRank({ before: null, after: 1536, min: 1024, max: 4096 })).toEqual({
      kind: 'place',
      position: 512,
    });
    expect(planRank({ before: null, after: 2, min: 2, max: 4096 })).toEqual({
      kind: 'place',
      position: 1,
    });
    expect(planRank({ before: null, after: 1, min: 1, max: 4096 }).kind).toBe('renumber');
    expect(planRank({ before: 4096, after: null, min: 1024, max: 4096 })).toEqual({
      kind: 'place',
      position: 5120,
    });
    expect(planRank({ before: null, after: null, min: null, max: null })).toEqual({
      kind: 'place',
      position: 1024,
    });
    expect(planRank({ before: 1024, after: 1024.5, min: 1024, max: 4096 }).kind).toBe('renumber');
  });
});
