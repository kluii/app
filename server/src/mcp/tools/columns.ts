// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Column tools (docs/mcp.md §3), adapters over `columns/service.ts` — the same
 * functions `POST /boards/:id/columns`, `PATCH /columns/:id` and
 * `DELETE /columns/:id` call.
 *
 * `{board, column}` must name a column of that board: a mismatch is
 * `column_not_found`, never a write to a column the caller only guessed.
 */
import { z } from 'zod';
import type { ToolContext } from '../registry.js';
import { handler, requireColumnInBoard } from '../registry.js';
import { createColumn, deleteColumn, updateColumn } from '../../columns/service.js';
import type { TOOL_SCHEMAS } from '../schemas.js';

type Args<T extends keyof typeof TOOL_SCHEMAS> = z.infer<(typeof TOOL_SCHEMAS)[T]>;

async function createColumnTool(
  context: ToolContext,
  args: Args<'create_column'>,
): Promise<unknown> {
  const { board, ...input } = args;
  return createColumn({ db: context.db, actor: context.actor, hub: context.hub }, board, input);
}

async function updateColumnTool(
  context: ToolContext,
  args: Args<'update_column'>,
): Promise<unknown> {
  await requireColumnInBoard(context.db, args.board, args.column);
  return updateColumn({ db: context.db, actor: context.actor, hub: context.hub }, args.column, {
    name: args.name,
  });
}

async function deleteColumnTool(
  context: ToolContext,
  args: Args<'delete_column'>,
): Promise<unknown> {
  await requireColumnInBoard(context.db, args.board, args.column);
  await deleteColumn({ db: context.db, actor: context.actor, hub: context.hub }, args.column, {
    move_cards_to: args.move_cards_to,
    // REST takes the literal `true`; anything else means "do not delete them".
    delete_cards: args.delete_cards === true ? true : undefined,
  });
  return { deleted: true, id: args.column };
}

export const columnTools = {
  create_column: handler(createColumnTool),
  update_column: handler(updateColumnTool),
  delete_column: handler(deleteColumnTool),
};
