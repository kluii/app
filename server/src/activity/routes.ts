// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Activity is a projection of `events` (D-23): newest first, cursor paginated,
 * never a count(*) and never an offset.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor } from '../auth/request.js';
import { assertAllowed, loadBoardFor } from '../boards/service.js';
import { toEnumName, type EventTypeName } from '../lib/events.js';
import type { EventDto } from '../contracts/dto.js';

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [timestamp, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!timestamp || !id) return null;
    const createdAt = new Date(timestamp);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

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
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'board.read');
    assertAllowed(loaded.decision);

    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 100);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const types = query.type
      ? query.type.split(',').map((value) => toEnumName(value as EventTypeName))
      : null;

    const rows = await db.event.findMany({
      where: {
        board_id: id,
        ...(query.actor_kind ? { actor_kind: query.actor_kind as never } : {}),
        ...(types ? { type: { in: types as never[] } } : {}),
        ...(cursor
          ? {
              OR: [
                { created_at: { lt: cursor.createdAt } },
                { created_at: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toEventDto),
      next_cursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  });
}

export function toEventDto(row: {
  id: string;
  type: string;
  actor_kind: string;
  actor_label: string | null;
  payload: unknown;
  created_at: Date;
}): EventDto {
  return {
    id: row.id,
    type: row.type.replaceAll('_', '.'),
    actor_kind: row.actor_kind as EventDto['actor_kind'],
    actor_label: row.actor_label,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    created_at: row.created_at.toISOString(),
  };
}
