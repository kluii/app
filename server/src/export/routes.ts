// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /boards/:id/export.json` and `/export.md` (docs/features/import-export.md
 * §1 and §3). Both are `board.export`, decided by `can()` like everything else,
 * so a viewer may export what it can already read and a link holder may not
 * take the board away in bulk.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { requireActor } from '../auth/request.js';
import { assertAllowed, loadBoardFor } from '../boards/service.js';
import { AppError } from '../lib/errors.js';
import { credentialLimiter, EXPORT_PER_BOARD, exportKey } from '../lib/ratelimit.js';
import {
  exportFileName,
  loadBoardSnapshot,
  serializeExportV2,
  toExportV2,
  toMarkdown,
} from './v2.js';

export function registerExportRoutes(app: FastifyInstance, context: AppContext): void {
  const database = () => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  /** 10 exports an hour per board (docs/api.md §1), counted in memory. */
  const spendExport = (boardId: string): void => {
    if (context.env.KLUI_RATE_LIMIT !== 'on') return;
    const result = credentialLimiter.take(exportKey(boardId), EXPORT_PER_BOARD);
    if (result.allowed) return;
    throw new AppError('rate_limited', {
      message: 'Too many exports for this board.',
      hint: `Try again in ${result.retryAfter} seconds.`,
    });
  };

  app.get('/api/v1/boards/:id/export.json', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'board.export');
    assertAllowed(loaded.decision);
    spendExport(id);

    const snapshot = await loadBoardSnapshot(db, id);
    const body = serializeExportV2(toExportV2(snapshot, new Date()));
    return reply
      .header(
        'content-disposition',
        `attachment; filename="${exportFileName(snapshot.board.name, 'json')}"`,
      )
      .header('cache-control', 'no-store')
      .type('application/json; charset=utf-8')
      .send(body);
  });

  app.get('/api/v1/boards/:id/export.md', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'board.export');
    assertAllowed(loaded.decision);
    spendExport(id);

    const snapshot = await loadBoardSnapshot(db, id);
    return reply
      .header(
        'content-disposition',
        `attachment; filename="${exportFileName(snapshot.board.name, 'md')}"`,
      )
      .header('cache-control', 'no-store')
      .type('text/markdown; charset=utf-8')
      .send(toMarkdown(snapshot));
  });
}
