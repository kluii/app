// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K4-01 — agent keys.
 *
 * The exits: a board-scoped key cannot read another board even when its owner
 * is an instance admin, a revoked key answers 401 on the next call, and the raw
 * key appears in exactly one response — never in the list, the row, the events
 * or a log line.
 */
import { Writable } from 'node:stream';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyServerOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { testEnv } from '../src/env.js';
import { ensureInstanceSettings } from '../src/auth/service.js';
import { testDatabaseUrl, testDb } from './helpers/db.js';
import { startServer, TEST_SECRETS, TestClient } from './helpers/server.js';
import { createHub } from '../src/realtime/events.js';

type Created = {
  id: string;
  key: string;
  name: string;
  scope: 'board' | 'user';
  board_id: string | null;
  expires_at: string;
};

type Board = { id: string; slug: string; visibility: string };

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer();
});

afterAll(async () => {
  await harness.close();
});

async function ownerWithBoard(username: string): Promise<{
  client: TestClient;
  board: Board;
  userId: string;
}> {
  const client = harness.client();
  const user = await client.signup(username);
  const created = await client.request('POST', '/api/v1/boards', {
    name: 'Agent board',
    visibility: 'private',
  });
  return { client, board: created.json() as Board, userId: user.id };
}

async function mint(client: TestClient, body: Record<string, unknown>): Promise<Created> {
  const response = await client.request('POST', '/api/v1/agent-keys', body);
  expect(response.statusCode).toBe(201);
  return response.json() as Created;
}

/** A request as the agent, with no session cookie involved at all. */
async function asAgent(raw: string, path: string): Promise<{ statusCode: number; body: string }> {
  const response = await harness.app.inject({
    method: 'GET',
    url: path,
    headers: { authorization: `Bearer ${raw}` },
  });
  return { statusCode: response.statusCode, body: response.body };
}

describe('agent keys', () => {
  it('shows the key once, stores only its hash, and never lists it', async () => {
    const { client, board } = await ownerWithBoard(`key-${harness.client().suffix}`);
    const created = await mint(client, {
      name: 'backlog-bot',
      scope: 'board',
      board_id: board.id,
    });

    expect(created.key.startsWith('kb_')).toBe(true);
    expect(created.key).toHaveLength(35);
    expect(created.expires_at).not.toBeNull();

    const row = await harness.db.agentKey.findUnique({ where: { id: created.id } });
    expect(row?.key_hash).not.toBe(created.key);
    expect(row?.key_hash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain(created.key);

    const listed = await client.request('GET', '/api/v1/agent-keys');
    expect(listed.statusCode).toBe(200);
    const items = (listed.json() as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(created.id);
    expect(items[0]?.name).toBe('backlog-bot');
    expect(JSON.stringify(items)).not.toContain(created.key);
    expect(JSON.stringify(items)).not.toContain('key_hash');

    // The creation is in the event log, without the credential.
    const events = await harness.db.event.findMany({
      where: { type: 'agent_key_created', board_id: board.id },
    });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(created.key);
  });

  it('reads its own board and answers 404 on another, even for an instance admin', async () => {
    const adminClient = harness.client();
    const admin = await adminClient.signup(`agent-admin-${adminClient.suffix}`);
    await harness.db.user.update({
      where: { id: admin.id },
      data: { is_instance_admin: true },
    });
    const first = await adminClient.request('POST', '/api/v1/boards', {
      name: 'First',
      visibility: 'private',
    });
    const second = await adminClient.request('POST', '/api/v1/boards', {
      name: 'Second',
      visibility: 'private',
    });
    const firstId = (first.json() as Board).id;
    const secondId = (second.json() as Board).id;

    const key = await mint(adminClient, {
      name: 'scoped',
      scope: 'board',
      board_id: firstId,
    });

    expect((await asAgent(key.key, `/api/v1/boards/${firstId}/state`)).statusCode).toBe(200);
    // An instance admin is not a board member of a board they do not belong to,
    // and the key is scoped structurally: this is a 404, not a 403.
    const foreign = await asAgent(key.key, `/api/v1/boards/${secondId}/state`);
    expect(foreign.statusCode).toBe(404);
    expect((JSON.parse(foreign.body) as { error: { code: string } }).error.code).toBe(
      'board_not_found',
    );
  });

  it('acts as the user on every board they belong to when scoped to the user', async () => {
    const owner = harness.client();
    const user = await owner.signup(`agent-user-${owner.suffix}`);
    const board = await owner.request('POST', '/api/v1/boards', {
      name: 'Shared',
      visibility: 'private',
    });
    const key = await mint(owner, { name: 'personal', scope: 'user' });

    const state = await asAgent(key.key, `/api/v1/boards/${(board.json() as Board).id}/state`);
    expect(state.statusCode).toBe(200);

    const listed = await asAgent(key.key, '/api/v1/boards');
    expect(listed.statusCode).toBe(200);
    expect((JSON.parse(listed.body) as { items: unknown[] }).items).toHaveLength(1);

    // A key cannot mint another key: the credential is not a session.
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/agent-keys',
      headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'child', scope: 'user' }),
    });
    expect(created.statusCode).toBe(403);
    void user;
  });

  it('answers 401 on the next call after revocation', async () => {
    const { client, board } = await ownerWithBoard(`agent-revoke-${harness.client().suffix}`);
    const key = await mint(client, { name: 'short-lived', scope: 'board', board_id: board.id });
    expect((await asAgent(key.key, `/api/v1/boards/${board.id}/state`)).statusCode).toBe(200);

    const revoked = await client.request('DELETE', `/api/v1/agent-keys/${key.id}`);
    expect(revoked.statusCode).toBe(204);

    const after = await asAgent(key.key, `/api/v1/boards/${board.id}/state`);
    expect(after.statusCode).toBe(401);
    expect((JSON.parse(after.body) as { error: { code: string } }).error.code).toBe(
      'invalid_credential',
    );
    const row = await harness.db.agentKey.findUnique({ where: { id: key.id } });
    expect(row?.revoked_at).not.toBeNull();
  });

  it('refuses an expired key and an expiry outside 1..365 days', async () => {
    const { client, board } = await ownerWithBoard(`agent-expiry-${harness.client().suffix}`);
    const key = await mint(client, { name: 'stale', scope: 'board', board_id: board.id });
    await harness.db.agentKey.update({
      where: { id: key.id },
      data: { expires_at: new Date(Date.now() - 1000) },
    });
    expect((await asAgent(key.key, `/api/v1/boards/${board.id}/state`)).statusCode).toBe(401);

    for (const expires_in_days of [0, 366]) {
      const invalid = await client.request('POST', '/api/v1/agent-keys', {
        name: 'wrong',
        scope: 'board',
        board_id: board.id,
        expires_in_days,
      });
      expect(invalid.statusCode).toBe(400);
    }
  });

  it('requires a board for a board-scoped key and forbids a foreign board', async () => {
    const { client, board } = await ownerWithBoard(`agent-shape-${harness.client().suffix}`);
    const missing = await client.request('POST', '/api/v1/agent-keys', {
      name: 'no-board',
      scope: 'board',
    });
    expect(missing.statusCode).toBe(400);

    const stranger = harness.client();
    await stranger.signup(`agent-stranger-${stranger.suffix}`);
    const foreign = await stranger.request('POST', '/api/v1/agent-keys', {
      name: 'theirs',
      scope: 'board',
      board_id: board.id,
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('reports revocation without asking the endpoint', async () => {
    const { client, board } = await ownerWithBoard(`agent-test-${harness.client().suffix}`);
    const key = await mint(client, { name: 'probe', scope: 'board', board_id: board.id });

    await client.request('DELETE', `/api/v1/agent-keys/${key.id}`);
    const after = await client.request('POST', `/api/v1/agent-keys/${key.id}/test`, {});
    expect(after.statusCode).toBe(200);
    const failed = after.json() as { ok: boolean; reason: string; via: string | null };
    expect(failed.ok).toBe(false);
    expect(failed.reason).toBe('revoked');
    // Nothing was called: the row already answered.
    expect(failed.via).toBeNull();
  });

  it('updates last_used_at at most once a minute', async () => {
    const { client, board } = await ownerWithBoard(`agent-used-${harness.client().suffix}`);
    const key = await mint(client, { name: 'used', scope: 'board', board_id: board.id });
    await asAgent(key.key, `/api/v1/boards/${board.id}/state`);
    const first = await harness.db.agentKey.findUnique({ where: { id: key.id } });
    expect(first?.last_used_at).not.toBeNull();

    const stamp = new Date(Date.now() - 5_000);
    await harness.db.agentKey.update({ where: { id: key.id }, data: { last_used_at: stamp } });
    await asAgent(key.key, `/api/v1/boards/${board.id}/state`);
    const second = await harness.db.agentKey.findUnique({ where: { id: key.id } });
    // Within a minute of the stored value: no write, so the timestamp is intact.
    expect(second?.last_used_at?.toISOString()).toBe(stamp.toISOString());
  });
});

/**
 * K4-07 — "Test connection" is an MCP call (docs/mcp.md §7).
 *
 * The panel used to hash the key and re-run `loadBoardFor` in process, so it
 * answered "connected" while `/mcp` was unreachable or refused that key. These
 * tests make the button prove the endpoint: a real `initialize` and
 * `tools/call whoami` against a listener, a JSON-RPC error is a refusal, and the
 * in-process path survives only for an instance with no public URL.
 */
describe('test connection', () => {
  let live: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    live = await startServer({ listen: true });
  });

  afterAll(async () => {
    await live.close();
  });

  async function ownerWithKey(
    username: string,
  ): Promise<{ owner: TestClient; board: Board; key: Created }> {
    const owner = live.client();
    await owner.signup(username);
    const created = await owner.request('POST', '/api/v1/boards', {
      name: 'Probe board',
      visibility: 'private',
    });
    const board = created.json() as Board;
    const key = await mint(owner, { name: 'probe', scope: 'board', board_id: board.id });
    return { owner, board, key };
  }

  it('goes through /mcp and reports the board the key really reaches', async () => {
    const { owner, board, key } = await ownerWithKey(`probe-mcp-${live.client().suffix}`);

    const tested = await owner.request('POST', `/api/v1/agent-keys/${key.id}/test`, {
      key: key.key,
    });
    expect(tested.statusCode).toBe(200);
    const body = tested.json() as {
      ok: boolean;
      via: string;
      board: { id: string; name: string };
      role: string;
      key: string;
    };
    expect(body.ok).toBe(true);
    expect(body.via).toBe('mcp');
    expect(body.board).toEqual({ id: board.id, name: 'Probe board' });
    expect(body.role).toBe('owner');
    expect(body.key).toBe('probe');
  });

  it('refuses when /mcp answers -32603, whatever the row says', async () => {
    // A stand-in endpoint: it speaks JSON-RPC and answers every call with the
    // internal error the panel must not paper over.
    const stub = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32603, message: 'internal error' },
        }),
      );
    });
    await new Promise<void>((resolve) => {
      stub.listen(0, '127.0.0.1', resolve);
    });
    const address = stub.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    const broken = await startServer({ env: { KLUI_PUBLIC_URL: `http://127.0.0.1:${port}` } });
    try {
      const owner = broken.client();
      await owner.signup(`probe-broken-${owner.suffix}`);
      const created = await owner.request('POST', '/api/v1/boards', { name: 'Unreachable' });
      const board = created.json() as Board;
      const key = await mint(owner, { name: 'probe', scope: 'board', board_id: board.id });

      const tested = await owner.request('POST', `/api/v1/agent-keys/${key.id}/test`, {
        key: key.key,
      });
      expect(tested.statusCode).toBe(200);
      const body = tested.json() as { ok: boolean; reason: string; via: string };
      expect(body.ok).toBe(false);
      expect(body.reason).toBe('mcp_error');
      expect(body.via).toBe('mcp');
    } finally {
      await broken.close();
      stub.close();
    }
  });

  it('asks for the key when the endpoint needs one', async () => {
    const { owner, key } = await ownerWithKey(`probe-nokey-${live.client().suffix}`);
    const tested = await owner.request('POST', `/api/v1/agent-keys/${key.id}/test`, {});
    expect(tested.statusCode).toBe(200);
    const body = tested.json() as { ok: boolean; reason: string; via: string | null };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('key_required');
    expect(body.via).toBeNull();
  });

  it('falls back in process, and says so, when there is no public URL', async () => {
    const offline = await startServer({ env: { KLUI_PUBLIC_URL: null } });
    try {
      const owner = offline.client();
      await owner.signup(`probe-offline-${owner.suffix}`);
      const created = await owner.request('POST', '/api/v1/boards', { name: 'No public URL' });
      const board = created.json() as Board;
      const key = await mint(owner, { name: 'probe', scope: 'board', board_id: board.id });

      const tested = await owner.request('POST', `/api/v1/agent-keys/${key.id}/test`, {});
      expect(tested.statusCode).toBe(200);
      const body = tested.json() as {
        ok: boolean;
        via: string;
        board: { id: string };
        role: string;
      };
      expect(body.ok).toBe(true);
      expect(body.via).toBe('inline');
      expect(body.board.id).toBe(board.id);
      expect(body.role).toBe('owner');
    } finally {
      await offline.close();
    }
  });
});

describe('the raw key never reaches a log', () => {
  it('keeps it out of every line, including the request log of a call made with it', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString('utf8'));
        callback();
      },
    });
    const db = testDb();
    const env = testEnv({
      DATABASE_URL: testDatabaseUrl(),
      KLUI_PUBLIC_URL: 'http://localhost:8099',
      KLUI_LOG_LEVEL: 'info',
    });
    await ensureInstanceSettings(db, env);
    const listener: NonNullable<FastifyServerOptions['logger']> = { level: 'info', stream };
    const app = buildApp({
      env,
      db,
      secrets: TEST_SECRETS,
      hub: createHub(),
      logger: listener,
    });
    await app.ready();
    try {
      // The fixture client absorbs the session and the double-submit cookie
      // exactly as a browser would; a hand-rolled parse of `set-cookie` is how
      // this test would fail for the wrong reason.
      const client = new TestClient(app, db);
      await client.signup(`log-key-${Date.now().toString(36)}`);
      const created = await client.request('POST', '/api/v1/agent-keys', {
        name: 'logged',
        scope: 'user',
      });
      expect(created.statusCode).toBe(201);
      const raw = (created.json() as Created).key;

      const used = await app.inject({
        method: 'GET',
        url: '/api/v1/boards',
        headers: { authorization: `Bearer ${raw}` },
      });
      expect(used.statusCode).toBe(200);

      const joined = lines.join('\n');
      expect(joined.length).toBeGreaterThan(0);
      expect(joined).not.toContain(raw);
      expect(joined).not.toContain(raw.slice(3));
    } finally {
      await app.close();
      await db.$disconnect();
    }
  });
});
