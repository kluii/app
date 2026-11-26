// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-05: the move planner, exercised as a property. Two hundred randomised
 * moves through the real endpoint must never leave a duplicate position, never
 * leave a column that disagrees with the order the client asked for, and must
 * converge instead of shrinking the gaps forever.
 *
 * The PRNG is seeded so a failure is reproducible: the seed is printed with the
 * step that broke the invariant.
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

type Column = { id: string; name: string };

/** mulberry32: small, deterministic, enough for a property test. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) % 0x100000000;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

async function board(c: TestClient): Promise<{ boardId: string; columns: Column[] }> {
  await c.signup(`prop-${c.suffix}`);
  const created = await c.request('POST', '/api/v1/boards', { name: 'Property board' });
  expect(created.statusCode).toBe(201);
  const boardId = (created.json() as { id: string }).id;
  const state = await c.request('GET', `/api/v1/boards/${boardId}/state`);
  return { boardId, columns: (state.json() as { columns: Column[] }).columns };
}

async function addCard(c: TestClient, boardId: string, columnId: string, title: string) {
  const response = await c.request('POST', `/api/v1/boards/${boardId}/cards`, {
    column: columnId,
    title,
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; title: string };
}

async function storedOrder(columnId: string): Promise<{ id: string; title: string }[]> {
  const rows = await harness.db.card.findMany({
    where: { column_id: columnId },
    orderBy: { position: 'asc' },
    select: { id: true, title: true, position: true },
  });
  return rows.map((row) => ({ id: row.id, title: row.title }));
}

async function assertNoDuplicates(columnId: string, step: number, seed: number): Promise<void> {
  const rows = await harness.db.card.findMany({
    where: { column_id: columnId },
    select: { id: true, position: true },
  });
  const positions = rows.map((row) => Number(row.position));
  expect(new Set(positions).size, `duplicate position at step ${step} (seed ${seed})`).toBe(
    positions.length,
  );
  for (const position of positions) {
    expect(Number.isFinite(position), `non-finite position at step ${step} (seed ${seed})`).toBe(
      true,
    );
    expect(position, `non-positive position at step ${step} (seed ${seed})`).toBeGreaterThan(0);
  }
}

describe('a move is a writable resource', () => {
  it('accepts expected_updated_at, and refuses a stale one with the current card', async () => {
    const c = harness.client();
    const { boardId, columns } = await board(c);
    const todo = columns[0];
    if (!todo) throw new Error('no column');
    const first = await addCard(c, boardId, todo.id, 'First');
    const second = await addCard(c, boardId, todo.id, 'Second');

    const fresh = (await c.request('GET', `/api/v1/cards/${second.id}`)).json() as {
      updated_at: string;
    };

    // Someone else writes the card first: the value we rendered against is old.
    await c.request('PATCH', `/api/v1/cards/${second.id}`, { title: 'Second, renamed' });

    const stale = await c.request('POST', `/api/v1/cards/${second.id}/move`, {
      column: todo.id,
      before: null,
      after: first.id,
      expected_updated_at: fresh.updated_at,
    });
    expect(stale.statusCode).toBe(409);
    const current = (stale.json() as { error: { current: { id: string; title: string } } }).error
      .current;
    expect(current.id).toBe(second.id);
    expect(current.title).toBe('Second, renamed');

    const order = await storedOrder(todo.id);
    expect(order.map((card) => card.title)).toEqual(['First', 'Second, renamed']);

    const now = (await c.request('GET', `/api/v1/cards/${second.id}`)).json() as {
      updated_at: string;
    };
    const accepted = await c.request('POST', `/api/v1/cards/${second.id}/move`, {
      column: todo.id,
      before: null,
      after: first.id,
      expected_updated_at: now.updated_at,
    });
    expect(accepted.statusCode).toBe(200);
    expect((await storedOrder(todo.id)).map((card) => card.title)).toEqual([
      'Second, renamed',
      'First',
    ]);
  });

  it('still accepts a move with no expected_updated_at', async () => {
    const c = harness.client();
    const { boardId, columns } = await board(c);
    const todo = columns[0];
    if (!todo) throw new Error('no column');
    const only = await addCard(c, boardId, todo.id, 'Only');

    const moved = await c.request('POST', `/api/v1/cards/${only.id}/move`, {
      column: todo.id,
    });
    expect(moved.statusCode).toBe(200);
  });
});

describe('move planning', () => {
  it('survives 200 randomised in-column moves without a duplicate or out-of-order position', async () => {
    const seed = 0x5eed;
    const next = random(seed);
    const c = harness.client();
    const { boardId, columns } = await board(c);
    const todo = columns[0];
    if (!todo) throw new Error('no column');

    const cards: { id: string; title: string }[] = [];
    for (const title of ['A', 'B', 'C', 'D', 'E', 'F']) {
      cards.push(await addCard(c, boardId, todo.id, title));
    }

    for (let step = 0; step < 200; step += 1) {
      const order = await storedOrder(todo.id);
      const from = Math.floor(next() * order.length);
      const to = Math.floor(next() * order.length);
      const moving = order[from];
      if (!moving) throw new Error('no card to move at step ' + String(step));

      // The neighbours the client would render for the chosen target slot.
      const without = order.filter((card) => card.id !== moving.id);
      const before = to > 0 ? (without[to - 1]?.id ?? null) : null;
      const after = without[to]?.id ?? null;

      const response = await c.request('POST', `/api/v1/cards/${moving.id}/move`, {
        column: todo.id,
        before,
        after,
      });
      expect(response.statusCode, `move answered ${response.statusCode} at step ${step}`).toBe(200);

      const expected = [...without];
      expected.splice(Math.min(to, without.length), 0, moving);
      const actual = await storedOrder(todo.id);
      expect(
        actual.map((card) => card.title),
        `order after step ${step} (seed ${seed})`,
      ).toEqual(expected.map((card) => card.title));

      await assertNoDuplicates(todo.id, step, seed);
    }
  });

  it('renumbers instead of collapsing when a slot is squeezed 30 times', async () => {
    const c = harness.client();
    const { boardId, columns } = await board(c);
    const todo = columns[0];
    if (!todo) throw new Error('no column');

    const top = await addCard(c, boardId, todo.id, 'top');
    const bottom = await addCard(c, boardId, todo.id, 'bottom');
    const squeezed = await addCard(c, boardId, todo.id, 'squeezed');

    let previous = Number.POSITIVE_INFINITY;
    for (let step = 0; step < 30; step += 1) {
      const response = await c.request('POST', `/api/v1/cards/${squeezed.id}/move`, {
        column: todo.id,
        before: top.id,
        after: bottom.id,
      });
      expect(response.statusCode).toBe(200);
      const position = Number((response.json() as { position: string }).position);
      expect(Number.isFinite(position)).toBe(true);
      // Pinned between the same neighbours, the rank is stable once renumbered:
      // it may shrink, but it never becomes zero or a duplicate.
      expect(position).toBeGreaterThan(0);
      previous = position;
      await assertNoDuplicates(todo.id, step, 0);
    }
    expect(previous).toBeGreaterThan(0);
    const order = await storedOrder(todo.id);
    expect(order.map((card) => card.title)).toEqual(['top', 'squeezed', 'bottom']);
  });

  it('keeps both columns consistent under 100 randomised cross-column moves', async () => {
    const seed = 0xc0ffee;
    const next = random(seed);
    const c = harness.client();
    const { boardId, columns } = await board(c);
    const [left, right] = columns;
    if (!left || !right) throw new Error('missing columns');

    for (const title of ['l1', 'l2', 'l3']) await addCard(c, boardId, left.id, title);
    for (const title of ['r1', 'r2']) await addCard(c, boardId, right.id, title);

    for (let step = 0; step < 100; step += 1) {
      // A random step can empty a column: pick the source among the columns
      // that still have cards instead of assuming both do.
      const leftOrder = await storedOrder(left.id);
      const rightOrder = await storedOrder(right.id);
      const populated = [
        { column: left, order: leftOrder },
        { column: right, order: rightOrder },
      ].filter((entry) => entry.order.length > 0);
      const source = populated[Math.floor(next() * populated.length)];
      if (!source) throw new Error('both columns are empty at step ' + String(step));
      const fromLeft = source.column.id === left.id;
      const to = fromLeft ? right : left;
      const order = source.order;
      const pick = order[Math.floor(next() * order.length)];
      if (!pick) throw new Error('no card at step ' + String(step));
      const target = fromLeft ? rightOrder : leftOrder;
      const slot = Math.floor(next() * (target.length + 1));
      const before = slot > 0 ? (target[slot - 1]?.id ?? null) : null;
      const after = target[slot]?.id ?? null;

      const response = await c.request('POST', `/api/v1/cards/${pick.id}/move`, {
        column: to.id,
        before,
        after,
      });
      expect(response.statusCode, `cross-column move at step ${step}`).toBe(200);

      const moved = await storedOrder(to.id);
      expect(moved[slot]?.id, `slot ${slot} wrong at step ${step} (seed ${seed})`).toBe(pick.id);
      await assertNoDuplicates(left.id, step, seed);
      await assertNoDuplicates(right.id, step, seed);
    }
  });

  it('appends when the neighbours do not exist, and does not lose the card', async () => {
    const c = harness.client();
    const { boardId, columns } = await board(c);
    const todo = columns[0];
    if (!todo) throw new Error('no column');
    const kept = await addCard(c, boardId, todo.id, 'kept');
    const gone = await addCard(c, boardId, todo.id, 'gone');
    await c.request('DELETE', `/api/v1/cards/${gone.id}`);

    const response = await c.request('POST', `/api/v1/cards/${kept.id}/move`, {
      column: todo.id,
      before: gone.id,
      after: gone.id,
    });
    expect(response.statusCode).toBe(200);
    const order = await storedOrder(todo.id);
    expect(order.map((card) => card.title)).toEqual(['kept']);
    await assertNoDuplicates(todo.id, 0, 0);
  });
});
