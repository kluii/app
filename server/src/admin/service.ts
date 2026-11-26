// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Instance operations (docs/security.md §9): an instance admin can list
 * accounts, ban one and lift it. This role never grants board content: every
 * board read still goes through `can()`, and an admin who is not a member sees
 * the same `404` as a stranger.
 */
import type { Db } from '../db.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { recordEvent } from '../lib/events.js';
import { revokeAllSessions } from '../auth/sessions.js';

export const PAGE_SIZE = 50;

export type AdminUser = {
  id: string;
  username: string;
  email: string;
  is_instance_admin: boolean;
  created_at: string;
  banned: boolean;
  banned_until: string | null;
};

async function requireInstanceAdmin(db: Db, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { is_instance_admin: true },
  });
  if (!user?.is_instance_admin) {
    throw new AppError('forbidden', {
      message: 'Only an instance admin can do that.',
      hint: null,
    });
  }
}

/** A ban is active until `expires_at`, or forever when that column is null. */
export async function activeBanFor(
  db: Db,
  userId: string,
): Promise<{ expires_at: Date | null } | null> {
  const ban = await db.ban.findFirst({
    where: {
      subject: userId,
      subject_kind: 'user',
      OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
    },
    orderBy: { created_at: 'desc' },
  });
  return ban ? { expires_at: ban.expires_at } : null;
}

export async function listUsers(
  db: Db,
  adminId: string,
  options: { cursor?: string; query?: string } = {},
): Promise<{ items: AdminUser[]; next_cursor: string | null }> {
  await requireInstanceAdmin(db, adminId);
  const users = await db.user.findMany({
    where: options.query
      ? {
          OR: [
            { username: { contains: options.query, mode: 'insensitive' } },
            { email: { contains: options.query, mode: 'insensitive' } },
          ],
        }
      : {},
    orderBy: { created_at: 'asc' },
    take: PAGE_SIZE + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const page = users.slice(0, PAGE_SIZE);
  const bans = await db.ban.findMany({
    where: {
      subject: { in: page.map((user) => user.id) },
      subject_kind: 'user',
      OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
    },
  });
  const banned = new Map(bans.map((ban) => [ban.subject, ban.expires_at]));

  return {
    items: page.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      is_instance_admin: user.is_instance_admin,
      created_at: user.created_at.toISOString(),
      banned: banned.has(user.id),
      banned_until: banned.get(user.id)?.toISOString() ?? null,
    })),
    next_cursor: users.length > PAGE_SIZE ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function banUser(
  db: Db,
  adminId: string,
  userId: string,
  input: { reason?: string; expires_at?: string | null; confirm: true },
): Promise<{ banned_until: string | null }> {
  await requireInstanceAdmin(db, adminId);
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw new AppError('not_found');
  if (target.is_instance_admin) {
    throw new AppError('forbidden', {
      message: 'An instance admin cannot be banned from the instance.',
      hint: 'Remove the admin role first; this is deliberate, not an oversight.',
    });
  }

  const expires_at = input.expires_at ? new Date(input.expires_at) : null;
  await db.$transaction(async (tx) => {
    await tx.ban.create({
      data: {
        id: newId('ban'),
        subject: userId,
        subject_kind: 'user',
        reason: input.reason ?? null,
        expires_at,
      },
    });
    await recordEvent(tx, {
      boardId: null,
      actor: { kind: 'user', userId: adminId },
      type: 'security.user_banned',
      payload: { user_id: userId, expires_at: expires_at?.toISOString() ?? null },
    });
  });
  // A ban that only applies at the next login would leave a live session open.
  await revokeAllSessions(db, userId);
  return { banned_until: expires_at?.toISOString() ?? null };
}

export async function unbanUser(db: Db, adminId: string, userId: string): Promise<void> {
  await requireInstanceAdmin(db, adminId);
  await db.$transaction(async (tx) => {
    const lifted = await tx.ban.deleteMany({
      where: { subject: userId, subject_kind: 'user' },
    });
    if (lifted.count === 0)
      throw new AppError('not_found', { message: 'That account is not banned.' });
    await recordEvent(tx, {
      boardId: null,
      actor: { kind: 'user', userId: adminId },
      type: 'security.user_unbanned',
      payload: { user_id: userId },
    });
  });
}
