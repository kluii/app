// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The parity table of docs/mcp.md §6, as data.
 *
 * Three things read it: the parity test (which asserts both directions), the
 * `export_board` byte-identity test, and `/llms.txt`, which is generated from
 * this file so the public list cannot drift from the registry.
 *
 * The rule it encodes: every tool has an app equivalent and vice versa. A tool
 * without a route must not ship, and a route added without a tool fails the
 * test rather than waiting for someone to notice.
 */
import type { ToolName } from './schemas.js';

export type ParityRow = {
  tool: ToolName;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | null;
  /** The REST path, or null for a tool with no route (never: see `whoami`). */
  route: string | null;
  /** The human surface the same operation lives on. */
  app: string;
  /** Route paths that only exist because a tool needed them. */
  addedForTool?: boolean;
  /** Other routes serving the same tool (two export formats, one serialiser). */
  extraRoutes?: string[];
};

export const PARITY: ParityRow[] = [
  { tool: 'list_boards', method: 'GET', route: '/api/v1/boards', app: 'Boards index' },
  {
    tool: 'get_board',
    method: 'GET',
    route: '/api/v1/boards/:id/state',
    app: 'Board',
  },
  { tool: 'create_board', method: 'POST', route: '/api/v1/boards', app: 'Boards index → New' },
  { tool: 'update_board', method: 'PATCH', route: '/api/v1/boards/:id', app: 'Board settings' },
  {
    tool: 'delete_board',
    method: 'DELETE',
    route: '/api/v1/boards/:id',
    app: 'Board settings → Danger',
  },
  {
    tool: 'create_column',
    method: 'POST',
    route: '/api/v1/boards/:id/columns',
    app: 'Board → Add column',
  },
  {
    tool: 'update_column',
    method: 'PATCH',
    route: '/api/v1/columns/:id',
    app: 'Column menu → Rename',
  },
  {
    tool: 'delete_column',
    method: 'DELETE',
    route: '/api/v1/columns/:id',
    app: 'Column menu → Delete',
  },
  {
    tool: 'create_card',
    method: 'POST',
    route: '/api/v1/boards/:id/cards',
    app: 'New card modal',
  },
  {
    tool: 'bulk_create_cards',
    method: 'POST',
    route: '/api/v1/boards/:id/cards/bulk',
    app: 'Import / quick fill',
  },
  { tool: 'get_card', method: 'GET', route: '/api/v1/cards/:id', app: 'Card read modal' },
  { tool: 'update_card', method: 'PATCH', route: '/api/v1/cards/:id', app: 'Card edit modal' },
  { tool: 'move_card', method: 'POST', route: '/api/v1/cards/:id/move', app: 'Drag and drop' },
  {
    tool: 'set_card_done',
    method: 'PATCH',
    route: '/api/v1/cards/:id',
    app: 'Done tick',
  },
  {
    tool: 'delete_card',
    method: 'DELETE',
    route: '/api/v1/cards/:id',
    app: 'Card menu → Delete',
  },
  {
    tool: 'list_comments',
    method: 'GET',
    route: '/api/v1/cards/:id/comments',
    app: 'Card read modal',
  },
  {
    tool: 'create_comment',
    method: 'POST',
    route: '/api/v1/cards/:id/comments',
    app: 'Card read modal',
  },
  {
    tool: 'search_cards',
    method: 'GET',
    route: '/api/v1/boards/:id/search',
    app: 'Filter panel',
    addedForTool: true,
  },
  {
    tool: 'get_activity',
    method: 'GET',
    route: '/api/v1/boards/:id/activity',
    app: 'Activity tab',
  },
  {
    tool: 'export_board',
    method: 'GET',
    route: '/api/v1/boards/:id/export.json',
    app: 'Board settings → Export',
    extraRoutes: ['/api/v1/boards/:id/export.md'],
  },
  { tool: 'whoami', method: 'GET', route: '/api/v1/me', app: 'Account menu' },
];

/**
 * Routes the product exposes that have no tool, each deliberately human-only
 * (docs/mcp.md §6). Anything else without a tool fails the parity test.
 */
export const HUMAN_ONLY_ROUTES: { method: string; path: string; why: string }[] = [
  {
    method: 'GET',
    path: '/api/v1/boards/:id',
    why: 'The board without content; `get_board` answers with the whole state.',
  },
  {
    method: 'GET',
    path: '/api/v1/boards/:id/members',
    why: 'Members already ride on get_board.',
  },
  {
    method: 'POST',
    path: '/api/v1/boards/:id/members',
    why: 'Inviting is an account action an agent key has no authority for.',
  },
  {
    method: 'PATCH',
    path: '/api/v1/boards/:id/members/:userId',
    why: 'Changing a role is an account action.',
  },
  {
    method: 'DELETE',
    path: '/api/v1/boards/:id/members/:userId',
    why: 'Removing a person is an account action.',
  },
  {
    method: 'POST',
    path: '/api/v1/boards/:id/transfer',
    why: 'Ownership moves only between accounts.',
  },
  {
    method: 'POST',
    path: '/api/v1/boards/:id/link-suffix/rotate',
    why: 'Rotating the share URL breaks every holder; a human decides that.',
  },
  {
    method: 'GET',
    path: '/api/v1/boards/:id/public',
    why: 'The credential-less face of a board; a key never needs it.',
  },
  {
    method: 'GET',
    path: '/api/v1/boards/:id/tag-colors',
    why: 'Tag colours ride on every card the tools return.',
  },
  {
    method: 'PUT',
    path: '/api/v1/boards/:id/tag-colors',
    why: 'An agent must not silently repaint a board (docs/mcp.md §3).',
  },
  {
    method: 'POST',
    path: '/api/v1/boards/:id/close',
    why: 'Closing is irreversible and generates the summary a human signs off.',
  },
  {
    method: 'GET',
    path: '/api/v1/boards/:id/summary',
    why: 'The close-out is read as a document, not per card.',
  },
  {
    method: 'GET',
    path: '/api/v1/boards/:id/summary.md',
    why: 'The Markdown close-out, same document.',
  },
  {
    method: 'POST',
    path: '/api/v1/boards/:id/anon',
    why: 'Joining as a visitor is a browser act; an agent holds a key instead.',
  },
  {
    method: 'GET',
    path: '/api/v1/boards/:id/pending',
    why: 'The moderation queue is a human decision surface.',
  },
  {
    method: 'POST',
    path: '/api/v1/boards/:id/pending/:pendingId/approve',
    why: 'Moderation is a human act.',
  },
  {
    method: 'POST',
    path: '/api/v1/boards/:id/pending/:pendingId/reject',
    why: 'Moderation is a human act.',
  },
  {
    method: 'GET',
    path: '/api/v1/boards/:id/links',
    why: 'A share link is a credential; listing them is an owner view.',
  },
  {
    method: 'POST',
    path: '/api/v1/boards/:id/links',
    why: 'Minting a link hands out access; that stays with an account.',
  },
  {
    method: 'DELETE',
    path: '/api/v1/boards/:id/links/:linkId',
    why: 'Revoking a link is an owner action.',
  },
  {
    method: 'POST',
    path: '/api/v1/boards/:id/import',
    why: 'Import is a bulk human action with its own job, limits and progress.',
  },
  {
    method: 'PATCH',
    path: '/api/v1/comments/:id',
    why: 'An agent may add a comment, not rewrite a human’s words.',
  },
  {
    method: 'DELETE',
    path: '/api/v1/comments/:id',
    why: 'Same: moderating a thread is a human act.',
  },
  {
    method: 'GET',
    path: '/api/v1/users/:username/boards',
    why: 'The public profile, for a crawler or a visitor without a key.',
  },
  {
    method: 'GET',
    path: '/api/v1/users/:username/boards/:segment/resolve',
    why: 'Resolves a human URL to a board id; a key already has the id.',
  },
  {
    method: 'GET',
    path: '/api/v1/users/:username/boards/:slug',
    why: 'The 301 a browser follows from a human URL.',
  },
];

/**
 * The namespaces the parity rule covers: board content. Auth, admin, `/me`
 * sessions and the health probes are not content and are not tool surface.
 */
export const PARITY_NAMESPACES = [
  '/api/v1/boards',
  '/api/v1/cards',
  '/api/v1/columns',
  '/api/v1/comments',
  '/api/v1/users',
];
