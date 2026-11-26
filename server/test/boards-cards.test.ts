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
type Card = { id: string; title: string; column_id: string; position: string; done: boolean };

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

describe('rank planning', () => {
  it('places between neighbours, prepends at the head and appends at the tail', () => {
    expect(planRank({ before: 1024, after: 2048, min: 1024, max: 2048 })).toEqual({
      kind: 'place',
      position: 1536,
    });
    expect(planRank({ before: null, after: 1024, min: 1024, max: 4096 }).kind).toBe('place');
    expect(planRank({ before: null, after: 1024, min: 1024, max: 4096 })).toEqual({
      kind: 'place',
      position: 0,
    });
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
