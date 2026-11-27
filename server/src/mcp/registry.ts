// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A tool is an adapter, not an implementation (docs/mcp.md §3).
 *
 * Every handler in `mcp/tools/` calls the same service function its REST route
 * calls: same `can()`, same transaction, same event, same DTO. A second
 * implementation here would be a bug even when its own test passed, so this
 * file holds no board logic at all — only the pair check the tool contract adds
 * (`{board, card}` must name a card in that board) and the registry.
 */
import type { Db } from '../db.js';
import type { Env } from '../env.js';
import type { Actor } from '../lib/authz.js';
import { AppError } from '../lib/errors.js';
import type { Hub } from '../realtime/events.js';
import { TOOL_NAMES, TOOL_SCHEMAS, type ToolName } from './schemas.js';
import { boardsTools } from './tools/boards.js';
import { cardTools } from './tools/cards.js';
import { columnTools } from './tools/columns.js';
import { commentTools } from './tools/comments.js';
import { identityTools } from './tools/identity.js';
import { readTools } from './tools/read.js';

export type ToolContext = { db: Db; actor: Actor; env: Env; hub: Hub };

export type ToolHandler = (context: ToolContext, args: never) => Promise<unknown>;

/**
 * One cast, here: the registry stores handlers of many argument shapes, and
 * `tools/call` has already validated the arguments against the tool's schema.
 */
export function handler<Args>(tool: (context: ToolContext, args: Args) => Promise<unknown>): ToolHandler {
  return tool as unknown as ToolHandler;
}

/** `{board, card}` names one thing or nothing: a card in another board is a 404. */
export async function requireCardInBoard(db: Db, boardId: string, cardId: string): Promise<void> {
  const card = await db.card.findFirst({
    where: { id: cardId, board_id: boardId },
    select: { id: true },
  });
  if (!card) throw new AppError('card_not_found');
}

/** The same rule for a column, which is board-scoped too. */
export async function requireColumnInBoard(
  db: Db,
  boardId: string,
  columnId: string,
): Promise<void> {
  const column = await db.column.findFirst({
    where: { id: columnId, board_id: boardId },
    select: { id: true },
  });
  if (!column) throw new AppError('column_not_found');
}

/**
 * A tag reaches a tool as a bare string or as `{name, color}` (docs/mcp.md §3).
 * The service layer takes the object form, so the adapter normalises once here
 * rather than in four handlers.
 */
export function toTagRows(
  tags: (string | { name: string; color?: string | undefined })[] | undefined,
): { name: string; color?: string }[] | undefined {
  if (tags === undefined) return undefined;
  return tags.map((tag) => (typeof tag === 'string' ? { name: tag } : { ...tag }));
}

export const TOOL_HANDLERS: Partial<Record<ToolName, ToolHandler>> = {
  ...boardsTools,
  ...columnTools,
  ...cardTools,
  ...commentTools,
  ...readTools,
  ...identityTools,
};

/**
 * What `tools/list` serves: the registry filtered to handlers that exist. The
 * transport and the parity test both read this, so the list cannot drift from
 * what a call would actually do.
 */
export const LISTED_TOOLS: ToolName[] = TOOL_NAMES.filter(
  (name) => TOOL_HANDLERS[name] !== undefined,
);

export function handlerFor(name: ToolName): ToolHandler | undefined {
  return TOOL_HANDLERS[name];
}

export { TOOL_SCHEMAS };
export type { ToolName };
