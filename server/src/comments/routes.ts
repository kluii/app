// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Comments (docs/api.md §5, docs/permissions.md §3).
 *
 * Three rules the routes below exist to keep:
 *
 * - Reading a comment needs `board.read`; writing one needs `comment.create`,
 *   which no link or anonymous actor holds. They can read the board, so the
 *   answer is `403`, never `404` — the board is not hidden from them.
 * - `comment.update` is the only action with an object-level condition: the
 *   author, or the owner/admin for a moderation edit, which is why the
 *   decision takes `isAuthor` and the route passes it.
 * - Every write records an event in the same transaction, carrying a 120-char
 *   `body_excerpt` and never the whole body.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireActor } from '../auth/request.js';
import { assertAllowed, loadBoardFor } from '../boards/service.js';
import { AppError, fromZod } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { recordEvent } from '../lib/events.js';
import { commitEvent } from '../realtime/events.js';
import {
  bodyExcerpt,
  commentById,
  commentCursor,
  parseCommentCursor,
  toCommentDto,
} from './service.js';

const bodySchema = z.object({ body: z.string().trim().min(1).max(20_000) }).strict();

const MAX_PAGE = 100;

export function registerCommentRoutes(app: FastifyInstance, context: AppContext): void {
  const database = () => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  app.get('/api/v1/cards/:id/comments', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const query = request.query as { limit?: string; cursor?: string };
    const db = database();

    const card = await db.card.findUnique({ where: { id }, select: { id: true, board_id: true } });
    if (!card) throw new AppError('card_not_found');
    const loaded = await loadBoardFor(db, actor, card.board_id, 'board.read');
    assertAllowed(loaded.decision);

    const requested = Number(query.limit ?? 50);
    const limit = Math.min(MAX_PAGE, Math.max(1, Number.isFinite(requested) ? requested : 50));
    const cursor = parseCommentCursor(query.cursor);
    const items = await db.comment.findMany({
      where: {
        card_id: id,
        ...(cursor === null
          ? {}
          : {
              OR: [
                { created_at: { gt: cursor.at } },
                { created_at: cursor.at, id: { gt: cursor.id } },
              ],
            }),
      },
      include: { author: { select: { id: true, username: true } } },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = items.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toCommentDto),
      next_cursor: items.length > limit && last ? commentCursor(last) : null,
    };
  });

  app.post('/api/v1/cards/:id/comments', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);

    const card = await db.card.findUnique({ where: { id }, select: { id: true, board_id: true } });
    if (!card) throw new AppError('card_not_found');
    const loaded = await loadBoardFor(db, actor, card.board_id, 'comment.create');
    assertAllowed(loaded.decision);

    const authorId = actor.kind === 'user' || actor.kind === 'agent' ? actor.userId : null;
    const comment = await db.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          id: newId('cmt'),
          board_id: card.board_id,
          card_id: card.id,
          author_id: authorId,
          author_type: actor.kind === 'agent' ? 'agent' : actor.kind === 'anon' ? 'anon' : 'user',
          author_label: actor.kind === 'user' || actor.kind === 'agent' ? null : 'link',
          body: parsed.data.body,
        },
        include: { author: { select: { id: true, username: true } } },
      });
      await recordEvent(tx, {
        boardId: card.board_id,
        actor,
        type: 'comment.created',
        payload: {
          board_id: card.board_id,
          card_id: card.id,
          comment_id: created.id,
          body_excerpt: bodyExcerpt(created.body),
        },
      });
      return created;
    });

    commitEvent(context.hub, {
      boardId: card.board_id,
      type: 'comment.created',
      entity: 'comment',
      action: 'created',
      payload: { comment: toCommentDto(comment) },
      actorLabel: actor.kind,
    });
    return reply.code(201).send(toCommentDto(comment));
  });

  app.patch('/api/v1/comments/:id', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);

    const existing = await commentById(db, id);
    if (!existing) throw new AppError('comment_not_found');
    const isAuthor =
      (actor.kind === 'user' || actor.kind === 'agent') && existing.author_id === actor.userId;
    const loaded = await loadBoardFor(db, actor, existing.board_id, 'comment.update', {
      isAuthor,
    });
    assertAllowed(loaded.decision);

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.comment.update({
        where: { id },
        data: { body: parsed.data.body, edited_at: new Date() },
        include: { author: { select: { id: true, username: true } } },
      });
      await recordEvent(tx, {
        boardId: existing.board_id,
        actor,
        type: 'comment.updated',
        payload: {
          board_id: existing.board_id,
          card_id: existing.card_id,
          comment_id: id,
          body_excerpt: bodyExcerpt(row.body),
        },
      });
      return row;
    });

    commitEvent(context.hub, {
      boardId: existing.board_id,
      type: 'comment.updated',
      entity: 'comment',
      action: 'updated',
      payload: { comment: toCommentDto(updated) },
      actorLabel: actor.kind,
    });
    return toCommentDto(updated);
  });

  app.delete('/api/v1/comments/:id', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();

    const existing = await commentById(db, id);
    if (!existing) throw new AppError('comment_not_found');
    const isAuthor =
      (actor.kind === 'user' || actor.kind === 'agent') && existing.author_id === actor.userId;
    const loaded = await loadBoardFor(db, actor, existing.board_id, 'comment.delete', {
      isAuthor,
    });
    assertAllowed(loaded.decision);

    await db.$transaction(async (tx) => {
      await tx.comment.delete({ where: { id } });
      await recordEvent(tx, {
        boardId: existing.board_id,
        actor,
        type: 'comment.deleted',
        payload: {
          board_id: existing.board_id,
          card_id: existing.card_id,
          comment_id: id,
          body_excerpt: bodyExcerpt(existing.body),
        },
      });
    });

    commitEvent(context.hub, {
      boardId: existing.board_id,
      type: 'comment.deleted',
      entity: 'comment',
      action: 'deleted',
      payload: { comment_id: id, card_id: existing.card_id },
      actorLabel: actor.kind,
    });
    return reply.code(204).send();
  });
}
