// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/v1/stream` — one SSE connection per session (D-29,
 * docs/features/realtime.md §1).
 *
 * A board the actor cannot read is silently dropped from the subscription: an
 * error would confirm the board exists. Replay is best-effort; a reconnect
 * always refetches state, and an id older than the ring buffer answers `resync`
 * instead of guessing.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor } from '../auth/request.js';
import { assertAllowed, loadBoardFor } from '../boards/service.js';
import type { Hub, HubEvent, Subscriber } from './events.js';

const HEARTBEAT_MS = 25_000;
/** A subscriber that falls this far behind is disconnected, not buffered. */
const MAX_BUFFERED_BYTES = 1_000_000;

export function eventFrame(event: HubEvent): string {
  return [
    `id: ${event.id}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify({
      board_id: event.boardId,
      entity: event.entity,
      action: event.action,
      payload: event.payload,
      actor_label: event.actorLabel,
      at: event.at,
    })}`,
    '',
    '',
  ].join('\n');
}

function namedFrame(event: string, data?: unknown): string {
  const lines = [`event: ${event}`];
  if (data !== undefined) lines.push(`data: ${JSON.stringify(data)}`);
  lines.push('', '');
  return lines.join('\n');
}

/** `?board=` repeated, or a single value; anything else is ignored. */
export function boardsFromQuery(query: unknown): string[] {
  const raw = (query as { board?: string | string[] } | undefined)?.board;
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return [...new Set(list.filter((id) => typeof id === 'string' && id.startsWith('brd_')))];
}

async function authorisedBoards(
  db: Db,
  request: FastifyRequest,
  boardIds: string[],
): Promise<string[]> {
  const actor = requireActor(request);
  const allowed: string[] = [];
  for (const boardId of boardIds) {
    try {
      const loaded = await loadBoardFor(db, actor, boardId, 'board.read');
      assertAllowed(loaded.decision);
      allowed.push(boardId);
    } catch {
      // Unreadable means non-existent: omitted, never an error frame.
    }
  }
  return allowed;
}

function openStream(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  reply.raw.write(': open\n\n');
}

/**
 * `EventSource` cannot set a request header, so a manual reconnect passes the
 * cursor as a query parameter. The header wins when both are present.
 */
export function lastEventIdFrom(request: FastifyRequest): string | null {
  const header = request.headers['last-event-id'];
  if (typeof header === 'string' && header !== '') return header;
  const query = (request.query as { last_event_id?: string } | undefined)?.last_event_id;
  return typeof query === 'string' && query !== '' ? query : null;
}

export function registerRealtimeRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };
  const hub = (): Hub => {
    if (!context.hub) throw new Error('hub is not available');
    return context.hub;
  };

  app.get('/api/v1/stream', async (request, reply) => {
    const boardIds = await authorisedBoards(database(), request, boardsFromQuery(request.query));
    const lastEventId = lastEventIdFrom(request);
    openStream(reply);

    const raw = reply.raw;
    let closed = false;
    const write = (chunk: string): void => {
      if (closed) return;
      if (raw.writableLength > MAX_BUFFERED_BYTES) {
        // A slow consumer is a memory leak with a socket attached.
        closed = true;
        raw.destroy();
        return;
      }
      raw.write(chunk);
    };

    const subscriber: Subscriber = {
      boards: new Set(boardIds),
      send: (event) => write(eventFrame(event)),
      close: () => write(namedFrame('close')),
    };
    const unsubscribe = hub().subscribe(subscriber);

    // Replay before the heartbeat: a reconnect gap is closed in order, and an id
    // the ring has already dropped asks the client to refetch instead.
    if (lastEventId !== null && boardIds.length > 0) {
      const first = boardIds[0] ?? '';
      const result = hub().replay(first, lastEventId);
      if (result.kind === 'resync') {
        write(namedFrame('resync'));
      } else if (result.kind === 'events') {
        for (const event of result.events) write(eventFrame(event));
      }
    }

    const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
    heartbeat.unref?.();

    const shutdown = (): void => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on('close', shutdown);
    raw.on('error', shutdown);

    request.log.info({ boards: boardIds.length }, 'stream opened');
  });
}
