// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `whoami` (docs/mcp.md §3): the account and the scope behind the credential,
 * which is what the setup panel's "Test connection" reports. It reads the same
 * rows `GET /me` does.
 */
import { z } from 'zod';
import type { ToolContext } from '../registry.js';
import { handler } from '../registry.js';
import { AppError } from '../../lib/errors.js';
import type { TOOL_SCHEMAS } from '../schemas.js';

type Args<T extends keyof typeof TOOL_SCHEMAS> = z.infer<(typeof TOOL_SCHEMAS)[T]>;

async function whoAmI(context: ToolContext, _args: Args<'whoami'>): Promise<unknown> {
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

export const identityTools = {
  whoami: handler(whoAmI),
};
