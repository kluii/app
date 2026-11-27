// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Card tools (docs/mcp.md §3), adapters over `cards/service.ts` — the same
 * functions the REST card routes call.
 *
 * Three rules the argument names carry, and the tests assert:
 *
 * - `move_card` takes `{column, before, after}`, never an index. `set_card_done`
 *   is `PATCH /cards/:id {done}` through the same `updateCard`, so a tick and an
 *   edit cannot disagree about the event they write.
 * - `update_card` accepts `expected_updated_at` and answers the same `409`
 *   (-32003) a stale REST write gets.
 * - `{board, card}` must name a card in that board, or `card_not_found`.
 */
import { z } from 'zod';
import type { ToolContext } from '../registry.js';
import { handler, requireCardInBoard, requireColumnInBoard, toTagRows } from '../registry.js';
import {
  bulkCreateCards,
  createCard,
  deleteCard,
  moveCard,
  readCard,
  updateCard,
} from '../../cards/service.js';
import type { TOOL_SCHEMAS } from '../schemas.js';

type Args<T extends keyof typeof TOOL_SCHEMAS> = z.infer<(typeof TOOL_SCHEMAS)[T]>;

async function createCardTool(context: ToolContext, args: Args<'create_card'>): Promise<unknown> {
  const { board, ...input } = args;
  return createCard({ db: context.db, actor: context.actor, hub: context.hub }, board, {
    ...input,
    tags: toTagRows(input.tags),
  });
}

async function bulkCreateCardsTool(
  context: ToolContext,
  args: Args<'bulk_create_cards'>,
): Promise<unknown> {
  const { board, column, items } = args;
  return bulkCreateCards({ db: context.db, actor: context.actor, hub: context.hub }, board, {
    column,
    items: items.map((item) => ({ ...item, tags: toTagRows(item.tags) })),
  });
}

async function getCardTool(context: ToolContext, args: Args<'get_card'>): Promise<unknown> {
  await requireCardInBoard(context.db, args.board, args.card);
  return readCard(context.db, context.actor, args.card);
}

async function updateCardTool(context: ToolContext, args: Args<'update_card'>): Promise<unknown> {
  const { board, card, tags, ...input } = args;
  await requireCardInBoard(context.db, board, card);
  return updateCard({ db: context.db, actor: context.actor, hub: context.hub }, card, {
    ...input,
    tags: toTagRows(tags),
  });
}

async function moveCardTool(context: ToolContext, args: Args<'move_card'>): Promise<unknown> {
  await requireCardInBoard(context.db, args.board, args.card);
  await requireColumnInBoard(context.db, args.board, args.column);
  return moveCard({ db: context.db, actor: context.actor, hub: context.hub }, args.card, {
    column: args.column,
    before: args.before,
    after: args.after,
  });
}

async function setCardDoneTool(
  context: ToolContext,
  args: Args<'set_card_done'>,
): Promise<unknown> {
  await requireCardInBoard(context.db, args.board, args.card);
  // The same write the done tick performs: `PATCH /cards/:id {done}`.
  return updateCard({ db: context.db, actor: context.actor, hub: context.hub }, args.card, {
    done: args.done,
  });
}

async function deleteCardTool(context: ToolContext, args: Args<'delete_card'>): Promise<unknown> {
  await requireCardInBoard(context.db, args.board, args.card);
  await deleteCard({ db: context.db, actor: context.actor, hub: context.hub }, args.card);
  return { deleted: true, id: args.card };
}

export const cardTools = {
  create_card: handler(createCardTool),
  bulk_create_cards: handler(bulkCreateCardsTool),
  get_card: handler(getCardTool),
  update_card: handler(updateCardTool),
  move_card: handler(moveCardTool),
  set_card_done: handler(setCardDoneTool),
  delete_card: handler(deleteCardTool),
};
