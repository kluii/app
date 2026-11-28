// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Board meta: `description` (feature pass A). The payload rule is
 * docs/api.md §2 — every board serialisation carries the field, `null` when
 * the board has none.
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

type Board = {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
};

async function newBoard(c: TestClient, body: Record<string, unknown>): Promise<Board> {
  const created = await c.request('POST', '/api/v1/boards', body);
  expect(created.statusCode).toBe(201);
  return created.json() as Board;
}

function errorCode(response: { statusCode: number; json: () => unknown }): string {
  return (response.json() as { error: { code: string } }).error.code;
}

describe('a board carries a description', () => {
  it('creates with one and reads it back, trimmed, and defaults to null', async () => {
    const c = harness.client();
    await c.signup(`meta-owner-${c.suffix}`);

    const board = await newBoard(c, { name: 'Sprint 42', description: '  Planning and retro  ' });
    expect(board.description).toBe('Planning and retro');

    const read = await c.request('GET', `/api/v1/boards/${board.id}`);
    expect(read.statusCode).toBe(200);
    expect((read.json() as Board).description).toBe('Planning and retro');

    // Absent on create means no description, not a refusal.
    const plain = await newBoard(c, { name: 'Plain board' });
    expect(plain.description).toBeNull();
  });

  it('rejects a 281-character description with 400 and accepts 280', async () => {
    const c = harness.client();
    await c.signup(`meta-length-${c.suffix}`);

    const tooLong = await c.request('POST', '/api/v1/boards', {
      name: 'Too long',
      description: 'x'.repeat(281),
    });
    expect(tooLong.statusCode).toBe(400);
    expect(errorCode(tooLong)).toBe('validation_failed');

    // Trimmed first: whitespace-only is empty once trimmed, and an empty
    // description is refused.
    const blank = await c.request('POST', '/api/v1/boards', {
      name: 'Blank',
      description: '   '.repeat(94),
    });
    expect(blank.statusCode).toBe(400);

    const edge = await c.request('POST', '/api/v1/boards', {
      name: 'Edge',
      description: 'x'.repeat(280),
    });
    expect(edge.statusCode).toBe(201);
    expect((edge.json() as Board).description).toHaveLength(280);
  });

  it('patches: sets, clears with null, and leaves the rest of the board alone', async () => {
    const c = harness.client();
    await c.signup(`meta-patch-${c.suffix}`);
    const board = await newBoard(c, { name: 'Patch me' });

    const set = await c.request('PATCH', `/api/v1/boards/${board.id}`, {
      description: 'What this board is',
      expected_updated_at: board.updated_at,
    });
    expect(set.statusCode).toBe(200);
    const setBody = set.json() as Board;
    expect(setBody.description).toBe('What this board is');
    expect(setBody.name).toBe('Patch me');

    // `null` clears the description.
    const cleared = await c.request('PATCH', `/api/v1/boards/${board.id}`, {
      description: null,
      expected_updated_at: setBody.updated_at,
    });
    expect(cleared.statusCode).toBe(200);
    const clearedBody = cleared.json() as Board;
    expect(clearedBody.description).toBeNull();

    // A field not sent is untouched: patching the name leaves the (cleared)
    // description null.
    const renamed = await c.request('PATCH', `/api/v1/boards/${board.id}`, {
      name: 'Renamed',
      expected_updated_at: clearedBody.updated_at,
    });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as Board).description).toBeNull();

    // The row agrees with the payload.
    const row = await harness.db.board.findUniqueOrThrow({ where: { id: board.id } });
    expect(row.description).toBeNull();
  });

  it('refuses a board-scoped viewer a description patch with 403', async () => {
    const owner = harness.client();
    await owner.signup(`meta-guard-owner-${owner.suffix}`);
    const board = await newBoard(owner, { name: 'Guarded', description: 'owner only' });

    const viewer = harness.client();
    const viewerUser = await viewer.signup(`meta-viewer-${viewer.suffix}`);
    await harness.db.boardMember.create({
      data: {
        id: `bmb_${viewer.suffix}xxxxxxxxxxxxxx`,
        board_id: board.id,
        user_id: viewerUser.id,
        role: 'viewer',
      },
    });

    // Same `board.update` gate as `name`: the viewer can read, not write.
    const read = await viewer.request('GET', `/api/v1/boards/${board.id}`);
    expect(read.statusCode).toBe(200);

    const denied = await viewer.request('PATCH', `/api/v1/boards/${board.id}`, {
      description: 'viewer was here',
    });
    expect(denied.statusCode).toBe(403);
    expect(errorCode(denied)).toBe('forbidden');

    const row = await harness.db.board.findUniqueOrThrow({ where: { id: board.id } });
    expect(row.description).toBe('owner only');
  });

  it('carries the field in the list and in the state payload', async () => {
    const c = harness.client();
    await c.signup(`meta-list-${c.suffix}`);
    const board = await newBoard(c, { name: 'Listed', description: 'Listed description' });

    const list = await c.request('GET', '/api/v1/boards');
    expect(list.statusCode).toBe(200);
    const listed = (list.json() as { items: Board[] }).items.find((item) => item.id === board.id);
    expect(listed?.description).toBe('Listed description');

    const state = await c.request('GET', `/api/v1/boards/${board.id}/state`);
    expect(state.statusCode).toBe(200);
    const stateBoard = (state.json() as { board: Board }).board;
    expect(stateBoard.description).toBe('Listed description');
  });
});
