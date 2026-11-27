// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The boot gate (K0-06, docs/testing.md §8).
 *
 * Seeds a database with rows in every table, replays the migrations on it,
 * boots the server against it, and requires identical row counts. This is the
 * only test that proves a deploy will not destroy data.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db.js';
import { testEnv } from '../src/env.js';
import { readVersion } from '../src/lib/version.js';

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.DATABASE_URL ?? 'postgresql://klui:klui@127.0.0.1:5432/klui_test';
const SCHEMA = `klui_boot_${Date.now().toString(36)}`;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}schema=${SCHEMA}`;

const TABLES = [
  'users',
  'sessions',
  'totp_secrets',
  'recovery_codes',
  'oauth_accounts',
  'instance_settings',
  'username_reservations',
  'boards',
  'board_slug_reservations',
  'board_members',
  'board_links',
  'board_tag_colors',
  'columns',
  'cards',
  'card_tags',
  'comments',
  'events',
  'pending_cards',
  'agent_keys',
  'digest_prefs',
  'notifications',
  'bans',
  'jobs',
];

let db: Db;

async function migrate(): Promise<string> {
  const { stdout } = await execFileAsync(
    'npx',
    ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
    {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, DATABASE_URL: SCOPED_URL },
      timeout: 120_000,
    },
  );
  return stdout;
}

async function counts(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of TABLES) {
    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "${SCHEMA}"."${table}"`,
    );
    result[table] = Number(rows[0]?.count ?? 0);
  }
  return result;
}

async function seed(): Promise<void> {
  const q = (sql: string) => db.$executeRawUnsafe(sql);
  await q(`
    INSERT INTO "${SCHEMA}".users (id, email, username, password_hash, is_instance_admin)
    VALUES ('usr_bootgate000000000001', 'one@example.com', 'one', 'hash', true),
           ('usr_bootgate000000000002', 'two@example.com', 'two', 'hash', false);
  `);
  await q(`
    INSERT INTO "${SCHEMA}".sessions (id, token_hash, user_id, expires_at)
    VALUES ('ses_bootgate000000000001', 'hash-a', 'usr_bootgate000000000001', now() + interval '30 days');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".totp_secrets (user_id, secret_enc, confirmed_at)
    VALUES ('usr_bootgate000000000001', 'enc', now());
  `);
  await q(`
    INSERT INTO "${SCHEMA}".recovery_codes (id, user_id, code_hash)
    VALUES ('rcv_bootgate000000000001', 'usr_bootgate000000000001', 'code-hash');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".oauth_accounts (id, user_id, provider, provider_account_id)
    VALUES ('oau_bootgate000000000001', 'usr_bootgate000000000001', 'github', 'gh-1');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".instance_settings (id, instance_name)
    VALUES (1, 'Klui');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".boards (id, owner_id, name, slug, visibility, link_role, anon_write, link_suffix)
    VALUES ('brd_bootgate000000000001', 'usr_bootgate000000000001', 'Retro S2', 'retro-s2', 'link', 'read', 'open', 'k3f9');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".username_reservations (username, user_id, redirect_to_user_id, reserved_until)
    VALUES ('old-name', 'usr_bootgate000000000001', 'usr_bootgate000000000001', now() + interval '90 days');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".board_slug_reservations (id, board_id, slug, redirect_slug, reserved_until)
    VALUES ('bsr_bootgate000000000001', 'brd_bootgate000000000001', 'old-slug', 'retro-s2', now() + interval '90 days');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".board_members (id, board_id, user_id, role)
    VALUES ('bmb_bootgate000000000001', 'brd_bootgate000000000001', 'usr_bootgate000000000001', 'owner'),
           ('bmb_bootgate000000000002', 'brd_bootgate000000000001', 'usr_bootgate000000000002', 'editor');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".board_links (id, board_id, token_hash, role, label)
    VALUES ('lnk_bootgate000000000001', 'brd_bootgate000000000001', 'link-hash', 'edit', 'friday');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".board_tag_colors (id, board_id, tag, color)
    VALUES ('btc_bootgate000000000001', 'brd_bootgate000000000001', 'api', '#8B5CF6');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".columns (id, board_id, name, position)
    VALUES ('col_bootgate000000000001', 'brd_bootgate000000000001', 'To Do', 1024),
           ('col_bootgate000000000002', 'brd_bootgate000000000001', 'Doing', 2048);
  `);
  await q(`
    INSERT INTO "${SCHEMA}".cards (id, board_id, column_id, title, position, done)
    VALUES ('crd_bootgate000000000001', 'brd_bootgate000000000001', 'col_bootgate000000000001', 'Wire the digest', 1024, false),
           ('crd_bootgate000000000002', 'brd_bootgate000000000001', 'col_bootgate000000000001', 'Ship export', 2048, true);
  `);
  await q(`
    INSERT INTO "${SCHEMA}".card_tags (card_id, name, color)
    VALUES ('crd_bootgate000000000001', 'api', '#8B5CF6');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".comments (id, board_id, card_id, author_id, body)
    VALUES ('cmt_bootgate000000000001', 'brd_bootgate000000000001', 'crd_bootgate000000000001', 'usr_bootgate000000000001', 'Looks right.');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".events (id, board_id, type, actor_kind, actor_user_id, payload)
    VALUES ('evt_bootgate000000000001', 'brd_bootgate000000000001', 'card_created', 'user', 'usr_bootgate000000000001', '{"card_id":"crd_bootgate000000000001"}')
  `);
  await q(`
    INSERT INTO "${SCHEMA}".pending_cards (id, board_id, column_id, title, actor_label, anon_actor_id, expires_at)
    VALUES ('pnd_bootgate000000000001', 'brd_bootgate000000000001', 'col_bootgate000000000001', 'From a stranger', 'Sam', 'anon-1', now() + interval '7 days');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".agent_keys (id, user_id, board_id, name, key_hash, scope, expires_at)
    VALUES ('key_bootgate000000000001', 'usr_bootgate000000000001', 'brd_bootgate000000000001', 'backlog-bot', 'key-hash', 'board', now() + interval '90 days');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".digest_prefs (user_id, enabled, hour, timezone)
    VALUES ('usr_bootgate000000000001', true, 8, 'Europe/Paris');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".notifications (id, user_id, kind, event_id, payload)
    VALUES ('not_bootgate000000000001', 'usr_bootgate000000000001', 'assignment', 'evt_bootgate000000000001', '{}');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".bans (id, subject, subject_kind, reason)
    VALUES ('ban_bootgate000000000001', '203.0.113.9', 'ip', 'flood');
  `);
  await q(`
    INSERT INTO "${SCHEMA}".jobs (id, board_id, kind, status, source_hash)
    VALUES ('job_bootgate000000000001', 'brd_bootgate000000000001', 'import', 'done', 'source-hash');
  `);
}

beforeAll(async () => {
  db = createDb(SCOPED_URL);
  const first = await migrate();
  expect(first).toContain('migrations');
  await seed();
});

afterAll(async () => {
  try {
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  } finally {
    await db.$disconnect();
  }
});

describe('boot gate', () => {
  it('replays migrations on a populated database without losing a row', async () => {
    const before = await counts();
    for (const table of TABLES) {
      expect(before[table], `seed wrote nothing into ${table}`).toBeGreaterThan(0);
    }

    const second = await migrate();
    expect(second).toContain('No pending migrations');

    const after = await counts();
    expect(after).toEqual(before);

    const card = await db.$queryRawUnsafe<{ title: string }[]>(
      `SELECT title FROM "${SCHEMA}"."cards" WHERE id = 'crd_bootgate000000000001'`,
    );
    expect(card[0]?.title).toBe('Wire the digest');
  });

  it('boots the server against the migrated database and reports db up', async () => {
    const app = buildApp({
      env: testEnv({ DATABASE_URL: SCOPED_URL }),
      db,
      secrets: {
        sessionSecret: 'test-session-secret-that-is-long-enough',
        tokenPepper: 'test-token-pepper-value',
        encryptionKey: Buffer.alloc(32, 3),
      },
    });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const response = await fetch(`${address}/healthz`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string; db: string; version: string };
      expect(body).toEqual({ status: 'ok', version: readVersion(), db: 'up' });
    } finally {
      await app.close();
    }
  });
});
