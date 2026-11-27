// SPDX-License-Identifier: AGPL-3.0-only
import { isIP } from 'node:net';
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

/**
 * An address ban is the anonymous path's counterpart to an account ban: there
 * is no user row to suspend, so the address is the subject. `isIP` accepts both
 * families; the value is stored verbatim and matched against `request.ip`,
 * which is already normalised by `KLUI_TRUSTED_PROXY_HOPS`.
 */
export const banAddressSchema = z
  .object({
    ip: z
      .string()
      .trim()
      .refine((value) => isIP(value) !== 0, {
        message: 'Enter an IPv4 or IPv6 address.',
      }),
    reason: z.string().trim().max(280).optional(),
    expires_at: isoDateTime.nullable().optional(),
    confirm: z.literal(true),
  })
  .strict();

export type BanAddressInput = z.infer<typeof banAddressSchema>;
