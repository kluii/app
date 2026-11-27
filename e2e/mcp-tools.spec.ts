// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K4-06 — the surface driven by a **real MCP client** against the **built
 * server** (the e2e job boots `server/dist/server.js` on :8123).
 *
 * A hand-rolled JSON body proves the server reads what we wrote. `@modelcontext
 * protocol/sdk` proves a client that only knows the specification can
 * initialise, list, call and read the result: the transport negotiation, the
 * `structuredContent` block, the JSON-RPC error shape of a refused call.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { PASSWORD, uniqueUsername } from './support.js';

const BASE = process.env.KLUI_BASE_URL ?? 'http://127.0.0.1:8123';

/** The REST fixture is the setup; everything after it goes over MCP. */
async function seed(request: APIRequestContext): Promise<{
  key: string;
  boardId: string;
  username: string;
}> {
  const username = uniqueUsername('mcp');
  const signup = await request.post('/api/v1/auth/signup', {
    data: { email: `${username}@klui.test`, username, password: PASSWORD },
  });
  expect(signup.status(), await signup.text()).toBe(201);

  const board = await request.post('/api/v1/boards', {
    headers: { 'x-klui-csrf': await csrf(request) },
    data: { name: 'MCP client board' },
  });
  expect(board.status()).toBe(201);
  const boardId = ((await board.json()) as { id: string }).id;

  const key = await request.post('/api/v1/agent-keys', {
    headers: { 'x-klui-csrf': await csrf(request) },
    data: { name: 'e2e-client', scope: 'user' },
  });
  expect(key.status()).toBe(201);
  return { key: ((await key.json()) as { key: string }).key, boardId, username };
}

async function csrf(request: APIRequestContext): Promise<string> {
  const state = await request.storageState();
  const cookie = state.cookies.find((entry) => entry.name === 'klui_csrf');
  if (!cookie) throw new Error('no CSRF cookie');
  return cookie.value;
}

async function connect(key: string): Promise<Client> {
  const client = new Client({ name: 'klui-e2e', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  await client.connect(transport);
  return client;
}

function structured<T>(result: unknown): T {
  const value = (result as { structuredContent?: unknown }).structuredContent;
  if (value === undefined) throw new Error('no structuredContent in the tool result');
  return value as T;
}

test.describe('the MCP surface through a real client', () => {
  test('initialises, lists 21 tools and walks a card through its life', async ({ request }) => {
    const { key, boardId, username } = await seed(request);
    const client = await connect(key);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(21);
      expect(tools.map((tool) => tool.name)).toContain('export_board');
      const move = tools.find((tool) => tool.name === 'move_card');
      expect(JSON.stringify(move?.inputSchema)).toContain('before');

      const me = structured<{ user: { username: string }; actor_kind: string }>(
        await client.callTool({ name: 'whoami', arguments: {} }),
      );
      expect(me.user.username).toBe(username);
      expect(me.actor_kind).toBe('agent');

      const board = structured<{ columns: { id: string; name: string }[] }>(
        await client.callTool({ name: 'get_board', arguments: { board: boardId } }),
      );
      const [toDo, doing] = board.columns;
      if (!toDo || !doing) throw new Error('no columns');

      const card = structured<{ id: string; title: string }>(
        await client.callTool({
          name: 'create_card',
          arguments: {
            board: boardId,
            column: toDo.id,
            title: 'Written by an MCP client',
            tags: ['e2e'],
          },
        }),
      );
      expect(card.title).toBe('Written by an MCP client');

      await client.callTool({
        name: 'move_card',
        arguments: { board: boardId, card: card.id, column: doing.id, before: null, after: null },
      });
      await client.callTool({
        name: 'set_card_done',
        arguments: { board: boardId, card: card.id, done: true },
      });

      const read = structured<{ column_id: string; done: boolean; tags: { name: string }[] }>(
        await client.callTool({ name: 'get_card', arguments: { board: boardId, card: card.id } }),
      );
      expect(read.column_id).toBe(doing.id);
      expect(read.done).toBe(true);
      expect(read.tags.map((tag) => tag.name)).toEqual(['e2e']);

      const comment = structured<{ body: string }>(
        await client.callTool({
          name: 'create_comment',
          arguments: { board: boardId, card: card.id, body: 'Seen by the client.' },
        }),
      );
      expect(comment.body).toBe('Seen by the client.');

      const found = structured<{ items: { id: string }[]; truncated: boolean }>(
        await client.callTool({
          name: 'search_cards',
          arguments: { board: boardId, query: 'MCP' },
        }),
      );
      expect(found.items.map((item) => item.id)).toContain(card.id);
      expect(found.truncated).toBe(false);

      const activity = structured<{ items: { type: string }[] }>(
        await client.callTool({ name: 'get_activity', arguments: { board: boardId } }),
      );
      expect(activity.items.map((event) => event.type)).toContain('card.completed');

      const exported = structured<{ format: string; content: string }>(
        await client.callTool({
          name: 'export_board',
          arguments: { board: boardId, format: 'json' },
        }),
      );
      expect(exported.format).toBe('json');
      expect(JSON.parse(exported.content).schema).toBe('klui.export/v2');
    } finally {
      await client.close();
    }
  });

  test('a refused call is a JSON-RPC error the client can read', async ({ request }) => {
    const { key, boardId } = await seed(request);
    const client = await connect(key);
    try {
      const missing = await client
        .callTool({ name: 'update_card', arguments: { board: boardId } })
        .then(() => null)
        .catch((error: unknown) => error as { code?: number; message: string });
      expect(missing).not.toBeNull();
      expect(missing?.code).toBe(-32602);
      expect(missing?.message).toContain('update_card');
      expect(missing?.message).toContain('card');

      const unreadable = await client
        .callTool({
          name: 'get_board',
          arguments: { board: 'brd_01JABCDEFGHJKLMNPQRSTU' },
        })
        .then(() => null)
        .catch((error: unknown) => error as { code?: number });
      expect(unreadable?.code).toBe(-32001);
    } finally {
      await client.close();
    }
  });
});
