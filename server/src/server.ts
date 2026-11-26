// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Boot order is fixed (docs/architecture.md §1): env validation → secrets
 * resolution (fail closed) → Prisma connect → plugin registration → listen.
 * Any failure exits non-zero with ONE actionable message.
 */
import { buildApp } from './app.js';
import { createDb, type Db } from './db.js';
import { loadEnv, type Env } from './env.js';
import { resolveSecrets, type Secrets } from './lib/secrets.js';

const SHUTDOWN_TIMEOUT_MS = 15_000;

type Booted = {
  app: ReturnType<typeof buildApp>;
  db: Db;
  env: Env;
  secrets: Secrets;
};

export async function boot(source: NodeJS.ProcessEnv = process.env): Promise<Booted> {
  const envResult = loadEnv(source);
  if (!envResult.ok) {
    process.stderr.write(`${envResult.message}\n`);
    process.exit(1);
  }
  const env = envResult.env;

  const secretsResult = resolveSecrets(env);
  if (!secretsResult.ok) {
    process.stderr.write(`${secretsResult.message}\n`);
    process.exit(1);
  }
  const secrets = secretsResult.secrets;
  if (secretsResult.generated.length > 0 && env.KLUI_ENV !== 'test') {
    process.stderr.write(
      `klui: generated ${secretsResult.generated.length} secret(s) into ${env.KLUI_SECRETS_DIR}: ${secretsResult.generated.join(', ')}\n`,
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

  const app = buildApp({ env, db, secrets });
  return { app, db, env, secrets };
}

async function main(): Promise<void> {
  const { app, db, env } = await boot();

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
}

await main();
