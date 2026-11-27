// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K3-02 — write links are credentials, and the readable URL is not one.
 *
 * The exits: the raw token exists in exactly one response; revoking kills it on
 * the next request; and a `link` actor reaches exactly what its role allows,
 * never another board.
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
  link_role: string;
  link_suffix: string | null;
  owner: { username: string };
};
type Link = {
  id: string;
  role: 'read' | 'edit';
  label: string | null;
  url: string;
  token: string;
  last_used_at?: string | null;
  revoked_at?: string | null;
};

async function boardWith(
  c: TestClient,
  visibility: 'link' | 'public' = 'link',
): Promise<{ board: Board; owner: string }> {
  const username = `link-${c.suffix}`;
  await c.signup(username);
  const created = await c.request('POST', '/api/v1/boards', { name: 'Shared board', visibility });
  const board = created.json() as Board;
  // `link_role` is independent of visibility and starts at `none`: a board with
  // a readable URL still has to say that the URL may be read.
  const patched = await c.request('PATCH', `/api/v1/boards/${board.id}`, { link_role: 'read' });
  return { board: patched.json() as Board, owner: username };
}

async function createLink(c: TestClient, boardId: string, role: 'read' | 'edit'): Promise<Link> {
  const response = await c.request('POST', `/api/v1/boards/${boardId}/links`, { role });
  expect(response.statusCode).toBe(201);
  return response.json() as Link;
}

/** A browser that holds one link cookie and nothing else. */
class LinkClient {
  private cookie: string | null = null;

  constructor(private readonly client: TestClient) {}

  async visit(token: string): Promise<{ statusCode: number; location: string | undefined }> {
    const response = await this.client.request('GET', `/l/${token}`);
    // The raw header, encoded exactly as the browser would send it back: a
    // signed cookie must not be reassembled by hand.
    const header = response.headers['set-cookie'];
    const raw = Array.isArray(header) ? header[0] : header;
    const pair = raw?.split(';')[0];
    if (pair?.startsWith('klui_link=')) this.cookie = pair;
    return { statusCode: response.statusCode, location: response.headers.location };
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

describe('creating a link', () => {
  it('returns the token once, and stores only its hash', async () => {
    const c = harness.client();
    const { board } = await boardWith(c);
    const link = await createLink(c, board.id, 'edit');

    expect(link.token).toMatch(/^[0-9A-Za-z]{22,}$/u);
    expect(link.url).toBe(`http://localhost:8099/l/${link.token}`);

    const row = await harness.db.boardLink.findUnique({ where: { id: link.id } });
    expect(row?.token_hash).not.toBe(link.token);
    expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/u);

    const encrypted = JSON.stringify(row) + JSON.stringify(await harness.db.event.findMany());
    expect(encrypted).not.toContain(link.token);
  });

  it('refuses to mint a credential the board would ignore', async () => {
    const c = harness.client();
    const username = `nolink-${c.suffix}`;
    await c.signup(username);
    const created = await c.request('POST', '/api/v1/boards', {
      name: 'Closed link',
      visibility: 'link',
    });
    const board = created.json() as Board;
    expect(board.link_role).toBe('none');

    const refused = await c.request('POST', `/api/v1/boards/${board.id}/links`, { role: 'read' });
    expect(refused.statusCode).toBe(400);
    expect(
      (refused.json() as { error: { details?: { path: string }[] } }).error.details?.[0]?.path,
    ).toBe('link_role');
  });

  it('lists the metadata forever and the token never', async () => {
    const c = harness.client();
    const { board } = await boardWith(c);
    const link = await createLink(c, board.id, 'read');

    const listed = await c.request('GET', `/api/v1/boards/${board.id}/links`);
    expect(listed.statusCode).toBe(200);
    const body = listed.json() as { items: Link[] };
    expect(body.items.map((item) => item.id)).toEqual([link.id]);
    expect(listed.body).not.toContain(link.token);
    expect(body.items[0]?.token).toBeUndefined();
  });

  it('refuses a caller who cannot manage links', async () => {
    const owner = harness.client();
    const { board } = await boardWith(owner);
    const editor = harness.client();
    const editorUser = await editor.signup(`editor-${editor.suffix}`);
    // Member management is K3-05; here the row is enough to prove the gate.
    await harness.db.boardMember.create({
      data: {
        id: `bmb_${crypto.randomUUID().replaceAll('-', '').slice(0, 22)}`,
        board_id: board.id,
        user_id: editorUser.id,
        role: 'editor',
      },
    });

    const denied = await editor.request('POST', `/api/v1/boards/${board.id}/links`, {
      role: 'read',
    });
    expect(denied.statusCode).toBe(403);

    const stranger = harness.client();
    await stranger.signup(`stranger-${stranger.suffix}`);
    const hidden = await stranger.request('POST', `/api/v1/boards/${board.id}/links`, {
      role: 'read',
    });
    expect(hidden.statusCode).toBe(404);
  });
});

describe('using a link', () => {
  it('sets a scoped cookie and opens the board as a link actor', async () => {
    const owner = harness.client();
    const { board } = await boardWith(owner);
    const link = await createLink(owner, board.id, 'edit');

    const visitor = new LinkClient(harness.client());
    const visit = await visitor.visit(link.token);
    expect(visit.statusCode).toBe(302);
    expect(visit.location).toBe(
      `/${board.owner.username}/${board.slug}-${String(board.link_suffix)}`,
    );

    const state = await visitor.request('GET', `/api/v1/boards/${board.id}/state`);
    expect(state.statusCode).toBe(200);
    const parsed = JSON.parse(state.body) as {
      caller: { actor_kind: string; role: string | null; can_write: boolean; label: string };
    };
    expect(parsed.caller.actor_kind).toBe('link');
    expect(parsed.caller.role).toBeNull();
    expect(parsed.caller.can_write).toBe(true);
    expect(parsed.caller.label).toBe('link');

    const row = await harness.db.boardLink.findUnique({ where: { id: link.id } });
    expect(row?.last_used_at).not.toBeNull();
  });

  it('lets an edit link write a card and refuses a delete', async () => {
    const owner = harness.client();
    const { board } = await boardWith(owner);
    const link = await createLink(owner, board.id, 'edit');
    const visitor = new LinkClient(harness.client());
    await visitor.visit(link.token);

    const state = await visitor.request('GET', `/api/v1/boards/${board.id}/state`);
    const columns = (JSON.parse(state.body) as { columns: { id: string }[] }).columns;
    const created = await visitor.request('POST', `/api/v1/boards/${board.id}/cards`, {
      column: columns[0]?.id,
      title: 'From a link',
    });
    expect(created.statusCode).toBe(201);
    const card = JSON.parse(created.body) as { id: string };

    const deleted = await visitor.request('DELETE', `/api/v1/cards/${card.id}`);
    expect(deleted.statusCode).toBe(403);
  });

  it('gives a read link the board and no write', async () => {
    const owner = harness.client();
    const { board } = await boardWith(owner);
    const link = await createLink(owner, board.id, 'read');
    const visitor = new LinkClient(harness.client());
    await visitor.visit(link.token);

    const state = await visitor.request('GET', `/api/v1/boards/${board.id}/state`);
    expect(state.statusCode).toBe(200);
    expect((JSON.parse(state.body) as { caller: { can_write: boolean } }).caller.can_write).toBe(
      false,
    );

    const columns = (JSON.parse(state.body) as { columns: { id: string }[] }).columns;
    const created = await visitor.request('POST', `/api/v1/boards/${board.id}/cards`, {
      column: columns[0]?.id,
      title: 'Should not exist',
    });
    expect(created.statusCode).toBe(403);
  });

  it('cannot reach another board with the same cookie', async () => {
    const owner = harness.client();
    const first = await boardWith(owner);
    const second = await owner.request('POST', '/api/v1/boards', {
      name: 'Other board',
      visibility: 'link',
    });
    const other = second.json() as Board;
    const link = await createLink(owner, first.board.id, 'edit');
    const visitor = new LinkClient(harness.client());
    await visitor.visit(link.token);

    const foreign = await visitor.request('GET', `/api/v1/boards/${other.id}/state`);
    expect(foreign.statusCode).toBe(404);
  });

  it('stops reading when the board sets link_role to none', async () => {
    const owner = harness.client();
    const { board } = await boardWith(owner);
    const link = await createLink(owner, board.id, 'edit');
    const visitor = new LinkClient(harness.client());
    await visitor.visit(link.token);

    const patched = await owner.request('PATCH', `/api/v1/boards/${board.id}`, {
      link_role: 'none',
    });
    expect(patched.statusCode).toBe(200);

    const state = await visitor.request('GET', `/api/v1/boards/${board.id}/state`);
    expect(state.statusCode).toBe(404);
  });
});

describe('revoking a link', () => {
  it('answers 404 on the token URL and drops the actor', async () => {
    const owner = harness.client();
    const { board } = await boardWith(owner);
    const link = await createLink(owner, board.id, 'edit');

    const revoked = await owner.request('DELETE', `/api/v1/boards/${board.id}/links/${link.id}`);
    expect(revoked.statusCode).toBe(204);

    const visitor = new LinkClient(harness.client());
    const visit = await visitor.visit(link.token);
    expect(visit.statusCode).toBe(404);

    const state = await visitor.request('GET', `/api/v1/boards/${board.id}/state`);
    expect(state.statusCode).toBe(401);
  });

  it('keeps the row for the record, with revoked_at set', async () => {
    const owner = harness.client();
    const { board } = await boardWith(owner);
    const link = await createLink(owner, board.id, 'read');
    await owner.request('DELETE', `/api/v1/boards/${board.id}/links/${link.id}`);

    const listed = await owner.request('GET', `/api/v1/boards/${board.id}/links`);
    const body = listed.json() as { items: Link[] };
    expect(body.items[0]?.revoked_at).not.toBeNull();
  });
});
