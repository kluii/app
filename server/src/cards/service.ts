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
 * The insertion point, expressed as the two cards that will actually end up
 * around it. A named neighbour that was deleted, or that lives in another
 * column, falls back to the stored neighbour on that side: a stale client must
 * never be able to place a card *past* a card it never saw (K2-05).
 */
async function resolveNeighbours(
  tx: Tx,
  input: { cardId: string; columnId: string; before: string | null; after: string | null },
): Promise<{ before: number | null; after: number | null }> {
  const named = await tx.card.findMany({
    where: {
      id: { in: [input.before, input.after].filter((id): id is string => id !== null) },
      column_id: input.columnId,
    },
    select: { id: true, position: true },
  });
  const byId = new Map(named.map((row) => [row.id, Number(row.position)]));

  let before = input.before === null ? null : (byId.get(input.before) ?? null);
  let after = input.after === null ? null : (byId.get(input.after) ?? null);

  if (before === null && after === null) return { before: null, after: null };

  // Keep only what is genuinely adjacent to the insertion point.
  if (before !== null) {
    const next = await tx.card.findFirst({
      where: { column_id: input.columnId, position: { gt: before }, id: { not: input.cardId } },
      orderBy: { position: 'asc' },
      select: { position: true },
    });
    const nextPosition = next ? Number(next.position) : null;
    if (after === null || (nextPosition !== null && nextPosition < after)) after = nextPosition;
  }
  if (after !== null) {
    const previous = await tx.card.findFirst({
      where: { column_id: input.columnId, position: { lt: after }, id: { not: input.cardId } },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const previousPosition = previous ? Number(previous.position) : null;
    if (before === null || (previousPosition !== null && previousPosition > before)) {
      before = previousPosition;
    }
  }

  return { before, after };
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
  const bounds = await tx.card.aggregate({
    where: { column_id: input.columnId, id: { not: input.cardId } },
    _max: { position: true },
  });
  const max = bounds._max.position === null ? null : Number(bounds._max.position);

  const neighbours = await resolveNeighbours(tx, input);
  const plan = planRank({ before: neighbours.before, after: neighbours.after, min: null, max });

  if (plan.kind === 'renumber') {
    await renumberColumn(tx, input.columnId);
    const refreshed = await resolveNeighbours(tx, input);
    const replanned = planRank({
      before: refreshed.before,
      after: refreshed.after,
      min: null,
      max,
    });
    return {
      // After a renumber the gaps are exactly one step, so `planRank` always
      // places; the append is the defensive tail for an unreachable plan.
      position: replanned.kind === 'place' ? replanned.position : (max ?? 0) + RANK_STEP,
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
