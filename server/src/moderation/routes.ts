// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The moderation queue over HTTP (K3-04). Owner/admin only, through `can()`:
 * `moderation.list` to read, `moderation.decide` to approve or reject.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor } from '../auth/request.js';
import { AppError } from '../lib/errors.js';
import { assertAllowed, loadBoardFor } from '../boards/service.js';
import { commitEvent } from '../realtime/events.js';
import { approvePendingCard, rejectPendingCard, toPendingDto } from './service.js';

export function registerModerationRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  app.get('/api/v1/boards/:id/pending', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'moderation.list');
    assertAllowed(loaded.decision);
    const rows = await db.pendingCard.findMany({
      where: { board_id: id },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    });
    reply.header('cache-control', 'no-store');
    return { items: rows.map(toPendingDto) };
  });

  app.post('/api/v1/boards/:id/pending/:pendingId/approve', async (request, reply) => {
    const actor = requireActor(request);
    const { id, pendingId } = request.params as { id: string; pendingId: string };
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'moderation.decide');
    assertAllowed(loaded.decision);

    const approverLabel =
      actor.kind === 'user' || actor.kind === 'agent'
        ? ((await db.user.findUnique({ where: { id: actor.userId }, select: { username: true } }))
            ?.username ?? actor.kind)
        : actor.kind;
    const result = await approvePendingCard(db, {
      boardId: id,
      pendingId,
      actor,
      approverLabel,
    });
    if (!result) throw new AppError('not_found', { message: 'Not found.', hint: null });
    commitEvent(context.hub, {
      boardId: id,
      type: 'card.created',
      entity: 'card',
      action: 'created',
      payload: { card_id: result.cardId },
      actorLabel: actor.kind,
    });
    return reply.code(201).send({ card_id: result.cardId });
  });

  app.post('/api/v1/boards/:id/pending/:pendingId/reject', async (request, reply) => {
    const actor = requireActor(request);
    const { id, pendingId } = request.params as { id: string; pendingId: string };
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'moderation.decide');
    assertAllowed(loaded.decision);

    const approverLabel =
      actor.kind === 'user' || actor.kind === 'agent'
        ? ((await db.user.findUnique({ where: { id: actor.userId }, select: { username: true } }))
            ?.username ?? actor.kind)
        : actor.kind;
    const rejected = await rejectPendingCard(db, {
      boardId: id,
      pendingId,
      actor,
      approverLabel,
    });
    if (!rejected) throw new AppError('not_found', { message: 'Not found.', hint: null });
    commitEvent(context.hub, {
      boardId: id,
      type: 'card.deleted',
      entity: 'card',
      action: 'deleted',
      payload: { pending_id: pendingId },
      actorLabel: actor.kind,
    });
    return reply.code(204).send();
  });
}
