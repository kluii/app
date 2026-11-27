// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rule the server enforces: a board is written by its members.
 *
 * The UI already hides the write affordances from a link visitor and an
 * anonymous one; this file gates the server, because a hidden button is not a
 * permission decision. Four exits: an edit link cannot write, an anonymous
 * cookie cannot write or comment, and the two retired policies cannot be set at
 * all — a stored one keeps working for what it still means (reading).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';
import { setLegacyPolicy } from './helpers/legacy.js';

const WEB_DIR = new URL('./fixtures/web', import.meta.url).pathname;

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer({ webDir: WEB_DIR });
});

afterAll(async () => {
  await harness.close();
});

type Board = { id: string; link_role: string; anon_write: string };
type Column = { id: string };

async function linkedBoard(owner: TestClient): Promise<{ board: Board; columnId: string }> {
  await owner.signup(`members-${owner.suffix}`);
  const created = await owner.request('POST', '/api/v1/boards', {
    name: 'Members write',
    visibility: 'link',
  });
  const board = created.json() as Board;
  const patched = await owner.request('PATCH', `/api/v1/boards/${board.id}`, { link_role: 'read' });
  const state = await owner.request('GET', `/api/v1/boards/${board.id}/state`);
  const [column] = (state.json() as { columns: Column[] }).columns;
  if (!column) throw new Error('no column');
  return { board: patched.json() as Board, columnId: column.id };
}

class Browsers {
  private cookie: string | null = null;

  constructor(private readonly client: TestClient) {}

  /** `/l/<token>` sets the link cookie; `/boards/:id/anon` the anonymous one. */
  async take(setCookie: string | undefined): Promise<string> {
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const pair = raw?.split(';')[0];
    if (pair !== undefined) this.cookie = pair;
    return this.cookie ?? '';
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
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
    return { statusCode: response.statusCode, body: response.body };
  }
}

describe('a board is written by its members', () => {
  it('refuses an edit link a card, and writes nothing', async () => {
    const owner = harness.client();
    const { board, columnId } = await linkedBoard(owner);

    // The row is created through the API: creating an `edit` link is still
    // allowed, because the column is data. It just grants no write.
    const link = await owner.request('POST', `/api/v1/boards/${board.id}/links`, { role: 'edit' });
    expect(link.statusCode).toBe(201);
    const token = (link.json() as { token: string }).token;

    // The cookie the redirect sets is what a browser keeps.
    const visit = await harness.app.inject({ method: 'GET', url: `/l/${token}` });
    expect(visit.statusCode).toBe(302);
    const visitor = new Browsers(harness.client());
    expect(await visitor.take(visit.headers['set-cookie'] as string | undefined)).toContain(
      'klui_link=',
    );

    const created = await visitor.request('POST', `/api/v1/boards/${board.id}/cards`, {
      column: columnId,
      title: 'From a link',
    });
    expect(created.statusCode).toBe(403);
    expect((JSON.parse(created.body) as { error: { code: string } }).error.code).toBe('forbidden');
    expect(await harness.db.card.count({ where: { board_id: board.id } })).toBe(0);
  });

  it('refuses an anonymous cookie a card and a comment, and writes nothing', async () => {
    const owner = harness.client();
    const { board, columnId } = await linkedBoard(owner);
    // A row written before the rule: the cookie can still be obtained, which is
    // what makes this a test of the writer and not of the gate.
    await setLegacyPolicy(harness.db, board.id, { anonWrite: 'open' });

    const ownerCard = await owner.request('POST', `/api/v1/boards/${board.id}/cards`, {
      column: columnId,
      title: 'The member wrote this',
    });
    expect(ownerCard.statusCode).toBe(201);
    const cardId = (ownerCard.json() as { id: string }).id;

    const visitor = new Browsers(harness.client());
    const joined = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/boards/${board.id}/anon`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ label: 'Passing stranger' }),
    });
    expect(joined.statusCode).toBe(200);
    await visitor.take(joined.headers['set-cookie'] as string | undefined);

    // The cookie is real: the board is readable with it.
    expect((await visitor.request('GET', `/api/v1/boards/${board.id}/state`)).statusCode).toBe(200);

    const created = await visitor.request('POST', `/api/v1/boards/${board.id}/cards`, {
      column: columnId,
      title: 'From the street',
    });
    expect(created.statusCode).toBe(403);

    const comment = await visitor.request('POST', `/api/v1/cards/${cardId}/comments`, {
      body: 'hello',
    });
    expect(comment.statusCode).toBe(403);

    expect(await harness.db.card.count({ where: { board_id: board.id } })).toBe(1);
    expect(await harness.db.comment.count({ where: { card_id: cardId } })).toBe(0);
  });

  it('refuses to set anonymous writes again', async () => {
    const owner = harness.client();
    const { board } = await linkedBoard(owner);

    for (const anon_write of ['open', 'moderated'] as const) {
      const patch = await owner.request('PATCH', `/api/v1/boards/${board.id}`, { anon_write });
      expect(patch.statusCode).toBe(400);
      const body = JSON.parse(patch.body) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('validation_failed');
      expect(body.error.message).toBe('anonymous writes are no longer available');
    }

    // `off` is the only value the API still writes.
    const off = await owner.request('PATCH', `/api/v1/boards/${board.id}`, { anon_write: 'off' });
    expect(off.statusCode).toBe(200);
    const row = await harness.db.board.findUniqueOrThrow({ where: { id: board.id } });
    expect(row.anon_write).toBe('off');
  });

  it('refuses to make a share link editable', async () => {
    const owner = harness.client();
    const { board } = await linkedBoard(owner);

    const patch = await owner.request('PATCH', `/api/v1/boards/${board.id}`, {
      link_role: 'edit',
    });
    expect(patch.statusCode).toBe(400);
    const body = JSON.parse(patch.body) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.message).toBe('a share link is read-only');

    // `read` and `none` stay accepted.
    expect(
      (await owner.request('PATCH', `/api/v1/boards/${board.id}`, { link_role: 'none' }))
        .statusCode,
    ).toBe(200);
    expect(
      (await owner.request('PATCH', `/api/v1/boards/${board.id}`, { link_role: 'read' }))
        .statusCode,
    ).toBe(200);
    const row = await harness.db.board.findUniqueOrThrow({ where: { id: board.id } });
    expect(row.link_role).toBe('read');
  });
});
