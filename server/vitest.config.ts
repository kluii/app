// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vitest/config';

/**
 * One Postgres, one process: files run serially (D-51). A shared database
 * across parallel files produces random false reds and teaches everyone to
 * ignore CI. Per-file schemas can lift this later.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    isolate: true,
    setupFiles: ['test/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
