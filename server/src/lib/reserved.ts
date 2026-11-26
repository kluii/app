// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Names nobody may take (D-13, docs/permissions.md §6). Three reasons to be on
 * this list, and only three: a name the application routes on, a name that
 * would impersonate the instance or its operators, and a name that becomes a
 * different URL once someone links it.
 */
const RESERVED = new Set([
  // routes the server answers on
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
  // impersonation
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
  // reserved for a future route, so it cannot be taken by a stranger first
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
]);

export function isReserved(name: string): boolean {
  return RESERVED.has(name.toLowerCase());
}

export function reservedWords(): string[] {
  return [...RESERVED].sort();
}

export const RESERVED_MESSAGE = 'that name is reserved';
