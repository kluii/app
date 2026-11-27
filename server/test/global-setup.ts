// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process';
import { TEST_SCHEMA, testBaseUrl, testDatabaseUrl } from './helpers/db.js';

/**
 * One schema for the suite, reset once per run, built by **replaying the
 * migrations** rather than by `db push`.
 *
 * `db push` only knows what `schema.prisma` can express, so a constraint written
 * in raw SQL (for example `boards_private_has_no_share_policy`) existed in
 * production and not in the suite — the test that asserts it could never pass
 * and the boot path was never exercised by the unit tests.
 *
 * `fileParallelism: false` already serialises the files; dropping the schema
 * first keeps a previous failed run from poisoning the next.
 */
export default function setup(): void {
  const cwd = new URL('..', import.meta.url).pathname;

  execFileSync('npx', ['prisma', 'db', 'execute', '--url', testBaseUrl(), '--stdin'], {
    cwd,
    input: `DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE;`,
    stdio: 'pipe',
  });

  execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
  });
}
