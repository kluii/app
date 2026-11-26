// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Resets the e2e schema before a Playwright run. The database is separate from
 * the dev one on purpose (docs/testing.md §2): a seeded board the sweeper purges
 * mid-run looks like a routing bug.
 */
import { execFileSync } from 'node:child_process';

const base = process.env.DATABASE_URL ?? 'postgresql://klui:klui@127.0.0.1:5432/klui_test';
const url = `${base}${base.includes('?') ? '&' : '?'}schema=e2e`;

execFileSync(
  'npx',
  ['prisma', 'db', 'push', '--force-reset', '--skip-generate', '--schema', 'prisma/schema.prisma'],
  {
    cwd: new URL('../server', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  },
);
