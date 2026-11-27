// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The reads an agent needs to finish a project: `search_cards` (the filter
 * panel's server twin), `get_activity` (the close-out and the digest's input)
 * and `export_board` (the project has an end).
 *
 * Each one calls the same function its REST route calls, which is also what
 * makes `export_board` byte-identical to `GET /boards/:id/export.json|.md`: one
 * serialiser, one ordering, one `exported_at` format.
 */
import { z } from 'zod';
import type { ToolContext } from '../registry.js';
import { handler } from '../registry.js';
import { listActivity } from '../../activity/service.js';
import { exportDocument } from '../../export/service.js';
import { searchCards } from '../../search/service.js';
import { AppError } from '../../lib/errors.js';
import type { TOOL_SCHEMAS } from '../schemas.js';

type Args<T extends keyof typeof TOOL_SCHEMAS> = z.infer<(typeof TOOL_SCHEMAS)[T]>;

/** docs/mcp.md §4: inline under 256 KB, an error naming REST above it. */
export const INLINE_EXPORT_LIMIT = 256 * 1024;

async function searchCardsTool(
  context: ToolContext,
  args: Args<'search_cards'>,
): Promise<unknown> {
  const { board, tags, ...query } = args;
  return searchCards(context.db, context.actor, board, {
    ...query,
    tags: tags?.map((tag) => (typeof tag === 'string' ? tag : tag.name)),
  });
}

async function getActivityTool(
  context: ToolContext,
  args: Args<'get_activity'>,
): Promise<unknown> {
  return listActivity(context.db, context.actor, args.board, {
    since: args.since,
    limit: args.limit,
  });
}

async function exportBoardTool(
  context: ToolContext,
  args: Args<'export_board'>,
): Promise<unknown> {
  const document = await exportDocument(context.db, context.actor, args.board, args.format, {
    rateLimit: context.env.KLUI_RATE_LIMIT === 'on',
  });
  const bytes = Buffer.byteLength(document.body, 'utf8');
  if (bytes > INLINE_EXPORT_LIMIT) {
    throw new AppError('payload_too_large', {
      message: `This board exports to ${bytes} bytes, more than the 256 KB a tool result carries.`,
      hint: `Download it from GET /api/v1/boards/${args.board}/export.${args.format} with the same key.`,
    });
  }
  return {
    format: args.format,
    filename: document.filename,
    content_type: document.contentType,
    bytes,
    content: document.body,
  };
}

export const readTools = {
  search_cards: handler(searchCardsTool),
  get_activity: handler(getActivityTool),
  export_board: handler(exportBoardTool),
};
