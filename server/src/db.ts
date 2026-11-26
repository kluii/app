// SPDX-License-Identifier: AGPL-3.0-only
import { PrismaClient } from '@prisma/client';

export type Db = PrismaClient;

/**
 * One client per process. The connection URL comes from validated env, never
 * from a module-level literal, so a test can point at its own schema.
 */
export function createDb(databaseUrl: string, logQueries = false): Db {
  return new PrismaClient({
    datasourceUrl: databaseUrl,
    log: logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

export async function pingDb(db: Db): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
