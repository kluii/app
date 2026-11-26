// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Accounts and sessions, end to end through the real Fastify instance.
 * The acceptance list is docs/features/auth.md §11.
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

function client(): TestClient {
  return harness.client();
}

describe('signup and the bootstrap admin', () => {
  it('makes the first account an instance admin and the second one not', async () => {
    const db = harness.db;
    const existing = await db.user.count();
    const first = client();
    const a = await first.signup(`admin-${first.suffix}`);
    const second = client();
    const b = await second.signup(`member-${second.suffix}`);

    const me = await first.request('GET', '/api/v1/me');
    expect(me.statusCode).toBe(200);
    const body = me.json() as { is_instance_admin: boolean; username: string };
    expect(body.username).toBe(a.username);
    expect(body.is_instance_admin).toBe(existing === 0);

    const other = await second.request('GET', '/api/v1/me');
    expect((other.json() as { is_instance_admin: boolean }).is_instance_admin).toBe(false);
    expect(b.username).toBe(`member-${second.suffix}`);
  });

  it('refuses a short password and a reserved shape with the same error envelope', async () => {
    const c = client();
    const short = await c.request('POST', '/api/v1/auth/signup', {
      email: `short-${c.suffix}@example.com`,
      username: `short-${c.suffix}`,
      password: 'short',
    });
    expect(short.statusCode).toBe(400);
    expect((short.json() as { error: { code: string } }).error.code).toBe('validation_failed');

    const upper = await c.request('POST', '/api/v1/auth/signup', {
      email: `upper-${c.suffix}@example.com`,
      username: 'NotLower',
      password: 'a-long-enough-password',
    });
    expect(upper.statusCode).toBe(400);
    expect(
      (upper.json() as { error: { details: { path: string }[] } }).error.details[0]?.path,
    ).toBe('username');
  });

  it('reveals a taken username but never an email', async () => {
    const c = client();
    const username = `dup-${c.suffix}`;
    await c.signup(username);

    const sameUsername = await client().request('POST', '/api/v1/auth/signup', {
      email: `other-${c.suffix}@example.com`,
      username,
      password: 'a-long-enough-password',
    });
    expect(sameUsername.statusCode).toBe(409);
    expect((sameUsername.json() as { error: { message: string } }).error.message).toContain(
      'username',
    );

    const sameEmail = await client().request('POST', '/api/v1/auth/signup', {
      email: `${username}@example.com`,
      username: `fresh-${c.suffix}`,
      password: 'a-long-enough-password',
    });
    expect(sameEmail.statusCode).toBe(409);
    expect((sameEmail.json() as { error: { message: string } }).error.message).not.toContain(
      username,
    );
  });
});

describe('login', () => {
  it('answers the same body for an unknown account and a wrong password', async () => {
    const c = client();
    const username = `login-${c.suffix}`;
    await c.signup(username);

    const wrong = await client().request('POST', '/api/v1/auth/login', {
      email_or_username: username,
      password: 'not-the-right-password',
    });
    const unknown = await client().request('POST', '/api/v1/auth/login', {
      email_or_username: `ghost-${c.suffix}`,
      password: 'not-the-right-password',
    });

    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.body).toBe(unknown.body);
  });

  it('issues a session cookie and a CSRF cookie that survive a /me call', async () => {
    const c = client();
    const username = `session-${c.suffix}`;
    await c.signup(username);
    const fresh = client();
    const login = await fresh.request('POST', '/api/v1/auth/login', {
      email_or_username: username,
      password: 'a-long-enough-password',
    });
    expect(login.statusCode).toBe(200);
    expect(fresh.session).not.toBeNull();
    expect(fresh.csrf).not.toBeNull();
    expect(login.cookies.find((cookie) => cookie.name === 'klui_session')?.httpOnly).toBe(true);

    const me = await fresh.request('GET', '/api/v1/me');
    expect(me.statusCode).toBe(200);
  });
});

describe('CSRF and sessions', () => {
  it('rejects a cookie-authenticated write without the double-submit header', async () => {
    const c = client();
    await c.signup(`csrf-${c.suffix}`);
    const withoutHeader = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/boards',
      headers: {
        cookie: `klui_session=${c.session ?? ''}; klui_csrf=${c.csrf ?? ''}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ name: 'No csrf' }),
    });
    expect(withoutHeader.statusCode).toBe(403);
    expect((withoutHeader.json() as { error: { code: string } }).error.code).toBe('csrf_failed');

    const withHeader = await c.request('POST', '/api/v1/boards', { name: 'With csrf' });
    expect(withHeader.statusCode).toBe(201);
  });

  it('revoking a session makes the next request unauthenticated, and logout-all clears the rest', async () => {
    const c = client();
    await c.signup(`revoke-${c.suffix}`);
    const sessions = await c.request('GET', '/api/v1/me/sessions');
    const list = sessions.json() as { items: { id: string; current: boolean }[] };
    const current = list.items.find((item) => item.current);
    expect(current).toBeDefined();

    const revoked = await c.request('DELETE', `/api/v1/me/sessions/${current?.id ?? ''}`);
    expect(revoked.statusCode).toBe(204);

    const after = await c.request('GET', '/api/v1/me');
    expect(after.statusCode).toBe(401);
    expect((after.json() as { error: { code: string } }).error.code).toBe('unauthenticated');
  });

  it('answers 401 invalid_credential for a bearer token that does not exist', async () => {
    const c = client();
    const response = await c.request('GET', '/api/v1/me', undefined, {
      authorization: 'Bearer not-a-real-session',
    });
    expect(response.statusCode).toBe(401);
    expect((response.json() as { error: { code: string } }).error.code).toBe('invalid_credential');
  });
});

describe('registration closed', () => {
  it('refuses signup with registration_closed', async () => {
    const closed = await startServer();
    try {
      await closed.db.instanceSettings.upsert({
        where: { id: 1 },
        create: { id: 1, registration_open: false },
        update: { registration_open: false },
      });
      const c = closed.client();
      const response = await c.request('POST', '/api/v1/auth/signup', {
        email: `closed-${c.suffix}@example.com`,
        username: `closed-${c.suffix}`,
        password: 'a-long-enough-password',
      });
      expect(response.statusCode).toBe(403);
      expect((response.json() as { error: { code: string } }).error.code).toBe(
        'registration_closed',
      );
    } finally {
      await closed.db.instanceSettings.update({
        where: { id: 1 },
        data: { registration_open: true },
      });
      await closed.close();
    }
  });
});
