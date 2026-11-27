// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { emailSchema } from './auth.js';

/**
 * The digest settings write (docs/api.md §7, digest.md §2.3–§2.4).
 *
 * `hour` is a wall-clock hour in the account's IANA zone, not an offset: an
 * offset is wrong twice a year and the account would drift by an hour with it.
 * `rss` has exactly two verbs, because a token is shown once: `rotate` returns a
 * new URL and invalidates the old one, `disable` removes it.
 */
export const digestUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    hour: z.number().int().min(0).max(23).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    webhook: z.string().trim().max(2048).url().nullable().optional(),
    email: emailSchema.nullable().optional(),
    rss: z.enum(['rotate', 'disable']).optional(),
  })
  .strict();

export type DigestUpdateInput = z.infer<typeof digestUpdateSchema>;
