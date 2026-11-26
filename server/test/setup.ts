// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from 'node:fs';

/**
 * Loads server/.env for local runs; CI provides the same variables through the
 * environment. Nothing in a test may depend on a developer's shell.
 */
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // a malformed .env must not break the suite silently: the failing test will say why
  }
}
