// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K5-08 — account password change, session revocation and account deletion cascade
 * (docs/api.md §3, docs/security.md §9, D-16).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from './helpers/server.js';

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer();
});

afterAll(async () => {
  await harness.close();
});

describe('account management (K5-08)', () => {
  it('changes password, rotates the session and revokes other sessions', async () => {
    const primary = harness.client();
    const username = `acct-pw-${primary.suffix}`;
    await primary.signup(username);

    const secondary = harness.client();
    const secondLogin = await secondary.request('POST', '/api/v1/auth/login', {
      email_or_username: username,
      password: 'a-long-enough-password',
    });
    expect(secondLogin.statusCode).toBe(200);

    const wrong = await primary.request('POST', '/api/v1/me/password', {
      current_password: 'not-the-right-password',
      new_password: 'a-brand-new-strong-password',
    });
    expect(wrong.statusCode).toBe(401);

    const changed = await primary.request('POST', '/api/v1/me/password', {
      current_password: 'a-long-enough-password',
      new_password: 'a-brand-new-strong-password',
    });
    expect(changed.statusCode).toBe(204);

    // Current client received a rotated session cookie and stays authenticated.
    const stillIn = await primary.request('GET', '/api/v1/me');
    expect(stillIn.statusCode).toBe(200);

    // Other sessions were revoked by the privilege change (D-16).
    const kicked = await secondary.request('GET', '/api/v1/me');
    expect(kicked.statusCode).toBe(401);

    // Old password no longer works; new password does.
    const third = harness.client();
    const oldLogin = await third.request('POST', '/api/v1/auth/login', {
      email_or_username: username,
      password: 'a-long-enough-password',
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await third.request('POST', '/api/v1/auth/login', {
      email_or_username: username,
      password: 'a-brand-new-strong-password',
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('revoking the current session signs out immediately', async () => {
    const client = harness.client();
    await client.signup(`acct-sess-${client.suffix}`);

    const list = await client.request('GET', '/api/v1/me/sessions');
    expect(list.statusCode).toBe(200);
    const current = (list.json() as { items: { id: string; current: boolean }[] }).items.find(
      (item) => item.current,
    );
    expect(current).toBeDefined();

    const revoked = await client.request('DELETE', `/api/v1/me/sessions/${current?.id ?? ''}`);
    expect(revoked.statusCode).toBe(204);

    // Next call with the same session fails with 401 immediately.
    const after = await client.request('GET', '/api/v1/me');
    expect(after.statusCode).toBe(401);
  });

  it('deletes the account, removes memberships and anonymises authored comments', async () => {
    const host = harness.client();
    await host.signup(`acct-host-${host.suffix}`);
    const board = await host.request('POST', '/api/v1/boards', { name: 'Shared for cascade' });
    const boardId = (board.json() as { id: string }).id;
    const state = await host.request('GET', `/api/v1/boards/${boardId}/state`);
    const columnId = (state.json() as { columns: { id: string }[] }).columns[0]?.id ?? '';
    const card = await host.request('POST', `/api/v1/boards/${boardId}/cards`, {
      column: columnId,
      title: 'Card with comment',
    });
    const cardId = (card.json() as { id: string }).id;

    const departing = harness.client();
    const departingName = `acct-del-${departing.suffix}`;
    const created = await departing.signup(departingName);

    const invited = await host.request('POST', `/api/v1/boards/${boardId}/members`, {
      username: departingName,
      role: 'editor',
    });
    expect(invited.statusCode).toBe(201);

    const comment = await departing.request('POST', `/api/v1/cards/${cardId}/comments`, {
      body: 'Leaving a note before deleting my account.',
    });
    expect(comment.statusCode).toBe(201);
    const commentId = (comment.json() as { id: string }).id;

    // Missing confirm or wrong password is refused.
    const noConfirm = await departing.request('DELETE', '/api/v1/me', {
      password: 'a-long-enough-password',
      confirm: false,
    });
    expect(noConfirm.statusCode).toBe(400);

    const badPass = await departing.request('DELETE', '/api/v1/me', {
      password: 'wrong-password-attempt',
      confirm: true,
    });
    expect(badPass.statusCode).toBe(401);

    // Real delete succeeds with 204.
    const deleted = await departing.request('DELETE', '/api/v1/me', {
      password: 'a-long-enough-password',
      confirm: true,
    });
    expect(deleted.statusCode).toBe(204);

    // Session is dead immediately.
    expect((await departing.request('GET', '/api/v1/me')).statusCode).toBe(401);

    // Membership is removed.
    const members = await host.request('GET', `/api/v1/boards/${boardId}/members`);
    const ids = (members.json() as { items: { user_id: string }[] }).items.map((m) => m.user_id);
    expect(ids).not.toContain(created.id);

    // Authored comment survives, anonymised as "deleted user" (docs/security.md §9).
    const row = await harness.db.comment.findUnique({ where: { id: commentId } });
    expect(row).not.toBeNull();
    expect(row?.author_id).toBeNull();
    expect(row?.author_label).toBe('deleted user');
    expect(row?.body).toBe('Leaving a note before deleting my account.');
  });
});
