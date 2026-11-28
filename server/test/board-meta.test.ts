// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Board meta: `description` and `icon` (feature pass A). The contract lives in
 * `server/src/contracts/boards.ts` (`BOARD_ICONS`, the closed set of icon
 * names); the payload rule is docs/api.md §2 — every board serialisation
 * carries both fields, `null` when unset.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';
import { BOARD_ICONS } from '../src/contracts/boards.js';

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
  icon: string | null;
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

describe('a board carries a description and an icon', () => {
  it('creates with both and reads them back, trimmed, and defaults to null', async () => {
    const c = harness.client();
    await c.signup(`meta-owner-${c.suffix}`);

    const board = await newBoard(c, {
      name: 'Sprint 42',
      description: '  Planning and retro  ',
      icon: 'rocket',
    });
    expect(board.description).toBe('Planning and retro');
    expect(board.icon).toBe('rocket');

    const read = await c.request('GET', `/api/v1/boards/${board.id}`);
    expect(read.statusCode).toBe(200);
    const readBody = read.json() as Board;
    expect(readBody.description).toBe('Planning and retro');
    expect(readBody.icon).toBe('rocket');

    // Absent on create means no description and no icon, not a refusal.
    const plain = await newBoard(c, { name: 'Plain board' });
    expect(plain.description).toBeNull();
    expect(plain.icon).toBeNull();
  });

  it('accepts every icon of the closed set, and rejects an unknown one with 400', async () => {
    const c = harness.client();
    await c.signup(`meta-icons-${c.suffix}`);

    for (const icon of BOARD_ICONS) {
      const board = await newBoard(c, { name: `Board ${icon}`, icon });
      expect(board.icon).toBe(icon);
    }

    const unknown = await c.request('POST', '/api/v1/boards', { name: 'Bad icon', icon: 'skull' });
    expect(unknown.statusCode).toBe(400);
    expect(errorCode(unknown)).toBe('validation_failed');

    // The patch schema is strict: a field nobody named is rejected, so a
    // colour or an arbitrary string cannot sneak in beside the closed set.
    const first = await newBoard(c, { name: 'Strict' });
    const strict = await c.request('PATCH', `/api/v1/boards/${first.id}`, { colour: '#FF0000' });
    expect(strict.statusCode).toBe(400);
    expect(errorCode(strict)).toBe('validation_failed');
    const unknownPatch = await c.request('PATCH', `/api/v1/boards/${first.id}`, { icon: 'skull' });
    expect(unknownPatch.statusCode).toBe(400);
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

    // Trimmed first: 281 characters of padding around one letter is still one
    // character once trimmed, and an empty-after-trim string is refused.
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

  it('patches: sets both, clears one with null, and leaves the other untouched', async () => {
    const c = harness.client();
    await c.signup(`meta-patch-${c.suffix}`);
    const board = await newBoard(c, { name: 'Patch me' });

    const set = await c.request('PATCH', `/api/v1/boards/${board.id}`, {
      description: 'What this board is',
      icon: 'book',
      expected_updated_at: board.updated_at,
    });
    expect(set.statusCode).toBe(200);
    const setBody = set.json() as Board;
    expect(setBody.description).toBe('What this board is');
    expect(setBody.icon).toBe('book');

    // `null` clears the description; the icon is not in the body, so it stays.
    const cleared = await c.request('PATCH', `/api/v1/boards/${board.id}`, {
      description: null,
      expected_updated_at: setBody.updated_at,
    });
    expect(cleared.statusCode).toBe(200);
    const clearedBody = cleared.json() as Board;
    expect(clearedBody.description).toBeNull();
    expect(clearedBody.icon).toBe('book');

    // The other way round: patching only the icon leaves the description alone.
    const setAgain = await c.request('PATCH', `/api/v1/boards/${board.id}`, {
      description: 'Back again',
      expected_updated_at: clearedBody.updated_at,
    });
    const setAgainBody = setAgain.json() as Board;
    const iconOnly = await c.request('PATCH', `/api/v1/boards/${board.id}`, {
      icon: 'cart',
      expected_updated_at: setAgainBody.updated_at,
    });
    expect(iconOnly.statusCode).toBe(200);
    const iconOnlyBody = iconOnly.json() as Board;
    expect(iconOnlyBody.icon).toBe('cart');
    expect(iconOnlyBody.description).toBe('Back again');

    // The row agrees with the payload.
    const row = await harness.db.board.findUniqueOrThrow({ where: { id: board.id } });
    expect(row.description).toBe('Back again');
    expect(row.icon).toBe('cart');
  });

  it('refuses a board-scoped viewer every patch of them with 403', async () => {
    const owner = harness.client();
    await owner.signup(`meta-guard-owner-${owner.suffix}`);
    const board = await newBoard(owner, {
      name: 'Guarded',
      description: 'owner only',
      icon: 'code',
    });

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
      icon: 'heart',
    });
    expect(denied.statusCode).toBe(403);
    expect(errorCode(denied)).toBe('forbidden');

    const row = await harness.db.board.findUniqueOrThrow({ where: { id: board.id } });
    expect(row.description).toBe('owner only');
    expect(row.icon).toBe('code');
  });

  it('carries both fields in the list, the state payload and the public profile list', async () => {
    const c = harness.client();
    const user = await c.signup(`meta-list-${c.suffix}`);
    const board = await newBoard(c, {
      name: 'Listed',
      description: 'Listed description',
      icon: 'layers',
    });

    const list = await c.request('GET', '/api/v1/boards');
    expect(list.statusCode).toBe(200);
    const listed = (list.json() as { items: Board[] }).items.find((item) => item.id === board.id);
    expect(listed?.description).toBe('Listed description');
    expect(listed?.icon).toBe('layers');

    const state = await c.request('GET', `/api/v1/boards/${board.id}/state`);
    expect(state.statusCode).toBe(200);
    const stateBoard = (state.json() as { board: Board }).board;
    expect(stateBoard.description).toBe('Listed description');
    expect(stateBoard.icon).toBe('layers');

    // The public profile list carries them too: a public board's summary is
    // the same contract, not a thinner one.
    const madePublic = await c.request('PATCH', `/api/v1/boards/${board.id}`, {
      visibility: 'public',
      expected_updated_at: board.updated_at,
    });
    expect(madePublic.statusCode).toBe(200);

    const profile = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/users/${user.username}/boards`,
    });
    expect(profile.statusCode).toBe(200);
    const items = (profile.json() as { items: Board[] }).items;
    const publicItem = items.find((item) => item.id === board.id);
    expect(publicItem?.description).toBe('Listed description');
    expect(publicItem?.icon).toBe('layers');
  });
});
