// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Board tools (docs/mcp.md §3). Each one is an adapter over `boards/service.ts`
 * and nothing else: the same function `POST /boards`, `PATCH /boards/:id` and
 * `DELETE /boards/:id` call, so an agent cannot reach a state a human cannot.
 */
import type { z } from 'zod';
import type { ToolContext } from '../registry.js';
import { handler } from '../registry.js';
import { boardStateFor } from '../../boards/state.js';
import {
  createBoard,
  deleteBoard,
  toBoardDto,
  toPolicy,
  updateBoard,
} from '../../boards/service.js';
import { can } from '../../lib/authz.js';
import { AppError } from '../../lib/errors.js';
import type { TOOL_SCHEMAS } from '../schemas.js';

type Args<T extends keyof typeof TOOL_SCHEMAS> = z.infer<(typeof TOOL_SCHEMAS)[T]>;

async function listBoards(context: ToolContext, _args: Args<'list_boards'>): Promise<unknown> {
  const { db, actor, env } = context;
  if (actor.kind !== 'user' && actor.kind !== 'agent') {
    throw new AppError('forbidden', {
      message: 'This credential cannot list boards.',
      hint: 'Use an agent key or a session.',
    });
  }
  const memberships = await db.boardMember.findMany({
    where: { user_id: actor.userId },
    include: {
      board: { include: { owner: { select: { id: true, username: true } } } },
    },
    orderBy: [{ board: { updated_at: 'desc' } }, { board_id: 'asc' }],
  });
  const items = memberships
    .filter((membership) => {
      const policy = toPolicy(membership.board);
      return can(actor, 'board.read', policy, { role: membership.role }).allow;
    })
    .map((membership) => ({
      ...toBoardDto(membership.board, env.KLUI_PUBLIC_URL),
      role: membership.role,
    }));
  return { items };
}

async function getBoard(context: ToolContext, args: Args<'get_board'>): Promise<unknown> {
  const state = await boardStateFor(
    context.db,
    context.actor,
    args.board,
    context.env.KLUI_PUBLIC_URL,
  );
  return {
    board: state.board,
    columns: state.columns,
    cards: state.cards,
    members: state.members,
    caller_role: state.caller.role,
    caller: state.caller,
  };
}

async function createBoardTool(context: ToolContext, args: Args<'create_board'>): Promise<unknown> {
  // Templates are deliberately not exposed to agents (docs/mcp.md §3): an
  // agent-created board gets the classic columns, never a half-built one.
  return createBoard(
    {
      db: context.db,
      actor: context.actor,
      publicUrl: context.env.KLUI_PUBLIC_URL,
      hub: context.hub,
    },
    args,
  );
}

async function updateBoardTool(context: ToolContext, args: Args<'update_board'>): Promise<unknown> {
  const { board, ...input } = args;
  return updateBoard(
    {
      db: context.db,
      actor: context.actor,
      publicUrl: context.env.KLUI_PUBLIC_URL,
      hub: context.hub,
    },
    board,
    input,
  );
}

async function deleteBoardTool(context: ToolContext, args: Args<'delete_board'>): Promise<unknown> {
  await deleteBoard(
    {
      db: context.db,
      actor: context.actor,
      publicUrl: context.env.KLUI_PUBLIC_URL,
      hub: context.hub,
    },
    args.board,
    args.confirm,
  );
  return { deleted: true, id: args.board };
}

export const boardsTools = {
  list_boards: handler(listBoards),
  get_board: handler(getBoard),
  create_board: handler(createBoardTool),
  update_board: handler(updateBoardTool),
  delete_board: handler(deleteBoardTool),
};
