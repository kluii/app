// SPDX-License-Identifier: AGPL-3.0-only
/**
 * /healthz — the only unauthenticated operational surface (D-42).
 * `{"status":"ok","version":"…","db":"up"}` or 503 with `db:"down"`.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { pingDb } from '../db.js';
import { readVersion } from '../lib/version.js';

export type HealthPayload = {
  status: 'ok' | 'error';
  version: string;
  db: 'up' | 'down';
};

export function registerHealth(app: FastifyInstance, db: Db | null): void {
  app.get('/healthz', async (_request, reply) => {
    const dbUp = db ? await pingDb(db) : false;
    const payload: HealthPayload = {
      status: dbUp ? 'ok' : 'error',
      version: readVersion(),
      db: dbUp ? 'up' : 'down',
    };
    reply.header('cache-control', 'no-store');
    return reply.code(dbUp ? 200 : 503).send(payload);
  });
}
