// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Renaming an account (D-13). A rename reserves the old username for 90 days
 * and the old URL redirects to the new one; after the window the name is free
 * again, because a shared link from last year should not outrank a live person.
 */
import type { Db } from '../db.js';
import { AppError, fromZod } from '../lib/errors.js';
import { recordEvent } from '../lib/events.js';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '../lib/password.js';
import { changePasswordSchema, deleteAccountSchema, patchMeSchema } from '../contracts/auth.js';
import { issueSession, type IssuedSession } from './sessions.js';

export const RESERVATION_DAYS = 90;

function reservationWindow(): Date {
  return new Date(Date.now() + RESERVATION_DAYS * 24 * 60 * 60 * 1000);
}

export type ProfileUpdate = {
  username?: string;
  display_name?: string | null;
  email?: string;
};

export async function updateProfile(
  db: Db,
  userId: string,
  rawInput: unknown,
): Promise<{ username: string; display_name: string | null; email: string }> {
  const parsed = patchMeSchema.safeParse(rawInput);
  if (!parsed.success) throw fromZod(parsed.error);
  const input = parsed.data;

  const current = await db.user.findUnique({ where: { id: userId } });
  if (!current) throw new AppError('unauthenticated');

  const data: Record<string, unknown> = {};
  const changes: Record<string, [string | null, string | null]> = {};

  if (input.email !== undefined && input.email !== current.email) {
    const taken = await db.user.findFirst({ where: { email: input.email, id: { not: userId } } });
    if (taken) {
      throw new AppError('conflict', {
        message: 'An account already uses this address.',
        hint: 'Sign in with it instead.',
      });
    }
    changes.email = [current.email, input.email];
    data.email = input.email;
  }

  if (input.username !== undefined && input.username !== current.username) {
    const taken = await db.user.findFirst({
      where: { username: input.username, id: { not: userId } },
    });
    if (taken) {
      throw new AppError('conflict', {
        message: 'That username is taken.',
        hint: 'Usernames are unique regardless of case.',
      });
    }
    const reserved = await db.usernameReservation.findUnique({
      where: { username: input.username },
    });
    if (reserved && reserved.reserved_until.getTime() > Date.now() && reserved.user_id !== userId) {
      throw new AppError('conflict', {
        message: 'That username was used recently and is still reserved.',
        hint: `A renamed account keeps its old name for ${RESERVATION_DAYS} days.`,
      });
    }
    changes.username = [current.username, input.username];
    data.username = input.username;
  }

  if (input.display_name !== undefined && input.display_name !== current.display_name) {
    changes.display_name = [current.display_name, input.display_name];
    data.display_name = input.display_name;
  }

  if (Object.keys(data).length === 0) {
    return { username: current.username, display_name: current.display_name, email: current.email };
  }

  const updated = await db.$transaction(async (tx) => {
    if (changes.username) {
      const [oldUsername, newUsername] = changes.username;
      await tx.usernameReservation.upsert({
        where: { username: String(oldUsername) },
        create: {
          username: String(oldUsername),
          user_id: userId,
          redirect_to_user_id: userId,
          reserved_until: reservationWindow(),
        },
        update: { redirect_to_user_id: userId, reserved_until: reservationWindow() },
      });
      // A name returning to its owner must not stay reserved against them.
      await tx.usernameReservation.deleteMany({
        where: { username: String(newUsername), user_id: userId },
      });
    }
    const row = await tx.user.update({ where: { id: userId }, data });
    await recordEvent(tx, {
      boardId: null,
      actor: { kind: 'user', userId },
      type: 'security.profile_updated',
      payload: { changes },
    });
    return row;
  });

  return {
    username: updated.username,
    display_name: updated.display_name,
    email: updated.email,
  };
}

/**
 * Where an old name points now: the account that reserved it, if the window is
 * still open. Null means the name is simply free (or was never used).
 */
export async function usernameRedirect(db: Db, username: string): Promise<string | null> {
  const reservation = await db.usernameReservation.findUnique({ where: { username } });
  if (!reservation || reservation.reserved_until.getTime() <= Date.now()) return null;
  const owner = await db.user.findUnique({
    where: { id: reservation.redirect_to_user_id },
    select: { username: true },
  });
  return owner?.username ?? null;
}

export async function slugRedirect(db: Db, username: string, slug: string): Promise<string | null> {
  const reservation = await db.boardSlugReservation.findFirst({
    where: { slug, reserved_until: { gt: new Date() }, board: { owner: { username } } },
    select: { redirect_slug: true },
  });
  return reservation?.redirect_slug ?? null;
}

/**
 * Password change (K5-08, D-16): verifies the current password, enforces
 * password policy, revokes every existing session, and issues one fresh session
 * for the caller so stolen cookies stop working immediately.
 */
export async function changePassword(
  db: Db,
  userId: string,
  pepper: string,
  rawInput: unknown,
  meta: { ip: string | null; userAgent: string | null },
): Promise<IssuedSession> {
  const parsed = changePasswordSchema.safeParse(rawInput);
  if (!parsed.success) throw fromZod(parsed.error);
  const { current_password: currentPassword, new_password: newPassword } = parsed.data;

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('unauthenticated');

  const valid = await verifyPassword(user.password_hash, currentPassword);
  if (!valid) {
    throw new AppError('invalid_credential', {
      message: 'The current password is incorrect.',
      hint: null,
    });
  }

  assertPasswordPolicy(newPassword);
  const nextHash = await hashPassword(newPassword);

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { password_hash: nextHash } });
    await tx.session.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    await recordEvent(tx, {
      boardId: null,
      actor: { kind: 'user', userId },
      type: 'security.password_changed',
      payload: {},
    });
  });

  return issueSession(db, {
    userId,
    pepper,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

/**
 * Account deletion with the documented cascade (K5-08, docs/security.md §9):
 * anonymises authored comments ("deleted user") before deleting the account so
 * shared threads stay readable, while memberships, sessions, TOTP, recovery
 * codes, OAuth accounts, digest prefs, notifications, agent keys and owned
 * boards cascade cleanly.
 */
export async function deleteAccount(db: Db, userId: string, rawInput: unknown): Promise<void> {
  const parsed = deleteAccountSchema.safeParse(rawInput);
  if (!parsed.success) throw fromZod(parsed.error);

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('unauthenticated');

  const valid = await verifyPassword(user.password_hash, parsed.data.password);
  if (!valid) {
    throw new AppError('invalid_credential', {
      message: 'The password is incorrect.',
      hint: null,
    });
  }

  await db.$transaction(async (tx) => {
    await tx.comment.updateMany({
      where: { author_id: userId },
      data: { author_id: null, author_label: 'deleted user' },
    });
    await tx.user.delete({ where: { id: userId } });
  });
}
