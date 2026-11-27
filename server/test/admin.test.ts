// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K1-06: instance bootstrap and settings.
 *
 * The bootstrap proof runs on its own empty schema: "the first account is the
 * admin" cannot be shown on a database where other tests already signed up.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db.js';
import { testEnv } from '../src/env.js';
import { ensureInstanceSettings } from '../src/auth/service.js';
import { TEST_SECRETS, startServer, TestClient } from './helpers/server.js';
import { setLegacyPolicy } from './helpers/legacy.js';

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.DATABASE_URL ?? 'postgresql://klui:klui@127.0.0.1:5432/klui_test';
const SCHEMA = `klui_bootstrap_${Date.now().toString(36)}`;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}schema=${SCHEMA}`;

type SignupBody = { id: string; is_instance_admin: boolean };

describe('the first account on an empty instance', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    await execFileAsync(
      'npx',
      ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      {
        cwd: new URL('..', import.meta.url).pathname,
        env: { ...process.env, DATABASE_URL: SCOPED_URL },
        timeout: 120_000,
      },
    );

    db = createDb(SCOPED_URL);
    const env = testEnv({ DATABASE_URL: SCOPED_URL });
    // The boot creates the row; the first request must not depend on a signup.
    await ensureInstanceSettings(db, env);
    const app = buildApp({ env, db, secrets: TEST_SECRETS });
    await app.ready();
    close = async () => {
      await app.close();
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      headers: { 'content-type': 'application/json' },
      payload: {
        email: 'first@bootstrap.test',
        username: 'first-admin',
        password: 'a-long-passphrase-9',
      },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      headers: { 'content-type': 'application/json' },
      payload: {
        email: 'second@bootstrap.test',
        username: 'second-user',
        password: 'a-long-passphrase-9',
      },
    });
    expect(second.statusCode).toBe(201);

    firstUser = first.json() as SignupBody;
    secondUser = second.json() as SignupBody;
  });

  let firstUser: SignupBody;
  let secondUser: SignupBody;

  afterAll(async () => {
    await close();
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await db.$disconnect();
  });

  it('makes the first signup the instance admin and the second one a normal account', () => {
    expect(firstUser.is_instance_admin).toBe(true);
    expect(secondUser.is_instance_admin).toBe(false);
  });

  it('created the settings row with the documented defaults', async () => {
    const settings = await db.instanceSettings.findUnique({ where: { id: 1 } });
    expect(settings).not.toBeNull();
    expect(settings?.totp_policy).toBe('available');
    expect(settings?.registration_open).toBe(true);
  });
});

describe('registration and administration', () => {
  let harness: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    harness = await startServer();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('refuses a signup with 403 registration_closed when the instance says so', async () => {
    await harness.db.instanceSettings.update({
      where: { id: 1 },
      data: { registration_open: false },
    });
    try {
      const client = harness.client();
      const response = await client.request('POST', '/api/v1/auth/signup', {
        email: 'late@example.com',
        username: `late-${client.suffix}`,
        password: 'a-long-enough-password',
      });
      expect(response.statusCode).toBe(403);
      expect((response.json() as { error: { code: string } }).error.code).toBe(
        'registration_closed',
      );
    } finally {
      await harness.db.instanceSettings.update({
        where: { id: 1 },
        data: { registration_open: true },
      });
    }
  });

  it('lists accounts for an admin only, and a ban blocks the next request and the next login', async () => {
    const admin = harness.client();
    const adminUser = await admin.signup(`ops-${admin.suffix}`);
    await harness.db.user.update({
      where: { id: adminUser.id },
      data: { is_instance_admin: true },
    });

    const member = harness.client();
    const target = await member.signup(`member-${member.suffix}`);

    const asMember = await member.request('GET', '/api/v1/admin/users');
    expect(asMember.statusCode).toBe(403);

    // Search, not page one: the listing is ordered by creation date and a full
    // test run creates far more accounts than one page holds (K2 CI red).
    const listed = await admin.request(
      'GET',
      `/api/v1/admin/users?q=${encodeURIComponent(`member-${member.suffix}`)}`,
    );
    expect(listed.statusCode).toBe(200);
    const page = listed.json() as { items: { id: string; banned: boolean }[] };
    expect(page.items.some((item) => item.id === target.id)).toBe(true);

    const banned = await admin.request('POST', `/api/v1/admin/users/${target.id}/ban`, {
      confirm: true,
      reason: 'test',
    });
    expect(banned.statusCode).toBe(201);

    // A ban revokes every session, so the next request is a stranger: 401, not a
    // 403 that would tell the caller the account exists. The `banned` code
    // surfaces where a credential is presented again, at login.
    const afterBan = await member.request('GET', '/api/v1/me');
    expect(afterBan.statusCode).toBe(401);
    expect((afterBan.json() as { error: { code: string } }).error.code).toBe('unauthenticated');

    const login = await new TestClient(harness.app, harness.db).request(
      'POST',
      '/api/v1/auth/login',
      { email_or_username: target.username, password: 'a-long-enough-password' },
    );
    expect(login.statusCode).toBe(403);

    const listedAfter = await admin.request(
      'GET',
      `/api/v1/admin/users?q=${encodeURIComponent(`member-${member.suffix}`)}`,
    );
    const bannedRow = (
      listedAfter.json() as { items: { id: string; banned: boolean }[] }
    ).items.find((item) => item.id === target.id);
    expect(bannedRow?.banned).toBe(true);

    const unbanned = await admin.request('DELETE', `/api/v1/admin/users/${target.id}/ban`);
    expect(unbanned.statusCode).toBe(204);
  });

  it('bans an address, shows it in the admin view, and blocks the next join with no restart', async () => {
    const admin = harness.client();
    const adminUser = await admin.signup(`ops3-${admin.suffix}`);
    await harness.db.user.update({
      where: { id: adminUser.id },
      data: { is_instance_admin: true },
    });

    const owner = harness.client();
    await owner.signup(`owner-${owner.suffix}`);
    const created = await owner.request('POST', '/api/v1/boards', {
      name: 'Address ban',
      visibility: 'link',
    });
    const boardId = (created.json() as { id: string }).id;
    await owner.request('PATCH', `/api/v1/boards/${boardId}`, { link_role: 'read' });
    // A legacy row: the join gate still reads the column, the write it could
    // once have allowed is refused.
    await setLegacyPolicy(harness.db, boardId, { anonWrite: 'open' });

    const join = async (): Promise<{ statusCode: number; body: string }> => {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/boards/${boardId}/anon`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ label: 'Flooder' }),
      });
      return { statusCode: response.statusCode, body: response.body };
    };

    expect((await join()).statusCode).toBe(200);

    const banned = await admin.request('POST', '/api/v1/admin/bans/ip', {
      ip: '127.0.0.1',
      confirm: true,
      reason: 'flooding the demo board',
    });
    expect(banned.statusCode).toBe(201);

    const listed = await admin.request('GET', '/api/v1/admin/bans');
    expect(listed.statusCode).toBe(200);
    const rows = (listed.json() as { items: { subject: string; subject_kind: string }[] }).items;
    expect(rows.some((row) => row.subject === '127.0.0.1' && row.subject_kind === 'ip')).toBe(true);

    const blocked = await join();
    expect(blocked.statusCode).toBe(403);
    expect((JSON.parse(blocked.body) as { error: { code: string } }).error.code).toBe('banned');

    // A member signed in from the same address is untouched: the address ban is
    // for anonymous actors, not a network-wide lockout.
    expect((await owner.request('GET', '/api/v1/me')).statusCode).toBe(200);

    const lifted = await admin.request('DELETE', '/api/v1/admin/bans/ip/127.0.0.1');
    expect(lifted.statusCode).toBe(204);
    expect((await join()).statusCode).toBe(200);
  });

  it('refuses a malformed address and a ban by a non-admin', async () => {
    const member = harness.client();
    await member.signup(`plain-${member.suffix}`);
    const nonAdmin = await member.request('POST', '/api/v1/admin/bans/ip', {
      ip: '198.51.100.4',
      confirm: true,
    });
    expect(nonAdmin.statusCode).toBe(403);

    const admin = harness.client();
    const adminUser = await admin.signup(`ops4-${admin.suffix}`);
    await harness.db.user.update({
      where: { id: adminUser.id },
      data: { is_instance_admin: true },
    });
    const malformed = await admin.request('POST', '/api/v1/admin/bans/ip', {
      ip: 'not-an-address',
      confirm: true,
    });
    expect(malformed.statusCode).toBe(400);
  });

  it('refuses to ban an instance admin', async () => {
    const admin = harness.client();
    const adminUser = await admin.signup(`ops2-${admin.suffix}`);
    await harness.db.user.update({
      where: { id: adminUser.id },
      data: { is_instance_admin: true },
    });

    const response = await admin.request('POST', `/api/v1/admin/users/${adminUser.id}/ban`, {
      confirm: true,
    });
    expect(response.statusCode).toBe(403);
  });
});
