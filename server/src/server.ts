// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Boot order is fixed (docs/architecture.md §1): env validation → secrets
 * resolution (fail closed) → Prisma connect → plugin registration → listen.
 * Any failure exits non-zero with ONE actionable message.
 *
 * The `.env` file is loaded here, explicitly, BEFORE validation, and the Prisma
 * client is imported only afterwards. Prisma also loads a `.env` next to the
 * schema at import time; importing it first would let a value the validator
 * never saw reach the process — a fail-closed gate that does not gate.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, type Env } from './env.js';
import { resolveSecrets, type Secrets } from './lib/secrets.js';

const SHUTDOWN_TIMEOUT_MS = 15_000;

for (const candidate of ['.env', '../.env', 'server/.env']) {
  const path = resolve(process.cwd(), candidate);
  if (existsSync(path) && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(path);
    } catch {
      // A malformed .env must not be silently ignored: validation reports the
      // variable it could not read on the next step.
    }
  }
}

const envResult = loadEnv(process.env);
if (!envResult.ok) {
  process.stderr.write(`${envResult.message}\n`);
  process.exit(1);
}
const env: Env = envResult.env;

const secretsResult = resolveSecrets(env);
if (!secretsResult.ok) {
  process.stderr.write(`${secretsResult.message}\n`);
  process.exit(1);
}
const secrets: Secrets = secretsResult.secrets;
if (secretsResult.generated.length > 0 && env.KLUI_ENV !== 'test') {
  process.stderr.write(
    `klui: generated ${secretsResult.generated.length} secret(s) into ${env.KLUI_SECRETS_DIR}: ${secretsResult.generated.join(', ')}\n`,
  );
}

// Only now may anything import the Prisma client.
const [{ buildApp }, { createDb }, { createMailer }] = await Promise.all([
  import('./app.js'),
  import('./db.js'),
  import('./lib/mail.js'),
]);
const mail = createMailer(env);
if (!mail && env.KLUI_ENV !== 'test') {
  process.stderr.write(
    'klui: SMTP is not configured; POST /api/v1/auth/reset/request will answer 503 email_not_configured.\n',
  );
}

const db = createDb(env.DATABASE_URL);
try {
  await db.$connect();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `Klui cannot start: the database is unreachable.\n\n  DATABASE_URL\n    expected  postgresql://user:pass@host:5432/db\n    problem   ${detail}\n\nIs the database running, and are the migrations applied (prisma migrate deploy)?\n`,
  );
  process.exit(1);
}

const app = buildApp({ env, db, secrets, mail });
await app.listen({ port: env.KLUI_PORT, host: '0.0.0.0' });
app.log.info({ port: env.KLUI_PORT, env: env.KLUI_ENV }, 'klui listening');

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  const timer = setTimeout(() => {
    app.log.error('shutdown timed out, exiting hard');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();
  try {
    await app.close();
    await db.$disconnect();
    clearTimeout(timer);
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'shutdown failed');
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
