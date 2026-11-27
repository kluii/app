// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-12 — close-out, against a real database and a real event log.
 *
 * The acceptance list of docs/features/close-out.md §6, one test per line:
 * closing twice, a write refused after close, Done + Remaining partitioning the
 * cards exactly, a byte-stable markdown, an anonymous actor named but never
 * promoted, and a stranger kept at `404`.
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

type Summary = {
  id: string;
  board: { name: string; owner: string };
  counts: { cards: number; done: number; columns: number; members: number; agents: number };
  done: { title: string; assignee: string | null; date: string | null }[];
  remaining: { column: string; cards: { title: string; assignee: string | null }[] }[];
  people: { label: string; kind: string; events: number }[];
  rhythm: string;
  note: string | null;
  span_days: number;
};

type Seeded = { boardId: string; cardIds: string[]; columnId: string };

async function seed(c: TestClient, titles: string[]): Promise<Seeded> {
  await c.signup(`close-${c.suffix}`);
  const board = await c.request('POST', '/api/v1/boards', { name: 'Retro S2' });
  expect(board.statusCode).toBe(201);
  const boardId = (board.json() as { id: string }).id;
  const state = await c.request('GET', `/api/v1/boards/${boardId}/state`);
  const columns = (state.json() as { columns: { id: string }[] }).columns;
  const columnId = columns[0]?.id ?? '';
  const cardIds: string[] = [];
  for (const title of titles) {
    const card = await c.request('POST', `/api/v1/boards/${boardId}/cards`, {
      column: columnId,
      title,
    });
    expect(card.statusCode).toBe(201);
    cardIds.push((card.json() as { id: string }).id);
  }
  return { boardId, cardIds, columnId };
}

describe('closing a board', () => {
  it('freezes it, stores the summary and answers 409 the second time', async () => {
    const c = harness.client();
    const seeded = await seed(c, ['Done one', 'Open one']);
    const firstCard = seeded.cardIds[0] ?? '';
    await c.request('PATCH', `/api/v1/cards/${firstCard}`, { done: true });

    const closed = await c.request('POST', `/api/v1/boards/${seeded.boardId}/close`, {
      confirm: true,
      note: 'Shipped the useful half.',
    });
    expect(closed.statusCode, closed.body).toBe(200);
    const summary = closed.json() as Summary;
    expect(summary.board).toMatchObject({ name: 'Retro S2' });
    expect(summary.note).toBe('Shipped the useful half.');
    expect(summary.counts.cards).toBe(2);
    expect(summary.counts.done).toBe(1);

    const again = await c.request('POST', `/api/v1/boards/${seeded.boardId}/close`, {
      confirm: true,
    });
    expect(again.statusCode).toBe(409);
    expect((again.json() as { error: { code: string } }).error.code).toBe('already_closed');

    const board = await c.request('GET', `/api/v1/boards/${seeded.boardId}`);
    expect((board.json() as { closed_at: string | null }).closed_at).not.toBeNull();

    const events = await harness.db.event.findMany({
      where: { board_id: seeded.boardId, type: 'board_closed' },
    });
    expect(events).toHaveLength(1);
    expect((events[0]?.payload as { summary_id: string }).summary_id).toBe(summary.id);
  });

  it('refuses every write after close, owner included, and keeps reads working', async () => {
    const c = harness.client();
    const seeded = await seed(c, ['One card']);
    const closed = await c.request('POST', `/api/v1/boards/${seeded.boardId}/close`, {
      confirm: true,
    });
    expect(closed.statusCode).toBe(200);

    const cardId = seeded.cardIds[0] ?? '';
    const writes = [
      await c.request('PATCH', `/api/v1/cards/${cardId}`, { title: 'Not any more' }),
      await c.request('POST', `/api/v1/boards/${seeded.boardId}/cards`, {
        column: seeded.columnId,
        title: 'Sneaking one in',
      }),
      await c.request('POST', `/api/v1/cards/${cardId}/comments`, { body: 'Hello?' }),
      await c.request('PATCH', `/api/v1/boards/${seeded.boardId}`, { name: 'Renamed' }),
    ];
    for (const response of writes) {
      expect(response.statusCode, response.body).toBe(403);
      expect((response.json() as { error: { code: string } }).error.code).toBe('board_closed');
    }

    expect((await c.request('GET', `/api/v1/boards/${seeded.boardId}/state`)).statusCode).toBe(200);
    expect(
      (await c.request('GET', `/api/v1/boards/${seeded.boardId}/export.json`)).statusCode,
    ).toBe(200);
    expect((await c.request('GET', `/api/v1/boards/${seeded.boardId}/summary`)).statusCode).toBe(
      200,
    );
  });

  it('partitions every card into done or remaining, exactly once', async () => {
    const c = harness.client();
    const seeded = await seed(c, ['Alpha', 'Bravo', 'Charlie', 'Deleted one']);
    const [alpha, bravo, , deleted] = seeded.cardIds;
    await c.request('PATCH', `/api/v1/cards/${alpha}`, { done: true });
    await c.request('PATCH', `/api/v1/cards/${bravo}`, { done: true });
    // A card that existed and was deleted before the close: it is in the event
    // log and must not appear in the summary's card totals.
    await c.request('DELETE', `/api/v1/cards/${deleted}`);

    const closed = await c.request('POST', `/api/v1/boards/${seeded.boardId}/close`, {
      confirm: true,
    });
    const summary = closed.json() as Summary;
    const doneTitles = summary.done.map((card) => card.title);
    const remainingTitles = summary.remaining.flatMap((group) =>
      group.cards.map((card) => card.title),
    );
    expect(doneTitles.sort()).toEqual(['Alpha', 'Bravo']);
    expect(remainingTitles.sort()).toEqual(['Charlie']);
    expect(doneTitles.length + remainingTitles.length).toBe(summary.counts.cards);
    expect(summary.counts.cards).toBe(
      await harness.db.card.count({ where: { board_id: seeded.boardId } }),
    );
    expect(doneTitles).not.toContain('Deleted one');
  });

  it('names an anonymous participant with their label and never as a member', async () => {
    const c = harness.client();
    const seeded = await seed(c, ['From a stranger']);

    // The anonymous actor exists in the event log with its own label; the state
    // route is what would promote it if anything could.
    await harness.db.event.create({
      data: {
        id: newId('evt'),
        board_id: seeded.boardId,
        type: 'card_created',
        actor_kind: 'anon',
        actor_user_id: null,
        actor_label: 'client',
        actor_anon_id: 'anon-test-1',
        payload: { board_id: seeded.boardId, card_id: seeded.cardIds[0], title: 'From a stranger' },
      },
    });

    const closed = await c.request('POST', `/api/v1/boards/${seeded.boardId}/close`, {
      confirm: true,
    });
    const summary = closed.json() as Summary;
    const client = summary.people.find((person) => person.label.includes('client'));
    expect(client).toBeDefined();
    expect(client?.label).toBe('client (anonymous)');
    expect(client?.kind).toBe('anon');

    // The owner is a member; the anonymous actor is not, and its label never
    // becomes an account.
    const members = await harness.db.boardMember.findMany({
      where: { board_id: seeded.boardId },
    });
    expect(members).toHaveLength(1);
    const anonymousUsers = await harness.db.user.findMany({ where: { username: 'client' } });
    expect(anonymousUsers).toHaveLength(0);
  });

  it('has a markdown summary that is identical across two reads', async () => {
    const c = harness.client();
    const seeded = await seed(c, ['One', 'Two']);
    await c.request('PATCH', `/api/v1/cards/${seeded.cardIds[0]}`, { done: true });
    await c.request('POST', `/api/v1/boards/${seeded.boardId}/close`, { confirm: true });

    const first = await c.request('GET', `/api/v1/boards/${seeded.boardId}/summary.md`);
    const second = await c.request('GET', `/api/v1/boards/${seeded.boardId}/summary.md`);
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toContain('text/markdown');
    expect(first.body).toBe(second.body);
    expect(first.body).toContain('# Retro S2 — closed ');
    expect(first.body).toContain('## Done');
    expect(first.body).toContain('- One — ');
    expect(first.body).toContain('## Remaining');
    expect(first.body).toContain('- Two — unassigned');
    // Every done card exactly once.
    expect(first.body.split('- One — ').length - 1).toBe(1);
  });

  it('answers 404 for the summary of an open board and for a stranger', async () => {
    const c = harness.client();
    const seeded = await seed(c, ['Open']);
    const before = await c.request('GET', `/api/v1/boards/${seeded.boardId}/summary`);
    expect(before.statusCode).toBe(404);

    const stranger = harness.client();
    await stranger.signup(`outsider-${stranger.suffix}`);
    const closed = await c.request('POST', `/api/v1/boards/${seeded.boardId}/close`, {
      confirm: true,
    });
    expect(closed.statusCode).toBe(200);

    const hidden = await stranger.request('GET', `/api/v1/boards/${seeded.boardId}/summary`);
    const missing = await stranger.request(
      'GET',
      '/api/v1/boards/brd_0000000000000000000001/summary',
    );
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).toBe(missing.body);
  });

  it('requires confirm:true and says so', async () => {
    const c = harness.client();
    const seeded = await seed(c, ['Anything']);
    const response = await c.request('POST', `/api/v1/boards/${seeded.boardId}/close`, {});
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details: { path: string }[] } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details[0]?.path).toBe('confirm');
    const board = await c.request('GET', `/api/v1/boards/${seeded.boardId}`);
    expect((board.json() as { closed_at: string | null }).closed_at).toBeNull();
  });
});

describe('the summary document', () => {
  it('counts people by actor kind and renders a rhythm only past a week', async () => {
    const c = harness.client();
    const seeded = await seed(c, ['Thing']);
    const base = Date.now() - 30 * 86_400_000;
    const events = Array.from({ length: 12 }, (_unused, index) => ({
      id: newId('evt'),
      board_id: seeded.boardId,
      type: 'card_updated' as const,
      actor_kind: (index % 3 === 0 ? 'agent' : 'user') as 'agent' | 'user',
      actor_user_id: null,
      actor_label: null,
      actor_anon_id: null,
      payload: { board_id: seeded.boardId, card_id: seeded.cardIds[0] },
      created_at: new Date(base + index * 3 * 86_400_000),
    }));
    await harness.db.event.createMany({ data: events });

    const closed = await c.request('POST', `/api/v1/boards/${seeded.boardId}/close`, {
      confirm: true,
    });
    const summary = closed.json() as Summary;
    expect(summary.people.length).toBeGreaterThan(0);
    expect(summary.span_days).toBeGreaterThanOrEqual(28);
    expect(summary.rhythm.length).toBeGreaterThanOrEqual(4);
    expect(summary.rhythm).toMatch(/^[▁▂▃▄▅▆▇█]+$/u);
  });
});
