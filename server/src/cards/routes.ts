// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor } from '../auth/request.js';
import { AppError, fromZod } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { RANK_STEP } from '../lib/ranks.js';
import { recordEvent } from '../lib/events.js';
import { commitEvent } from '../realtime/events.js';
import { conflictIfStale } from '../lib/concurrency.js';
import { assertAllowed, loadBoardFor } from '../boards/service.js';
import {
  boardTagColors,
  createTagRows,
  nextAppendPosition,
  planMove,
  toCardDto,
} from './service.js';
import {
  bulkCreateSchema,
  createCardSchema,
  moveCardSchema,
  updateCardSchema,
  type CreateCardInput,
} from '../contracts/cards.js';

export function registerCardRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  app.post('/api/v1/boards/:id/cards', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = createCardSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const db = database();

    const loaded = await loadBoardFor(db, actor, id, 'card.create');
    assertAllowed(loaded.decision);
    const card = await createCard(db, { boardId: id, actor, input: parsed.data });
    commitEvent(context.hub, {
      boardId: id,
      type: 'card.created',
      entity: 'card',
      action: 'created',
      payload: { card_id: card.id, column_id: card.column_id },
      actorLabel: actor.kind,
    });
    return reply.code(201).send(card);
  });

  app.post('/api/v1/boards/:id/cards/bulk', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = bulkCreateSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const db = database();

    const loaded = await loadBoardFor(db, actor, id, 'card.create');
    assertAllowed(loaded.decision);

    // The column must belong to *this* board: `card.create` on board A is not
    // permission to write into a column of board B (PROMPT.md §3.3).
    const column = await db.column.findFirst({
      where: { id: parsed.data.column, board_id: id },
    });
    if (!column) throw new AppError('column_not_found');

    const assignees = new Map<string, { id: string; username: string } | null>();
    for (const item of parsed.data.items) {
      if (item.assignee !== undefined && !assignees.has(item.assignee)) {
        assignees.set(item.assignee, await resolveAssignee(db, id, item.assignee));
      }
    }

    const createdIds = await db.$transaction(async (tx) => {
      const ids: string[] = [];
      const base = await nextAppendPosition(tx, column.id);
      for (const [index, item] of parsed.data.items.entries()) {
        const assignee =
          item.assignee === undefined ? null : (assignees.get(item.assignee) ?? null);
        const card = await tx.card.create({
          data: {
            id: newId('crd'),
            board_id: id,
            column_id: column.id,
            title: item.title,
            description: item.description ?? null,
            assignee_id: assignee?.id ?? null,
            assignee_label: assignee ? null : (item.assignee_label ?? null),
            due_at: item.due_at ? new Date(item.due_at) : null,
            done: item.done ?? false,
            position: base + index * RANK_STEP,
            anon_actor_id: actor.kind === 'anon' ? actor.anonId : null,
          },
          include: { tags: true },
        });
        if (item.tags) await createTagRows(tx, card.id, item.tags);
        await recordEvent(tx, {
          boardId: id,
          actor,
          type: 'card.created',
          payload: { board_id: id, card_id: card.id, column_id: card.column_id, title: card.title },
        });
        ids.push(card.id);
      }
      return ids;
    });

    const [rows, tagColors] = await Promise.all([
      db.card.findMany({ where: { id: { in: createdIds } }, include: { tags: true } }),
      boardTagColors(db, id),
    ]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return reply.code(201).send({
      created: parsed.data.items.map((item, index) => {
        const cardId = createdIds[index] ?? '';
        const row = byId.get(cardId);
        const assignee =
          item.assignee === undefined ? null : (assignees.get(item.assignee) ?? null);
        return row ? toCardDto(row, assignee, tagColors) : null;
      }),
    });
  });

  app.get('/api/v1/cards/:id', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();
    const card = await db.card.findUnique({ where: { id }, include: { tags: true } });
    if (!card) throw new AppError('card_not_found');
    const loaded = await loadBoardFor(db, actor, card.board_id, 'board.read');
    assertAllowed(loaded.decision);
    const [tagColors, assignee, commentsCount] = await Promise.all([
      boardTagColors(db, card.board_id),
      card.assignee_id
        ? db.user.findUnique({
            where: { id: card.assignee_id },
            select: { id: true, username: true },
          })
        : Promise.resolve(null),
      db.comment.count({ where: { card_id: card.id } }),
    ]);
    return { ...toCardDto(card, assignee, tagColors), comments_count: commentsCount };
  });

  app.patch('/api/v1/cards/:id', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = updateCardSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const input = parsed.data;
    const db = database();

    const card = await db.card.findUnique({ where: { id }, include: { tags: true } });
    if (!card) throw new AppError('card_not_found');

    const action = input.done === true ? 'card.complete' : 'card.update';
    const loaded = await loadBoardFor(db, actor, card.board_id, action, {
      isOwnCard: actor.kind === 'anon' && card.anon_actor_id === actor.anonId,
    });
    assertAllowed(loaded.decision);
    conflictIfStale(card.updated_at, input.expected_updated_at, toCardDto(card, null, new Map()));

    const changes: Record<string, [unknown, unknown]> = {};
    const data: Record<string, unknown> = {};
    if (input.title !== undefined && input.title !== card.title) {
      changes.title = [card.title, input.title];
      data.title = input.title;
    }
    if (input.description !== undefined && input.description !== card.description) {
      changes.description = [card.description, input.description];
      data.description = input.description;
    }
    if (input.due_at !== undefined) {
      const next = input.due_at === null ? null : new Date(input.due_at);
      if (next?.getTime() !== card.due_at?.getTime()) {
        changes.due_at = [card.due_at?.toISOString() ?? null, next?.toISOString() ?? null];
        data.due_at = next;
      }
    }
    if (input.done !== undefined && input.done !== card.done) {
      changes.done = [card.done, input.done];
      data.done = input.done;
    }
    if (input.assignee !== undefined) {
      const resolved =
        input.assignee === null ? null : await resolveAssignee(db, card.board_id, input.assignee);
      data.assignee_id = resolved?.id ?? null;
      data.assignee_label = resolved ? null : input.assignee;
      if ((resolved?.id ?? null) !== card.assignee_id) {
        changes.assignee = [card.assignee_id, resolved?.id ?? input.assignee];
      }
    } else if (input.assignee_label !== undefined) {
      data.assignee_label = input.assignee_label;
      data.assignee_id = null;
      if (input.assignee_label !== card.assignee_label) {
        changes.assignee_label = [card.assignee_label, input.assignee_label];
      }
    }

    const updated = await db.$transaction(async (tx) => {
      if (input.tags !== undefined) {
        await tx.cardTag.deleteMany({ where: { card_id: id } });
        await createTagRows(tx, id, input.tags);
        changes.tags = [card.tags.map((tag) => tag.name), input.tags.map((tag) => tag.name)];
      }
      const row =
        Object.keys(data).length > 0
          ? await tx.card.update({ where: { id }, data, include: { tags: true } })
          : await tx.card.findUniqueOrThrow({ where: { id }, include: { tags: true } });

      if (changes.done) {
        await recordEvent(tx, {
          boardId: card.board_id,
          actor,
          type: input.done ? 'card.completed' : 'card.reopened',
          payload: { board_id: card.board_id, card_id: card.id, column_id: card.column_id },
        });
      }
      const rest = Object.fromEntries(Object.entries(changes).filter(([key]) => key !== 'done'));
      if (Object.keys(rest).length > 0) {
        await recordEvent(tx, {
          boardId: card.board_id,
          actor,
          type: 'card.updated',
          payload: {
            board_id: card.board_id,
            card_id: card.id,
            column_id: card.column_id,
            changes: rest,
          },
        });
      }
      return row;
    });

    const tagColors = await boardTagColors(db, card.board_id);
    const assignee = updated.assignee_id
      ? await db.user.findUnique({
          where: { id: updated.assignee_id },
          select: { id: true, username: true },
        })
      : null;
    commitEvent(context.hub, {
      boardId: card.board_id,
      type: 'card.updated',
      entity: 'card',
      action: 'updated',
      payload: { card_id: card.id },
      actorLabel: actor.kind,
    });
    return toCardDto(updated, assignee, tagColors);
  });

  app.delete('/api/v1/cards/:id', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();
    const card = await db.card.findUnique({ where: { id } });
    if (!card) throw new AppError('card_not_found');
    const loaded = await loadBoardFor(db, actor, card.board_id, 'card.delete');
    assertAllowed(loaded.decision);

    await db.$transaction(async (tx) => {
      await tx.card.delete({ where: { id } });
      await recordEvent(tx, {
        boardId: card.board_id,
        actor,
        type: 'card.deleted',
        payload: {
          board_id: card.board_id,
          card_id: card.id,
          column_id: card.column_id,
          title: card.title,
        },
      });
    });
    commitEvent(context.hub, {
      boardId: card.board_id,
      type: 'card.deleted',
      entity: 'card',
      action: 'deleted',
      payload: { card_id: id },
      actorLabel: actor.kind,
    });
    return reply.code(204).send();
  });

  /**
   * `{column, before, after}` only. A body carrying `index`, `position` or
   * `order` is rejected on purpose: accepting it would reintroduce the bug the
   * neighbour API exists to prevent (docs/api.md §6.1).
   */
  app.post('/api/v1/cards/:id/move', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const rawBody = request.body as Record<string, unknown> | undefined;
    if (rawBody && ['index', 'position', 'order'].some((key) => key in rawBody)) {
      throw new AppError('unknown_field', {
        message: 'The move endpoint takes neighbours, never an index.',
        hint: 'Send {"column":"col_…","before":"crd_…"|null,"after":"crd_…"|null}.',
        details: [{ path: 'index', code: 'unrecognized_keys', message: 'not accepted' }],
      });
    }
    const parsed = moveCardSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const db = database();

    const card = await db.card.findUnique({ where: { id }, include: { tags: true } });
    if (!card) throw new AppError('card_not_found');
    const loaded = await loadBoardFor(db, actor, card.board_id, 'card.move');
    assertAllowed(loaded.decision);

    const column = await db.column.findFirst({
      where: { id: parsed.data.column, board_id: card.board_id },
    });
    if (!column) throw new AppError('column_not_found');

    // Before the transaction: a stale move must not take the lock or the row.
    conflictIfStale(
      card.updated_at,
      parsed.data.expected_updated_at,
      toCardDto(card, null, new Map()),
    );

    const moved = await db.$transaction(async (tx) => {
      const plan = await planMove(tx, {
        cardId: id,
        columnId: column.id,
        before: parsed.data.before ?? null,
        after: parsed.data.after ?? null,
      });
      const updated = await tx.card.update({
        where: { id },
        data: { column_id: column.id, position: plan.position },
        include: { tags: true },
      });
      await recordEvent(tx, {
        boardId: card.board_id,
        actor,
        type: 'card.moved',
        payload: {
          board_id: card.board_id,
          card_id: id,
          from_column: card.column_id,
          to_column: column.id,
          before: plan.before,
          after: plan.after,
        },
      });
      return updated;
    });

    const tagColors = await boardTagColors(db, card.board_id);
    commitEvent(context.hub, {
      boardId: card.board_id,
      type: 'card.moved',
      entity: 'card',
      action: 'moved',
      payload: { card_id: id, column_id: column.id },
      actorLabel: actor.kind,
    });
    return {
      card: toCardDto(moved, null, tagColors),
      column_id: column.id,
      position: moved.position.toString(),
    };
  });
}

async function createCard(
  db: Db,
  input: { boardId: string; actor: ReturnType<typeof requireActor>; input: CreateCardInput },
) {
  const column = await db.column.findFirst({
    where: { id: input.input.column, board_id: input.boardId },
  });
  if (!column) throw new AppError('column_not_found');
  const position = await nextAppendPosition(db, column.id);
  const assignee =
    input.input.assignee !== undefined
      ? await resolveAssignee(db, input.boardId, input.input.assignee)
      : null;

  const card = await db.$transaction(async (tx) => {
    const created = await tx.card.create({
      data: {
        id: newId('crd'),
        board_id: input.boardId,
        column_id: column.id,
        title: input.input.title,
        description: input.input.description ?? null,
        assignee_id: assignee?.id ?? null,
        assignee_label: assignee ? null : (input.input.assignee_label ?? null),
        due_at: input.input.due_at ? new Date(input.input.due_at) : null,
        done: input.input.done ?? false,
        position,
        anon_actor_id: input.actor.kind === 'anon' ? input.actor.anonId : null,
      },
      include: { tags: true },
    });
    if (input.input.tags) await createTagRows(tx, created.id, input.input.tags);
    await recordEvent(tx, {
      boardId: input.boardId,
      actor: input.actor,
      type: 'card.created',
      payload: {
        board_id: input.boardId,
        card_id: created.id,
        column_id: created.column_id,
        title: created.title,
      },
    });
    return created;
  });

  const tags = await db.cardTag.findMany({ where: { card_id: card.id } });
  const tagColors = await boardTagColors(db, input.boardId);
  return toCardDto({ ...card, tags }, assignee, tagColors);
}

async function resolveAssignee(
  db: Db,
  boardId: string,
  reference: string,
): Promise<{ id: string; username: string } | null> {
  const byUsername = await db.boardMember.findFirst({
    where: { board_id: boardId, user: { username: reference.toLowerCase() } },
    include: { user: { select: { id: true, username: true } } },
  });
  if (byUsername) return byUsername.user;
  const byId = await db.boardMember.findFirst({
    where: { board_id: boardId, user_id: reference },
    include: { user: { select: { id: true, username: true } } },
  });
  return byId ? byId.user : null;
}
