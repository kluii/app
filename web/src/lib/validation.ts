// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The browser mirror of `server/src/contracts/auth.ts` and
 * `server/src/lib/reserved.ts`. The server is the authority; this file exists so
 * the form can answer before a round trip. `web/test/validation.test.ts` reads
 * the server files and fails when the two drift, which is the only reason this
 * duplication is allowed to exist.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/;

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

/** Mirrors `RESERVED_MESSAGE` in the server module: the client matches on it. */
export const RESERVED_MESSAGE = 'that name is reserved';

export const RESERVED_WORDS = [
  'api',
  'admin',
  'auth',
  'healthz',
  'mcp',
  'metrics',
  'login',
  'logout',
  'signup',
  'reset',
  'settings',
  'account',
  'boards',
  'board',
  'l',
  'u',
  'og',
  'assets',
  'static',
  'sitemap',
  'robots',
  'favicon',
  'well-known',
  'openapi',
  'llms',
  'klui',
  'support',
  'help',
  'security',
  'abuse',
  'root',
  'administrator',
  'moderator',
  'staff',
  'team',
  'official',
  'system',
  'wyliam',
  'docs',
  'blog',
  'pricing',
  'billing',
  'status',
  'new',
  'edit',
  'delete',
  'create',
  'invite',
  'join',
  'share',
  'export',
  'import',
] as const;

const RESERVED = new Set<string>(RESERVED_WORDS);

export type NameProblem = 'too_short' | 'too_long' | 'shape' | 'reserved';

export function checkUsername(value: string): NameProblem | null {
  if (value.length < USERNAME_MIN) return 'too_short';
  if (value.length > USERNAME_MAX) return 'too_long';
  if (!USERNAME_PATTERN.test(value)) return 'shape';
  if (RESERVED.has(value)) return 'reserved';
  return null;
}

export function checkSlug(value: string): NameProblem | null {
  if (value.length < SLUG_MIN) return 'too_short';
  if (value.length > SLUG_MAX) return 'too_long';
  if (!SLUG_PATTERN.test(value)) return 'shape';
  if (RESERVED.has(value)) return 'reserved';
  return null;
}
