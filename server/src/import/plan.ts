// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Turning a file into a plan, before anything touches the database.
 *
 * Two properties matter here and nowhere else:
 *
 * - **All or nothing.** Every rejection throws, and the caller has not written
 *   a row yet. "Mostly imported" is worse than "rejected".
 * - **No invented identity.** `assignee` is a display name. An import never
 *   binds a card to a local account, because the file names someone the
 *   instance may never have heard of.
 *
 * The three readers normalise into one shape; apply.ts only ever sees a plan.
 */
import { AppError } from '../lib/errors.js';
import {
  IMPORT_LIMITS,
  importV2Schema,
  type ImportFormat,
  type ImportV2,
} from '../contracts/import.js';

export type PlannableTag = { name: string; color: string | null };

export type PlannedCard = {
  /** The id in the source file, used only to attach comments and to name errors. */
  sourceId: string | null;
  columnKey: string;
  title: string;
  description: string | null;
  assignee_label: string | null;
  tags: PlannableTag[];
  due_at: Date | null;
  done: boolean;
  position: number;
  created_at: Date | null;
  updated_at: Date | null;
};

export type PlannedComment = {
  cardKey: string;
  body: string;
  author_label: string | null;
  author_type: 'user' | 'agent' | 'anon';
  created_at: Date | null;
};

export type ImportPlan = {
  format: ImportFormat;
  /** Only a v1 file names its board; anything else imports into the target board. */
  boardName: string | null;
  /** `key` is the source id (v2) or the name (v1, Trello). */
  columns: { key: string; name: string; position: number | null }[];
  cards: PlannedCard[];
  comments: PlannedComment[];
  /** Field names that were present and deliberately dropped, with a count. */
  dropped: Record<string, number>;
  warnings: string[];
};

const TAG_PATTERN = /[^a-z0-9-]+/g;

/** Lowercase `[a-z0-9-]`, 1–24 characters, or null when it cannot be salvaged. */
export function normalizeTagName(raw: string): string | null {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(TAG_PATTERN, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return name.length === 0 ? null : name;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A date the file claims; an unparseable one is an error that names the field. */
function parseDate(value: unknown, where: string): Date | null {
  const raw = asString(value);
  if (raw === null || raw.trim() === '') return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('validation_failed', {
      message: `The import file has an invalid date (${where}).`,
      hint: 'Dates are ISO 8601, for example 2026-11-26T10:00:00.000Z.',
      details: [{ path: where, code: 'invalid_date', message: `not a date: ${raw}` }],
    });
  }
  return date;
}

function tooLarge(what: string, limit: number): AppError {
  return new AppError('payload_too_large', {
    message: `The import exceeds the ${what} limit.`,
    hint: `A single import may carry at most ${String(limit)} ${what}.`,
  });
}

function unsupportedSchema(): AppError {
  return new AppError('unsupported_schema', {
    message: 'The file is not a klui.export/v2, klui.export/v1 or Trello export.',
    hint: 'Accepted schemas: klui.export/v2, klui.export/v1, Trello JSON.',
  });
}

function collectTags(raw: unknown, dropped: Record<string, number>): PlannableTag[] {
  const tags: PlannableTag[] = [];
  const seen = new Set<string>();
  for (const entry of asArray(raw)) {
    const object = asObject(entry);
    const name = normalizeTagName(
      typeof entry === 'string' ? entry : (asString(object?.name) ?? ''),
    );
    if (name === null) {
      dropped.tags_unreadable = (dropped.tags_unreadable ?? 0) + 1;
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    const color = object === null ? null : asString(object.color);
    tags.push({ name, color: color !== null && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null });
    if (color !== null && tags[tags.length - 1]?.color === null) {
      dropped.tags_color_invalid = (dropped.tags_color_invalid ?? 0) + 1;
    }
  }
  return tags.sort((left, right) => (left.name < right.name ? -1 : 1));
}

function assertCounts(plan: ImportPlan): ImportPlan {
  if (plan.columns.length > IMPORT_LIMITS.columns) {
    throw tooLarge('columns', IMPORT_LIMITS.columns);
  }
  if (plan.cards.length > IMPORT_LIMITS.cards) throw tooLarge('cards', IMPORT_LIMITS.cards);
  if (plan.comments.length > IMPORT_LIMITS.comments) {
    throw tooLarge('comments', IMPORT_LIMITS.comments);
  }
  return plan;
}

export function buildPlan(format: ImportFormat, data: unknown): ImportPlan {
  const object = asObject(data);
  if (object === null) throw unsupportedSchema();
  switch (format) {
    case 'v2':
      return assertCounts(planV2(object));
    case 'v1':
      return assertCounts(planV1(object));
    case 'trello':
      return assertCounts(planTrello(object));
  }
}

function planV2(raw: Record<string, unknown>): ImportPlan {
  const parsed = importV2Schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError('validation_failed', {
      message: 'The klui.export/v2 file does not match the schema.',
      hint: issue ? `${issue.path.join('.') || 'data'}: ${issue.message}` : null,
      details: parsed.error.issues.slice(0, 20).map((entry) => ({
        path: entry.path.join('.'),
        code: entry.code,
        message: entry.message,
      })),
    });
  }
  const file: ImportV2 = parsed.data;
  const columnIds = new Set(file.columns.map((column) => column.id));
  if (columnIds.size !== file.columns.length) {
    throw new AppError('validation_failed', {
      message: 'The file reuses a column id.',
      hint: 'Every column needs its own id.',
    });
  }
  const cardIds = new Set<string>();
  for (const card of file.cards) {
    if (card.id !== undefined) {
      if (cardIds.has(card.id)) {
        throw new AppError('validation_failed', {
          message: `The file has two cards with the id ${card.id}.`,
          hint: 'Card ids must be unique inside one file.',
          details: [{ path: 'cards.id', code: 'duplicate_id', message: card.id }],
        });
      }
      cardIds.add(card.id);
    }
    if (!columnIds.has(card.column_id)) {
      throw new AppError('validation_failed', {
        message: `Card ${card.id ?? card.title} names a column the file does not contain.`,
        hint: `column_id ${card.column_id} has no matching entry in columns.`,
        details: [{ path: 'cards.column_id', code: 'missing_column', message: card.column_id }],
      });
    }
  }

  const dropped: Record<string, number> = {};
  return {
    format: 'v2',
    boardName: null,
    // A post-1.0 file may sort the columns; the position decides, then the id.
    columns: [...file.columns]
      .sort(
        (left, right) =>
          (left.position ?? 0) - (right.position ?? 0) ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      )
      .map((column) => ({ key: column.id, name: column.name, position: column.position ?? null })),
    cards: [...file.cards]
      .sort(
        (left, right) =>
          (left.column_id < right.column_id ? -1 : left.column_id > right.column_id ? 1 : 0) ||
          (left.position ?? 0) - (right.position ?? 0) ||
          ((left.id ?? '') < (right.id ?? '') ? -1 : 1),
      )
      .map((card) => ({
        sourceId: card.id ?? null,
        columnKey: card.column_id,
        title: card.title,
        description: card.description ?? null,
        assignee_label: card.assignee ?? null,
        tags: collectTags(card.tags ?? [], dropped),
        due_at: parseDate(card.due_at, `cards.${card.id ?? card.title}.due_at`),
        done: card.done ?? false,
        position: card.position ?? 0,
        created_at: parseDate(card.created_at, `cards.${card.id ?? card.title}.created_at`),
        updated_at: parseDate(card.updated_at, `cards.${card.id ?? card.title}.updated_at`),
      })),
    comments: (file.comments ?? []).map((comment) => ({
      cardKey: comment.card_id,
      body: comment.body,
      author_label: comment.author_label ?? null,
      author_type: comment.author_type ?? 'user',
      created_at: parseDate(comment.created_at, `comments.${comment.card_id}.created_at`),
    })),
    dropped,
    warnings: [],
  };
}

/**
 * `klui.export/v1` as described by the mapping table in
 * docs/features/import-export.md §2.1. No real file was available (O-01), so
 * every field the table names is honoured and everything else is ignored and
 * counted rather than guessed.
 */
function planV1(raw: Record<string, unknown>): ImportPlan {
  const dropped: Record<string, number> = {};
  const warnings: string[] = [];
  for (const field of ['archived', 'archived_at', 'archive_after_days', 'archive_at']) {
    if (raw[field] !== undefined) dropped[field] = 1;
  }
  if (dropped.archived !== undefined || dropped.archived_at !== undefined) {
    warnings.push('v1 archive flags were dropped: Klui 2.0 has no archive.');
  }
  if (raw.level === 'ro') warnings.push('The v1 file was read-only; the importer became owner.');

  const columns = asArray(raw.columns);
  if (columns.length === 0) throw unsupportedSchema();
  const plannedColumns: ImportPlan['columns'] = [];
  const nameByKey = new Map<string, string>();
  columns.forEach((entry, index) => {
    const column = asObject(entry);
    const name = asString(column?.name);
    if (name === null || name.trim() === '') {
      throw new AppError('validation_failed', {
        message: 'A v1 column has no name.',
        hint: 'Every entry in columns needs a name.',
        details: [
          { path: `columns.${String(index)}.name`, code: 'invalid_type', message: 'required' },
        ],
      });
    }
    const id = asString(column?.id);
    const key = id ?? name;
    nameByKey.set(key, name);
    plannedColumns.push({
      key,
      name,
      position: asNumber(column?.position) ?? (index + 1) * 1024,
    });
  });

  const cards: PlannedCard[] = [];
  const cardIds = new Set<string>();
  asArray(raw.cards).forEach((entry, index) => {
    const card = asObject(entry);
    const title = asString(card?.title) ?? asString(card?.name);
    if (card === null || title === null || title.trim() === '') {
      throw new AppError('validation_failed', {
        message: 'A v1 card has no title.',
        hint: 'Every entry in cards needs a title.',
        details: [
          { path: `cards.${String(index)}.title`, code: 'invalid_type', message: 'required' },
        ],
      });
    }
    const id = asString(card.id);
    if (id !== null) {
      if (cardIds.has(id)) {
        throw new AppError('validation_failed', {
          message: `The v1 file has two cards with the id ${id}.`,
          hint: 'Card ids must be unique inside one file.',
          details: [{ path: 'cards.id', code: 'duplicate_id', message: id }],
        });
      }
      cardIds.add(id);
    }
    const columnKey = asString(card.column_id) ?? asString(card.column) ?? asString(card.list);
    if (columnKey === null || !nameByKey.has(columnKey)) {
      throw new AppError('validation_failed', {
        message: `v1 card ${id ?? title} names a column the file does not contain.`,
        hint: `Looked for a column called ${String(columnKey)}.`,
        details: [{ path: 'cards.column', code: 'missing_column', message: String(columnKey) }],
      });
    }
    const assigneeId = card.assignee_id;
    if (assigneeId !== undefined && assigneeId !== null)
      dropped.assignee_id = (dropped.assignee_id ?? 0) + 1;
    cards.push({
      sourceId: id,
      columnKey,
      title: title.trim().slice(0, 200),
      description: asString(card.description),
      // A display name, never an account: `assignee_id` is not carried over.
      assignee_label: asString(card.assignee) ?? asString(card.assignee_label),
      tags: collectTags(card.tags ?? [], dropped),
      due_at: parseDate(card.due_at, `cards.${id ?? title}.due_at`),
      done: card.done === true,
      position: asNumber(card.position) ?? 0,
      created_at: parseDate(card.created_at, `cards.${id ?? title}.created_at`),
      updated_at: null,
    });
  });

  // `tag_colors` becomes board defaults; apply.ts writes them before the cards
  // so an imported tag without its own colour still comes out tinted.
  const tagColors = asObject(raw.tag_colors);
  const comments: PlannedComment[] = [];
  for (const entry of asArray(raw.comments)) {
    const comment = asObject(entry);
    const body = asString(comment?.body);
    const cardKey = asString(comment?.card_id);
    if (body === null || cardKey === null) continue;
    const authorType = asString(comment?.author_type);
    comments.push({
      cardKey,
      body,
      author_label: asString(comment?.author_label),
      author_type:
        authorType === 'agent' || authorType === 'anon' || authorType === 'user'
          ? authorType
          : 'user',
      created_at: parseDate(comment?.created_at, `comments.${cardKey}.created_at`),
    });
  }

  if (raw.share_url !== undefined || raw.share_mode !== undefined) {
    dropped.share_url = 1;
    warnings.push('The v1 share link was dropped: an export never carries a token.');
  }
  if (asArray(raw.member_names).length > 0) dropped.member_names = asArray(raw.member_names).length;

  const plan: ImportPlan = {
    format: 'v1',
    boardName: asString(raw.name),
    columns: plannedColumns,
    cards,
    comments,
    dropped,
    warnings,
  };
  // Attached for apply.ts without a second parameter nobody else needs.
  tagColorsIntoPlan(plan, tagColors);
  return plan;
}

const PLAN_TAG_COLORS = new WeakMap<ImportPlan, Map<string, string>>();

function tagColorsIntoPlan(plan: ImportPlan, raw: Record<string, unknown> | null): void {
  if (raw === null) return;
  const colors = new Map<string, string>();
  for (const [name, value] of Object.entries(raw)) {
    const normalized = normalizeTagName(name);
    const color = asString(value);
    if (normalized !== null && color !== null && /^#[0-9a-fA-F]{6}$/.test(color)) {
      colors.set(normalized, color);
    }
  }
  if (colors.size > 0) PLAN_TAG_COLORS.set(plan, colors);
}

/** The board defaults a v1 file asked for, if any. */
export function planTagColors(plan: ImportPlan): Map<string, string> {
  return PLAN_TAG_COLORS.get(plan) ?? new Map();
}

/**
 * Trello board JSON (§2.2). Lists by `pos`, cards by `pos`; archived lists and
 * archived cards are skipped rather than imported as done — that would invent a
 * state the source never showed.
 */
function planTrello(raw: Record<string, unknown>): ImportPlan {
  const dropped: Record<string, number> = {};
  const lists = asArray(raw.lists);
  if (lists.length === 0) throw unsupportedSchema();

  const openLists = lists
    .map((entry) => asObject(entry))
    .filter((list): list is Record<string, unknown> => list !== null)
    .sort((left, right) => (asNumber(left.pos) ?? 0) - (asNumber(right.pos) ?? 0));
  const plannedColumns: ImportPlan['columns'] = [];
  const nameByKey = new Map<string, string>();
  for (const list of openLists) {
    const id = asString(list.id);
    const name = asString(list.name);
    if (id === null || name === null) continue;
    if (list.closed === true) {
      dropped.lists_closed = (dropped.lists_closed ?? 0) + 1;
      continue;
    }
    plannedColumns.push({
      key: id,
      name,
      position: (plannedColumns.length + 1) * 1024,
    });
    nameByKey.set(id, name);
  }

  const members = new Map<string, string>();
  for (const entry of asArray(raw.members)) {
    const member = asObject(entry);
    const id = asString(member?.id);
    const name = asString(member?.fullName);
    if (id !== null && name !== null) members.set(id, name);
  }

  const cards: PlannedCard[] = [];
  const comments: PlannedComment[] = [];
  const trelloCards = asArray(raw.cards)
    .map((entry) => asObject(entry))
    .filter((card): card is Record<string, unknown> => card !== null)
    .sort((left, right) => (asNumber(left.pos) ?? 0) - (asNumber(right.pos) ?? 0));

  for (const card of trelloCards) {
    if (card.closed === true) {
      dropped.cards_closed = (dropped.cards_closed ?? 0) + 1;
      continue;
    }
    const listId = asString(card.idList);
    const title = asString(card.name);
    if (listId === null || !nameByKey.has(listId) || title === null) continue;
    const tags: PlannableTag[] = [];
    for (const entry of asArray(card.labels)) {
      const label = asObject(entry);
      const colorName = asString(label?.color);
      const rawName = asString(label?.name);
      const name = normalizeTagName(
        rawName !== null && rawName.trim() !== '' ? rawName : `label-${colorName ?? 'none'}`,
      );
      if (name === null) {
        dropped.labels_unreadable = (dropped.labels_unreadable ?? 0) + 1;
        continue;
      }
      // Trello names a colour (`green`, `sky`); Klui stores hexes and the only
      // hexes in this repository live in web/src/styles/tokens.css, which the
      // server cannot read. The name is kept, the colour is dropped and
      // counted: the tag renders with the neutral chip rather than a colour
      // nobody chose.
      if (colorName !== null)
        dropped.labels_colour_dropped = (dropped.labels_colour_dropped ?? 0) + 1;
      tags.push({ name, color: null });
    }
    const memberIds = asArray(card.idMembers)
      .map((value) => asString(value))
      .filter((value): value is string => value !== null);
    const assignee = memberIds.map((id) => members.get(id) ?? null).find((name) => name !== null);
    cards.push({
      sourceId: asString(card.id),
      columnKey: listId,
      title: title.trim().slice(0, 200),
      description: typeof card.desc === 'string' && card.desc.trim() !== '' ? card.desc : null,
      assignee_label: assignee ?? null,
      tags: tags.sort((left, right) => (left.name < right.name ? -1 : 1)),
      due_at: parseDate(card.due, `cards.${String(card.id)}.due`),
      done: false,
      position: asNumber(card.pos) ?? 0,
      created_at: null,
      updated_at: null,
    });
    for (const field of ['checklists', 'attachments', 'actions']) {
      const count = asArray(card[field]).length;
      if (count > 0) dropped[field] = (dropped[field] ?? 0) + count;
    }
    for (const entry of asArray(card.comments)) {
      const comment = asObject(entry);
      const body = asString(comment?.text);
      if (body === null) continue;
      const author = asObject(comment?.author);
      comments.push({
        cardKey: asString(card.id) ?? '',
        body,
        author_label: asString(author?.fullName) ?? asString(author?.username),
        author_type: 'user',
        created_at: parseDate(comment?.date, 'comments.date'),
      });
    }
  }

  return {
    format: 'trello',
    boardName: asString(raw.name),
    columns: plannedColumns,
    cards,
    comments,
    dropped,
    warnings: ['Trello cards are imported with done: false (Trello has no done flag).'],
  };
}
