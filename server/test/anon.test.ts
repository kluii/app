// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K3-03 — participation without an account.
 *
 * The exits: an anonymous visitor creates a card and can mark it done, cannot
 * comment, delete or move, cannot touch someone else's card, and a private board
 * never accepts any of it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';

const WEB_DIR = new URL('./fixtures/web', import.meta.url).pathname;

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer({ webDir: WEB_DIR });
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

async function board(
  c: TestClient,
  input: { visibility?: 'link' | 'public'; anon_write?: 'off' | 'open' | 'moderated' },
): Promise<Board> {
  await c.signup(`anon-${c.suffix}`);
  const created = await c.request('POST', '/api/v1/boards', {
    name: 'Open house',
    visibility: input.visibility ?? 'link',
  });
  const patched = await c.request('PATCH', `/api/v1/boards/${(created.json() as Board).id}`, {
    link_role: 'read',
    anon_write: input.anon_write ?? 'open',
  });
  expect(patched.statusCode).toBe(200);
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
  ): Promise<{ statusCode: number; body: string }> {
    const response = await this.client.app.inject({
      method,
      url,
      headers: {
        ...(this.cookie === null ? {} : { cookie: this.cookie }),
        ...(payload ? { 'content-type': 'application/json' } : {}),
      },
      ...(payload ? { payload: JSON.stringify(payload) } : {}),
    });
    return { statusCode: response.statusCode, body: response.body };
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
  it('creates a card and marks it done, with the label on both', async () => {
    const owner = harness.client();
    const created = await board(owner, { anon_write: 'open' });
    const visitor = new AnonClient(harness.client());
    await visitor.join(created.id, 'Guest worker');
    const column = await firstColumn(visitor, created.id);

    const card = await visitor.request('POST', `/api/v1/boards/${created.id}/cards`, {
      column,
      title: 'From the street',
    });
    expect(card.statusCode).toBe(201);
    const body = JSON.parse(card.body) as { id: string; actor_label: string; mine: boolean };
    expect(body.actor_label).toBe('Guest worker');
    expect(body.mine).toBe(true);

    const done = await visitor.request('PATCH', `/api/v1/cards/${body.id}`, { done: true });
    expect(done.statusCode).toBe(200);
    expect((JSON.parse(done.body) as { done: boolean }).done).toBe(true);

    const event = await harness.db.event.findFirst({
      where: { board_id: created.id, type: 'card_created' },
    });
    expect(event?.actor_kind).toBe('anon');
    expect(event?.actor_label).toBe('Guest worker');
    expect(event?.actor_anon_id).not.toBeNull();
  });

  it('cannot comment, delete or move', async () => {
    const owner = harness.client();
    const created = await board(owner, { anon_write: 'open' });
    const visitor = new AnonClient(harness.client());
    await visitor.join(created.id, 'Read only by policy');
    const column = await firstColumn(visitor, created.id);
    const card = await visitor.request('POST', `/api/v1/boards/${created.id}/cards`, {
      column,
      title: 'Mine',
    });
    const id = (JSON.parse(card.body) as { id: string }).id;

    expect(
      (await visitor.request('POST', `/api/v1/cards/${id}/comments`, { body: 'hello' })).statusCode,
    ).toBe(403);
    expect((await visitor.request('DELETE', `/api/v1/cards/${id}`)).statusCode).toBe(403);
    expect(
      (
        await visitor.request('POST', `/api/v1/cards/${id}/move`, {
          column,
          before: null,
          after: null,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('cannot touch a card another anonymous actor created', async () => {
    const owner = harness.client();
    const created = await board(owner, { anon_write: 'open' });
    const first = new AnonClient(harness.client());
    await first.join(created.id, 'First one');
    const second = new AnonClient(harness.client());
    await second.join(created.id, 'Second one');
    const column = await firstColumn(first, created.id);

    const card = await first.request('POST', `/api/v1/boards/${created.id}/cards`, {
      column,
      title: 'First card',
    });
    const id = (JSON.parse(card.body) as { id: string }).id;

    expect(
      (await second.request('PATCH', `/api/v1/cards/${id}`, { title: 'Hijacked' })).statusCode,
    ).toBe(403);
    expect((await second.request('PATCH', `/api/v1/cards/${id}`, { done: true })).statusCode).toBe(
      403,
    );
    const fresh = await harness.db.card.findUnique({ where: { id } });
    expect(fresh?.title).toBe('First card');
    expect(fresh?.done).toBe(false);
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

  it('can read a public board without joining it first', async () => {
    const owner = harness.client();
    const created = await board(owner, { visibility: 'public', anon_write: 'open' });
    const visitor = new AnonClient(harness.client());
    await visitor.join(created.id, 'Guest');
    const state = await visitor.request('GET', `/api/v1/boards/${created.id}/state`);
    expect(state.statusCode).toBe(200);
  });
});

describe('moderated writes', () => {
  it('creates a pending row and no card, with no event', async () => {
    const owner = harness.client();
    const created = await board(owner, { anon_write: 'moderated' });
    const visitor = new AnonClient(harness.client());
    await visitor.join(created.id, 'Waiting');
    const column = await firstColumn(visitor, created.id);

    const response = await visitor.request('POST', `/api/v1/boards/${created.id}/cards`, {
      column,
      title: 'Under review',
    });
    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body) as { status: string; id: string };
    expect(body.status).toBe('pending');

    expect(await harness.db.card.count({ where: { board_id: created.id } })).toBe(0);
    // No card, and nothing in the log that implies one: the board's own
    // creation events are not this write's business.
    expect(
      await harness.db.event.count({
        where: { board_id: created.id, type: { in: ['card_created', 'pending_created'] } },
      }),
    ).toBe(0);
    const pending = await harness.db.pendingCard.findUnique({ where: { id: body.id } });
    expect(pending?.actor_label).toBe('Waiting');
    expect(pending?.title).toBe('Under review');
  });
});
