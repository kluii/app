// SPDX-License-Identifier: AGPL-3.0-only
import { buildApp } from '../../src/app.js';
import { testEnv, type Env } from '../../src/env.js';
import type { Db } from '../../src/db.js';

export const TEST_SECRETS = {
  sessionSecret: 'test-session-secret-that-is-long-enough',
  tokenPepper: 'test-token-pepper-value',
  encryptionKey: Buffer.alloc(32, 7),
};

export function makeApp(options: { env?: Partial<Env>; db?: Db | null } = {}) {
  return buildApp({
    env: testEnv(options.env),
    db: options.db ?? null,
    secrets: TEST_SECRETS,
  });
}
