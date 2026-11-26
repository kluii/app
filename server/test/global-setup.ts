// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process';
import { testDatabaseUrl } from './helpers/db.js';

/**
 * One schema for the suite, reset once per run. `fileParallelism: false` already
 * serialises the files; this keeps a previous failed run from poisoning the next.
 */
export default function setup(): void {
  execFileSync(
    'npx',
    [
      'prisma',
      'db',
      'push',
      '--force-reset',
      '--skip-generate',
      '--schema',
      'prisma/schema.prisma',
    ],
    {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
      stdio: 'pipe',
    },
  );
}
