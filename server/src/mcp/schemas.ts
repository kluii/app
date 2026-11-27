// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The frozen tool surface (docs/mcp.md §3). These Zod schemas are the source of
 * truth: `tools/list` renders them as JSON Schema, `tools/call` validates with
 * them, and an error names the parameter it refused.
 */
import { z } from 'zod';

const boardId = z.string().regex(/^brd_[0-9A-Za-z]{22}$/u, 'a board id (brd_…)');
const cardId = z.string().regex(/^crd_[0-9A-Za-z]{22}$/u, 'a card id (crd_…)');
const columnId = z.string().regex(/^col_[0-9A-Za-z]{22}$/u, 'a column id (col_…)');

const tagInput = z.union([
  z.string().min(1).max(24),
  z
    .object({
      name: z.string().min(1).max(24),
      color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/u)
        .optional(),
    })
    .strict(),
]);

const cardItem = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(10_000).optional(),
    assignee: z.string().min(1).max(64).optional(),
    due_at: z.string().datetime({ offset: true }).optional(),
    tags: z.array(tagInput).max(8).optional(),
    done: z.boolean().optional(),
  })
  .strict();

export const TOOL_SCHEMAS = {
  list_boards: z.object({}).strict(),
  get_board: z.object({ board: boardId }).strict(),
  create_board: z
    .object({
      name: z.string().min(1).max(80),
      visibility: z.enum(['private', 'link', 'public']).optional(),
    })
    .strict(),
  update_board: z
    .object({
      board: boardId,
      name: z.string().min(1).max(80).optional(),
      slug: z.string().min(3).max(40).optional(),
      visibility: z.enum(['private', 'link', 'public']).optional(),
      link_role: z.enum(['read', 'edit', 'none']).optional(),
      anon_write: z.enum(['off', 'open', 'moderated']).optional(),
    })
    .strict(),
  delete_board: z.object({ board: boardId, confirm: z.literal(true) }).strict(),
  create_column: z
    .object({
      board: boardId,
      name: z.string().min(1).max(64),
      position: z
        .object({ before: columnId.optional(), after: columnId.optional() })
        .strict()
        .optional(),
    })
    .strict(),
  update_column: z
    .object({
      board: boardId,
      column: columnId,
      name: z.string().min(1).max(64).optional(),
    })
    .strict(),
  delete_column: z
    .object({
      board: boardId,
      column: columnId,
      move_cards_to: columnId.optional(),
      delete_cards: z.boolean().optional(),
    })
    .strict(),
  create_card: z
    .object({
      board: boardId,
      column: columnId,
      title: z.string().min(1).max(200),
      description: z.string().max(10_000).optional(),
      assignee: z.string().min(1).max(64).optional(),
      due_at: z.string().datetime({ offset: true }).optional(),
      tags: z.array(tagInput).max(8).optional(),
    })
    .strict(),
  bulk_create_cards: z
    .object({
      board: boardId,
      column: columnId,
      items: z.array(cardItem).min(1).max(200),
    })
    .strict(),
  get_card: z.object({ board: boardId, card: cardId }).strict(),
  update_card: z
    .object({
      board: boardId,
      card: cardId,
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(10_000).nullable().optional(),
      assignee: z.string().min(1).max(64).nullable().optional(),
      due_at: z.string().datetime({ offset: true }).nullable().optional(),
      tags: z.array(tagInput).max(8).optional(),
      done: z.boolean().optional(),
      expected_updated_at: z.string().datetime({ offset: true }).optional(),
    })
    .strict(),
  move_card: z
    .object({
      board: boardId,
      card: cardId,
      column: columnId,
      before: cardId.nullable().optional(),
      after: cardId.nullable().optional(),
    })
    .strict(),
  set_card_done: z.object({ board: boardId, card: cardId, done: z.boolean() }).strict(),
  delete_card: z.object({ board: boardId, card: cardId }).strict(),
  list_comments: z.object({ board: boardId, card: cardId }).strict(),
  create_comment: z
    .object({ board: boardId, card: cardId, body: z.string().min(1).max(10_000) })
    .strict(),
  search_cards: z
    .object({
      board: boardId,
      query: z.string().max(200).optional(),
      assignee: z.string().max(64).optional(),
      tags: z.array(tagInput).max(8).optional(),
      done: z.boolean().optional(),
      column: columnId.optional(),
    })
    .strict(),
  get_activity: z
    .object({
      board: boardId,
      since: z.string().datetime({ offset: true }).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    })
    .strict(),
  export_board: z.object({ board: boardId, format: z.enum(['json', 'md']) }).strict(),
  whoami: z.object({}).strict(),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

export const TOOL_NAMES = Object.keys(TOOL_SCHEMAS) as ToolName[];

/** One working example per tool, quoted in every `-32602` (docs/mcp.md §2). */
export const TOOL_EXAMPLES: Record<ToolName, Record<string, unknown>> = {
  list_boards: {},
  get_board: { board: 'brd_01JABCDEFGHJKLMNPQRSTU' },
  create_board: { name: 'Retro S3', visibility: 'private' },
  update_board: { board: 'brd_01JABCDEFGHJKLMNPQRSTU', name: 'Retro S3' },
  delete_board: { board: 'brd_01JABCDEFGHJKLMNPQRSTU', confirm: true },
  create_column: { board: 'brd_01JABCDEFGHJKLMNPQRSTU', name: 'Doing' },
  update_column: {
    board: 'brd_01JABCDEFGHJKLMNPQRSTU',
    column: 'col_01JABCDEFGHJKLMNPQRSTU',
    name: 'In progress',
  },
  delete_column: {
    board: 'brd_01JABCDEFGHJKLMNPQRSTU',
    column: 'col_01JABCDEFGHJKLMNPQRSTU',
  },
  create_card: {
    board: 'brd_01JABCDEFGHJKLMNPQRSTU',
    column: 'col_01JABCDEFGHJKLMNPQRSTU',
    title: 'Wire the digest',
  },
  bulk_create_cards: {
    board: 'brd_01JABCDEFGHJKLMNPQRSTU',
    column: 'col_01JABCDEFGHJKLMNPQRSTU',
    items: [{ title: 'First' }, { title: 'Second' }],
  },
  get_card: {
    board: 'brd_01JABCDEFGHJKLMNPQRSTU',
    card: 'crd_01JABCDEFGHJKLMNPQRSTU',
  },
  update_card: {
    board: 'brd_01JABCDEFGHJKLMNPQRSTU',
    card: 'crd_01JABCDEFGHJKLMNPQRSTU',
    title: 'Wire the digest, again',
  },
  move_card: {
    board: 'brd_01JABCDEFGHJKLMNPQRSTU',
    card: 'crd_01JABCDEFGHJKLMNPQRSTU',
    column: 'col_01JABCDEFGHJKLMNPQRSTU',
    before: null,
    after: 'crd_01JABCDEFGHJKLMNPQRSTU',
  },
  set_card_done: {
    board: 'brd_01JABCDEFGHJKLMNPQRSTU',
    card: 'crd_01JABCDEFGHJKLMNPQRSTU',
    done: true,
  },
  delete_card: {
    board: 'brd_01JABCDEFGHJKLMNPQRSTU',
    card: 'crd_01JABCDEFGHJKLMNPQRSTU',
  },
  list_comments: {
    board: 'brd_01JABCDEFGHJKLMNPQRSTU',
    card: 'crd_01JABCDEFGHJKLMNPQRSTU',
  },
  create_comment: {
    board: 'brd_01JABCDEFGHJKLMNPQRSTU',
    card: 'crd_01JABCDEFGHJKLMNPQRSTU',
    body: 'Picked this up.',
  },
  search_cards: { board: 'brd_01JABCDEFGHJKLMNPQRSTU', query: 'digest' },
  get_activity: { board: 'brd_01JABCDEFGHJKLMNPQRSTU', limit: 50 },
  export_board: { board: 'brd_01JABCDEFGHJKLMNPQRSTU', format: 'json' },
  whoami: {},
};
