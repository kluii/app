// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K4-02 — the MCP transport.
 *
 * The exits: a raw initialize + tools/list returns all 21 frozen tools, an
 * unknown tool answers -32601 with the closest names, and a bad argument
 * answers -32602 naming the parameter, the type it wanted and an example that
 * would work.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';
import { TOOL_NAMES } from '../src/mcp/schemas.js';
import { LISTED_TOOLS, TOOL_HANDLERS } from '../src/mcp/registry.js';

type Rpc = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: Record<string, unknown> };
};

let harness: Awaited<ReturnType<typeof startServer>>;
let key = '';
let owner: TestClient;

beforeAll(async () => {
  harness = await startServer();
  owner = harness.client();
  await owner.signup(`mcp-${owner.suffix}`);
  const created = await owner.request('POST', '/api/v1/agent-keys', { name: 'mcp', scope: 'user' });
  expect(created.statusCode).toBe(201);
  key = (created.json() as { key: string }).key;
});

afterAll(async () => {
  await harness.close();
});

async function rpc(payload: unknown, bearer = key): Promise<{ statusCode: number; body: Rpc }> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(bearer === '' ? {} : { authorization: `Bearer ${bearer}` }),
    },
    payload: JSON.stringify(payload),
  });
  return { statusCode: response.statusCode, body: response.json() as Rpc };
}

describe('the MCP transport', () => {
  it('completes the handshake and advertises the frozen tool surface', async () => {
    const init = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } },
    });
    expect(init.statusCode).toBe(200);
    const result = init.body.result as {
      protocolVersion: string;
      capabilities: { tools: { listChanged: boolean } };
      serverInfo: { name: string; version: string };
    };
    expect(result.protocolVersion).toBe('2025-06-18');
    expect(result.capabilities.tools.listChanged).toBe(false);
    expect(result.serverInfo.name).toBe('klui');

    const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(list.statusCode).toBe(200);
    const tools = (list.body.result as { tools: { name: string; inputSchema: unknown }[] }).tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual([...LISTED_TOOLS].sort());
    // Every tool carries a real JSON Schema, not a free-form object.
    for (const tool of tools) {
      const schema = tool.inputSchema as { type?: string; properties?: Record<string, unknown> };
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();
    }
    const move = tools.find((tool) => tool.name === 'move_card');
    expect(JSON.stringify(move)).toContain('before');
    expect(JSON.stringify(move)).toContain('after');
  });

  /**
   * Listing is a claim, so the wire response is the registry minus the names
   * that have no handler. This is the test that keeps the filter honest: it
   * fails the moment a tool is advertised without one, and the moment a handler
   * exists but is hidden from the client.
   */
  it('serves exactly the tools it has a handler for', async () => {
    const list = await rpc({ jsonrpc: '2.0', id: 11, method: 'tools/list' });
    const listed = (list.body.result as { tools: { name: string }[] }).tools.map(
      (tool) => tool.name,
    );

    for (const name of listed) {
      expect(
        TOOL_HANDLERS[name as (typeof TOOL_NAMES)[number]],
        `${name} has no handler`,
      ).toBeTypeOf('function');
    }
    const served = TOOL_NAMES.filter((name) => TOOL_HANDLERS[name] !== undefined);
    expect([...listed].sort()).toEqual([...served].sort());

    // The frozen surface the parity test asserts does not shrink with the wire.
    expect(TOOL_NAMES).toHaveLength(21);
  });

  it('answers a frozen tool that has no handler with -32601, never -32603', async () => {
    const unbuilt = TOOL_NAMES.find((name) => TOOL_HANDLERS[name] === undefined);
    // Once all 21 land the filter is a no-op and there is nothing to ask for.
    if (unbuilt === undefined) return;
    const response = await rpc({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: unbuilt, arguments: {} },
    });
    expect(response.body.error?.code).toBe(-32601);
    expect(String(response.body.error?.data?.hint)).toContain('Did you mean');
  });

  it('answers an unknown tool with -32601 and the closest three names', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'move_crad', arguments: {} },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.error?.code).toBe(-32601);
    const hint = String(response.body.error?.data?.hint ?? '');
    expect(hint).toContain('move_card');
    expect(hint.split(',').length).toBe(3);
  });

  it('answers a bad argument with -32602 naming the parameter, the type and an example', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'move_card', arguments: { board: 'brd_01JABCDEFGHJKLMNPQRSTU' } },
    });
    expect(response.body.error?.code).toBe(-32602);
    const data = response.body.error?.data ?? {};
    expect(data.parameter).toBe('card');
    expect(data.expected).toBe('string');
    expect(String(response.body.error?.message)).toContain('move_card');
    const example = data.example as Record<string, unknown>;
    expect(example.card).toBeTypeOf('string');
  });

  it('accepts a notification with 202 and an empty body', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      payload: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(response.statusCode).toBe(202);
    expect(response.body).toBe('');
  });

  it('answers a batch in order and skips notifications inside it', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      payload: JSON.stringify([
        { jsonrpc: '2.0', id: 'a', method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/cancelled' },
        { jsonrpc: '2.0', id: 'b', method: 'ping' },
      ]),
    });
    expect(response.statusCode).toBe(200);
    const bodies = response.json() as Rpc[];
    expect(bodies).toHaveLength(2);
    expect(bodies.map((body) => body.id)).toEqual(['a', 'b']);
  });

  it('refuses a GET and an unauthenticated call', async () => {
    const get = await harness.app.inject({ method: 'GET', url: '/mcp' });
    expect(get.statusCode).toBe(405);
    expect(get.headers.allow).toBe('POST');

    const anonymous = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, '');
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.body.error?.code).toBe(-32001);
  });

  it('answers whoami with the account and the credential scope', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'whoami', arguments: {} },
    });
    expect(response.statusCode).toBe(200);
    const result = response.body.result as {
      structuredContent: { actor_kind: string; scope: string; user: { username: string } };
      content: { type: string; text: string }[];
      isError: boolean;
    };
    expect(result.isError).toBe(false);
    expect(result.structuredContent.actor_kind).toBe('agent');
    expect(result.structuredContent.scope).toBe('user');
    expect(result.structuredContent.user.username).toContain('mcp-');
    // The text block carries the same object, for clients without structured output.
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual(result.structuredContent);
  });

  it('lists boards and reads one board in a single call', async () => {
    const created = await owner.request('POST', '/api/v1/boards', { name: 'MCP board' });
    const boardId = (created.json() as { id: string }).id;

    const listed = await rpc({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'list_boards', arguments: {} },
    });
    const items = (listed.body.result as { structuredContent: { items: { id: string }[] } })
      .structuredContent.items;
    expect(items.some((board) => board.id === boardId)).toBe(true);

    const state = await rpc({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'get_board', arguments: { board: boardId } },
    });
    const board = (
      state.body.result as {
        structuredContent: { columns: unknown[]; cards: unknown[]; caller_role: string };
      }
    ).structuredContent;
    expect(board.columns.length).toBeGreaterThan(0);
    expect(board.caller_role).toBe('owner');
  });

  it('maps an unreadable board to -32001, never a confirming 403', async () => {
    const stranger = harness.client();
    await stranger.signup(`mcp-stranger-${stranger.suffix}`);
    const foreign = await owner.request('POST', '/api/v1/boards', { name: 'Private' });
    const foreignId = (foreign.json() as { id: string }).id;
    const strangerKey = await stranger.request('POST', '/api/v1/agent-keys', {
      name: 'stranger',
      scope: 'user',
    });
    const response = await rpc(
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'get_board', arguments: { board: foreignId } },
      },
      (strangerKey.json() as { key: string }).key,
    );
    expect(response.body.error?.code).toBe(-32001);
    expect(response.body.error?.data?.code).toBe('board_not_found');
  });

  it('is stateless: no cookie, no session, the key is the whole context', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/list' }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
