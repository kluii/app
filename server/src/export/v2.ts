// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `klui.export/v2` and the markdown export (docs/features/import-export.md §1
 * and §3).
 *
 * Two rules drive every line here:
 *
 * - **Deterministic.** Columns by position then id, cards by column then
 *   position then id, comments by creation then id, tags by name, and a fixed
 *   key order. Two exports of the same board differ only in `exported_at`, so
 *   the round-trip test can compare bytes instead of a deep-equal that would
 *   hide a reordering bug.
 * - **No credentials.** The board's share URL, its suffix, agent keys, RSS
 *   tokens and session ids never reach the file: an export is content, not a
 *   way into the instance.
 */
import type { Card, CardTag, Column } from '@prisma/client';
import type { Db } from '../db.js';

export type ExportTag = { name: string; color: string | null };

export type ExportCard = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  assignee: string | null;
  tags: ExportTag[];
  due_at: string | null;
  done: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

export type ExportColumn = { id: string; name: string; position: number };

export type ExportComment = {
  card_id: string;
  body: string;
  author_label: string | null;
  author_type: string;
  created_at: string;
};

/** The board object in the file is the §1 shape: name and share policy, no id. */
export type ExportBoard = {
  name: string;
  visibility: string;
  link_role: string;
  anon_write: string;
};

export type BoardSnapshot = {
  board: ExportBoard & { id: string };
  columns: ExportColumn[];
  cards: ExportCard[];
  comments: ExportComment[];
};

export type ExportV2 = {
  schema: 'klui.export/v2';
  exported_at: string;
  board: ExportBoard;
  columns: ExportColumn[];
  cards: ExportCard[];
  comments: ExportComment[];
};

/** Decimal columns arrive as `Decimal`; the format carries plain numbers. */
function rank(value: { toString(): string }): number {
  return Number(value.toString());
}

function compare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Loads everything the export needs in one snapshot. `board_id` is the filter
 * on every query: a card from another board can never appear in a file that
 * claims to be this one.
 */
export async function loadBoardSnapshot(db: Db, boardId: string): Promise<BoardSnapshot> {
  const [board, columns, cards, comments] = await Promise.all([
    db.board.findUnique({
      where: { id: boardId },
      select: { id: true, name: true, visibility: true, link_role: true, anon_write: true },
    }),
    db.column.findMany({ where: { board_id: boardId } }),
    db.card.findMany({ where: { board_id: boardId }, include: { tags: true } }),
    db.comment.findMany({ where: { board_id: boardId } }),
  ]);
  if (!board) throw new Error('the board disappeared while it was being exported');

  const assigneeIds = cards
    .map((card) => card.assignee_id)
    .filter((value): value is string => value !== null);
  const assignees =
    assigneeIds.length === 0
      ? []
      : await db.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, username: true },
        });
  const usernameById = new Map(assignees.map((user) => [user.id, user.username]));

  const tagColors = await db.boardTagColor.findMany({ where: { board_id: boardId } });
  const boardTagColor = new Map(tagColors.map((row) => [row.tag, row.color]));

  return {
    board: {
      id: board.id,
      name: board.name,
      visibility: board.visibility,
      link_role: board.link_role,
      anon_write: board.anon_write,
    },
    columns: [...columns]
      .sort(
        (left, right) => rank(left.position) - rank(right.position) || compare(left.id, right.id),
      )
      .map((column) => exportColumn(column)),
    cards: [...cards]
      .sort(
        (left, right) =>
          compare(left.column_id, right.column_id) ||
          rank(left.position) - rank(right.position) ||
          compare(left.id, right.id),
      )
      .map((card) => exportCard(card, usernameById, boardTagColor)),
    comments: [...comments]
      .sort(
        (left, right) =>
          left.created_at.getTime() - right.created_at.getTime() || compare(left.id, right.id),
      )
      .map((comment) => ({
        card_id: comment.card_id,
        body: comment.body,
        author_label: comment.author_label,
        author_type: comment.author_type,
        created_at: comment.created_at.toISOString(),
      })),
  };
}

function exportColumn(column: Column): ExportColumn {
  return { id: column.id, name: column.name, position: rank(column.position) };
}

function exportCard(
  card: Card & { tags: CardTag[] },
  usernameById: Map<string, string>,
  boardTagColor: Map<string, string>,
): ExportCard {
  const tags = [...card.tags]
    .sort((left, right) => compare(left.name, right.name))
    .map((tag) => ({
      name: tag.name,
      color: tag.color ?? boardTagColor.get(tag.name) ?? null,
    }));
  const assignee =
    card.assignee_label ??
    (card.assignee_id === null ? null : (usernameById.get(card.assignee_id) ?? null));
  return {
    id: card.id,
    column_id: card.column_id,
    title: card.title,
    description: card.description,
    assignee,
    tags,
    due_at: card.due_at === null ? null : card.due_at.toISOString(),
    done: card.done,
    position: rank(card.position),
    created_at: card.created_at.toISOString(),
    updated_at: card.updated_at.toISOString(),
  };
}

export function toExportV2(snapshot: BoardSnapshot, exportedAt: Date): ExportV2 {
  return {
    schema: 'klui.export/v2',
    exported_at: exportedAt.toISOString(),
    board: {
      name: snapshot.board.name,
      visibility: snapshot.board.visibility,
      link_role: snapshot.board.link_role,
      anon_write: snapshot.board.anon_write,
    },
    columns: snapshot.columns,
    cards: snapshot.cards,
    comments: snapshot.comments,
  };
}

/** The bytes of the file, not a pretty-printed approximation: two spaces, one trailing newline. */
export function serializeExportV2(payload: ExportV2): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function markdownDate(iso: string | null): string | null {
  return iso === null ? null : iso.slice(0, 10);
}

/**
 * Markdown per §3: `# Board`, `## Column`, one line per card, the description
 * indented two spaces, comments as blockquotes. Not re-importable by design —
 * the JSON is the round-trip format.
 */
export function toMarkdown(snapshot: BoardSnapshot): string {
  const lines: string[] = [`# ${snapshot.board.name}`, ''];
  for (const column of snapshot.columns) {
    lines.push(`## ${column.name}`);
    const cards = snapshot.cards.filter((card) => card.column_id === column.id);
    if (cards.length === 0) {
      lines.push('');
      continue;
    }
    for (const card of cards) {
      // `**api** **web** Title — @Hermes — due 2026-12-02` (import-export §3):
      // tags are space-separated, everything else is separated by an em dash.
      const tags = card.tags.map((tag) => `**${tag.name}**`).join(' ');
      const head = tags === '' ? card.title : `${tags} ${card.title}`;
      const parts: string[] = [head];
      if (card.assignee) parts.push(`@${card.assignee}`);
      const due = markdownDate(card.due_at);
      if (due) parts.push(`due ${due}`);
      const box = card.done ? '[x]' : '[ ]';
      lines.push(`- ${box} ${parts.join(' — ')}`);
      if (card.description !== null) {
        for (const line of card.description.split('\n')) {
          lines.push(line === '' ? '  ' : `  ${line}`);
        }
      }
      for (const comment of snapshot.comments.filter((entry) => entry.card_id === card.id)) {
        const date = comment.created_at.slice(0, 10);
        lines.push(
          `  > [${comment.author_label ?? comment.author_type}/${comment.author_type}, ${date}] ${comment.body}`,
        );
      }
    }
    lines.push('');
  }
  // Exactly one trailing newline: `join` + `\n`, then collapse the blank line
  // that a column with cards leaves behind.
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

/** The file name a browser gets; the board name is not trusted in a header. */
export function exportFileName(name: string, extension: 'json' | 'md'): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug === '' ? 'board' : slug}-klui.${extension}`;
}
