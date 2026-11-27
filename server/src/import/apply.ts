// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Writing a plan (docs/features/import-export.md §2).
 *
 * The position rule is what makes the round-trip test meaningful:
 *
 * - A column that is **empty** keeps the file's positions when they are all
 *   distinct, so an export imported into an empty board exports back to the
 *   same bytes — a board that went through a drag would otherwise come back
 *   with every card re-spaced and "round-trip" would mean "deep-equal-ish".
 * - A column that **already holds cards** appends after its current maximum in
 *   `RANK_STEP`s. Reusing the file's positions there is how a card lands on top
 *   of a teammate's.
 * - Equal positions inside the file are renumbered, never rejected: a hand-made
 *   file with `position: 0` on every card is not an error.
 */
import { newId } from '../lib/ids.js';
import { RANK_STEP } from '../lib/ranks.js';
import { planTagColors, type ImportPlan } from './plan.js';
import type { Tx } from '../lib/events.js';

export type ApplyResult = {
  columns: number;
  cards: number;
  comments: number;
  created_columns: number;
  dropped: Record<string, number>;
  warnings: string[];
};

type ColumnState = { id: string; hadCards: boolean; max: number };

function rank(value: { toString(): string }): number {
  return Number(value.toString());
}

/**
 * Keeps the id a v2 file carries when it is well-formed and unused, so exporting
 * a board and importing it into an empty instance reproduces the file byte for
 * byte rather than "the same content under new ids" (ROADMAP K2-11). A taken or
 * malformed id is regenerated: an import must never overwrite an unrelated row.
 */
async function pickId(tx: Tx, kind: 'col' | 'crd', wanted: string | null): Promise<string> {
  const pattern = new RegExp(`^${kind}_[0-9A-Za-z]{22}$`);
  if (wanted !== null && pattern.test(wanted)) {
    const taken =
      kind === 'col'
        ? await tx.column.findUnique({ where: { id: wanted }, select: { id: true } })
        : await tx.card.findUnique({ where: { id: wanted }, select: { id: true } });
    if (taken === null) return wanted;
  }
  return newId(kind);
}

export async function applyPlan(tx: Tx, boardId: string, plan: ImportPlan): Promise<ApplyResult> {
  const existing = await tx.column.findMany({ where: { board_id: boardId } });
  const byName = new Map(existing.map((column) => [column.name.trim().toLowerCase(), column.id]));
  let nextColumnPosition =
    existing.reduce((max, column) => Math.max(max, rank(column.position)), 0) + RANK_STEP;

  const states = new Map<string, ColumnState>();
  let createdColumns = 0;
  for (const column of plan.columns) {
    const key = column.name.trim().toLowerCase();
    const existingId = byName.get(key);
    if (existingId !== undefined) {
      states.set(column.key, { id: existingId, hadCards: false, max: 0 });
      continue;
    }
    const id = await pickId(tx, 'col', column.key.startsWith('col_') ? column.key : null);
    const position =
      column.position !== null && existing.length === 0 ? column.position : nextColumnPosition;
    nextColumnPosition = Math.max(nextColumnPosition, position) + RANK_STEP;
    await tx.column.create({
      data: { id, board_id: boardId, name: column.name.trim().slice(0, 120), position },
    });
    byName.set(key, id);
    states.set(column.key, { id, hadCards: false, max: 0 });
    createdColumns += 1;
  }

  // What each target column already holds decides where the first import card goes.
  const grouped = await tx.card.groupBy({
    by: ['column_id'],
    where: { board_id: boardId },
    _max: { position: true },
    _count: { _all: true },
  });
  for (const row of grouped) {
    for (const state of states.values()) {
      if (state.id !== row.column_id) continue;
      state.hadCards = row._count._all > 0;
      state.max = row._max.position === null ? 0 : rank(row._max.position);
    }
  }

  // A v1 file carries board-level tag colours; write them first so a tag with
  // no card-level colour still comes out tinted (D-21 precedence).
  for (const [tag, color] of planTagColors(plan)) {
    await tx.boardTagColor.upsert({
      where: { board_id_tag: { board_id: boardId, tag } },
      create: { id: newId('btc'), board_id: boardId, tag, color },
      update: { color },
    });
  }

  const cardIdBySource = new Map<string, string>();
  const cardIdByIndex = new Map<number, string>();
  const cardsPerColumn = new Map<string, number>();
  for (const card of plan.cards) {
    cardsPerColumn.set(card.columnKey, (cardsPerColumn.get(card.columnKey) ?? 0) + 1);
  }

  // Positions inside the file: distinct, or that column is renumbered from the
  // start. A hand-made file with `position: 0` everywhere is not an error.
  const filePositions = new Map<string, number[]>();
  for (const card of plan.cards) {
    const list = filePositions.get(card.columnKey) ?? [];
    list.push(card.position);
    filePositions.set(card.columnKey, list);
  }
  const renumbered = new Set<string>();
  const ordinal = new Map<string, number>();
  for (const [columnKey, positions] of filePositions) {
    if (new Set(positions).size !== positions.length) renumbered.add(columnKey);
  }

  let cardCount = 0;
  let commentCount = 0;
  for (const [index, card] of plan.cards.entries()) {
    const state = states.get(card.columnKey);
    if (state === undefined) {
      // plan.ts has already rejected an unknown column for v2 and v1; a Trello
      // card in a closed list is the only way here, and it was skipped there.
      continue;
    }
    const id = await pickId(tx, 'crd', card.sourceId);
    const nth = (ordinal.get(card.columnKey) ?? 0) + 1;
    ordinal.set(card.columnKey, nth);
    const fromFile = !renumbered.has(card.columnKey) && card.position > 0;
    const position = state.hadCards || !fromFile ? state.max + RANK_STEP : card.position;
    state.max = position;
    await tx.card.create({
      data: {
        id,
        board_id: boardId,
        column_id: state.id,
        title: card.title,
        description: card.description,
        assignee_id: null,
        assignee_label: card.assignee_label,
        due_at: card.due_at,
        done: card.done,
        position,
        anon_actor_id: null,
        ...(card.created_at === null ? {} : { created_at: card.created_at }),
        ...(card.updated_at === null ? {} : { updated_at: card.updated_at }),
      },
    });
    for (const tag of card.tags) {
      await tx.cardTag.create({
        data: { card_id: id, name: tag.name, color: tag.color },
      });
    }
    if (card.sourceId !== null) cardIdBySource.set(card.sourceId, id);
    cardIdByIndex.set(index, id);
    cardCount += 1;
  }

  for (const comment of plan.comments) {
    const cardId =
      cardIdBySource.get(comment.cardKey) ?? cardIdByIndex.get(Number(comment.cardKey)) ?? null;
    if (cardId === null) {
      plan.dropped.comments_orphaned = (plan.dropped.comments_orphaned ?? 0) + 1;
      continue;
    }
    await tx.comment.create({
      data: {
        id: newId('cmt'),
        board_id: boardId,
        card_id: cardId,
        author_id: null,
        author_type: comment.author_type,
        author_label: comment.author_label,
        body: comment.body,
        ...(comment.created_at === null ? {} : { created_at: comment.created_at }),
      },
    });
    commentCount += 1;
  }

  return {
    columns: plan.columns.length,
    cards: cardCount,
    comments: commentCount,
    created_columns: createdColumns,
    dropped: plan.dropped,
    warnings: plan.warnings,
  };
}
