// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { expectedUpdatedAt, idSchema } from './common.js';
import { slugSchema } from './auth.js';

export const boardNameSchema = z.string().trim().min(1).max(80);
export const visibilitySchema = z.enum(['private', 'link', 'public']);
export const linkRoleSchema = z.enum(['read', 'edit', 'none']);
export const anonWriteSchema = z.enum(['off', 'open', 'moderated']);

export const createBoardSchema = z.object({
  name: boardNameSchema,
  visibility: visibilitySchema.optional(),
  template: z.enum(['classic', 'blank']).optional(),
});

export const patchBoardSchema = z
  .object({
    name: boardNameSchema.optional(),
    slug: slugSchema.optional(),
    visibility: visibilitySchema.optional(),
    link_role: linkRoleSchema.optional(),
    anon_write: anonWriteSchema.optional(),
    expected_updated_at: expectedUpdatedAt,
  })
  .strict()
  .refine(
    (value) =>
      value.visibility !== 'private' ||
      ((value.link_role === undefined || value.link_role === 'none') &&
        (value.anon_write === undefined || value.anon_write === 'off')),
    {
      message:
        'a private board cannot have a link role or anonymous writes; set both to none/off in the same request',
      path: ['visibility'],
    },
  );

export const boardIdParam = z.object({ id: idSchema('brd') });

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type PatchBoardInput = z.infer<typeof patchBoardSchema>;
