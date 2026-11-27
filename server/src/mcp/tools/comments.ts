// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Comment tools (docs/mcp.md §3), adapters over `comments/service.ts` — the same
 * functions `GET` and `POST /cards/:id/comments` call, so an agent reads the
 * same page a human does and writes the same event.
 */
import { z } from 'zod';
import type { ToolContext } from '../registry.js';
import { handler, requireCardInBoard } from '../registry.js';
import { createComment, listComments } from '../../comments/service.js';
import type { TOOL_SCHEMAS } from '../schemas.js';

type Args<T extends keyof typeof TOOL_SCHEMAS> = z.infer<(typeof TOOL_SCHEMAS)[T]>;

async function listCommentsTool(
  context: ToolContext,
  args: Args<'list_comments'>,
): Promise<unknown> {
  await requireCardInBoard(context.db, args.board, args.card);
  // One page, the documented default: the tool has no `cursor` (docs/mcp.md §3).
  return listComments({ db: context.db, actor: context.actor, hub: context.hub }, args.card, {
    limit: 100,
    cursor: null,
  });
}

async function createCommentTool(
  context: ToolContext,
  args: Args<'create_comment'>,
): Promise<unknown> {
  await requireCardInBoard(context.db, args.board, args.card);
  return createComment({ db: context.db, actor: context.actor, hub: context.hub }, args.card, args.body);
}

export const commentTools = {
  list_comments: handler(listCommentsTool),
  create_comment: handler(createCommentTool),
};
