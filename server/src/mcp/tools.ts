// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The tool registry (docs/mcp.md §3): one entry per frozen name, each with the
 * handler the transport calls. A tool without a handler answers `-32603` and
 * names the milestone that fills it — an unimplemented tool must never pretend
 * to have worked.
 */
import type { Db } from '../db.js';
import type { Env } from '../env.js';
import type { Actor } from '../lib/authz.js';
import { can } from '../lib/authz.js';
import { AppError } from '../lib/errors.js';
import type { Hub } from '../realtime/events.js';
import { boardStateFor } from '../boards/state.js';
import { toBoardDto, toPolicy } from '../boards/service.js';
import { TOOL_SCHEMAS, type ToolName } from './schemas.js';

export type ToolContext = { db: Db; actor: Actor; env: Env; hub: Hub };

export type ToolHandler = (context: ToolContext, args: never) => Promise<unknown>;

const BOARD_TOOLS = new Set<ToolName>(['get_board', 'update_board', 'delete_board']);

async function listBoards(context: ToolContext): Promise<unknown> {
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

async function getBoard(context: ToolContext, args: { board: string }): Promise<unknown> {
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

async function whoAmI(context: ToolContext): Promise<unknown> {
  const { db, actor } = context;
  if (actor.kind !== 'user' && actor.kind !== 'agent') {
    throw new AppError('forbidden', {
      message: 'This credential has no account.',
      hint: 'Use an agent key or a session.',
    });
  }
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { id: true, username: true, email: true, display_name: true },
  });
  if (!user) throw new AppError('not_found');
  return {
    user,
    actor_kind: actor.kind,
    ...(actor.kind === 'agent'
      ? { scope: actor.scope, board_id: actor.boardId ?? null }
      : { scope: 'session', board_id: null }),
  };
}

function notImplemented(tool: ToolName, milestone: string): ToolHandler {
  return async () => {
    throw new AppError('not_implemented', {
      message: `${tool} is not available in this build yet.`,
      hint: `It lands with ${milestone}; use the REST endpoint named in docs/mcp.md §6 until then.`,
    });
  };
}

export const TOOL_HANDLERS: Record<ToolName, ToolHandler> = {
  list_boards: listBoards as ToolHandler,
  get_board: getBoard as unknown as ToolHandler,
  whoami: whoAmI as ToolHandler,
  create_board: notImplemented('create_board', 'K4-03'),
  update_board: notImplemented('update_board', 'K4-03'),
  delete_board: notImplemented('delete_board', 'K4-03'),
  create_column: notImplemented('create_column', 'K4-04'),
  update_column: notImplemented('update_column', 'K4-04'),
  delete_column: notImplemented('delete_column', 'K4-04'),
  create_card: notImplemented('create_card', 'K4-04'),
  bulk_create_cards: notImplemented('bulk_create_cards', 'K4-04'),
  get_card: notImplemented('get_card', 'K4-05'),
  update_card: notImplemented('update_card', 'K4-04'),
  move_card: notImplemented('move_card', 'K4-04'),
  set_card_done: notImplemented('set_card_done', 'K4-04'),
  delete_card: notImplemented('delete_card', 'K4-04'),
  list_comments: notImplemented('list_comments', 'K4-05'),
  create_comment: notImplemented('create_comment', 'K4-05'),
  search_cards: notImplemented('search_cards', 'K4-05'),
  get_activity: notImplemented('get_activity', 'K4-05'),
  export_board: notImplemented('export_board', 'K4-05'),
};

export { TOOL_SCHEMAS };
export type { ToolName };
export { BOARD_TOOLS };
