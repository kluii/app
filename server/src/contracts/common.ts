// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { ID_TOTAL_LENGTH, type IdPrefix } from '../lib/ids.js';

/** Ids are opaque: `<prefix>_` + 22 base62 characters, 26 in total (docs/api.md §2). */
export function idSchema(prefix: IdPrefix) {
  return z
    .string()
    .regex(
      new RegExp(`^${prefix}_[0-9A-Za-z]{${ID_TOTAL_LENGTH - prefix.length - 1}}$`),
      `expected a ${prefix}_… id`,
    );
}

export const isoDateTime = z.string().datetime({ offset: true });

export const expectedUpdatedAt = z
  .string()
  .datetime({ offset: true })
  .optional()
  .describe('The value the client last saw; a mismatch answers 409 with the current row.');

export const paginationQuery = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
};

export const confirmSchema = z.object({ confirm: z.literal(true) });

/** The documented error envelope, used in OpenAPI and by the contract tests. */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    hint: z.string().nullable(),
    details: z
      .array(z.object({ path: z.string(), code: z.string(), message: z.string() }))
      .optional(),
    current: z.unknown().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
