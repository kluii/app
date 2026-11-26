// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Cards and columns. A move is planned against the **stored** column and the
 * neighbours the client rendered (D-20); an index is never accepted.
 */
import type { Prisma } from '@prisma/client';
import type { Db } from '../db.js';
import { AppError } from '../lib/errors.js';
import { RANK_STEP, planRank, renumberPositions } from '../lib/ranks.js';
import { recordEvent } from '../lib/events.js';
import type { CardDto, ColumnDto, TagDto } from '../contracts/dto.js';
import type { Actor } from '../lib/authz.js';

type Tx = Prisma.TransactionClient;

export type CardWithRelations = Prisma.CardGetPayload<{
  include: {
    tags: true;
    column: { select: { id: true } };
  };
}>;

export function toColumnDto(column: {
  id: string;
  name: string;
  position: Prisma.Decimal;
}): ColumnDto {
  return { id: column.id, name: column.name, position: column.position.toString() };
}

export function toCardDto(
  card: Prisma.CardGetPayload<{ include: { tags: true } }>,
  assignee: { id: string; username: string } | null,
  boardTagColors: Map<string, string>,
): CardDto {
  const tags: TagDto[] = card.tags
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((tag) => ({ name: tag.name, color: tag.color ?? boardTagColors.get(tag.name) ?? null }));
  return {
    id: card.id,
    column_id: card.column_id,
    title: card.title,
    description: card.description,
    assignee,
    assignee_label: card.assignee_label,
    due_at: card.due_at ? card.due_at.toISOString() : null,
    done: card.done,
    position: card.position.toString(),
    tags,
    created_at: card.created_at.toISOString(),
    updated_at: card.updated_at.toISOString(),
  };
}

export async function boardTagColors(db: Db | Tx, boardId: string): Promise<Map<string, string>> {
  const rows = await db.boardTagColor.findMany({ where: { board_id: boardId } });
  return new Map(rows.map((row) => [row.tag, row.color]));
}

/** Positions of the cards currently in a column, ordered. */
export async function columnPositions(db: Db | Tx, columnId: string): Promise<number[]> {
  const rows = await db.card.findMany({
    where: { column_id: columnId },
    orderBy: { position: 'asc' },
    select: { position: true },
  });
  return rows.map((row) => Number(row.position));
}

export async function nextAppendPosition(db: Db | Tx, columnId: string): Promise<number> {
  const max = await db.card.aggregate({ where: { column_id: columnId }, _max: { position: true } });
  return Number(max._max.position ?? 0) + RANK_STEP;
}

/**
 * Resolves `{column, before, after}` into a concrete rank, renumbering the
 * target column when the gap between the neighbours is exhausted. A neighbour
 * that is missing, or that lives in another column, counts as absent.
 */
export async function planMove(
  tx: Tx,
  input: { cardId: string; columnId: string; before: string | null; after: string | null },
): Promise<{ position: number; renumber: boolean; before: string | null; after: string | null }> {
  const neighbours = await tx.card.findMany({
    where: {
      id: { in: [input.before, input.after].filter((id): id is string => id !== null) },
      column_id: input.columnId,
    },
    select: { id: true, position: true },
  });
  const byId = new Map(neighbours.map((row) => [row.id, Number(row.position)]));
  const before = input.before && byId.has(input.before) ? Number(byId.get(input.before)) : null;
  const after = input.after && byId.has(input.after) ? Number(byId.get(input.after)) : null;

  const bounds = await tx.card.aggregate({
    where: { column_id: input.columnId, id: { not: input.cardId } },
    _min: { position: true },
    _max: { position: true },
  });
  const min = bounds._min.position === null ? null : Number(bounds._min.position);
  const max = bounds._max.position === null ? null : Number(bounds._max.position);

  const plan = planRank({ before, after, min, max });
  if (plan.kind === 'renumber') {
    await renumberColumn(tx, input.columnId);
    const refreshed = await tx.card.findMany({
      where: {
        id: { in: [input.before, input.after].filter((id): id is string => id !== null) },
        column_id: input.columnId,
      },
      select: { id: true, position: true },
    });
    const positions = new Map(refreshed.map((row) => [row.id, Number(row.position)]));
    const replanned = planRank({
      before: input.before ? (positions.get(input.before) ?? null) : null,
      after: input.after ? (positions.get(input.after) ?? null) : null,
      min: null,
      max,
    });
    return {
      position: replanned.kind === 'place' ? replanned.position : RANK_STEP,
      renumber: true,
      before: input.before,
      after: input.after,
    };
  }
  return { position: plan.position, renumber: false, before: input.before, after: input.after };
}

export async function renumberColumn(tx: Tx, columnId: string): Promise<void> {
  const rows = await tx.card.findMany({
    where: { column_id: columnId },
    orderBy: { position: 'asc' },
    select: { id: true },
  });
  const positions = renumberPositions(rows.length);
  for (const [index, row] of rows.entries()) {
    const position = positions[index];
    if (position === undefined) continue;
    await tx.card.update({ where: { id: row.id }, data: { position } });
  }
}

export async function recordCardUpdate(
  tx: Tx,
  input: {
    actor: Actor;
    card: { id: string; board_id: string; column_id: string };
    changes: Record<string, [unknown, unknown]>;
  },
): Promise<void> {
  if (Object.keys(input.changes).length === 0) return;
  await recordEvent(tx, {
    boardId: input.card.board_id,
    actor: input.actor,
    type: 'card.updated',
    payload: {
      board_id: input.card.board_id,
      card_id: input.card.id,
      column_id: input.card.column_id,
      changes: input.changes,
    },
  });
}

export async function requireCardInBoard(
  db: Db,
  cardId: string,
): Promise<Prisma.CardGetPayload<{ include: { tags: true } }>> {
  const card = await db.card.findUnique({ where: { id: cardId }, include: { tags: true } });
  if (!card) throw new AppError('card_not_found');
  return card;
}

export async function createTagRows(
  tx: Tx,
  cardId: string,
  tags: { name: string; color?: string | null }[],
): Promise<void> {
  const unique = new Map(tags.map((tag) => [tag.name.toLowerCase(), tag]));
  for (const [name, tag] of unique) {
    await tx.cardTag.create({
      data: { card_id: cardId, name, color: tag.color ?? null },
    });
  }
}

export function positionString(value: number): string {
  return value.toFixed(10).replace(/\.?0+$/, '');
}
