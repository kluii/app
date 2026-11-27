// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Activity is a projection of `events` (D-23): newest first, cursor paginated,
 * never a count(*) and never an offset. The reader lives in `service.ts` so
 * `/mcp` `get_activity` and this route answer the same page.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor } from '../auth/request.js';
import { listActivity } from './service.js';

export { encodeCursor, decodeCursor, toEventDto } from './service.js';

export function registerActivityRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  app.get('/api/v1/boards/:id/activity', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const query = request.query as {
      limit?: string;
      cursor?: string;
      actor_kind?: string;
      type?: string;
    };
    return listActivity(database(), actor, id, {
      limit: Number(query.limit ?? 50),
      cursor: query.cursor,
      actorKind: query.actor_kind,
      type: query.type,
    });
  });
}
