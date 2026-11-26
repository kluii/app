// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { RESERVED_MESSAGE, isReserved } from '../lib/reserved.js';

/**
 * One validation module for usernames, used by REST, MCP and the UI
 * (docs/permissions.md §6, K1-08). The UI mirrors these rules in
 * web/src/lib/validation.ts and a test asserts the same error codes.
 */
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;
export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

/**
 * One validation module for every surface (K1-08): REST, MCP and the UI all
 * answer the same code for the same input. `reserved` is a separate issue code
 * so a client can tell "the shape is wrong" from "somebody already claimed it".
 */
export const usernameSchema = z
  .string()
  .min(USERNAME_MIN)
  .max(USERNAME_MAX)
  .regex(USERNAME_PATTERN, 'lowercase letters, digits and single hyphens, no hyphen at either end')
  .refine((value) => !isReserved(value), RESERVED_MESSAGE);

export const slugSchema = z
  .string()
  .min(SLUG_MIN)
  .max(SLUG_MAX)
  .regex(SLUG_PATTERN, 'lowercase letters, digits and single hyphens, no hyphen at either end')
  .refine((value) => !isReserved(value), RESERVED_MESSAGE);

export const emailSchema = z.string().trim().toLowerCase().max(254).email();

export const passwordSchema = z.string().min(12).max(256);

export const patchMeSchema = z
  .object({
    username: usernameSchema.optional(),
    display_name: z.string().trim().min(1).max(64).nullable().optional(),
    email: emailSchema.optional(),
  })
  .strict();

export const signupSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  invite_token: z.string().max(200).optional(),
});

export const loginSchema = z
  .object({
    email_or_username: z.string().min(1).max(254),
    password: z.string().min(1).max(256),
    totp: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    recovery_code: z.string().min(20).max(32).optional(),
  })
  .refine((value) => !(value.totp && value.recovery_code), {
    message: 'send a TOTP code or a recovery code, not both',
    path: ['recovery_code'],
  });

export const totpVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export const totpDisableSchema = z.object({
  password: z.string().min(1).max(256),
  code: z.string().regex(/^\d{6}$/),
});

export const recoveryCodesSchema = z.object({
  password: z.string().min(1).max(256),
});

export const resetRequestSchema = z.object({
  email: emailSchema,
});

export const resetConfirmSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  username: z.string(),
  display_name: z.string().nullable(),
  totp_enabled: z.boolean(),
  is_instance_admin: z.boolean(),
  created_at: z.string(),
});

export const sessionCookieName = 'klui_session';
export const csrfCookieName = 'klui_csrf';
export const csrfHeaderName = 'x-klui-csrf';

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type Me = z.infer<typeof meSchema>;
