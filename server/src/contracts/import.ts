// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The import request contract (docs/api.md §1, docs/features/import-export.md
 * §2). Only `klui.export/v2` is ours and therefore schema-checked; v1 and
 * Trello are foreign shapes and are narrowed in plan.ts, where every rejected
 * field has to name itself in the error.
 */
import { z } from 'zod';

export const IMPORT_FORMATS = ['v2', 'v1', 'trello'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/** 5 MB, 5 000 cards, 200 columns, 20 000 comments: the published limits (§2). */
export const IMPORT_LIMITS = {
  bytes: 5 * 1024 * 1024,
  cards: 5_000,
  columns: 200,
  comments: 20_000,
} as const;

export const importRequestSchema = z
  .object({
    format: z.enum(IMPORT_FORMATS),
    data: z.unknown(),
  })
  .strict();

export type ImportRequest = z.infer<typeof importRequestSchema>;

/** A bare string is accepted as `{name}`; responses always emit objects (§1). */
export const tagInputSchema = z.union([
  z.string().min(1).max(64),
  z.object({ name: z.string().min(1).max(64), color: z.string().max(32).nullish() }),
]);

export const importV2ColumnSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  position: z.number().finite().optional(),
});

export const importV2CardSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  column_id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  description: z.string().max(100_000).nullish(),
  assignee: z.string().max(120).nullish(),
  tags: z.array(tagInputSchema).max(64).optional(),
  due_at: z.string().max(64).nullish(),
  done: z.boolean().optional(),
  position: z.number().finite().optional(),
  created_at: z.string().max(64).nullish(),
  updated_at: z.string().max(64).nullish(),
});

export const importV2CommentSchema = z.object({
  card_id: z.string().min(1).max(64),
  body: z.string().min(1).max(20_000),
  author_label: z.string().max(120).nullish(),
  author_type: z.enum(['user', 'agent', 'anon']).optional(),
  created_at: z.string().max(64).nullish(),
});

export const importV2Schema = z.object({
  schema: z.literal('klui.export/v2'),
  exported_at: z.string().max(64).optional(),
  board: z
    .object({
      name: z.string().max(120).optional(),
      visibility: z.string().max(16).optional(),
      link_role: z.string().max(16).optional(),
      anon_write: z.string().max(16).optional(),
    })
    .optional(),
  // The limits are enforced in plan.ts, where the answer is `413` and names the
  // limit; a `.max()` here would turn the same file into a `400`.
  columns: z.array(importV2ColumnSchema).min(1),
  cards: z.array(importV2CardSchema),
  comments: z.array(importV2CommentSchema).optional(),
});

export type ImportV2 = z.infer<typeof importV2Schema>;
