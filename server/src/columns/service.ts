// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Columns. Extracted from the routes so `/mcp` and REST change a board through
 * the same function: one `can()` call, one transaction, one event, one DTO.
 *
 * A column belongs to exactly one board, and the column id alone never decides
 * anything: every write loads the board the column actually lives on, so a
 * `board`-scoped key cannot reach another board's column by guessing an id.
 */
import type { Prisma } from '@prisma/client';
import type { Db } from '../db.js';
import type { Actor } from '../lib/authz.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { RANK_STEP, planRank, renumberPositions } from '../lib/ranks.js';
import { recordEvent } from '../lib/events.js';
import { conflictIfStale } from '../lib/concurrency.js';
import type { Hub } from '../realtime/events.js';
import type { ColumnDto } from '../contracts/dto.js';
import type {
  createColumnSchema,
  deleteColumnSchema,
  updateColumnSchema,
} from '../contracts/cards.js';
import type { z } from 'zod';
import { assertAllowed, loadBoardFor } from '../boards/service.js';
import { toColumnDto } from '../cards/service.js';

type Tx = Prisma.TransactionClient;

export type ColumnWrite = { db: Db; actor: Actor; hub?: Hub };

export type CreateColumnInput = z.infer<typeof createColumnSchema>;
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;
export type DeleteColumnInput = z.infer<typeof deleteColumnSchema>;

export async function createColumn(
  context: ColumnWrite,
  boardId: string,
  input: CreateColumnInput,
): Promise<ColumnDto> {
  const { db, actor } = context;
  const loaded = await loadBoardFor(db, actor, boardId, 'column.create');
  assertAllowed(loaded.decision);

  const columns = await db.column.findMany({
    where: { board_id: boardId },
    orderBy: { position: 'asc' },
  });
  const before = columns.find((column) => column.id === input.position?.before);
  const after = columns.find((column) => column.id === input.position?.after);
  const plan = planRank({
    before: before ? Number(before.position) : null,
    after: after ? Number(after.position) : null,
    min: columns.length > 0 ? Number(columns[0]?.position) : null,
    max: columns.length > 0 ? Number(columns[columns.length - 1]?.position) : null,
  });
  const position = plan.kind === 'place' ? plan.position : RANK_STEP;

  const column = await db.$transaction(async (tx) => {
    const created = await tx.column.create({
      data: { id: newId('col'), board_id: boardId, name: input.name, position },
    });
    await recordEvent(tx, {
      boardId,
      actor,
      type: 'column.created',
      payload: { board_id: boardId, column_id: created.id, name: created.name },
    });
    return created;
  });
  return toColumnDto(column);
}

export async function updateColumn(
  context: ColumnWrite,
  columnId: string,
  input: UpdateColumnInput,
): Promise<ColumnDto> {
  const { db, actor } = context;
  const column = await db.column.findUnique({ where: { id: columnId } });
  if (!column) throw new AppError('column_not_found');
  const loaded = await loadBoardFor(db, actor, column.board_id, 'column.update');
  assertAllowed(loaded.decision);
  conflictIfStale(column.updated_at, input.expected_updated_at, toColumnDto(column));

  if (input.name === undefined || input.name === column.name) return toColumnDto(column);
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.column.update({ where: { id: columnId }, data: { name: input.name } });
    await recordEvent(tx, {
      boardId: column.board_id,
      actor,
      type: 'column.updated',
      payload: { board_id: column.board_id, column_id: columnId, from: column.name, to: row.name },
    });
    return row;
  });
  return toColumnDto(updated);
}

export async function deleteColumn(
  context: ColumnWrite,
  columnId: string,
  input: DeleteColumnInput,
): Promise<void> {
  const { db, actor } = context;
  const column = await db.column.findUnique({ where: { id: columnId } });
  if (!column) throw new AppError('column_not_found');
  const loaded = await loadBoardFor(db, actor, column.board_id, 'column.delete');
  assertAllowed(loaded.decision);

  const cards = await db.card.count({ where: { column_id: columnId } });
  const moveTo = input.move_cards_to;
  const deleteCards = input.delete_cards;

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

  await db.$transaction(async (tx: Tx) => {
    if (moveTo) {
      const targetCards = await tx.card.findMany({
        where: { column_id: moveTo },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      const positions = renumberPositions(targetCards.length + cards);
      const base = positions[0] ?? RANK_STEP;
      const moving = await tx.card.findMany({
        where: { column_id: columnId },
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
      await tx.card.deleteMany({ where: { column_id: columnId } });
    }
    await tx.column.delete({ where: { id: columnId } });
    await recordEvent(tx, {
      boardId: column.board_id,
      actor,
      type: 'column.deleted',
      payload: {
        board_id: column.board_id,
        column_id: columnId,
        name: column.name,
        cards_moved_to: moveTo ?? null,
        cards_deleted: deleteCards === true,
      },
    });
  });
}
