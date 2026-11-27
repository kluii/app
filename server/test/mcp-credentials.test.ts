// SPDX-License-Identifier: AGPL-3.0-only
/**
 * D1 regression — `/mcp` serves `user` and `agent` credentials only (docs/mcp.md §1).
 *
 * Anonymous (`klui_anon`) and link (`klui_link`) cookies must be refused before
 * the body is read, in the JSON-RPC `-32001` envelope, regardless of the method
 * or tool, without touching the anonymous write bucket, while REST anonymous
 * writes continue to work on the same board.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';
import { setLegacyPolicy } from './helpers/legacy.js';
import { newId } from '../src/lib/ids.js';

type Rpc = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: Record<string, unknown> };
};

let harness: Awaited<ReturnType<typeof startServer>>;
let owner: TestClient;
let boardId = '';
let columnId = '';
let anonCookie = '';
let linkCookie = '';
let agentKey = '';

beforeAll(async () => {
  harness = await startServer({
    env: {
      KLUI_ANON_WRITES_PER_IP: 2,
      KLUI_ANON_WRITES_PER_BOARD: 2,
      KLUI_ANON_JOINS_PER_IP: 20,
    },
  });
  owner = harness.client();
  await owner.signup(`mcp-cred-${owner.suffix}`);

  const board = await owner.request('POST', '/api/v1/boards', { name: 'Open anon board' });
  expect(board.statusCode).toBe(201);
  boardId = (board.json() as { id: string }).id;

  const opened = await owner.request('PATCH', `/api/v1/boards/${boardId}`, {
    visibility: 'public',
    link_role: 'read',
  });
  expect(opened.statusCode).toBe(200);
  // A legacy row: the cookie has to be obtainable for this file to test that
  // /mcp refuses it. The write it used to allow is refused by `can()` now.
  await setLegacyPolicy(harness.db, boardId, { anonWrite: 'open' });

  const state = await owner.request('GET', `/api/v1/boards/${boardId}/state`);
  columnId = (state.json() as { columns: { id: string }[] }).columns[0]?.id ?? '';
  expect(columnId).toBeTruthy();

  const joined = await harness.app.inject({
    method: 'POST',
    url: `/api/v1/boards/${boardId}/anon`,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ label: 'Stranger' }),
  });
  expect(joined.statusCode).toBe(200);
  const anon = (joined.cookies as { name: string; value: string }[]).find(
    (cookie) => cookie.name === 'klui_anon',
  );
  expect(anon?.value).toBeTruthy();
  anonCookie = `klui_anon=${anon?.value ?? ''}`;

  const createdLink = await owner.request('POST', `/api/v1/boards/${boardId}/links`, {
    role: 'edit',
    label: 'editor-link',
  });
  expect(createdLink.statusCode).toBe(201);
  const rawToken = (createdLink.json() as { token: string }).token;
  const openedLink = await harness.app.inject({
    method: 'GET',
    url: `/l/${rawToken}`,
  });
  expect(openedLink.statusCode).toBe(302);
  const link = (openedLink.cookies as { name: string; value: string }[]).find(
    (cookie) => cookie.name === 'klui_link',
  );
  expect(link?.value).toBeTruthy();
  linkCookie = `klui_link=${link?.value ?? ''}`;

  const createdKey = await owner.request('POST', '/api/v1/agent-keys', {
    name: 'cred-check',
    scope: 'user',
  });
  expect(createdKey.statusCode).toBe(201);
  agentKey = (createdKey.json() as { key: string }).key;
});

afterAll(async () => {
  await harness.close();
});

function mcpWithCookie(cookie: string, payload: string, remoteAddress = '127.0.0.1') {
  return harness.app.inject({
    method: 'POST',
    url: '/mcp',
    remoteAddress,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      cookie,
    },
    payload,
  });
}

describe('/mcp credential kinds (D1)', () => {
  it('refuses an anon cookie on tools/call, tools/list, initialize, and malformed JSON before parsing', async () => {
    const payloads = [
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_card',
          arguments: { board: boardId, column: columnId, title: 'Bypass via MCP' },
        },
      }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {} },
      }),
      '{not-valid-json',
    ];

    for (const payload of payloads) {
      const response = await mcpWithCookie(anonCookie, payload);
      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
      const body = response.json() as Rpc;
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBeNull();
      expect(body.error?.code).toBe(-32001);
    }

    // No card was created.
    const state = await owner.request('GET', `/api/v1/boards/${boardId}/state`);
    expect((state.json() as { cards: unknown[] }).cards).toEqual([]);
  });

  it('refuses a link cookie before the body is read', async () => {
    const response = await mcpWithCookie(
      linkCookie,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'create_card',
          arguments: { board: boardId, column: columnId, title: 'Link via MCP' },
        },
      }),
    );
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    const body = response.json() as Rpc;
    expect(body.error?.code).toBe(-32001);
  });

  it('refuses a banned IP carrying an anon cookie', async () => {
    const bannedIp = '203.0.113.42';
    const banId = newId('ban');
    await harness.db.ban.create({
      data: {
        id: banId,
        subject: bannedIp,
        subject_kind: 'ip',
        reason: 'test ban',
        expires_at: null,
      },
    });
    try {
      const response = await mcpWithCookie(
        anonCookie,
        JSON.stringify({
          jsonrpc: '2.0',
          id: 20,
          method: 'tools/call',
          params: {
            name: 'create_card',
            arguments: { board: boardId, column: columnId, title: 'Banned via MCP' },
          },
        }),
        bannedIp,
      );
      expect(response.statusCode).toBe(401);
      const body = response.json() as Rpc;
      expect(body.error?.code).toBe(-32001);

      // REST refuses it too, and writes nothing either way.
      const rest = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/boards/${boardId}/cards`,
        remoteAddress: bannedIp,
        headers: { 'content-type': 'application/json', cookie: anonCookie },
        payload: JSON.stringify({ column: columnId, title: 'Banned REST' }),
      });
      expect(rest.statusCode).toBe(403);
      expect(
        await harness.db.card.count({ where: { board_id: boardId, title: 'Banned REST' } }),
      ).toBe(0);
    } finally {
      await harness.db.ban.deleteMany({ where: { id: banId } });
    }
  });

  it('refuses the anon cookie on both transports, and writes nothing', async () => {
    const cleanIp = '198.51.100.7';
    for (let index = 0; index < 5; index += 1) {
      const response = await mcpWithCookie(
        anonCookie,
        JSON.stringify({
          jsonrpc: '2.0',
          id: 30 + index,
          method: 'tools/call',
          params: {
            name: 'create_card',
            arguments: { board: boardId, column: columnId, title: `MCP ${index}` },
          },
        }),
        cleanIp,
      );
      expect(response.statusCode).toBe(401);
    }

    // The browser door answers the same way: an anonymous cookie writes no card.
    for (let index = 0; index < 2; index += 1) {
      const rest = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/boards/${boardId}/cards`,
        remoteAddress: cleanIp,
        headers: { 'content-type': 'application/json', cookie: anonCookie },
        payload: JSON.stringify({ column: columnId, title: `REST ${index}` }),
      });
      expect(rest.statusCode).toBe(403);
    }
    expect(await harness.db.card.count({ where: { board_id: boardId } })).toBe(0);
  });

  it('still accepts both user sessions and agent keys', async () => {
    const asAgent = await harness.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${agentKey}` },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 40, method: 'ping' }),
    });
    expect(asAgent.statusCode).toBe(200);
    expect((asAgent.json() as Rpc).result).toEqual({});

    const asSession = await owner.request('POST', '/mcp', {
      jsonrpc: '2.0',
      id: 41,
      method: 'ping',
    });
    expect(asSession.statusCode).toBe(200);
    expect((asSession.json() as Rpc).result).toEqual({});
  });
});
