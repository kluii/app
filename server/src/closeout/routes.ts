// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Close-out (docs/features/close-out.md, D-22).
 *
 * Closing is irreversible in 2.0: one transaction sets `closed_at`, computes the
 * summary from the events and cards as they stand, stores it, and records
 * `board.closed`. After that `can()` answers `board_closed` for every write —
 * owner included — while `board.read`, `board.export` and `board.summary` keep
 * working.
 *
 * The summary is computed once and read from the board afterwards. It does not
 * move when an old event is trimmed by retention, which is the whole point of
 * storing it.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireActor } from '../auth/request.js';
import { assertAllowed, loadBoardFor } from '../boards/service.js';
import { can } from '../lib/authz.js';
import { AppError, fromZod } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { recordEvent } from '../lib/events.js';
import { commitEvent } from '../realtime/events.js';
import { buildSummary, summaryToMarkdown, type CloseSummary } from './summary.js';

const closeSchema = z
  .object({
    confirm: z.literal(true),
    note: z.string().trim().max(2_000).optional(),
  })
  .strict();

function alreadyClosed(): AppError {
  return new AppError('already_closed', {
    message: 'This board is already closed.',
    hint: 'Reopening is not part of 2.0; the export is the escape hatch.',
  });
}

export function registerCloseoutRoutes(app: FastifyInstance, context: AppContext): void {
  const database = () => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  app.post('/api/v1/boards/:id/close', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();
    const parsed = closeSchema.safeParse(request.body);
    if (!parsed.success) {
      if (parsed.error.issues.some((issue) => issue.path[0] === 'confirm')) {
        throw new AppError('validation_failed', {
          message: 'Closing a board requires confirmation.',
          hint: 'Send {"confirm": true} once the user has seen that it cannot be reopened.',
          details: [{ path: 'confirm', code: 'invalid_literal', message: 'expected true' }],
        });
      }
      throw fromZod(parsed.error);
    }

    const loaded = await loadBoardFor(db, actor, id, 'board.close');
    if (loaded.board.closed_at !== null) {
      // A closed board refuses every write through `can()`, so asking it again
      // would answer `403 board_closed` and hide the fact that the board is
      // already closed. The decision is re-run against the board as if it were
      // open: an actor allowed to close it gets the documented `409`, anyone
      // else gets the ordinary refusal from `assertAllowed`.
      const asIfOpen = can(
        actor,
        'board.close',
        { ...loaded.policy, closedAt: null },
        loaded.membership,
      );
      if (asIfOpen.allow) throw alreadyClosed();
      assertAllowed(loaded.decision);
    }
    assertAllowed(loaded.decision);

    const closedAt = new Date();
    const summaryId = newId('sum');
    const summary = await db.$transaction(async (tx) => {
      const [columns, cards, events, members] = await Promise.all([
        tx.column.findMany({ where: { board_id: id }, orderBy: { position: 'asc' } }),
        tx.card.findMany({ where: { board_id: id }, include: { tags: true } }),
        tx.event.findMany({
          where: { board_id: id },
          orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        }),
        tx.boardMember.findMany({ where: { board_id: id }, select: { user_id: true } }),
      ]);
      const userIds = new Set<string>(members.map((member) => member.user_id));
      for (const event of events) {
        if (event.actor_user_id !== null) userIds.add(event.actor_user_id);
      }
      if (!userIds.has(loaded.board.owner_id)) userIds.add(loaded.board.owner_id);
      for (const card of cards) {
        if (card.assignee_id !== null) userIds.add(card.assignee_id);
      }
      const users = await tx.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, username: true },
      });

      const built = buildSummary({
        id: summaryId,
        board: {
          name: loaded.board.name,
          owner: loaded.board.owner.username,
          created_at: loaded.board.created_at,
        },
        closedAt,
        note: parsed.data.note ?? null,
        columns,
        cards,
        events,
        users,
      });

      await tx.board.update({
        where: { id },
        // The summary is the document; `closed_at` is the state. Both are
        // written once, in the same statement as the event below.
        data: { closed_at: closedAt, close_summary: built as never },
      });
      await recordEvent(tx, {
        boardId: id,
        actor,
        type: 'board.closed',
        payload: { board_id: id, summary_id: summaryId },
      });
      return built;
    });

    commitEvent(context.hub, {
      boardId: id,
      type: 'board.closed',
      entity: 'board',
      action: 'closed',
      payload: { board_id: id, summary_id: summaryId },
      actorLabel: actor.kind,
    });
    return reply.code(200).send(summary);
  });

  app.get('/api/v1/boards/:id/summary', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'board.summary');
    assertAllowed(loaded.decision);
    if (loaded.board.close_summary === null) {
      throw new AppError('not_found', {
        message: 'This board has no summary.',
        hint: 'A summary exists once the board is closed.',
      });
    }
    return loaded.board.close_summary as CloseSummary;
  });

  app.get('/api/v1/boards/:id/summary.md', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'board.summary');
    assertAllowed(loaded.decision);
    if (loaded.board.close_summary === null) {
      throw new AppError('not_found', {
        message: 'This board has no summary.',
        hint: 'A summary exists once the board is closed.',
      });
    }
    const summary = loaded.board.close_summary as CloseSummary;
    return reply
      .header('cache-control', 'no-store')
      .type('text/markdown; charset=utf-8')
      .send(summaryToMarkdown(summary));
  });
}
