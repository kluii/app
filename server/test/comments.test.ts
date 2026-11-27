// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-09 — comments and the activity feed, against a real database.
 *
 * The two exits the roadmap names are here: a viewer gets `403` on a write and
 * `200` on a read (the board is readable, so it is not a `404`), and 10 000
 * events page through the index instead of scanning the table — the second is
 * asserted with `EXPLAIN`, not with a stopwatch.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';
import { newId } from '../src/lib/ids.js';

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer();
});

afterAll(async () => {
  await harness.close();
});

type CommentDto = {
  id: string;
  card_id: string;
  body: string;
  author: { id: string | null; username: string | null; label: string | null; type: string };
  edited_at: string | null;
  created_at: string;
};

type Seeded = {
  boardId: string;
  columnId: string;
  cardId: string;
  userId: string;
  username: string;
};

async function seed(c: TestClient, prefix = 'cmt'): Promise<Seeded> {
  const username = `${prefix}-${c.suffix}`;
  const user = await c.signup(username);
  const created = await c.request('POST', '/api/v1/boards', { name: 'Threads' });
  expect(created.statusCode).toBe(201);
  const boardId = (created.json() as { id: string }).id;
  const state = await c.request('GET', `/api/v1/boards/${boardId}/state`);
  const columnId = (state.json() as { columns: { id: string }[] }).columns[0]?.id ?? '';
  const card = await c.request('POST', `/api/v1/boards/${boardId}/cards`, {
    column: columnId,
    title: 'Discuss me',
  });
  expect(card.statusCode).toBe(201);
  return {
    boardId,
    columnId,
    cardId: (card.json() as { id: string }).id,
    userId: user.id,
    username,
  };
}

async function addComment(c: TestClient, cardId: string, body: string): Promise<CommentDto> {
  const response = await c.request('POST', `/api/v1/cards/${cardId}/comments`, { body });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as CommentDto;
}

describe('comments', () => {
  it('creates one with the author on it and one comment.created event', async () => {
    const c = harness.client();
    const seeded = await seed(c);
    const comment = await addComment(c, seeded.cardId, 'First pass on the importer.');

    expect(comment.body).toBe('First pass on the importer.');
    expect(comment.author).toMatchObject({
      id: seeded.userId,
      username: seeded.username,
      type: 'user',
    });
    expect(comment.edited_at).toBeNull();

    const events = await harness.db.event.findMany({
      where: { board_id: seeded.boardId, type: 'comment_created' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      card_id: seeded.cardId,
      comment_id: comment.id,
      body_excerpt: 'First pass on the importer.',
    });
  });

  it('caps the excerpt at 120 characters and never stores the whole body in the event', async () => {
    const c = harness.client();
    const seeded = await seed(c);
    const body = 'x'.repeat(400);
    await addComment(c, seeded.cardId, body);
    const event = await harness.db.event.findFirst({
      where: { board_id: seeded.boardId, type: 'comment_created' },
    });
    const excerpt = (event?.payload as { body_excerpt: string }).body_excerpt;
    expect(excerpt.length).toBe(120);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('lets the author edit and marks it, and refuses another editor', async () => {
    const c = harness.client();
    const seeded = await seed(c);
    const comment = await addComment(c, seeded.cardId, 'Before the edit.');

    const edited = await c.request('PATCH', `/api/v1/comments/${comment.id}`, {
      body: 'After the edit.',
    });
    expect(edited.statusCode).toBe(200);
    const dto = edited.json() as CommentDto;
    expect(dto.body).toBe('After the edit.');
    expect(dto.edited_at).not.toBeNull();
    expect(
      await harness.db.event.count({
        where: { board_id: seeded.boardId, type: 'comment_updated' },
      }),
    ).toBe(1);

    // An editor who is not the author cannot rewrite someone else's words.
    const other = harness.client();
    const otherUser = await other.signup(`other-${other.suffix}`);
    await harness.db.boardMember.create({
      data: { id: newId('bmb'), board_id: seeded.boardId, user_id: otherUser.id, role: 'editor' },
    });
    const refused = await other.request('PATCH', `/api/v1/comments/${comment.id}`, {
      body: 'Not mine to edit.',
    });
    expect(refused.statusCode).toBe(403);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('forbidden');
    expect((await harness.db.comment.findUnique({ where: { id: comment.id } }))?.body).toBe(
      'After the edit.',
    );
  });

  it('gives a viewer 403 on a write and 200 on a read', async () => {
    const c = harness.client();
    const seeded = await seed(c);
    await addComment(c, seeded.cardId, 'Readable by a viewer.');

    const viewer = harness.client();
    const viewerUser = await viewer.signup(`viewer-${viewer.suffix}`);
    await harness.db.boardMember.create({
      data: { id: newId('bmb'), board_id: seeded.boardId, user_id: viewerUser.id, role: 'viewer' },
    });

    const list = await viewer.request('GET', `/api/v1/cards/${seeded.cardId}/comments`);
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: CommentDto[] }).items).toHaveLength(1);

    const write = await viewer.request('POST', `/api/v1/cards/${seeded.cardId}/comments`, {
      body: 'A viewer must not write this.',
    });
    expect(write.statusCode).toBe(403);
    expect(await harness.db.comment.count({ where: { card_id: seeded.cardId } })).toBe(1);
  });

  it('lets the owner moderate someone else’s comment away, and records it', async () => {
    const c = harness.client();
    const seeded = await seed(c);
    const comment = await addComment(c, seeded.cardId, 'To be moderated.');

    const removed = await c.request('DELETE', `/api/v1/comments/${comment.id}`);
    expect(removed.statusCode).toBe(204);
    expect(await harness.db.comment.findUnique({ where: { id: comment.id } })).toBeNull();
    const event = await harness.db.event.findFirst({
      where: { board_id: seeded.boardId, type: 'comment_deleted' },
    });
    expect(event?.payload).toMatchObject({
      comment_id: comment.id,
      body_excerpt: 'To be moderated.',
    });
  });

  it('answers 404 for a card a stranger cannot read, never 403', async () => {
    const c = harness.client();
    const seeded = await seed(c);
    const stranger = harness.client();
    await stranger.signup(`stranger-${stranger.suffix}`);

    const read = await stranger.request('GET', `/api/v1/cards/${seeded.cardId}/comments`);
    const write = await stranger.request('POST', `/api/v1/cards/${seeded.cardId}/comments`, {
      body: 'Not allowed.',
    });
    expect(read.statusCode).toBe(404);
    expect(write.statusCode).toBe(404);
    expect(read.body).toBe(write.body);
  });

  it('pages a thread with a cursor and never repeats a comment', async () => {
    const c = harness.client();
    const seeded = await seed(c);
    for (const body of ['one', 'two', 'three']) await addComment(c, seeded.cardId, body);

    const first = await c.request('GET', `/api/v1/cards/${seeded.cardId}/comments?limit=2`);
    const firstBody = first.json() as { items: CommentDto[]; next_cursor: string | null };
    expect(firstBody.items.map((item) => item.body)).toEqual(['one', 'two']);
    expect(firstBody.next_cursor).not.toBeNull();

    const second = await c.request(
      'GET',
      `/api/v1/cards/${seeded.cardId}/comments?limit=2&cursor=${String(firstBody.next_cursor)}`,
    );
    const secondBody = second.json() as { items: CommentDto[]; next_cursor: string | null };
    expect(secondBody.items.map((item) => item.body)).toEqual(['three']);
    expect(secondBody.next_cursor).toBeNull();
  });

  it('rejects an empty body and refuses a comment on a card that does not exist', async () => {
    const c = harness.client();
    const seeded = await seed(c);
    const empty = await c.request('POST', `/api/v1/cards/${seeded.cardId}/comments`, {
      body: '   ',
    });
    expect(empty.statusCode).toBe(400);
    const missing = await c.request('POST', '/api/v1/cards/crd_0000000000000000000001/comments', {
      body: 'Nowhere.',
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('the activity feed', () => {
  it('groups nothing, filters by actor kind, and pages a board of 10 000 events from the index', async () => {
    const c = harness.client();
    const seeded = await seed(c, 'feed');

    const rows = Array.from({ length: 10_000 }, (_unused, index) => ({
      id: newId('evt'),
      board_id: seeded.boardId,
      type: 'card_updated' as const,
      actor_kind: (index % 2 === 0 ? 'user' : 'agent') as 'user' | 'agent',
      actor_user_id: null,
      actor_label: null,
      actor_anon_id: null,
      payload: { board_id: seeded.boardId, card_id: seeded.cardId, changes: {} },
      created_at: new Date(Date.now() - index * 1000),
    }));
    await harness.db.event.createMany({ data: rows });

    const first = await c.request('GET', `/api/v1/boards/${seeded.boardId}/activity?limit=30`);
    expect(first.statusCode).toBe(200);
    const page = first.json() as { items: { id: string }[]; next_cursor: string | null };
    expect(page.items).toHaveLength(30);
    expect(page.next_cursor).not.toBeNull();

    const second = await c.request(
      'GET',
      `/api/v1/boards/${seeded.boardId}/activity?limit=30&cursor=${String(page.next_cursor)}`,
    );
    const nextPage = second.json() as { items: { id: string }[] };
    expect(nextPage.items).toHaveLength(30);
    const overlap = new Set(page.items.map((item) => item.id));
    expect(nextPage.items.some((item) => overlap.has(item.id))).toBe(false);

    const agents = await c.request(
      'GET',
      `/api/v1/boards/${seeded.boardId}/activity?limit=5&actor_kind=agent`,
    );
    const agentPage = agents.json() as { items: { actor_kind: string }[] };
    expect(agentPage.items.every((item) => item.actor_kind === 'agent')).toBe(true);

    // The plan, not the stopwatch: a sequential scan over `events` is the bug
    // this asserts against, and Postgres prints it the same way every time.
    const plan = await harness.db.$queryRaw<
      { 'QUERY PLAN': { Plan: { 'Node Type': string } }[] }[]
    >`
      EXPLAIN (FORMAT JSON)
      SELECT id FROM events
       WHERE board_id = ${seeded.boardId}
       ORDER BY created_at DESC, id DESC
       LIMIT 31`;
    const planText = JSON.stringify(plan);
    // "Index Scan" or "Index Only Scan": both read the index, neither reads the
    // table. Postgres picks the covering one when the select list allows it.
    expect(planText).toMatch(/Index (Only )?Scan/);
    expect(planText).not.toContain('Seq Scan');
  });
});
