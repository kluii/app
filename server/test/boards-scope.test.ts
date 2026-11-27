// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K4-01 — `GET /boards` lists what the credential can read, and nothing else.
 *
 * The defect this file pins: a board-scoped key listed every board its owner
 * belonged to. The REST list read `boardMember` rows directly, while the MCP
 * twin filtered each row through `can()`, so the same question had two answers
 * — and `GET /boards/B/state` answered 404 for the board the list had just
 * named. One question, one function: the board-scoped filter is `can()`'s
 * structural rule, not a second rule beside it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';
import { listBoardsFor } from '../src/boards/service.js';

type Board = { id: string; name: string };
type Minted = { id: string; key: string };

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer();
});

afterAll(async () => {
  await harness.close();
});

async function newBoard(client: TestClient, name: string): Promise<Board> {
  const created = await client.request('POST', '/api/v1/boards', { name, visibility: 'private' });
  expect(created.statusCode).toBe(201);
  return created.json() as Board;
}

async function mint(client: TestClient, body: Record<string, unknown>): Promise<Minted> {
  const created = await client.request('POST', '/api/v1/agent-keys', body);
  expect(created.statusCode).toBe(201);
  return created.json() as Minted;
}

/** The list as the agent, with no session cookie involved at all. */
async function listAs(raw: string): Promise<{ statusCode: number; ids: string[]; code?: string }> {
  const response = await harness.app.inject({
    method: 'GET',
    url: '/api/v1/boards',
    headers: { authorization: `Bearer ${raw}` },
  });
  if (response.statusCode !== 200) {
    return {
      statusCode: response.statusCode,
      ids: [],
      code: (response.json() as { error: { code: string } }).error.code,
    };
  }
  return {
    statusCode: 200,
    ids: (response.json() as { items: Board[] }).items.map((item) => item.id),
  };
}

/** The MCP twin, over the real transport, for the same key. */
async function mcpListAs(raw: string): Promise<string[]> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `Bearer ${raw}`, 'content-type': 'application/json' },
    payload: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_boards', arguments: {} },
    }),
  });
  expect(response.statusCode).toBe(200);
  const body = response.json() as {
    result: { structuredContent: { items: Board[] } };
  };
  return body.result.structuredContent.items.map((item) => item.id);
}

describe('the board list is the read decision', () => {
  it('gives a board-scoped key exactly the board it is bound to', async () => {
    const owner = harness.client();
    await owner.signup(`scope-owner-${owner.suffix}`);
    const first = await newBoard(owner, 'Board A');
    const second = await newBoard(owner, 'Board B');
    const key = await mint(owner, { name: 'scoped', scope: 'board', board_id: first.id });

    const listed = await listAs(key.key);
    expect(listed.statusCode).toBe(200);
    expect(listed.ids).toEqual([first.id]);

    // The board the list must not name is a 404 on its own route: the two
    // answers now agree, which they did not before.
    const foreign = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/boards/${second.id}/state`,
      headers: { authorization: `Bearer ${key.key}` },
    });
    expect(foreign.statusCode).toBe(404);
    expect((foreign.json() as { error: { code: string } }).error.code).toBe('board_not_found');

    // One source of truth: the MCP twin is the same function, so it agrees.
    expect(await mcpListAs(key.key)).toEqual([first.id]);
  });

  it('gives a user-scoped key every board its owner belongs to', async () => {
    const username = `scope-user-${harness.client().suffix}`;
    const owner = harness.client();
    await owner.signup(username);
    const first = await newBoard(owner, 'Owned one');
    const second = await newBoard(owner, 'Owned two');

    // A board the owner is a member of, not the owner of: "belongs to" is the
    // membership row, and a user-scoped key inherits the whole of it.
    const host = harness.client();
    await host.signup(`scope-host-${host.suffix}`);
    const shared = await newBoard(host, 'Somebody else');
    const invited = await host.request('POST', `/api/v1/boards/${shared.id}/members`, {
      username,
      role: 'editor',
    });
    expect(invited.statusCode).toBeLessThan(300);

    const expected = [first.id, second.id, shared.id].sort();
    const key = await mint(owner, { name: 'personal', scope: 'user' });
    const listed = await listAs(key.key);
    expect(listed.statusCode).toBe(200);
    expect([...listed.ids].sort()).toEqual(expected);

    // The session that owns the key sees the same list: a key is not a wider lens.
    const asSession = await owner.request('GET', '/api/v1/boards');
    expect((asSession.json() as { items: Board[] }).items.map((item) => item.id).sort()).toEqual(
      expected,
    );

    expect((await mcpListAs(key.key)).sort()).toEqual(expected);
  });

  it('keeps the anonymous and link answers unchanged: no membership, no boards', async () => {
    // No credential is not an empty list: the route needs an actor to answer at
    // all, and it answered that way before the fix.
    const anonymous = await harness.app.inject({ method: 'GET', url: '/api/v1/boards' });
    expect(anonymous.statusCode).toBe(401);
    expect((anonymous.json() as { error: { code: string } }).error.code).toBe('unauthenticated');

    const owner = harness.client();
    await owner.signup(`scope-anon-${owner.suffix}`);
    const board = await newBoard(owner, 'Open to visitors');
    const opened = await owner.request('PATCH', `/api/v1/boards/${board.id}`, {
      visibility: 'public',
      anon_write: 'open',
    });
    expect(opened.statusCode).toBe(200);

    const joined = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/boards/${board.id}/anon`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ label: 'visitor' }),
    });
    expect(joined.statusCode).toBe(200);
    const anonCookie = (joined.cookies as { name: string; value: string }[]).find(
      (cookie) => cookie.name === 'klui_anon',
    );
    expect(anonCookie?.value).toBeTruthy();

    const asVisitor = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/boards',
      headers: { cookie: `klui_anon=${anonCookie?.value ?? ''}` },
    });
    expect(asVisitor.statusCode).toBe(200);
    expect((asVisitor.json() as { items: unknown[] }).items).toEqual([]);

    // A link holds one board id and no account, so it has no memberships to
    // list. Asserted at the function both routes call: a link has no HTTP path
    // to this list by design (docs/permissions.md §4.2).
    const asLink = await listBoardsFor(
      harness.db,
      { kind: 'link', boardId: board.id, role: 'read', linkId: 'lnk_scope' },
      null,
    );
    expect(asLink.items).toEqual([]);
  });
});

describe('creating a board respects key scope (D2)', () => {
  it('refuses create_board for a board-scoped agent key on both MCP and REST, while user-scoped keys succeed', async () => {
    const owner = harness.client();
    await owner.signup(`scope-create-${owner.suffix}`);
    const bound = await newBoard(owner, 'Bound board');
    const other = await newBoard(owner, 'Other board');
    const boardKey = await mint(owner, { name: 'one-board', scope: 'board', board_id: bound.id });
    const userKey = await mint(owner, { name: 'all-boards', scope: 'user' });

    const mcpRefused = await harness.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${boardKey.key}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_board', arguments: { name: 'Escaped board' } },
      }),
    });
    expect(mcpRefused.statusCode).toBe(200);
    const mcpBody = mcpRefused.json() as {
      error?: { code: number; data?: { code?: string } };
    };
    expect(mcpBody.error?.code).toBe(-32002);
    expect(mcpBody.error?.data?.code).toBe('forbidden');

    const restRefused = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/boards',
      headers: { authorization: `Bearer ${boardKey.key}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Escaped via REST' }),
    });
    expect(restRefused.statusCode).toBe(403);
    expect((restRefused.json() as { error: { code: string } }).error.code).toBe('forbidden');

    // Audit check on search_cards: board-scoped key reads its bound board and 404s another.
    const searchForeign = await harness.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${boardKey.key}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'search_cards', arguments: { board: other.id, query: 'anything' } },
      }),
    });
    expect(searchForeign.statusCode).toBe(200);
    expect(
      (searchForeign.json() as { error?: { code: number; data?: { code?: string } } }).error,
    ).toMatchObject({ code: -32001, data: { code: 'board_not_found' } });

    const searchBound = await harness.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${boardKey.key}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'search_cards', arguments: { board: bound.id } },
      }),
    });
    expect(searchBound.statusCode).toBe(200);
    expect((searchBound.json() as { error?: unknown }).error).toBeUndefined();

    // User-scoped key still creates boards on both MCP and REST.
    const mcpAllowed = await harness.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${userKey.key}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'create_board', arguments: { name: 'Allowed via MCP' } },
      }),
    });
    expect(mcpAllowed.statusCode).toBe(200);
    expect(
      (mcpAllowed.json() as { result?: { structuredContent?: { name?: string } } }).result
        ?.structuredContent?.name,
    ).toBe('Allowed via MCP');

    const restAllowed = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/boards',
      headers: { authorization: `Bearer ${userKey.key}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Allowed via REST' }),
    });
    expect(restAllowed.statusCode).toBe(201);
  });
});
