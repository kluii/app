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
  .strict();

/**
 * The one rule for "private means no share policy", applied to the **merged**
 * next state by the route (docs/permissions.md §4.3).
 *
 * A payload-only refinement was not enough: `PATCH {"link_role":"edit"}` has no
 * `visibility`, so the guard never ran and the board accepted a link role it can
 * never honour. `visibility: 'private'` coerces both fields in the same request;
 * naming a value that contradicts it is a 400 rather than a silent rewrite.
 */
export function sharePolicyConflict(next: {
  visibility: string;
  link_role: string;
  anon_write: string;
}): { field: 'link_role' | 'anon_write'; message: string } | null {
  if (next.visibility !== 'private') return null;
  if (next.link_role !== 'none') {
    return {
      field: 'link_role',
      message:
        'a private board cannot have a link role: set visibility to link or public first, or send link_role: "none"',
    };
  }
  if (next.anon_write !== 'off') {
    return {
      field: 'anon_write',
      message:
        'a private board cannot accept anonymous writes: set visibility to link or public first, or send anon_write: "off"',
    };
  }
  return null;
}

/**
 * Rotating the readable suffix is destructive for whoever holds the old URL, so
 * it carries the same explicit `confirm: true` every irreversible action does.
 */
export const rotateSuffixSchema = z.object({ confirm: z.literal(true) }).strict();

export const boardIdParam = z.object({ id: idSchema('brd') });

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type PatchBoardInput = z.infer<typeof patchBoardSchema>;
