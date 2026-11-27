// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one export path (docs/features/import-export.md §1 and §3).
 *
 * `GET /boards/:id/export.json|.md` and the `export_board` tool both call
 * `exportDocument`, so the bytes an agent receives are the bytes a browser
 * downloads: same serialiser, same ordering, same `exported_at` format. A test
 * compares the two strings, because "the same content" that differs by a
 * newline is a bug nobody notices until a diff.
 */
import type { Db } from '../db.js';
import type { Actor } from '../lib/authz.js';
import { AppError } from '../lib/errors.js';
import { credentialLimiter, EXPORT_PER_BOARD, exportKey } from '../lib/ratelimit.js';
import { assertAllowed, loadBoardFor } from '../boards/service.js';
import { exportFileName, loadBoardSnapshot, serializeExportV2, toExportV2, toMarkdown } from './v2.js';

export type ExportFormat = 'json' | 'md';

export type ExportDocument = {
  filename: string;
  contentType: string;
  body: string;
};

/** 10 exports an hour per board (docs/api.md §1), counted in memory. */
export function spendExport(boardId: string, enabled: boolean): void {
  if (!enabled) return;
  const result = credentialLimiter.take(exportKey(boardId), EXPORT_PER_BOARD);
  if (result.allowed) return;
  throw new AppError('rate_limited', {
    message: 'Too many exports for this board.',
    hint: `Try again in ${result.retryAfter} seconds.`,
  });
}

export async function exportDocument(
  db: Db,
  actor: Actor,
  boardId: string,
  format: ExportFormat,
  options: { rateLimit: boolean },
): Promise<ExportDocument> {
  const loaded = await loadBoardFor(db, actor, boardId, 'board.export');
  assertAllowed(loaded.decision);
  spendExport(boardId, options.rateLimit);

  const snapshot = await loadBoardSnapshot(db, boardId);
  if (format === 'json') {
    return {
      filename: exportFileName(snapshot.board.name, 'json'),
      contentType: 'application/json; charset=utf-8',
      body: serializeExportV2(toExportV2(snapshot, new Date())),
    };
  }
  return {
    filename: exportFileName(snapshot.board.name, 'md'),
    contentType: 'text/markdown; charset=utf-8',
    body: toMarkdown(snapshot),
  };
}
