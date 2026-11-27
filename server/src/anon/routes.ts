// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The display-name gate (docs/features/links-and-anonymous.md §4).
 *
 * A visitor on a board that accepts anonymous writes names themselves and gets
 * a signed 12-hour cookie. The label is not an account: no password, no email,
 * no uniqueness. `can()` decides what that cookie may do on the board it names.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { can } from '../lib/authz.js';
import { AppError, boardNotFound, fromZod } from '../lib/errors.js';
import { joinBoardSchema } from '../contracts/boards.js';
import { toPolicy } from '../boards/service.js';
import { newAnonId, setAnonCookie } from './service.js';

export function registerAnonRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  app.post('/api/v1/boards/:id/anon', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = joinBoardSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const db = database();

    const board = await db.board.findUnique({ where: { id } });
    // Unreadable is non-existent: a private board is not a place to ask.
    if (!board) throw boardNotFound();
    const identity = { boardId: id, anonId: newAnonId(), label: parsed.data.label };
    const decision = can(
      { kind: 'anon', boardId: id, label: identity.label, anonId: identity.anonId },
      'board.read',
      toPolicy(board),
      null,
    );
    if (!decision.allow) throw boardNotFound();
    if (board.anon_write === 'off') {
      throw new AppError('forbidden', {
        message: 'This board does not accept anonymous writes.',
        hint: 'Ask a member for a write link, or sign in.',
      });
    }

    setAnonCookie(reply, identity, context.env.KLUI_ENV === 'production');
    reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex');
    return { board_id: id, label: identity.label, actor_kind: 'anon' };
  });
}
