// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K3-04 — the moderation queue.
 *
 * A moderated write creates nothing public. Approval is the only road from a
 * `PendingCard` to a card, the author's label survives it, and expiry is the
 * sweeper's job — proven by moving the clock, not by waiting seven days.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';
import { sweepExpiredPendingCards } from '../src/moderation/service.js';

const WEB_DIR = new URL('./fixtures/web', import.meta.url).pathname;

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer({ webDir: WEB_DIR });
});

afterAll(async () => {
  await harness.close();
});

type Board = { id: string; anon_write: string };
type Pending = { id: string; title: string; actor_label: string; column_id: string };

async function moderatedBoard(owner: TestClient): Promise<{ board: Board; columnId: string }> {
  await owner.signup(`mod-${owner.suffix}`);
  const created = await owner.request('POST', '/api/v1/boards', {
    name: 'Queue under test',
    visibility: 'link',
  });
  const board = created.json() as Board;
  const patched = await owner.request('PATCH', `/api/v1/boards/${board.id}`, {
    link_role: 'read',
    anon_write: 'moderated',
  });
  const state = await owner.request('GET', `/api/v1/boards/${board.id}/state`);
  const columns = (state.json() as { columns: { id: string }[] }).columns;
  const [column] = columns;
  if (!column) throw new Error('no column');
  return { board: patched.json() as Board, columnId: column.id };
}

async function pendingFrom(
  visitor: TestClient,
  boardId: string,
  columnId: string,
  title: string,
  label: string,
): Promise<Pending> {
  const join = await visitor.app.inject({
    method: 'POST',
    url: `/api/v1/boards/${boardId}/anon`,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ label }),
  });
  const header = join.headers['set-cookie'];
  const raw = Array.isArray(header) ? header[0] : header;
  const cookie = raw?.split(';')[0] ?? '';
  const created = await visitor.app.inject({
    method: 'POST',
    url: `/api/v1/boards/${boardId}/cards`,
    headers: { 'content-type': 'application/json', cookie },
    payload: JSON.stringify({ column: columnId, title }),
  });
  expect(created.statusCode).toBe(202);
  return created.json() as Pending;
}

describe('the queue', () => {
  it('is readable by owner and admin, refused to editor and stranger', async () => {
    const owner = harness.client();
    const { board, columnId } = await moderatedBoard(owner);
    await pendingFrom(harness.client(), board.id, columnId, 'Waiting one', 'Someone');

    const listed = await owner.request('GET', `/api/v1/boards/${board.id}/pending`);
    expect(listed.statusCode).toBe(200);
    const items = (listed.json() as { items: Pending[] }).items;
    expect(items.map((item) => item.title)).toEqual(['Waiting one']);
    expect(items[0]?.actor_label).toBe('Someone');

    const editor = harness.client();
    const editorUser = await editor.signup(`mod-editor-${editor.suffix}`);
    await harness.db.boardMember.create({
      data: {
        id: `bmb_${crypto.randomUUID().replaceAll('-', '').slice(0, 22)}`,
        board_id: board.id,
        user_id: editorUser.id,
        role: 'editor',
      },
    });
    expect((await editor.request('GET', `/api/v1/boards/${board.id}/pending`)).statusCode).toBe(
      403,
    );

    const stranger = harness.client();
    await stranger.signup(`mod-stranger-${stranger.suffix}`);
    expect((await stranger.request('GET', `/api/v1/boards/${board.id}/pending`)).statusCode).toBe(
      404,
    );
  });

  it('approves into a real card, keeps the label, and records the approver', async () => {
    const owner = harness.client();
    const { board, columnId } = await moderatedBoard(owner);
    const pending = await pendingFrom(
      harness.client(),
      board.id,
      columnId,
      'Please add me',
      'A visitor',
    );

    const approved = await owner.request(
      'POST',
      `/api/v1/boards/${board.id}/pending/${pending.id}/approve`,
      {},
    );
    expect(approved.statusCode).toBe(201);
    const { card_id: cardId } = approved.json() as { card_id: string };

    const card = await harness.db.card.findUnique({ where: { id: cardId } });
    expect(card?.title).toBe('Please add me');
    expect(card?.actor_label).toBe('A visitor');
    expect(card?.column_id).toBe(columnId);
    expect(await harness.db.pendingCard.count({ where: { board_id: board.id } })).toBe(0);

    const event = await harness.db.event.findFirst({
      where: { board_id: board.id, type: 'pending_approved' },
    });
    const payload = event?.payload as { card_id?: string; approved_by?: string } | undefined;
    expect(event?.actor_kind).toBe('user');
    expect(payload?.card_id).toBe(cardId);
    expect(payload?.approved_by).toBe(`mod-${owner.suffix}`);

    const again = await owner.request(
      'POST',
      `/api/v1/boards/${board.id}/pending/${pending.id}/approve`,
      {},
    );
    expect(again.statusCode).toBe(404);
  });

  it('rejects without creating anything, and records it', async () => {
    const owner = harness.client();
    const { board, columnId } = await moderatedBoard(owner);
    const pending = await pendingFrom(harness.client(), board.id, columnId, 'Spam', 'Spammer');

    const rejected = await owner.request(
      'POST',
      `/api/v1/boards/${board.id}/pending/${pending.id}/reject`,
      {},
    );
    expect(rejected.statusCode).toBe(204);
    expect(await harness.db.card.count({ where: { board_id: board.id } })).toBe(0);
    expect(await harness.db.pendingCard.count({ where: { board_id: board.id } })).toBe(0);
    const event = await harness.db.event.findFirst({
      where: { board_id: board.id, type: 'pending_rejected' },
    });
    expect(event).not.toBeNull();
  });
});

describe('expiry', () => {
  it('purges an expired row as the system, and keeps a fresh one', async () => {
    const owner = harness.client();
    const { board, columnId } = await moderatedBoard(owner);
    const stale = await pendingFrom(harness.client(), board.id, columnId, 'Too old', 'Slowpoke');
    const fresh = await pendingFrom(harness.client(), board.id, columnId, 'Still fresh', 'Quick');

    await harness.db.pendingCard.update({
      where: { id: stale.id },
      data: { expires_at: new Date(Date.now() - 1000) },
    });

    const swept = await sweepExpiredPendingCards(harness.db);
    expect(swept).toBe(1);
    expect(await harness.db.pendingCard.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await harness.db.pendingCard.findUnique({ where: { id: fresh.id } })).not.toBeNull();

    const event = await harness.db.event.findFirst({
      where: { board_id: board.id, type: 'pending_expired' },
    });
    expect(event?.actor_kind).toBe('system');
    expect((event?.payload as { pending_id?: string } | undefined)?.pending_id).toBe(stale.id);
  });

  it('is a no-op the second time', async () => {
    const owner = harness.client();
    const { board, columnId } = await moderatedBoard(owner);
    const stale = await pendingFrom(harness.client(), board.id, columnId, 'One shot', 'Someone');
    await harness.db.pendingCard.update({
      where: { id: stale.id },
      data: { expires_at: new Date(Date.now() - 1000) },
    });
    expect(await sweepExpiredPendingCards(harness.db)).toBe(1);
    expect(await sweepExpiredPendingCards(harness.db)).toBe(0);
  });
});
