// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { expectedUpdatedAt, idSchema, isoDateTime } from './common.js';

export const cardTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !value.includes('\n'), 'a title is one line');

export const tagNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(24)
  .regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and hyphens');

export const tagInputSchema = z.union([
  tagNameSchema,
  z
    .object({
      name: tagNameSchema,
      color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
    })
    .strict(),
]);

export const tagsSchema = z
  .array(tagInputSchema)
  .max(8)
  .transform((values) =>
    values.map((value) =>
      typeof value === 'string' ? { name: value } : { name: value.name, color: value.color },
    ),
  );

export const createCardSchema = z
  .object({
    column: idSchema('col'),
    title: cardTitleSchema,
    description: z.string().max(10_000).optional(),
    assignee: z.string().max(64).optional(),
    assignee_label: z.string().min(1).max(32).optional(),
    due_at: isoDateTime.optional(),
    tags: tagsSchema.optional(),
    done: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !(value.assignee && value.assignee_label), {
    message: 'assignee and assignee_label are exclusive: a member id, or a display name',
    path: ['assignee'],
  });

export const updateCardSchema = z
  .object({
    title: cardTitleSchema.optional(),
    description: z.string().max(10_000).nullable().optional(),
    assignee: z.string().max(64).nullable().optional(),
    assignee_label: z.string().min(1).max(32).nullable().optional(),
    due_at: isoDateTime.nullable().optional(),
    tags: tagsSchema.optional(),
    done: z.boolean().optional(),
    expected_updated_at: expectedUpdatedAt,
  })
  .strict();

const neighbourSchema = idSchema('crd').nullable().optional();

export const moveCardSchema = z
  .object({
    column: idSchema('col'),
    before: neighbourSchema,
    after: neighbourSchema,
  })
  .strict();

export const columnNameSchema = z.string().trim().min(1).max(64);

export const createColumnSchema = z
  .object({
    name: columnNameSchema,
    position: z
      .object({ before: idSchema('col').optional(), after: idSchema('col').optional() })
      .strict()
      .optional(),
  })
  .strict();

export const updateColumnSchema = z
  .object({
    name: columnNameSchema.optional(),
    expected_updated_at: expectedUpdatedAt,
  })
  .strict();

export const deleteColumnSchema = z
  .object({
    move_cards_to: idSchema('col').optional(),
    delete_cards: z.literal(true).optional(),
  })
  .strict();

export type CreateCardInput = z.infer<typeof createCardSchema>;
export type UpdateCardInput = z.infer<typeof updateCardSchema>;
export type MoveCardInput = z.infer<typeof moveCardSchema>;
