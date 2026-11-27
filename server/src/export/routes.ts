// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /boards/:id/export.json` and `/export.md` (docs/features/import-export.md
 * §1 and §3). Both are `board.export`, decided by `can()` like everything else,
 * so a viewer may export what it can already read and a link holder may not
 * take the board away in bulk. The document itself comes from `service.ts`.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor } from '../auth/request.js';
import { exportDocument } from './service.js';

export function registerExportRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };
  const rateLimit = context.env.KLUI_RATE_LIMIT === 'on';

  app.get('/api/v1/boards/:id/export.json', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const document = await exportDocument(database(), actor, id, 'json', { rateLimit });
    return reply
      .header('content-disposition', `attachment; filename="${document.filename}"`)
      .header('cache-control', 'no-store')
      .type(document.contentType)
      .send(document.body);
  });

  app.get('/api/v1/boards/:id/export.md', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const document = await exportDocument(database(), actor, id, 'md', { rateLimit });
    return reply
      .header('content-disposition', `attachment; filename="${document.filename}"`)
      .header('cache-control', 'no-store')
      .type(document.contentType)
      .send(document.body);
  });
}
