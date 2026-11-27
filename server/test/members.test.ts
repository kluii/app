// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K3-05 — membership.
 *
 * The exits: the only owner cannot be demoted, a transfer leaves exactly one
 * owner and one log entry, and a removed member loses access on the next
 * request without touching their session.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';

const WEB_DIR = new URL('./fixtures/web', import.meta.url).pathname;

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer({ webDir: WEB_DIR });
});

afterAll(async () => {
  await harness.close();
});

type Board = { id: string; owner: { username: string } };
type Member = { user_id: string; username: string; role: string };

async function ownerClient(prefix: string): Promise<{
  c: TestClient;
  username: string;
  user: { id: string; username: string };
}> {
  const c = harness.client();
  const username = `${prefix}-${c.suffix}`;
  const user = await c.signup(username);
  return { c, username, user };
}

async function board(c: TestClient, name = 'Members board'): Promise<Board> {
  const created = await c.request('POST', '/api/v1/boards', { name });
  expect(created.statusCode).toBe(201);
  return created.json() as Board;
}

describe('inviting and listing', () => {
  it('adds a member by username and lists them with joined_at', async () => {
    const { c } = await ownerClient('invite');
    const target = await ownerClient('invitee');
    const created = await board(c);

    const invited = await c.request('POST', `/api/v1/boards/${created.id}/members`, {
      username: target.username,
      role: 'editor',
    });
    expect(invited.statusCode).toBe(201);
    const row = invited.json() as Member;
    expect(row).toMatchObject({ username: target.username, role: 'editor' });

    const listed = await c.request('GET', `/api/v1/boards/${created.id}/members`);
    const items = (listed.json() as { items: (Member & { joined_at?: string })[] }).items;
    expect(items).toHaveLength(2);
    expect(items.some((item) => item.role === 'owner')).toBe(true);
    expect(items.find((item) => item.username === target.username)?.role).toBe('editor');
    expect(items[0]?.joined_at).toBeTypeOf('string');
  });

  it('refuses an unknown username, a duplicate, and a caller who is not an admin', async () => {
    const { c } = await ownerClient('inviteguard');
    const created = await board(c);

    const unknown = await c.request('POST', `/api/v1/boards/${created.id}/members`, {
      username: 'nobody-at-all-here',
      role: 'viewer',
    });
    expect(unknown.statusCode).toBe(404);

    const target = await ownerClient('dupe');
    expect(
      (
        await c.request('POST', `/api/v1/boards/${created.id}/members`, {
          username: target.username,
          role: 'viewer',
        })
      ).statusCode,
    ).toBe(201);
    const again = await c.request('POST', `/api/v1/boards/${created.id}/members`, {
      username: target.username,
      role: 'editor',
    });
    expect(again.statusCode).toBe(409);

    const stranger = await ownerClient('notadmin');
    const denied = await stranger.c.request('POST', `/api/v1/boards/${created.id}/members`, {
      username: target.username,
      role: 'editor',
    });
    expect(denied.statusCode).toBe(404);
  });
});

describe('roles', () => {
  it('changes a role and records it in the event log', async () => {
    const { c } = await ownerClient('role');
    const target = await ownerClient('role-target');
    const created = await board(c);
    await c.request('POST', `/api/v1/boards/${created.id}/members`, {
      username: target.username,
      role: 'viewer',
    });

    const updated = await c.request(
      'PATCH',
      `/api/v1/boards/${created.id}/members/${target.user.id}`,
      { role: 'editor' },
    );
    expect(updated.statusCode).toBe(200);

    const event = await harness.db.event.findFirst({
      where: { board_id: created.id, type: 'member_updated' },
      orderBy: { created_at: 'desc' },
    });
    expect((event?.payload as { changes?: { role?: [string, string] } }).changes?.role).toEqual([
      'viewer',
      'editor',
    ]);
  });

  it('refuses to demote the only owner', async () => {
    const { c, user } = await ownerClient('lastowner');
    const created = await board(c);

    const demoted = await c.request('PATCH', `/api/v1/boards/${created.id}/members/${user.id}`, {
      role: 'admin',
    });
    expect(demoted.statusCode).toBe(409);
    const row = await harness.db.boardMember.findFirst({
      where: { board_id: created.id, user_id: user.id },
    });
    expect(row?.role).toBe('owner');
  });

  it('refuses to remove the owner', async () => {
    const { c, user } = await ownerClient('ownerremove');
    const created = await board(c);
    const removed = await c.request('DELETE', `/api/v1/boards/${created.id}/members/${user.id}`);
    expect(removed.statusCode).toBe(409);
  });

  it('lets an admin remove an editor but not another admin', async () => {
    const { c } = await ownerClient('adminremove');
    const admin = await ownerClient('admin-two');
    const editor = await ownerClient('editor-three');
    const created = await board(c);
    for (const [target, role] of [
      [admin, 'admin'],
      [editor, 'editor'],
    ] as const) {
      const added = await c.request('POST', `/api/v1/boards/${created.id}/members`, {
        username: target.username,
        role,
      });
      expect(added.statusCode).toBe(201);
    }

    expect(
      (await admin.c.request('DELETE', `/api/v1/boards/${created.id}/members/${editor.user.id}`))
        .statusCode,
    ).toBe(204);
    expect(
      (await admin.c.request('DELETE', `/api/v1/boards/${created.id}/members/${admin.user.id}`))
        .statusCode,
    ).toBe(409);
  });

  it('removes a member and their next request is a 404, same session', async () => {
    const { c } = await ownerClient('kick');
    const removed = await ownerClient('kicked');
    const created = await board(c);
    await c.request('POST', `/api/v1/boards/${created.id}/members`, {
      username: removed.username,
      role: 'editor',
    });
    expect((await removed.c.request('GET', `/api/v1/boards/${created.id}/state`)).statusCode).toBe(
      200,
    );

    expect(
      (await c.request('DELETE', `/api/v1/boards/${created.id}/members/${removed.user.id}`))
        .statusCode,
    ).toBe(204);

    // Same cookie jar: no refresh, no re-login.
    expect((await removed.c.request('GET', `/api/v1/boards/${created.id}/state`)).statusCode).toBe(
      404,
    );
  });
});

describe('transfer', () => {
  it('leaves exactly one owner, moves ownership, and writes one entry', async () => {
    const { c, user } = await ownerClient('transfer');
    const next = await ownerClient('successor');
    const created = await board(c);
    await c.request('POST', `/api/v1/boards/${created.id}/members`, {
      username: next.username,
      role: 'admin',
    });

    const transferred = await c.request('POST', `/api/v1/boards/${created.id}/transfer`, {
      user_id: next.user.id,
      confirm: true,
    });
    expect(transferred.statusCode).toBe(200);

    const members = await harness.db.boardMember.findMany({ where: { board_id: created.id } });
    expect(members.filter((member) => member.role === 'owner')).toHaveLength(1);
    expect(members.find((member) => member.user_id === next.user.id)?.role).toBe('owner');
    expect(members.find((member) => member.user_id === user.id)?.role).toBe('admin');

    const row = await harness.db.board.findUnique({ where: { id: created.id } });
    expect(row?.owner_id).toBe(next.user.id);

    const events = await harness.db.event.findMany({
      where: { board_id: created.id, type: 'member_updated' },
      orderBy: { created_at: 'asc' },
    });
    const transfer = events.filter((event) => {
      const payload = event.payload as { changes?: { owner_id?: unknown } };
      return payload.changes?.owner_id !== undefined;
    });
    expect(transfer).toHaveLength(1);
  });

  it('needs confirm:true and the owner role', async () => {
    const { c } = await ownerClient('transferguard');
    const other = await ownerClient('successor-two');
    const created = await board(c);
    await c.request('POST', `/api/v1/boards/${created.id}/members`, {
      username: other.username,
      role: 'admin',
    });

    expect(
      (await c.request('POST', `/api/v1/boards/${created.id}/transfer`, { user_id: other.user.id }))
        .statusCode,
    ).toBe(400);

    const admin = harness.client();
    const adminUser = await admin.signup(`admin-only-${admin.suffix}`);
    await harness.db.boardMember.create({
      data: {
        id: `bmb_${crypto.randomUUID().replaceAll('-', '').slice(0, 22)}`,
        board_id: created.id,
        user_id: adminUser.id,
        role: 'admin',
      },
    });
    expect(
      (
        await admin.request('POST', `/api/v1/boards/${created.id}/transfer`, {
          user_id: other.user.id,
          confirm: true,
        })
      ).statusCode,
    ).toBe(403);
  });
});
