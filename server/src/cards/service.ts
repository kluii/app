// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Cards and columns. A move is planned against the **stored** column and the
 * neighbours the client rendered (D-20); an index is never accepted.
 */
import type { Prisma } from '@prisma/client';
import type { Db } from '../db.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { RANK_STEP, planRank, renumberPositions } from '../lib/ranks.js';
import { recordEvent } from '../lib/events.js';
import { conflictIfStale } from '../lib/concurrency.js';
import { commitEvent, type Hub } from '../realtime/events.js';
import type { CardDto, ColumnDto, TagDto } from '../contracts/dto.js';
import type { Actor } from '../lib/authz.js';
import { assertAllowed, loadBoardFor } from '../boards/service.js';
import type {
  BulkCreateInput,
  CreateCardInput,
  MoveCardInput,
  UpdateCardInput,
} from '../contracts/cards.js';

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
  viewer?: Actor | null,
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
    actor_label: card.actor_label,
    mine: viewer?.kind === 'anon' && card.anon_actor_id === viewer.anonId,
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

/**
 * Serialises appends in one column (K2-05). Two creators in READ COMMITTED read
 * the same `max(position)` and receive the same rank, so the row lock — not the
 * transaction boundary — is what orders them. The lock is the column row, so a
 * create in another column never waits.
 */
export async function lockColumnForAppend(tx: Tx, columnId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM columns WHERE id = ${columnId} FOR UPDATE`;
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

/**
 * A moderated write: no card, no event, a row the owner can approve or reject
 * (docs/features/links-and-anonymous.md §5). Seven days, then the sweeper drops
 * it (K3-04).
 */
export async function createPendingCard(
  db: Db,
  input: {
    boardId: string;
    columnId: string;
    title: string;
    description: string | null;
    dueAt: Date | null;
    tags: unknown;
    label: string;
    anonId: string;
  },
): Promise<{ id: string; title: string }> {
  const column = await db.column.findFirst({
    where: { id: input.columnId, board_id: input.boardId },
    select: { id: true },
  });
  if (!column) throw new AppError('column_not_found');
  const row = await db.pendingCard.create({
    data: {
      id: newId('pnd'),
      board_id: input.boardId,
      column_id: column.id,
      title: input.title,
      description: input.description,
      tags: input.tags === undefined ? undefined : (input.tags as Prisma.InputJsonValue),
      due_at: input.dueAt,
      actor_label: input.label,
      anon_actor_id: input.anonId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    select: { id: true, title: true },
  });
  return row;
}

/**
 * The card writes and reads, extracted from the routes so `/mcp` and REST run
 * the same function: one `can()` call, one transaction, one event, one DTO.
 *
 * What stays in the route is what only a browser-facing actor can reach — the
 * anonymous-write budget, the moderated pending queue and the field
 * restrictions on a visitor's own card. An MCP credential is never anonymous,
 * so those branches are policy for a route, not a second write path.
 */
export type CardWrite = { db: Db; actor: Actor; hub?: Hub };

/**
 * `assignee` is the username string an agent read off a board; a display name
 * for a non-member is stored as `assignee_label` and never becomes a user.
 */
export async function resolveAssignee(
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

async function requireColumnInBoard(db: Db, boardId: string, columnId: string): Promise<void> {
  // The column must belong to *this* board: `card.create` on board A is not
  // permission to write into a column of board B (PROMPT.md §3.3).
  const column = await db.column.findFirst({ where: { id: columnId, board_id: boardId } });
  if (!column) throw new AppError('column_not_found');
}

export async function createCard(
  context: CardWrite,
  boardId: string,
  input: CreateCardInput,
): Promise<CardDto> {
  const { db, actor } = context;
  const loaded = await loadBoardFor(db, actor, boardId, 'card.create');
  assertAllowed(loaded.decision);
  await requireColumnInBoard(db, boardId, input.column);
  const assignee =
    input.assignee !== undefined ? await resolveAssignee(db, boardId, input.assignee) : null;

  const card = await db.$transaction(async (tx) => {
    // Inside the transaction and behind the column lock: two creators must not
    // read the same max(position).
    await lockColumnForAppend(tx, input.column);
    const position = await nextAppendPosition(tx, input.column);
    const created = await tx.card.create({
      data: {
        id: newId('crd'),
        board_id: boardId,
        column_id: input.column,
        title: input.title,
        description: input.description ?? null,
        assignee_id: assignee?.id ?? null,
        assignee_label: assignee ? null : (input.assignee_label ?? null),
        due_at: input.due_at ? new Date(input.due_at) : null,
        done: input.done ?? false,
        position,
        anon_actor_id: actor.kind === 'anon' ? actor.anonId : null,
        actor_label: actor.kind === 'anon' ? actor.label : null,
      },
      include: { tags: true },
    });
    if (input.tags) await createTagRows(tx, created.id, input.tags);
    await recordEvent(tx, {
      boardId,
      actor,
      type: 'card.created',
      payload: {
        board_id: boardId,
        card_id: created.id,
        column_id: created.column_id,
        title: created.title,
      },
    });
    return created;
  });

  const tags = await db.cardTag.findMany({ where: { card_id: card.id } });
  const tagColors = await boardTagColors(db, boardId);
  commitEvent(context.hub, {
    boardId,
    type: 'card.created',
    entity: 'card',
    action: 'created',
    payload: { card_id: card.id, column_id: card.column_id },
    actorLabel: actor.kind,
  });
  return toCardDto({ ...card, tags }, assignee, tagColors, actor);
}

export async function bulkCreateCards(
  context: CardWrite,
  boardId: string,
  input: BulkCreateInput,
): Promise<{ created: (CardDto | null)[] }> {
  const { db, actor } = context;
  const loaded = await loadBoardFor(db, actor, boardId, 'card.create');
  assertAllowed(loaded.decision);
  await requireColumnInBoard(db, boardId, input.column);

  const assignees = new Map<string, { id: string; username: string } | null>();
  for (const item of input.items) {
    if (item.assignee !== undefined && !assignees.has(item.assignee)) {
      assignees.set(item.assignee, await resolveAssignee(db, boardId, item.assignee));
    }
  }

  const createdIds = await db.$transaction(async (tx) => {
    const ids: string[] = [];
    await lockColumnForAppend(tx, input.column);
    const base = await nextAppendPosition(tx, input.column);
    for (const [index, item] of input.items.entries()) {
      const assignee = item.assignee === undefined ? null : (assignees.get(item.assignee) ?? null);
      const card = await tx.card.create({
        data: {
          id: newId('crd'),
          board_id: boardId,
          column_id: input.column,
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
        boardId,
        actor,
        type: 'card.created',
        payload: {
          board_id: boardId,
          card_id: card.id,
          column_id: card.column_id,
          title: card.title,
        },
      });
      ids.push(card.id);
    }
    return ids;
  });

  const [rows, tagColors] = await Promise.all([
    db.card.findMany({ where: { id: { in: createdIds } }, include: { tags: true } }),
    boardTagColors(db, boardId),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  commitEvent(context.hub, {
    boardId,
    type: 'card.created',
    entity: 'card',
    action: 'created',
    payload: { card_ids: createdIds, column_id: input.column },
    actorLabel: actor.kind,
  });
  return {
    created: input.items.map((item, index) => {
      const row = byId.get(createdIds[index] ?? '');
      const assignee = item.assignee === undefined ? null : (assignees.get(item.assignee) ?? null);
      return row ? toCardDto(row, assignee, tagColors, actor) : null;
    }),
  };
}

export async function readCard(
  db: Db,
  actor: Actor,
  cardId: string,
): Promise<CardDto & { comments_count: number }> {
  const card = await db.card.findUnique({ where: { id: cardId }, include: { tags: true } });
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
  return { ...toCardDto(card, assignee, tagColors, actor), comments_count: commentsCount };
}

export async function updateCard(
  context: CardWrite,
  cardId: string,
  input: UpdateCardInput,
): Promise<CardDto> {
  const { db, actor } = context;
  const card = await db.card.findUnique({ where: { id: cardId }, include: { tags: true } });
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
      await tx.cardTag.deleteMany({ where: { card_id: cardId } });
      await createTagRows(tx, cardId, input.tags);
      changes.tags = [card.tags.map((tag) => tag.name), input.tags.map((tag) => tag.name)];
    }
    const row =
      Object.keys(data).length > 0
        ? await tx.card.update({ where: { id: cardId }, data, include: { tags: true } })
        : await tx.card.findUniqueOrThrow({ where: { id: cardId }, include: { tags: true } });

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
  return toCardDto(updated, assignee, tagColors, actor);
}

export async function moveCard(
  context: CardWrite,
  cardId: string,
  input: MoveCardInput,
): Promise<{ card: CardDto; column_id: string; position: string }> {
  const { db, actor } = context;
  const card = await db.card.findUnique({ where: { id: cardId }, include: { tags: true } });
  if (!card) throw new AppError('card_not_found');
  const loaded = await loadBoardFor(db, actor, card.board_id, 'card.move');
  assertAllowed(loaded.decision);

  const column = await db.column.findFirst({
    where: { id: input.column, board_id: card.board_id },
  });
  if (!column) throw new AppError('column_not_found');

  // Before the transaction: a stale move must not take the lock or the row.
  conflictIfStale(card.updated_at, input.expected_updated_at, toCardDto(card, null, new Map()));

  const moved = await db.$transaction(async (tx) => {
    const plan = await planMove(tx, {
      cardId,
      columnId: column.id,
      before: input.before ?? null,
      after: input.after ?? null,
    });
    const updated = await tx.card.update({
      where: { id: cardId },
      data: { column_id: column.id, position: plan.position },
      include: { tags: true },
    });
    await recordEvent(tx, {
      boardId: card.board_id,
      actor,
      type: 'card.moved',
      payload: {
        board_id: card.board_id,
        card_id: cardId,
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
    payload: { card_id: cardId, column_id: column.id },
    actorLabel: actor.kind,
  });
  return {
    card: toCardDto(moved, null, tagColors),
    column_id: column.id,
    position: moved.position.toString(),
  };
}

export async function deleteCard(context: CardWrite, cardId: string): Promise<void> {
  const { db, actor } = context;
  const card = await db.card.findUnique({ where: { id: cardId } });
  if (!card) throw new AppError('card_not_found');
  const loaded = await loadBoardFor(db, actor, card.board_id, 'card.delete');
  assertAllowed(loaded.decision);

  await db.$transaction(async (tx) => {
    await tx.card.delete({ where: { id: cardId } });
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
    payload: { card_id: cardId },
    actorLabel: actor.kind,
  });
}
