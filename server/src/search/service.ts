// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /boards/:id/search` (docs/api.md §4) and the `search_cards` tool.
 *
 * docs/api.md has documented this route since K2 and no handler ever existed;
 * `search_cards` needs it because a tool without an app equivalent must not
 * ship (docs/mcp.md §6) and the filter panel is its human twin. The shape is
 * the documented one, `{items:[Card], next_cursor, truncated}`, capped at 50 —
 * the same `board.read` gate as `state`.
 */
import type { Db } from '../db.js';
import type { Actor } from '../lib/authz.js';
import type { CardDto } from '../contracts/dto.js';
import { assertAllowed, loadBoardFor } from '../boards/service.js';
import { boardTagColors, toCardDto } from '../cards/service.js';

/** docs/mcp.md §4: `search_cards` caps at 50 and says so in `truncated`. */
export const SEARCH_CAP = 50;

export type SearchQuery = {
  query?: string | undefined;
  assignee?: string | undefined;
  tags?: string[] | undefined;
  done?: boolean | undefined;
  column?: string | undefined;
};

export type SearchResult = {
  items: CardDto[];
  next_cursor: null;
  truncated: boolean;
};

/**
 * Filters are applied in SQL where they are cheap and exact (assignee, column,
 * done) and in memory where the alternative is a case-insensitive `OR` over
 * three columns with a tag join. The board is capped at 200 cards per the
 * documented list limit, so the in-memory step is bounded by a constant.
 */
export async function searchCards(
  db: Db,
  actor: Actor,
  boardId: string,
  query: SearchQuery,
): Promise<SearchResult> {
  const loaded = await loadBoardFor(db, actor, boardId, 'board.read');
  assertAllowed(loaded.decision);

  const assigneeId =
    query.assignee === undefined ? null : await resolveAssigneeId(db, boardId, query.assignee);
  const done = query.done;

  const rows = await db.card.findMany({
    where: {
      board_id: boardId,
      ...(query.column ? { column_id: query.column } : {}),
      ...(done === undefined ? {} : { done }),
      ...(query.assignee === undefined
        ? {}
        : assigneeId === null
          ? { assignee_label: { equals: query.assignee, mode: 'insensitive' } }
          : { assignee_id: assigneeId }),
    },
    include: { tags: true },
    orderBy: [{ column_id: 'asc' }, { position: 'asc' }, { id: 'asc' }],
  });

  const needle = query.query?.trim().toLowerCase() ?? '';
  const wanted = (query.tags ?? []).map((tag) => tag.toLowerCase());
  const matched = rows.filter((row) => {
    if (wanted.length > 0) {
      const names = new Set(row.tags.map((tag) => tag.name.toLowerCase()));
      if (!wanted.every((tag) => names.has(tag))) return false;
    }
    if (needle === '') return true;
    return (
      row.title.toLowerCase().includes(needle) ||
      (row.description ?? '').toLowerCase().includes(needle)
    );
  });

  const page = matched.slice(0, SEARCH_CAP);
  const [tagColors, assigneeById] = await Promise.all([
    boardTagColors(db, boardId),
    assigneesFor(db, page),
  ]);
  return {
    items: page.map((row) =>
      toCardDto(
        row,
        row.assignee_id ? (assigneeById.get(row.assignee_id) ?? null) : null,
        tagColors,
        actor,
      ),
    ),
    // A hard cap, not a cursor: the panel pages client-side already and the
    // tool is told the answer was truncated rather than silently short.
    next_cursor: null,
    truncated: matched.length > page.length,
  };
}

async function resolveAssigneeId(
  db: Db,
  boardId: string,
  reference: string,
): Promise<string | null> {
  const member = await db.boardMember.findFirst({
    where: {
      board_id: boardId,
      OR: [{ user: { username: reference.toLowerCase() } }, { user_id: reference }],
    },
    select: { user_id: true },
  });
  return member?.user_id ?? null;
}

async function assigneesFor(
  db: Db,
  rows: { assignee_id: string | null }[],
): Promise<Map<string, { id: string; username: string }>> {
  const ids = [
    ...new Set(rows.map((row) => row.assignee_id).filter((id): id is string => id !== null)),
  ];
  if (ids.length === 0) return new Map();
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, username: true },
  });
  return new Map(users.map((user) => [user.id, { id: user.id, username: user.username }]));
}
