// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Membership (K3-05).
 *
 * Exactly one owner per board is a partial unique index, not a convention; the
 * only way to change who owns a board is `POST /boards/:id/transfer`, which
 * demotes the old owner and promotes the new one in one transaction.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor } from '../auth/request.js';
import { AppError, fromZod } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { recordEvent } from '../lib/events.js';
import { commitEvent } from '../realtime/events.js';
import { assertAllowed, loadBoardFor, toBoardDto } from './service.js';
import { notify } from '../notifications/service.js';

const roleSchema = z.enum(['admin', 'editor', 'viewer']);
const inviteSchema = z.object({ username: z.string().trim().min(1), role: roleSchema }).strict();
const updateSchema = z
  .object({ role: roleSchema, expected_updated_at: z.string().datetime().optional() })
  .strict();
const transferSchema = z.object({ user_id: z.string().min(1), confirm: z.literal(true) }).strict();

export function registerMemberRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  app.post('/api/v1/boards/:id/members', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = inviteSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'member.invite');
    assertAllowed(loaded.decision);

    const user = await db.user.findUnique({
      where: { username: parsed.data.username.toLowerCase() },
      select: { id: true, username: true },
    });
    if (!user) {
      throw new AppError('not_found', {
        message: 'No account with that username.',
        hint: 'Accounts are invited by username; the person has to sign up first.',
      });
    }
    const existing = await db.boardMember.findUnique({
      where: { board_id_user_id: { board_id: id, user_id: user.id } },
      select: { id: true },
    });
    if (existing) {
      throw new AppError('conflict', {
        message: 'That account is already a member.',
        hint: 'Change their role instead of inviting them again.',
      });
    }

    const memberId = newId('bmb');
    await db.$transaction(async (tx) => {
      await tx.boardMember.create({
        data: { id: memberId, board_id: id, user_id: user.id, role: parsed.data.role },
      });
      await recordEvent(tx, {
        boardId: id,
        actor,
        type: 'member.added',
        payload: {
          board_id: id,
          user_id: user.id,
          username: user.username,
          role: parsed.data.role,
        },
      });
    });
    commitEvent(context.hub, {
      boardId: id,
      type: 'member.added',
      entity: 'member',
      action: 'added',
      payload: { board_id: id, user_id: user.id },
      actorLabel: actor.kind,
    });
    if (actor.kind !== 'user' || actor.userId !== user.id) {
      await notify(db, {
        userId: user.id,
        kind: 'invitation',
        eventId: `invite:${id}:${memberId}`,
        payload: { board_id: id, board_name: loaded.board.name, role: parsed.data.role },
      }).catch(() => undefined);
    }
    return reply.code(201).send({ ...user, user_id: user.id, role: parsed.data.role });
  });

  app.patch('/api/v1/boards/:id/members/:userId', async (request) => {
    const actor = requireActor(request);
    const { id, userId } = request.params as { id: string; userId: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'member.update');
    assertAllowed(loaded.decision);

    const member = await db.boardMember.findUnique({
      where: { board_id_user_id: { board_id: id, user_id: userId } },
      include: { user: { select: { username: true } } },
    });
    if (member) {
      if (member.role === 'owner') {
        // A board has one owner; handing it over is a transfer, not a PATCH.
        throw new AppError('conflict', {
          message: 'The owner cannot be demoted here.',
          hint: 'Transfer ownership to another member, which demotes this account to admin.',
        });
      }
      if (member.role !== parsed.data.role) {
        await db.$transaction(async (tx) => {
          await tx.boardMember.update({
            where: { id: member.id },
            data: { role: parsed.data.role },
          });
          await recordEvent(tx, {
            boardId: id,
            actor,
            type: 'member.updated',
            payload: {
              board_id: id,
              user_id: userId,
              username: member.user.username,
              changes: { role: [member.role, parsed.data.role] },
            },
          });
        });
      }
      return {
        user_id: userId,
        username: member.user.username,
        role: parsed.data.role,
        joined_at: member.created_at.toISOString(),
      };
    }
    throw new AppError('not_found', { message: 'Not found.', hint: null });
  });

  app.delete('/api/v1/boards/:id/members/:userId', async (request, reply) => {
    const actor = requireActor(request);
    const { id, userId } = request.params as { id: string; userId: string };
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'member.remove');
    assertAllowed(loaded.decision);

    const member = await db.boardMember.findUnique({
      where: { board_id_user_id: { board_id: id, user_id: userId } },
      include: { user: { select: { username: true } } },
    });
    if (!member) throw new AppError('not_found', { message: 'Not found.', hint: null });
    if (member.role === 'owner') {
      throw new AppError('conflict', {
        message: 'The owner cannot be removed.',
        hint: 'Transfer ownership first, then remove the old account if it should leave.',
      });
    }
    if (loaded.membership?.role === 'admin' && member.role === 'admin') {
      throw new AppError('conflict', {
        message: 'An admin cannot remove another admin.',
        hint: 'The owner can.',
      });
    }

    await db.$transaction(async (tx) => {
      await tx.boardMember.delete({ where: { id: member.id } });
      await recordEvent(tx, {
        boardId: id,
        actor,
        type: 'member.removed',
        payload: {
          board_id: id,
          user_id: userId,
          username: member.user.username,
          role: member.role,
        },
      });
    });
    commitEvent(context.hub, {
      boardId: id,
      type: 'member.removed',
      entity: 'member',
      action: 'removed',
      payload: { board_id: id, user_id: userId },
      actorLabel: actor.kind,
    });
    return reply.code(204).send();
  });

  app.post('/api/v1/boards/:id/transfer', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = transferSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'member.transfer');
    assertAllowed(loaded.decision);

    const target = await db.boardMember.findUnique({
      where: { board_id_user_id: { board_id: id, user_id: parsed.data.user_id } },
      select: { id: true, role: true },
    });
    if (!target) {
      throw new AppError('validation_failed', {
        message: 'That account is not a member of this board.',
        hint: 'Invite them first; ownership goes to an existing member.',
        details: [{ path: 'user_id', code: 'custom', message: 'not a member' }],
      });
    }
    if (target.role === 'owner') {
      throw new AppError('conflict', {
        message: 'That account already owns this board.',
        hint: null,
      });
    }

    const previousOwner = await db.boardMember.findFirst({
      where: { board_id: id, role: 'owner' },
      select: { id: true, user_id: true },
    });
    if (!previousOwner) throw new AppError('internal');

    const board = await db.$transaction(async (tx) => {
      // Demote first: the partial unique index refuses two owners, even for the
      // instant between the two statements.
      await tx.boardMember.update({ where: { id: previousOwner.id }, data: { role: 'admin' } });
      await tx.boardMember.update({ where: { id: target.id }, data: { role: 'owner' } });
      const updated = await tx.board.update({
        where: { id },
        data: { owner_id: parsed.data.user_id },
        include: { owner: { select: { id: true, username: true } } },
      });
      await recordEvent(tx, {
        boardId: id,
        actor,
        type: 'member.updated',
        payload: {
          board_id: id,
          user_id: parsed.data.user_id,
          changes: {
            owner_id: [previousOwner.user_id, parsed.data.user_id],
            previous_owner_role: ['owner', 'admin'],
          },
        },
      });
      return updated;
    });
    commitEvent(context.hub, {
      boardId: id,
      type: 'member.updated',
      entity: 'member',
      action: 'transferred',
      payload: { board_id: id, user_id: parsed.data.user_id },
      actorLabel: actor.kind,
    });
    return toBoardDto(board, context.env.KLUI_PUBLIC_URL);
  });
}
