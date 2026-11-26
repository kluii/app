// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { isoDateTime } from './common.js';

export const banUserSchema = z
  .object({
    reason: z.string().trim().max(280).optional(),
    expires_at: isoDateTime.nullable().optional(),
    // An accidental ban is a support ticket; the confirmation is the seatbelt.
    confirm: z.literal(true),
  })
  .strict();

export type BanUserInput = z.infer<typeof banUserSchema>;
