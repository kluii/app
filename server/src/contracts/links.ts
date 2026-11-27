// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { idSchema } from './common.js';

export const linkRoleSchema = z.enum(['read', 'edit']);

export const createLinkSchema = z
  .object({
    role: linkRoleSchema,
    label: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const linkIdParam = z.object({ id: idSchema('brd'), linkId: idSchema('lnk') });

export const linkTokenParam = z.object({ token: z.string().min(16).max(128) });

export type CreateLinkInput = z.infer<typeof createLinkSchema>;
