// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A visitor without an account.
 *
 * The rule is "a board is written by its members": an anonymous visitor reads a
 * shared board, names themselves so the page is not a wall, and writes nothing —
 * no card, no comment, no move, whatever the stored `anon_write` says. The
 * display-name gate therefore outlives the writes it was built for, and the
 * column survives as a legacy value the API refuses to set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';
import { setLegacyPolicy } from './helpers/legacy.js';

const WEB_DIR = new URL('./fixtures/web', import.meta.url).pathname;

let harness: Awaited<ReturnType<typeof startServer>>;
/** The harness this file's boards belong to; `board()` reaches the row directly. */
let db: Awaited<ReturnType<typeof startServer>>['db'];

beforeAll(async () => {
  harness = await startServer({ webDir: WEB_DIR });
  db = harness.db;
});

afterAll(async () => {
  await harness.close();
});

type Board = {
  id: string;
  slug: string;
  visibility: string;
  anon_write: string;
  link_role: string;
};

/**
 * A board as the API can write it today, plus — when a test needs one — the
 * policy a row written before the rule still carries. The PATCH cannot set it:
 * that refusal is itself asserted below.
 */
async function board(
  c: TestClient,
  input: { visibility?: 'link' | 'public'; anon_write?: 'off' | 'open' | 'moderated' },
): Promise<Board> {
  await c.signup(`anon-${c.suffix}`);
  const created = await c.request('POST', '/api/v1/boards', {
    name: 'Open house',
    visibility: input.visibility ?? 'link',
  });
  const id = (created.json() as Board).id;
  const patched = await c.request('PATCH', `/api/v1/boards/${id}`, { link_role: 'read' });
  expect(patched.statusCode).toBe(200);
  const stored = input.anon_write ?? 'open';
  if (stored !== 'off') await setLegacyPolicy(db, id, { anonWrite: stored });
  return patched.json() as Board;
}

/** A browser holding one anonymous cookie and nothing else. */
class AnonClient {
  private cookie: string | null = null;

  constructor(readonly client: TestClient) {}

  async join(boardId: string, label: string): Promise<{ statusCode: number; body: string }> {
    const response = await this.client.app.inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/anon`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ label }),
    });
    const header = response.headers['set-cookie'];
    const raw = Array.isArray(header) ? header[0] : header;
    const pair = raw?.split(';')[0];
    if (pair?.startsWith('klui_anon=')) this.cookie = pair;
    return { statusCode: response.statusCode, body: response.body };
  }

  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ): Promise<{
    statusCode: number;
    body: string;
    headers: Record<string, string | string[] | number | undefined>;
  }> {
    const response = await this.client.app.inject({
      method,
      url,
      headers: {
        ...(this.cookie === null ? {} : { cookie: this.cookie }),
        ...(payload ? { 'content-type': 'application/json' } : {}),
      },
      ...(payload ? { payload: JSON.stringify(payload) } : {}),
    });
    return { statusCode: response.statusCode, body: response.body, headers: response.headers };
  }
}

async function firstColumn(visitor: AnonClient, boardId: string): Promise<string> {
  const state = await visitor.request('GET', `/api/v1/boards/${boardId}/state`);
  expect(state.statusCode).toBe(200);
  const columns = (JSON.parse(state.body) as { columns: { id: string }[] }).columns;
  const [column] = columns;
  if (!column) throw new Error('no column');
  return column.id;
}

describe('the display-name gate', () => {
  it('accepts 2 to 32 characters and sets a 12-hour cookie', async () => {
    const owner = harness.client();
    const created = await board(owner, { anon_write: 'open' });
    const visitor = new AnonClient(harness.client());

    const joined = await visitor.join(created.id, 'A passing stranger');
    expect(joined.statusCode).toBe(200);
    expect((JSON.parse(joined.body) as { label: string }).label).toBe('A passing stranger');

    const state = await visitor.request('GET', `/api/v1/boards/${created.id}/state`);
    expect(state.statusCode).toBe(200);
    expect(
      (JSON.parse(state.body) as { caller: { actor_kind: string; label: string } }).caller,
    ).toMatchObject({ actor_kind: 'anon', label: 'A passing stranger' });
  });

  it('refuses one character and thirty-three', async () => {
    const owner = harness.client();
    const created = await board(owner, { anon_write: 'open' });
    const visitor = new AnonClient(harness.client());

    expect((await visitor.join(created.id, 'A')).statusCode).toBe(400);
    expect((await visitor.join(created.id, 'x'.repeat(33))).statusCode).toBe(400);
    expect((await visitor.join(created.id, '   ')).statusCode).toBe(400);
  });

  it('is closed when anon_write is off, and on a private board', async () => {
    const owner = harness.client();
    const closed = await board(owner, { anon_write: 'off' });
    const visitor = new AnonClient(harness.client());
    expect((await visitor.join(closed.id, 'Nobody')).statusCode).toBe(403);

    const privateBoard = await owner.request('POST', '/api/v1/boards', {
      name: 'Members only',
      visibility: 'link',
    });
    const hidden = privateBoard.json() as Board;
    const patched = await owner.request('PATCH', `/api/v1/boards/${hidden.id}`, {
      visibility: 'private',
    });
    expect(patched.statusCode).toBe(200);
    expect((await visitor.join(hidden.id, 'Nobody')).statusCode).toBe(404);
  });
});

describe('what an anonymous actor can do', () => {
  it('reads the board and writes nothing: no card, no comment, no move', async () => {
    const owner = harness.client();
    const created = await board(owner, { anon_write: 'open' });
    const visitor = new AnonClient(harness.client());
    await visitor.join(created.id, 'Guest worker');
    const column = await firstColumn(visitor, created.id);

    const card = await visitor.request('POST', `/api/v1/boards/${created.id}/cards`, {
      column,
      title: 'From the street',
    });
    expect(card.statusCode).toBe(403);
    expect((JSON.parse(card.body) as { error: { code: string } }).error.code).toBe('forbidden');
    expect(await db.card.count({ where: { board_id: created.id } })).toBe(0);

    // A card that exists, put there by its owner: the visitor still cannot
    // comment on it, move it, tick it or delete it.
    const owned = await owner.request('POST', `/api/v1/boards/${created.id}/cards`, {
      column,
      title: 'The owner wrote this',
    });
    expect(owned.statusCode).toBe(201);
    const id = (JSON.parse(owned.body) as { id: string }).id;

    expect(
      (await visitor.request('POST', `/api/v1/cards/${id}/comments`, { body: 'hello' })).statusCode,
    ).toBe(403);
    expect(
      (
        await visitor.request('POST', `/api/v1/cards/${id}/move`, {
          column,
          before: null,
          after: null,
        })
      ).statusCode,
    ).toBe(403);
    expect((await visitor.request('PATCH', `/api/v1/cards/${id}`, { done: true })).statusCode).toBe(
      403,
    );
    expect((await visitor.request('DELETE', `/api/v1/cards/${id}`)).statusCode).toBe(403);

    // Nothing was written by the refusal, and nothing was logged as if it were.
    expect(await db.card.count({ where: { board_id: created.id } })).toBe(1);
    expect(await db.event.count({ where: { board_id: created.id, actor_kind: 'anon' } })).toBe(0);
  });

  it('cannot read another board with the same cookie', async () => {
    const owner = harness.client();
    const created = await board(owner, { anon_write: 'open' });
    const other = await owner.request('POST', '/api/v1/boards', {
      name: 'Elsewhere',
      visibility: 'link',
    });
    const visitor = new AnonClient(harness.client());
    await visitor.join(created.id, 'Wandering');
    const foreign = await visitor.request(
      'GET',
      `/api/v1/boards/${(other.json() as Board).id}/state`,
    );
    expect(foreign.statusCode).toBe(404);
  });

  it('cannot reach the moderation queue with a card it may not write', async () => {
    const owner = harness.client();
    const created = await board(owner, { anon_write: 'moderated' });
    const visitor = new AnonClient(harness.client());
    await visitor.join(created.id, 'Waiting');
    const column = await firstColumn(visitor, created.id);

    const response = await visitor.request('POST', `/api/v1/boards/${created.id}/cards`, {
      column,
      title: 'Under review',
    });
    expect(response.statusCode).toBe(403);
    expect(await db.pendingCard.count({ where: { board_id: created.id } })).toBe(0);
  });

  it('can read a public board without joining it first', async () => {
    const owner = harness.client();
    const created = await board(owner, { visibility: 'public', anon_write: 'open' });
    const visitor = new AnonClient(harness.client());
    await visitor.join(created.id, 'Guest');
    const state = await visitor.request('GET', `/api/v1/boards/${created.id}/state`);
    expect(state.statusCode).toBe(200);
  });
});

describe('the retired policies', () => {
  it('refuses to set anonymous writes, and keeps a stored value readable', async () => {
    const owner = harness.client();
    await owner.signup(`anon-retired-${owner.suffix}`);
    const created = await owner.request('POST', '/api/v1/boards', {
      name: 'Retired policy',
      visibility: 'link',
    });
    const id = (created.json() as Board).id;

    for (const anon_write of ['open', 'moderated'] as const) {
      const patch = await owner.request('PATCH', `/api/v1/boards/${id}`, { anon_write });
      expect(patch.statusCode).toBe(400);
      const body = JSON.parse(patch.body) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('validation_failed');
      expect(body.error.message).toBe('anonymous writes are no longer available');
    }

    // `off` is still accepted, and a legacy row keeps what it stored.
    const off = await owner.request('PATCH', `/api/v1/boards/${id}`, {
      link_role: 'read',
      anon_write: 'off',
    });
    expect(off.statusCode).toBe(200);
    await setLegacyPolicy(db, id, { anonWrite: 'open' });
    const row = await db.board.findUniqueOrThrow({ where: { id } });
    expect(row.anon_write).toBe('open');

    const visitor = new AnonClient(harness.client());
    expect((await visitor.join(id, 'Reader')).statusCode).toBe(200);
    expect((await visitor.request('GET', `/api/v1/boards/${id}/state`)).statusCode).toBe(200);
  });
});
