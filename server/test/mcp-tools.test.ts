// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K4-03, K4-04, K4-05 — one transport-level test per tool.
 *
 * Each test initialises, calls `tools/call` with the **real argument names of
 * docs/mcp.md §3**, and asserts the effect through a second read. A tool that
 * answers `{"ok":true}` and writes nothing fails here, which is the whole point:
 * the surface is not the schema, it is what the board looks like afterwards.
 */
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyServerOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { testEnv } from '../src/env.js';
import { createHub } from '../src/realtime/events.js';
import { ensureInstanceSettings } from '../src/auth/service.js';
import { testDatabaseUrl, testDb } from './helpers/db.js';
import { startServer, TEST_SECRETS, TestClient } from './helpers/server.js';

type Rpc = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: {
    content: { type: string; text: string }[];
    structuredContent: Record<string, unknown>;
    isError: boolean;
  };
  error?: { code: number; message: string; data?: Record<string, unknown> };
};

let harness: Awaited<ReturnType<typeof startServer>>;
let owner: TestClient;
let key = '';
let boardId = '';
let columns: { id: string; name: string }[] = [];

beforeAll(async () => {
  // The agent buckets are always on (K4-02). This file is about what the tools
  // do; the limiter gets its own test below with its own small numbers.
  harness = await startServer({ env: { KLUI_AGENT_WRITES: 10_000, KLUI_AGENT_READS: 10_000 } });
  owner = harness.client();
  await owner.signup(`mcp-tools-${owner.suffix}`);
  const created = await owner.request('POST', '/api/v1/agent-keys', {
    name: 'tools',
    scope: 'user',
  });
  expect(created.statusCode).toBe(201);
  key = (created.json() as { key: string }).key;
  const board = await owner.request('POST', '/api/v1/boards', { name: 'Tools board' });
  boardId = (board.json() as { id: string }).id;
  const state = await owner.request('GET', `/api/v1/boards/${boardId}/state`);
  columns = (state.json() as { columns: { id: string; name: string }[] }).columns;
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

let counter = 100;
async function call(
  name: string,
  args: Record<string, unknown> = {},
  bearer = key,
): Promise<Record<string, unknown>> {
  counter += 1;
  const response = await rpc(
    {
      jsonrpc: '2.0',
      id: counter,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    bearer,
  );
  if (response.body.error) {
    throw new Error(`${name} answered ${JSON.stringify(response.body.error)}`);
  }
  return response.body.result?.structuredContent as Record<string, unknown>;
}

/** The error a tool answers, for the cases where failing is the contract. */
async function failure(
  name: string,
  args: Record<string, unknown> = {},
  bearer = key,
): Promise<{ code: number; message: string; data: Record<string, unknown> }> {
  counter += 1;
  const response = await rpc(
    {
      jsonrpc: '2.0',
      id: counter,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    bearer,
  );
  if (!response.body.error) throw new Error(`${name} was expected to fail and did not`);
  return {
    code: response.body.error.code,
    message: response.body.error.message,
    data: response.body.error.data ?? {},
  };
}

function columnNamed(name: string): string {
  const match = columns.find((column) => column.name === name);
  if (!match) throw new Error(`no column ${name}`);
  return match.id;
}

describe('board tools (K4-03)', () => {
  it('creates a board and lists it, with the classic columns already there', async () => {
    const created = await call('create_board', { name: 'Retro S3', visibility: 'private' });
    expect(created.name).toBe('Retro S3');
    expect(created.visibility).toBe('private');

    const listed = await call('list_boards');
    const items = listed.items as { id: string; name: string }[];
    expect(items.map((board) => board.name)).toContain('Retro S3');

    const state = await call('get_board', { board: created.id });
    expect((state.columns as { name: string }[]).map((column) => column.name)).toEqual([
      'To do',
      'Doing',
      'Done',
    ]);
  });

  it('renames a board and reads the new name back', async () => {
    const board = await call('create_board', { name: 'Rename me' });
    await call('update_board', { board: board.id, name: 'Renamed', visibility: 'link' });
    const state = await call('get_board', { board: board.id });
    const after = state.board as { name: string; visibility: string; link_role: string };
    expect(after.name).toBe('Renamed');
    expect(after.visibility).toBe('link');
    // A link board gets a suffix in the same transaction.
    expect(after.link_role).toBeDefined();
  });

  it('deletes a board, and the next read is a -32001 board_not_found', async () => {
    const board = await call('create_board', { name: 'Delete me' });
    const deleted = await call('delete_board', { board: board.id as string, confirm: true });
    expect(deleted.deleted).toBe(true);
    const error = await failure('get_board', { board: board.id });
    expect(error.code).toBe(-32001);
    expect(error.data.code).toBe('board_not_found');
  });

  it('refuses a delete without confirm:true, as -32602 naming confirm', async () => {
    const board = await call('create_board', { name: 'Not confirmed' });
    const error = await failure('delete_board', { board: board.id });
    expect(error.code).toBe(-32602);
    expect(error.data.parameter).toBe('confirm');
    const example = error.data.example as Record<string, unknown>;
    expect(example.confirm).toBe(true);
  });
});

describe('column tools (K4-04)', () => {
  it('creates a column, reorders it between two neighbours and deletes it', async () => {
    const board = await call('create_board', { name: 'Columns' });
    const fresh = await call('get_board', { board: board.id });
    const doing = (fresh.columns as { id: string; name: string }[]).find(
      (column) => column.name === 'Doing',
    );
    if (!doing) throw new Error('no Doing column');
    const made = await call('create_column', {
      board: board.id,
      name: 'Review',
      position: { after: doing.id },
    });
    expect(made.name).toBe('Review');

    let state = await call('get_board', { board: board.id });
    let names = (state.columns as { name: string }[]).map((column) => column.name);
    expect(names.indexOf('Review')).toBe(names.indexOf('Doing') - 1);

    await call('update_column', { board: board.id, column: made.id, name: 'Reviewing' });
    state = await call('get_board', { board: board.id });
    names = (state.columns as { name: string }[]).map((column) => column.name);
    expect(names).toContain('Reviewing');

    await call('delete_column', { board: board.id, column: made.id });
    state = await call('get_board', { board: board.id });
    names = (state.columns as { name: string }[]).map((column) => column.name);
    expect(names).not.toContain('Reviewing');
  });

  it('refuses to delete a column that still holds cards, as -32003 column_not_empty', async () => {
    const board = await call('create_board', { name: 'Not empty' });
    const state = await call('get_board', { board: board.id });
    const [first] = state.columns as { id: string }[];
    if (!first) throw new Error('no column');
    await call('create_card', { board: board.id, column: first.id, title: 'In the way' });

    const error = await failure('delete_column', { board: board.id, column: first.id });
    expect(error.code).toBe(-32003);
    expect(error.data.code).toBe('column_not_empty');
  });
});

describe('card tools (K4-04)', () => {
  it('creates a card and reads it back with its tags, assignee and due date', async () => {
    const board = await call('create_board', { name: 'Cards' });
    const state = await call('get_board', { board: board.id });
    const [first] = state.columns as { id: string }[];
    if (!first) throw new Error('no column');

    const created = await call('create_card', {
      board: board.id,
      column: first.id,
      title: 'Wire the digest',
      description: 'Daily, 08:00',
      assignee: owner.suffix === '' ? 'nobody' : await username(),
      tags: ['api', { name: 'web', color: '#8B5CF6' }],
      due_at: '2026-12-02T09:00:00.000Z',
    });
    expect(created.title).toBe('Wire the digest');

    const read = await call('get_card', { board: board.id, card: created.id });
    expect(read.title).toBe('Wire the digest');
    expect(read.description).toBe('Daily, 08:00');
    expect(read.due_at).toBe('2026-12-02T09:00:00.000Z');
    expect((read.tags as { name: string; color: string | null }[]).map((tag) => tag.name)).toEqual([
      'api',
      'web',
    ]);
    expect((read.assignee as { username: string } | null)?.username).toBe(await username());
    expect(read.comments_count).toBe(0);
  });

  it('bulk-creates cards in one write and counts them', async () => {
    const board = await call('create_board', { name: 'Bulk' });
    const state = await call('get_board', { board: board.id });
    const [first] = state.columns as { id: string }[];
    if (!first) throw new Error('no column');

    const result = await call('bulk_create_cards', {
      board: board.id,
      column: first.id,
      items: [{ title: 'One' }, { title: 'Two' }, { title: 'Three', done: true }],
    });
    expect((result.created as unknown[]).length).toBe(3);

    const after = await call('get_board', { board: board.id });
    const titles = (after.cards as { title: string }[]).map((card) => card.title);
    expect(titles.sort()).toEqual(['One', 'Three', 'Two']);
  });

  it('updates a card, and a stale expected_updated_at answers -32003 with the current row', async () => {
    const board = await call('create_board', { name: 'Updates' });
    const state = await call('get_board', { board: board.id });
    const [first] = state.columns as { id: string }[];
    if (!first) throw new Error('no column');
    const card = await call('create_card', {
      board: board.id,
      column: first.id,
      title: 'Before',
    });

    await call('update_card', { board: board.id, card: card.id, title: 'After' });
    const read = await call('get_card', { board: board.id, card: card.id });
    expect(read.title).toBe('After');

    const stale = await call('get_card', { board: board.id, card: card.id });
    const error = await failure('update_card', {
      board: board.id,
      card: card.id,
      title: 'Sneaky',
      expected_updated_at: '2020-01-01T00:00:00.000Z',
    });
    expect(error.code).toBe(-32003);
    expect(error.data.code).toBe('conflict');
    // The 409 carries the current row, so a client can merge instead of retrying blind.
    expect((error.data.current as { title: string }).title).toBe(stale.title);
  });

  it('moves a card with neighbours, and the read shows the new column', async () => {
    const board = await call('create_board', { name: 'Moves' });
    const state = await call('get_board', { board: board.id });
    const [toDo, doing] = state.columns as { id: string }[];
    if (!toDo || !doing) throw new Error('no columns');
    const first = await call('create_card', { board: board.id, column: toDo.id, title: 'One' });
    const second = await call('create_card', { board: board.id, column: toDo.id, title: 'Two' });

    const moved = await call('move_card', {
      board: board.id,
      card: second.id,
      column: doing.id,
      before: null,
      after: null,
    });
    expect(moved.column_id).toBe(doing.id);

    const read = await call('get_card', { board: board.id, card: second.id });
    expect(read.column_id).toBe(doing.id);
    const stillThere = await call('get_card', { board: board.id, card: first.id });
    expect(stillThere.column_id).toBe(toDo.id);
  });

  it('refuses an index in move_card with -32602 naming the accepted shape', async () => {
    const error = await failure('move_card', {
      board: boardId,
      card: 'crd_01JABCDEFGHJKLMNPQRSTU',
      column: columnNamed('Doing'),
      index: 2,
    });
    expect(error.code).toBe(-32602);
    expect(JSON.stringify(error.data.example)).toContain('before');
  });

  it('sets a card done and reopens it, writing the two events', async () => {
    const board = await call('create_board', { name: 'Done' });
    const state = await call('get_board', { board: board.id });
    const [first] = state.columns as { id: string }[];
    if (!first) throw new Error('no column');
    const card = await call('create_card', { board: board.id, column: first.id, title: 'Tick' });

    await call('set_card_done', { board: board.id, card: card.id, done: true });
    expect((await call('get_card', { board: board.id, card: card.id })).done).toBe(true);

    await call('set_card_done', { board: board.id, card: card.id, done: false });
    expect((await call('get_card', { board: board.id, card: card.id })).done).toBe(false);

    const activity = await call('get_activity', { board: board.id, limit: 50 });
    const types = (activity.items as { type: string }[]).map((event) => event.type);
    expect(types).toContain('card.completed');
    expect(types).toContain('card.reopened');
  });

  it('deletes a card, and the next read is card_not_found', async () => {
    const board = await call('create_board', { name: 'Deletes' });
    const state = await call('get_board', { board: board.id });
    const [first] = state.columns as { id: string }[];
    if (!first) throw new Error('no column');
    const card = await call('create_card', { board: board.id, column: first.id, title: 'Gone' });
    await call('delete_card', { board: board.id, card: card.id });

    const error = await failure('get_card', { board: board.id, card: card.id });
    expect(error.code).toBe(-32001);
    expect(error.data.code).toBe('card_not_found');
  });

  it('a {board, card} pair from two different boards is a 404, not a cross-board write', async () => {
    const boardA = await call('create_board', { name: 'Pair A' });
    const boardB = await call('create_board', { name: 'Pair B' });
    const stateB = await call('get_board', { board: boardB.id });
    const [columnB] = stateB.columns as { id: string }[];
    if (!columnB) throw new Error('no column');
    const card = await call('create_card', {
      board: boardB.id,
      column: columnB.id,
      title: 'Belongs to B',
    });

    const error = await failure('update_card', {
      board: boardA.id,
      card: card.id,
      title: 'Cross-board',
    });
    expect(error.code).toBe(-32001);
    expect(error.data.code).toBe('card_not_found');

    // And it really did not change.
    const read = await call('get_card', { board: boardB.id, card: card.id });
    expect(read.title).toBe('Belongs to B');
  });
});

describe('reading tools (K4-05)', () => {
  it('lists comments oldest first and adds one through the same write REST uses', async () => {
    const board = await call('create_board', { name: 'Comments' });
    const state = await call('get_board', { board: board.id });
    const [first] = state.columns as { id: string }[];
    if (!first) throw new Error('no column');
    const card = await call('create_card', { board: board.id, column: first.id, title: 'Talk' });

    expect((await call('list_comments', { board: board.id, card: card.id })).items).toEqual([]);

    const created = await call('create_comment', {
      board: board.id,
      card: card.id,
      body: 'Picked this up.',
    });
    expect(created.body).toBe('Picked this up.');
    expect((created.author as { type: string }).type).toBe('agent');

    const listed = await call('list_comments', { board: board.id, card: card.id });
    expect((listed.items as { body: string }[]).map((item) => item.body)).toEqual([
      'Picked this up.',
    ]);

    const activity = await call('get_activity', { board: board.id });
    const comments = (
      activity.items as { type: string; payload: { body_excerpt?: string } }[]
    ).filter((event) => event.type === 'comment.created');
    expect(comments[0]?.payload.body_excerpt).toBe('Picked this up.');
  });

  it('searches by text, assignee, tag and done, and says when it truncated', async () => {
    const board = await call('create_board', { name: 'Search' });
    const state = await call('get_board', { board: board.id });
    const [first] = state.columns as { id: string }[];
    if (!first) throw new Error('no column');
    await call('create_card', {
      board: board.id,
      column: first.id,
      title: 'Wire the digest',
      tags: ['api'],
    });
    const other = await call('create_card', {
      board: board.id,
      column: first.id,
      title: 'Colour the buttons',
      tags: ['web'],
    });
    await call('set_card_done', { board: board.id, card: other.id, done: true });

    const byText = await call('search_cards', { board: board.id, query: 'digest' });
    expect((byText.items as { title: string }[]).map((card) => card.title)).toEqual([
      'Wire the digest',
    ]);
    expect(byText.truncated).toBe(false);
    expect(byText.next_cursor).toBeNull();

    const byTag = await call('search_cards', { board: board.id, tags: ['web'] });
    expect((byTag.items as { title: string }[]).map((card) => card.title)).toEqual([
      'Colour the buttons',
    ]);

    const byDone = await call('search_cards', { board: board.id, done: false });
    expect((byDone.items as { title: string }[]).map((card) => card.title)).toEqual([
      'Wire the digest',
    ]);

    const byAssignee = await call('search_cards', { board: board.id, assignee: await username() });
    expect((byAssignee.items as unknown[]).length).toBe(0);
  });

  it('the REST twin of search_cards answers the same card', async () => {
    const board = await call('create_board', { name: 'Search route' });
    const state = await call('get_board', { board: board.id });
    const [first] = state.columns as { id: string }[];
    if (!first) throw new Error('no column');
    await call('create_card', { board: board.id, column: first.id, title: 'Through REST' });

    const response = await owner.request('GET', `/api/v1/boards/${board.id}/search?q=rest`);
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: { title: string }[]; truncated: boolean };
    expect(body.items.map((card) => card.title)).toEqual(['Through REST']);
    expect(body.truncated).toBe(false);
  });

  it('returns the activity newest first, filtered by since and capped by limit', async () => {
    const board = await call('create_board', { name: 'Activity' });
    const state = await call('get_board', { board: board.id });
    const [first] = state.columns as { id: string }[];
    if (!first) throw new Error('no column');
    const card = await call('create_card', {
      board: board.id,
      column: first.id,
      title: 'Logged',
    });

    const page = await call('get_activity', { board: board.id, limit: 1 });
    expect((page.items as unknown[]).length).toBe(1);
    expect(typeof page.next_cursor).toBe('string');

    const all = await call('get_activity', { board: board.id });
    const created = (all.items as { type: string; payload: { card_id?: string } }[]).find(
      (event) => event.type === 'card.created' && event.payload.card_id === card.id,
    );
    expect(created).toBeDefined();

    const future = await call('get_activity', {
      board: board.id,
      since: '2099-01-01T00:00:00.000Z',
    });
    expect(future.items).toEqual([]);
  });

  it('exports JSON byte-identical to GET /export.json, and Markdown identical too', async () => {
    const board = await call('create_board', { name: 'Export' });
    const state = await call('get_board', { board: board.id });
    const [first] = state.columns as { id: string }[];
    if (!first) throw new Error('no column');
    await call('create_card', {
      board: board.id,
      column: first.id,
      title: 'Exported',
      tags: ['api'],
    });

    const json = await call('export_board', { board: board.id, format: 'json' });
    const restJson = await owner.request('GET', `/api/v1/boards/${board.id}/export.json`);
    // `exported_at` is the time of the export and therefore the one field two
    // calls cannot share; every other byte comes from the same serialiser.
    const withoutClock = (value: string) =>
      value.replace(/"exported_at": "[^"]+"/u, '"exported_at": "<at>"');
    expect(withoutClock(String(json.content))).toBe(withoutClock(restJson.body));
    expect(JSON.parse(String(json.content)).schema).toBe('klui.export/v2');
    expect(json.bytes).toBe(Buffer.byteLength(String(json.content), 'utf8'));

    const md = await call('export_board', { board: board.id, format: 'md' });
    const restMd = await owner.request('GET', `/api/v1/boards/${board.id}/export.md`);
    expect(md.content).toBe(restMd.body);
    expect(String(md.content)).toContain('# Export');
  });

  it('a board-scoped key is 404 on another board, never 403', async () => {
    const mine = await call('create_board', { name: 'Scoped' });
    const other = await call('create_board', { name: 'Elsewhere' });
    const scoped = await owner.request('POST', '/api/v1/agent-keys', {
      name: 'board-only',
      scope: 'board',
      board_id: mine.id,
    });
    const scopedKey = (scoped.json() as { key: string }).key;

    const allowed = await call('get_board', { board: mine.id }, scopedKey);
    expect((allowed.board as { id: string }).id).toBe(mine.id);

    const error = await failure('get_board', { board: other.id }, scopedKey);
    expect(error.code).toBe(-32001);
    expect(error.data.code).toBe('board_not_found');

    const write = await failure(
      'create_card',
      { board: other.id, column: columnNamed('Doing'), title: 'Nope' },
      scopedKey,
    );
    expect(write.code).toBe(-32001);
  });
});

describe('the credential never reaches the log', () => {
  it('keeps the key out of every line, including a tools/call write', async () => {
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
    const app = buildApp({ env, db, secrets: TEST_SECRETS, hub: createHub(), logger: listener });
    await app.ready();
    try {
      const client = new TestClient(app, db);
      await client.signup(`mcp-log-${client.suffix}`);
      const created = await client.request('POST', '/api/v1/agent-keys', {
        name: 'logged',
        scope: 'user',
      });
      const raw = (created.json() as { key: string }).key;
      const board = await client.request('POST', '/api/v1/boards', { name: 'Logged board' });
      const boardId = (board.json() as { id: string }).id;
      const state = await client.request('GET', `/api/v1/boards/${boardId}/state`);
      const [first] = (state.json() as { columns: { id: string }[] }).columns;
      if (!first) throw new Error('no column');

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${raw}` },
        payload: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'create_card',
            arguments: { board: boardId, column: first.id, title: 'Written by an agent' },
          },
        }),
      });
      expect(response.statusCode).toBe(200);

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

async function username(): Promise<string> {
  const me = await call('whoami');
  return (me.user as { username: string }).username;
}

/**
 * docs/mcp.md §5: the agent bucket is exceeded with `-32004` and
 * `data.retry_after_s`, over HTTP 429 with `Retry-After`. The bucket is filled
 * by the onRequest hook, before the JSON-RPC handler runs, so this is also the
 * test that the endpoint never answers a protocol call with the REST envelope.
 */
describe('an exhausted agent bucket is still JSON-RPC', () => {
  it('answers -32004 with retry_after_s and a 429 + Retry-After', async () => {
    const tight = await startServer({ env: { KLUI_AGENT_WRITES: 2, KLUI_AGENT_READS: 2 } });
    try {
      const client = tight.client();
      await client.signup(`mcp-tight-${client.suffix}`);
      const created = await client.request('POST', '/api/v1/agent-keys', {
        name: 'tight',
        scope: 'user',
      });
      const tightKey = (created.json() as { key: string }).key;

      const send = () =>
        tight.app.inject({
          method: 'POST',
          url: '/mcp',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${tightKey}` },
          payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });

      expect((await send()).statusCode).toBe(200);
      expect((await send()).statusCode).toBe(200);
      const blocked = await send();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
      const body = blocked.json() as {
        jsonrpc?: string;
        error?: { code: number; data?: { code?: string; retry_after_s?: number } };
      };
      expect(body.jsonrpc).toBe('2.0');
      expect(body.error?.code).toBe(-32004);
      expect(body.error?.data?.code).toBe('rate_limited');
      expect(body.error?.data?.retry_after_s).toBeGreaterThan(0);
    } finally {
      await tight.close();
    }
  });
});
