// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-11 — export and import, proven against a real database.
 *
 * The exit criterion that drives the whole file: export a populated board,
 * import the file into an empty board, export again, and the two files are
 * byte-identical once `exported_at` is dropped. Everything else here exists to
 * make sure that sentence cannot be true while a token leaks, a comment loses
 * its author type, or the second import duplicates the board.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer();
});

afterAll(async () => {
  await harness.close();
});

type Board = { id: string; name: string };
type Column = { id: string; name: string };
type Card = { id: string; title: string; position: string };

async function owner(c: TestClient): Promise<void> {
  await c.signup(`io-${c.suffix}`);
}

async function newBoard(
  c: TestClient,
  name = 'Retro S2',
  template?: 'blank' | 'classic',
): Promise<{ board: Board; columns: Column[] }> {
  const created = await c.request('POST', '/api/v1/boards', {
    name,
    ...(template === undefined ? {} : { template }),
  });
  expect(created.statusCode).toBe(201);
  const board = created.json() as Board;
  const state = await c.request('GET', `/api/v1/boards/${board.id}/state`);
  return { board, columns: (state.json() as { columns: Column[] }).columns };
}

async function addCard(
  c: TestClient,
  boardId: string,
  body: Record<string, unknown>,
): Promise<Card> {
  const response = await c.request('POST', `/api/v1/boards/${boardId}/cards`, body);
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as Card;
}

/** A board with everything the format claims to carry. */
async function seededBoard(c: TestClient): Promise<{ board: Board; columns: Column[] }> {
  await owner(c);
  const { board, columns } = await newBoard(c);
  const [todo, doing, done] = columns;
  const first = await addCard(c, board.id, {
    column: todo?.id ?? '',
    title: 'Wire the digest',
    description: 'Mail on Monday.\n\nSecond paragraph.',
    assignee_label: 'Hermes',
    due_at: '2026-12-02T00:00:00.000Z',
    tags: [{ name: 'api', color: '#8B5CF6' }, { name: 'web' }],
  });
  const second = await addCard(c, board.id, {
    column: todo?.id ?? '',
    title: 'Second in todo',
    done: true,
  });
  await addCard(c, board.id, { column: doing?.id ?? '', title: 'In progress' });
  await addCard(c, board.id, { column: done?.id ?? '', title: 'Fix the drop index' });
  // Moving the first card to the head puts it on a half-step rank (512) without
  // changing the visible order: the exporter must carry that rank and the
  // importer must keep it, or "byte-identical" only holds for appended boards.
  const moved = await c.request('POST', `/api/v1/cards/${first.id}/move`, {
    column: todo?.id ?? '',
    before: null,
    after: second.id,
  });
  expect(moved.statusCode, moved.body).toBe(200);

  await harness.db.comment.create({
    data: {
      id: `cmt_${c.suffix}aaaaaaaaaaaaaaaa`,
      board_id: board.id,
      card_id: first.id,
      author_id: null,
      author_type: 'agent',
      author_label: 'Hermes',
      body: 'Created from the MCP surface.',
      created_at: new Date('2026-11-02T08:00:00.000Z'),
    },
  });
  return { board, columns };
}

async function exportJson(c: TestClient, boardId: string): Promise<string> {
  const response = await c.request('GET', `/api/v1/boards/${boardId}/export.json`);
  expect(response.statusCode, response.body).toBe(200);
  return response.body;
}

function stripTimestamp(text: string): string {
  return text.replace(/"exported_at": "[^"]+"/, '"exported_at": "(normalised)"');
}

describe('klui.export/v2', () => {
  it('is byte-identical between two exports except for exported_at', async () => {
    const c = harness.client();
    const { board } = await seededBoard(c);
    const first = await exportJson(c, board.id);
    const second = await exportJson(c, board.id);
    expect(stripTimestamp(first)).toBe(stripTimestamp(second));
    expect(first.endsWith('\n')).toBe(true);
  });

  it('orders columns and cards deterministically and carries every field', async () => {
    const c = harness.client();
    const { board, columns } = await seededBoard(c);
    const file = JSON.parse(await exportJson(c, board.id)) as {
      schema: string;
      board: { name: string; visibility: string; link_role: string; anon_write: string };
      columns: { name: string; position: number }[];
      cards: {
        title: string;
        column_id: string;
        assignee: string | null;
        tags: { name: string; color: string | null }[];
        due_at: string | null;
        done: boolean;
        position: number;
      }[];
      comments: { author_type: string; author_label: string | null; body: string }[];
    };
    expect(file.schema).toBe('klui.export/v2');
    expect(file.board).toMatchObject({
      name: 'Retro S2',
      visibility: 'private',
      link_role: 'none',
      anon_write: 'off',
    });
    expect(file.columns.map((column) => column.name)).toEqual(['To do', 'Doing', 'Done']);
    expect(file.columns.map((column) => column.position)).toEqual([1024, 2048, 3072]);

    const todo = columns[0]?.id;
    const inTodo = file.cards.filter((card) => card.column_id === todo);
    expect(inTodo.map((card) => card.title)).toEqual(['Wire the digest', 'Second in todo']);
    const first = inTodo[0];
    expect(first?.assignee).toBe('Hermes');
    expect(first?.tags).toEqual([
      { name: 'api', color: '#8B5CF6' },
      { name: 'web', color: null },
    ]);
    expect(first?.due_at?.slice(0, 10)).toBe('2026-12-02');
    expect(inTodo[1]?.done).toBe(true);
    expect(file.comments).toHaveLength(1);
    expect(file.comments[0]).toMatchObject({
      author_type: 'agent',
      author_label: 'Hermes',
      body: 'Created from the MCP surface.',
    });
  });

  it('never carries a credential', async () => {
    const c = harness.client();
    const { board } = await seededBoard(c);
    const file = await exportJson(c, board.id);
    for (const forbidden of ['share_url', 'link_suffix', 'kb_', 'klui_session', 'token']) {
      expect(file.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('is a download, and a stranger cannot have one', async () => {
    const c = harness.client();
    const { board } = await seededBoard(c);
    const response = await c.request('GET', `/api/v1/boards/${board.id}/export.json`);
    expect(response.headers['content-disposition']).toContain(
      'attachment; filename="retro-s2-klui.json"',
    );

    const stranger = harness.client();
    await stranger.signup(`outsider-${stranger.suffix}`);
    const denied = await stranger.request('GET', `/api/v1/boards/${board.id}/export.json`);
    const missing = await stranger.request(
      'GET',
      '/api/v1/boards/brd_0000000000000000000001/export.json',
    );
    expect(denied.statusCode).toBe(404);
    expect(denied.body).toBe(missing.body);
  });
});

describe('the markdown export', () => {
  it('renders the done box, the tags, the assignee and the comment', async () => {
    const c = harness.client();
    const { board } = await seededBoard(c);
    const response = await c.request('GET', `/api/v1/boards/${board.id}/export.md`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/markdown');
    const text = response.body;
    expect(text.startsWith('# Retro S2\n')).toBe(true);
    expect(text).toContain('## To do');
    expect(text).toContain('- [ ] **api** **web** Wire the digest — @Hermes — due 2026-12-02');
    expect(text).toContain('- [x] Second in todo');
    expect(text).toContain('  Mail on Monday.');
    expect(text).toContain('  > [Hermes/agent, 2026-11-02] Created from the MCP surface.');
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('import', () => {
  it('reproduces the export exactly in an empty instance', async () => {
    const c = harness.client();
    const { board } = await seededBoard(c);
    const original = await exportJson(c, board.id);

    // "Into an empty database" means the source rows are gone, which is what
    // frees their ids for the import to reuse. The delete is the test's way of
    // being a second instance without a second Postgres.
    const removed = await c.request('DELETE', `/api/v1/boards/${board.id}`, { confirm: true });
    expect(removed.statusCode).toBe(204);

    const { board: target } = await newBoard(c, 'Retro S2', 'blank');
    const imported = await c.request('POST', `/api/v1/boards/${target.id}/import`, {
      format: 'v2',
      data: JSON.parse(original),
    });
    expect(imported.statusCode, imported.body).toBe(202);
    const body = imported.json() as { job_id: string; status: string; result: { cards: number } };
    expect(body.job_id).toMatch(/^job_/);
    expect(body.status).toBe('done');
    expect(body.result.cards).toBe(4);

    const second = await exportJson(c, target.id);
    expect(stripTimestamp(second)).toBe(stripTimestamp(original));
  });

  it('is idempotent on the same content, and does not duplicate a card', async () => {
    const c = harness.client();
    const { board } = await seededBoard(c);
    const file = JSON.parse(await exportJson(c, board.id)) as unknown;

    const { board: target } = await newBoard(c, 'Imported twice');
    const first = await c.request('POST', `/api/v1/boards/${target.id}/import`, {
      format: 'v2',
      data: file,
    });
    expect(first.statusCode).toBe(202);
    const firstBody = first.json() as { job_id: string; replayed: boolean };

    const second = await c.request('POST', `/api/v1/boards/${target.id}/import`, {
      format: 'v2',
      data: file,
    });
    expect(second.statusCode).toBe(202);
    const secondBody = second.json() as { job_id: string; replayed: boolean };
    expect(secondBody.job_id).toBe(firstBody.job_id);
    expect(secondBody.replayed).toBe(true);

    expect(await harness.db.card.count({ where: { board_id: target.id } })).toBe(4);
    expect(
      await harness.db.event.count({ where: { board_id: target.id, type: 'import_completed' } }),
    ).toBe(1);
  });

  it('appends after the cards a matched column already holds', async () => {
    const c = harness.client();
    const { board } = await seededBoard(c);
    const file = JSON.parse(await exportJson(c, board.id)) as unknown;

    const { board: target, columns } = await newBoard(c, 'Appended');
    await addCard(c, target.id, { column: columns[0]?.id ?? '', title: 'Already here' });
    const response = await c.request('POST', `/api/v1/boards/${target.id}/import`, {
      format: 'v2',
      data: file,
    });
    expect(response.statusCode).toBe(202);
    const state = await c.request('GET', `/api/v1/boards/${target.id}/state`);
    const cards = (state.json() as { cards: { title: string; column_id: string }[] }).cards;
    const inFirst = cards.filter((card) => card.column_id === columns[0]?.id);
    expect(inFirst.map((card) => card.title)).toEqual([
      'Already here',
      'Wire the digest',
      'Second in todo',
    ]);
  });

  it('is all or nothing: a bad second card writes nothing', async () => {
    const c = harness.client();
    await owner(c);
    const { board } = await newBoard(c, 'Rejected');
    const response = await c.request('POST', `/api/v1/boards/${board.id}/import`, {
      format: 'v2',
      data: {
        schema: 'klui.export/v2',
        columns: [{ id: 'col_a', name: 'Only', position: 1024 }],
        cards: [
          { id: 'crd_a', column_id: 'col_a', title: 'Fine' },
          { id: 'crd_b', column_id: 'col_missing', title: 'Broken' },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details: { code: string }[] } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details[0]?.code).toBe('missing_column');
    expect(await harness.db.card.count({ where: { board_id: board.id } })).toBe(0);
  });

  it('rejects a duplicate card id, an invalid date and the wrong schema', async () => {
    const c = harness.client();
    await owner(c);
    const { board } = await newBoard(c, 'Edge cases');
    const base = {
      schema: 'klui.export/v2',
      columns: [{ id: 'col_a', name: 'Only', position: 1024 }],
    };

    const duplicate = await c.request('POST', `/api/v1/boards/${board.id}/import`, {
      format: 'v2',
      data: {
        ...base,
        cards: [
          { id: 'crd_a', column_id: 'col_a', title: 'One' },
          { id: 'crd_a', column_id: 'col_a', title: 'Two' },
        ],
      },
    });
    expect(duplicate.statusCode).toBe(400);
    expect(
      (duplicate.json() as { error: { details: { code: string }[] } }).error.details[0]?.code,
    ).toBe('duplicate_id');

    const badDate = await c.request('POST', `/api/v1/boards/${board.id}/import`, {
      format: 'v2',
      data: {
        ...base,
        cards: [{ id: 'crd_a', column_id: 'col_a', title: 'One', due_at: 'not-a-date' }],
      },
    });
    expect(badDate.statusCode).toBe(400);
    expect(
      (badDate.json() as { error: { details: { code: string }[] } }).error.details[0]?.code,
    ).toBe('invalid_date');

    const wrong = await c.request('POST', `/api/v1/boards/${board.id}/import`, {
      format: 'trello',
      data: { hello: 'world' },
    });
    expect(wrong.statusCode).toBe(400);
    expect((wrong.json() as { error: { code: string } }).error.code).toBe('unsupported_schema');
    expect(await harness.db.card.count({ where: { board_id: board.id } })).toBe(0);
  });

  it('refuses more than 5 000 cards with 413 and writes nothing', async () => {
    const c = harness.client();
    await owner(c);
    const { board } = await newBoard(c, 'Too big');
    const cards = Array.from({ length: 5_001 }, (_unused, index) => ({
      id: `crd_${String(index)}`,
      column_id: 'col_a',
      title: `Card ${String(index)}`,
    }));
    const response = await c.request('POST', `/api/v1/boards/${board.id}/import`, {
      format: 'v2',
      data: {
        schema: 'klui.export/v2',
        columns: [{ id: 'col_a', name: 'Only', position: 1024 }],
        cards,
      },
    });
    expect(response.statusCode).toBe(413);
    expect(await harness.db.card.count({ where: { board_id: board.id } })).toBe(0);
  });
});

/**
 * Shaped from the mapping table in docs/features/import-export.md §2.1, not from
 * a real file: O-01 has no sample. The importer is marked "shaped from the
 * appendix" in docs/verify/k2.md rather than claimed verified.
 */
const V1_FIXTURE = {
  name: 'Klui v1 board',
  level: 'creator',
  archived: false,
  archive_after_days: null,
  share_url: 'https://v1.example/board/secret-token',
  share_mode: 'link',
  member_names: ['Will', 'Hermes'],
  tag_colors: { api: '#8B5CF6' },
  columns: [
    { name: 'Backlog', position: 1 },
    { name: 'Shipped', position: 2 },
  ],
  cards: [
    {
      id: 'v1-card-1',
      column: 'Backlog',
      title: 'Port the importer',
      description: 'Appendix A shape.',
      assignee: 'Hermes',
      assignee_id: 'user-42',
      tags: ['api', 'Web UI'],
      due_at: '2026-12-01T00:00:00.000Z',
      done: false,
      position: 1,
    },
    { id: 'v1-card-2', column: 'Shipped', title: 'Old work', done: true, position: 1 },
  ],
  comments: [
    {
      id: 'v1-comment-1',
      card_id: 'v1-card-1',
      body: 'Carried over.',
      author_type: 'agent',
      author_label: 'Hermes',
      created_at: '2026-11-01T09:00:00.000Z',
    },
  ],
};

describe('klui.export/v1', () => {
  it('imports the same content twice into two boards, dropping the archive fields', async () => {
    const c = harness.client();
    await owner(c);
    const first = await newBoard(c, 'v1 one');
    const second = await newBoard(c, 'v1 two');

    for (const target of [first, second]) {
      const response = await c.request('POST', `/api/v1/boards/${target.board.id}/import`, {
        format: 'v1',
        data: V1_FIXTURE,
      });
      expect(response.statusCode, response.body).toBe(202);
      const result = (
        response.json() as {
          result: {
            cards: number;
            comments: number;
            dropped: Record<string, number>;
            warnings: string[];
          };
        }
      ).result;
      expect(result.cards).toBe(2);
      expect(result.comments).toBe(1);
      expect(result.dropped.archived).toBe(1);
      expect(result.dropped.share_url).toBe(1);
      expect(result.warnings.join(' ')).toContain('no archive');
    }

    const state = await c.request('GET', `/api/v1/boards/${first.board.id}/state`);
    const cards = (
      state.json() as {
        cards: {
          title: string;
          assignee_label: string | null;
          done: boolean;
          tags: { name: string; color: string | null }[];
        }[];
      }
    ).cards;
    expect(cards.map((card) => card.title).sort()).toEqual(['Old work', 'Port the importer']);
    const ported = cards.find((card) => card.title === 'Port the importer');
    expect(ported?.assignee_label).toBe('Hermes');
    expect(ported?.tags).toEqual([
      { name: 'api', color: '#8B5CF6' },
      { name: 'web-ui', color: null },
    ]);

    const comment = await harness.db.comment.findFirst({
      where: { board_id: first.board.id },
    });
    expect(comment?.author_type).toBe('agent');
    expect(comment?.author_label).toBe('Hermes');
    expect(comment?.author_id).toBeNull();

    // A v1 card is never bound to a local account.
    const bound = await harness.db.card.findFirst({
      where: { board_id: first.board.id, assignee_id: { not: null } },
    });
    expect(bound).toBeNull();
  });
});

const TRELLO_FIXTURE = {
  name: 'Trello board',
  lists: [
    { id: 'list-a', name: 'Todo', pos: 1, closed: false },
    { id: 'list-b', name: 'Done', pos: 2, closed: false },
    { id: 'list-c', name: 'Old', pos: 3, closed: true },
  ],
  members: [{ id: 'member-a', fullName: 'Hermes' }],
  cards: [
    {
      id: 'trello-card-1',
      idList: 'list-a',
      name: 'Ship it',
      desc: 'With notes',
      due: '2026-12-03T00:00:00.000Z',
      pos: 1,
      closed: false,
      idMembers: ['member-a'],
      labels: [
        { name: 'api', color: 'purple' },
        { name: '', color: 'green' },
      ],
      checklists: [{}],
    },
    {
      id: 'trello-card-2',
      idList: 'list-a',
      name: 'Archived away',
      pos: 2,
      closed: true,
    },
  ],
};

describe('Trello JSON', () => {
  it('maps lists and cards, skips archived ones and never invents done', async () => {
    const c = harness.client();
    await owner(c);
    const created = await c.request('POST', '/api/v1/boards', {
      name: 'From Trello',
      template: 'blank',
    });
    expect(created.statusCode).toBe(201);
    const board = created.json() as Board;
    const response = await c.request('POST', `/api/v1/boards/${board.id}/import`, {
      format: 'trello',
      data: TRELLO_FIXTURE,
    });
    expect(response.statusCode, response.body).toBe(202);
    const result = (
      response.json() as { result: { cards: number; dropped: Record<string, number> } }
    ).result;
    expect(result.cards).toBe(1);
    expect(result.dropped.cards_closed).toBe(1);
    expect(result.dropped.lists_closed).toBe(1);
    expect(result.dropped.checklists).toBe(1);
    // Trello's colour names cannot become hexes without a palette on the
    // server, so they are counted as dropped instead of invented.
    expect(result.dropped.labels_colour_dropped).toBe(2);

    const state = await c.request('GET', `/api/v1/boards/${board.id}/state`);
    const body = state.json() as {
      columns: { name: string }[];
      cards: {
        title: string;
        done: boolean;
        assignee_label: string | null;
        tags: { name: string; color: string | null }[];
      }[];
    };
    expect(body.columns.map((column) => column.name)).toEqual(['Todo', 'Done']);
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]?.done).toBe(false);
    expect(body.cards[0]?.assignee_label).toBe('Hermes');
    expect(body.cards[0]?.tags).toEqual([
      { name: 'api', color: null },
      { name: 'label-green', color: null },
    ]);
  });
});

describe('import access', () => {
  it('answers 404 to a stranger, like every unreadable board', async () => {
    const c = harness.client();
    await owner(c);
    const { board } = await newBoard(c, 'Private import');
    const stranger = harness.client();
    await stranger.signup(`no-${stranger.suffix}`);
    const response = await stranger.request('POST', `/api/v1/boards/${board.id}/import`, {
      format: 'v2',
      data: { schema: 'klui.export/v2', columns: [], cards: [] },
    });
    expect(response.statusCode).toBe(404);
  });

  it('accepts a multipart upload and reads the format from the file', async () => {
    const c = harness.client();
    await owner(c);
    const { board } = await newBoard(c, 'Uploaded');
    const boundary = 'klui-test-boundary';
    const payload = JSON.stringify({
      schema: 'klui.export/v2',
      columns: [{ id: 'col_a', name: 'Only', position: 1024 }],
      cards: [{ id: 'crd_a', column_id: 'col_a', title: 'From a file' }],
    });
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="board.json"',
      'Content-Type: application/json',
      '',
      payload,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    // The helper only serialises JSON bodies, so the raw payload goes through
    // `inject` with the same cookies and CSRF header.
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/boards/${board.id}/import`,
      headers: {
        ...c.headers({ 'content-type': `multipart/form-data; boundary=${boundary}` }),
        'content-length': String(Buffer.byteLength(body)),
      },
      payload: body,
    });
    expect(response.statusCode, response.body).toBe(202);
    const card = await harness.db.card.findFirst({ where: { board_id: board.id } });
    expect(card?.title).toBe('From a file');
  });
});

describe('the import and export buckets', () => {
  let limited: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    limited = await startServer({ env: { KLUI_RATE_LIMIT: 'on' } });
  });

  afterAll(async () => {
    await limited.close();
  });

  it('answers 429 on the fourth import of one board within the hour', async () => {
    const c = limited.client();
    await c.signup(`bucket-io-${c.suffix}`);
    const { board } = await newBoard(c, 'Bucketed');
    const statuses: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      const response = await c.request('POST', `/api/v1/boards/${board.id}/import`, {
        format: 'v2',
        data: {
          schema: 'klui.export/v2',
          columns: [{ id: 'col_a', name: 'Only', position: 1024 }],
          cards: [
            { id: `crd_${String(index)}`, column_id: 'col_a', title: `Run ${String(index)}` },
          ],
        },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, 3)).toEqual([202, 202, 202]);
    expect(statuses[3]).toBe(429);
  });

  it('answers 429 on the eleventh export of one board within the hour', async () => {
    const c = limited.client();
    await c.signup(`bucket-ex-${c.suffix}`);
    const { board } = await newBoard(c, 'Bucketed export');
    for (let index = 0; index < 10; index += 1) {
      const response = await c.request('GET', `/api/v1/boards/${board.id}/export.json`);
      expect(response.statusCode, `export ${String(index)}`).toBe(200);
    }
    const blocked = await c.request('GET', `/api/v1/boards/${board.id}/export.json`);
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe('rate_limited');
  });
});
