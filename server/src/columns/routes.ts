// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor } from '../auth/request.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { RANK_STEP, planRank, renumberPositions } from '../lib/ranks.js';
import { recordEvent } from '../lib/events.js';
import { conflictIfStale } from '../lib/concurrency.js';
import { assertAllowed, loadBoardFor } from '../boards/service.js';
import { toColumnDto } from '../cards/service.js';
import { createColumnSchema, deleteColumnSchema, updateColumnSchema } from '../contracts/cards.js';

export function registerColumnRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  app.post('/api/v1/boards/:id/columns', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = createColumnSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('validation_failed', {
        message: 'A column needs a name of at most 64 characters.',
        hint: 'Send {"name":"Doing"}.',
      });
    }
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'column.create');
    assertAllowed(loaded.decision);

    const columns = await db.column.findMany({
      where: { board_id: id },
      orderBy: { position: 'asc' },
    });
    const beforeId = parsed.data.position?.before ?? null;
    const afterId = parsed.data.position?.after ?? null;
    const before = columns.find((column) => column.id === beforeId);
    const after = columns.find((column) => column.id === afterId);
    const plan = planRank({
      before: before ? Number(before.position) : null,
      after: after ? Number(after.position) : null,
      min: columns.length > 0 ? Number(columns[0]?.position) : null,
      max: columns.length > 0 ? Number(columns[columns.length - 1]?.position) : null,
    });
    const position = plan.kind === 'place' ? plan.position : RANK_STEP;

    const column = await db.$transaction(async (tx) => {
      const created = await tx.column.create({
        data: { id: newId('col'), board_id: id, name: parsed.data.name, position },
      });
      await recordEvent(tx, {
        boardId: id,
        actor,
        type: 'column.created',
        payload: { board_id: id, column_id: created.id, name: created.name },
      });
      return created;
    });
    return reply.code(201).send(toColumnDto(column));
  });

  app.patch('/api/v1/columns/:id', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = updateColumnSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('validation_failed', {
        message: 'Rename needs a name of at most 64 characters.',
        hint: 'Send {"name":"Doing"}.',
      });
    }
    const db = database();
    const column = await db.column.findUnique({ where: { id } });
    if (!column) throw new AppError('column_not_found');
    const loaded = await loadBoardFor(db, actor, column.board_id, 'column.update');
    assertAllowed(loaded.decision);
    conflictIfStale(column.updated_at, parsed.data.expected_updated_at, toColumnDto(column));

    if (parsed.data.name === undefined || parsed.data.name === column.name) {
      return toColumnDto(column);
    }
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.column.update({ where: { id }, data: { name: parsed.data.name } });
      await recordEvent(tx, {
        boardId: column.board_id,
        actor,
        type: 'column.updated',
        payload: { board_id: column.board_id, column_id: id, from: column.name, to: row.name },
      });
      return row;
    });
    return toColumnDto(updated);
  });

  app.delete('/api/v1/columns/:id', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = deleteColumnSchema.safeParse(request.body ?? {});
    const db = database();
    const column = await db.column.findUnique({ where: { id } });
    if (!column) throw new AppError('column_not_found');
    const loaded = await loadBoardFor(db, actor, column.board_id, 'column.delete');
    assertAllowed(loaded.decision);

    const cards = await db.card.count({ where: { column_id: id } });
    const moveTo = parsed.success ? parsed.data.move_cards_to : undefined;
    const deleteCards = parsed.success ? parsed.data.delete_cards : undefined;

    if (cards > 0 && !moveTo && !deleteCards) {
      throw new AppError('column_not_empty', {
        message: 'The column still holds cards.',
        hint: 'Move them to another column, or confirm the deletion of the cards with {"delete_cards":true}.',
        details: [{ path: 'column', code: 'not_empty', message: `${cards} card(s)` }],
      });
    }
    if (moveTo) {
      const target = await db.column.findFirst({
        where: { id: moveTo, board_id: column.board_id },
      });
      if (!target) throw new AppError('column_not_found');
    }

    await db.$transaction(async (tx) => {
      if (moveTo) {
        const targetCards = await tx.card.findMany({
          where: { column_id: moveTo },
          orderBy: { position: 'asc' },
          select: { id: true },
        });
        const positions = renumberPositions(targetCards.length + cards);
        const base = positions[0] ?? RANK_STEP;
        const moving = await tx.card.findMany({
          where: { column_id: id },
          orderBy: { position: 'asc' },
          select: { id: true },
        });
        for (const [index, row] of moving.entries()) {
          await tx.card.update({
            where: { id: row.id },
            data: {
              column_id: moveTo,
              position: positions[targetCards.length + index] ?? base + index * RANK_STEP,
            },
          });
        }
      }
      if (deleteCards) {
        await tx.card.deleteMany({ where: { column_id: id } });
      }
      await tx.column.delete({ where: { id } });
      await recordEvent(tx, {
        boardId: column.board_id,
        actor,
        type: 'column.deleted',
        payload: {
          board_id: column.board_id,
          column_id: id,
          name: column.name,
          cards_moved_to: moveTo ?? null,
          cards_deleted: deleteCards === true,
        },
      });
    });
    return reply.code(204).send();
  });
}
