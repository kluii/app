// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Password reset, fail-closed (docs/features/auth.md §6).
 *
 * - The request always answers `202` for a well-formed address, existing or
 *   not; with no SMTP configured it answers `503 email_not_configured` *before*
 *   looking at the account, so it is not an enumeration oracle either.
 * - A token is 32 random bytes, stored as sha256 with the pepper, valid 30
 *   minutes, single use, and retired by the next request.
 * - A successful reset revokes every session, because a reset is the moment a
 *   password is known to be compromised.
 */
import type { Db } from '../db.js';
import type { Env } from '../env.js';
import { AppError, fromZod } from '../lib/errors.js';
import { newId, sessionToken } from '../lib/ids.js';
import { hashToken } from '../lib/hash.js';
import { hashPassword, assertPasswordPolicy } from '../lib/password.js';
import { recordEvent } from '../lib/events.js';
import type { Mailer } from '../lib/mail.js';
import { resetConfirmSchema, resetRequestSchema } from '../contracts/auth.js';
import { revokeAllSessions } from './sessions.js';
import { translate, type Locale } from '../i18n/index.js';

export const RESET_TTL_MS = 30 * 60 * 1000;
const REQUESTS_PER_HOUR = 3;

/** Per-account throttle, in memory: one process, one array of timestamps. */
const recentRequests = new Map<string, number[]>();

function allowRequest(userId: string, now = Date.now()): boolean {
  const windowStart = now - 60 * 60 * 1000;
  const recent = (recentRequests.get(userId) ?? []).filter((at) => at > windowStart);
  if (recent.length >= REQUESTS_PER_HOUR) {
    recentRequests.set(userId, recent);
    return false;
  }
  recent.push(now);
  recentRequests.set(userId, recent);
  return true;
}

export function resetThrottleForTests(): void {
  recentRequests.clear();
}

function baseUrl(env: Env): string {
  return (env.KLUI_PUBLIC_URL ?? `http://localhost:${env.KLUI_PORT}`).replace(/\/$/, '');
}

export type IssuedReset = { url: string; expires_at: Date };

async function issueToken(
  db: Db,
  pepper: string,
  userId: string,
): Promise<{ raw: string; expires_at: Date }> {
  const raw = sessionToken();
  const expires_at = new Date(Date.now() + RESET_TTL_MS);
  await db.$transaction(async (tx) => {
    // A new request retires the previous one: two live links is one too many.
    await tx.passwordResetToken.updateMany({
      where: { user_id: userId, used_at: null },
      data: { used_at: new Date() },
    });
    await tx.passwordResetToken.create({
      data: {
        id: newId('rcv'),
        user_id: userId,
        token_hash: hashToken(raw, pepper),
        expires_at,
      },
    });
  });
  return { raw, expires_at };
}

export function resetUrl(env: Env, raw: string): string {
  return `${baseUrl(env)}/reset?token=${encodeURIComponent(raw)}`;
}

export async function requestReset(
  db: Db,
  env: Env,
  pepper: string,
  mailer: Mailer | null,
  rawInput: unknown,
  locale: Locale = 'en',
): Promise<{ status: 'accepted' }> {
  const parsed = resetRequestSchema.safeParse(rawInput);
  if (!parsed.success) throw fromZod(parsed.error);
  if (!mailer) {
    throw new AppError('email_not_configured', {
      hint: 'An instance admin can reset the password for this account, or set KLUI_SMTP_HOST and KLUI_SMTP_FROM.',
    });
  }

  const email = parsed.data.email;
  const user = await db.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) return { status: 'accepted' };
  if (!allowRequest(user.id)) {
    throw new AppError('rate_limited', {
      message: 'Too many reset requests.',
      hint: 'Wait an hour, or ask an instance admin for a reset link.',
    });
  }

  const issued = await issueToken(db, pepper, user.id);
  await mailer.send({
    to: user.email,
    subject: translate(locale, 'mail.reset.subject'),
    // The reader's language, not the requester's: `Accept-Language` of the
    // request that asked for the link is the only signal the server has (K5-07).
    text: [
      translate(locale, 'mail.reset.intro'),
      '',
      translate(locale, 'mail.reset.link', { url: resetUrl(env, issued.raw) }),
      '',
      translate(locale, 'mail.reset.ignore'),
    ].join('\n'),
  });
  await db.$transaction(async (tx) => {
    await recordEvent(tx, {
      boardId: null,
      actor: { kind: 'user', userId: user.id },
      type: 'security.password_reset',
      payload: { method: 'email', stage: 'requested' },
    });
  });
  return { status: 'accepted' };
}

export async function adminResetLink(
  db: Db,
  env: Env,
  pepper: string,
  userId: string,
): Promise<IssuedReset> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new AppError('not_found');
  const issued = await issueToken(db, pepper, userId);
  await db.$transaction(async (tx) => {
    await recordEvent(tx, {
      boardId: null,
      actor: { kind: 'user', userId },
      type: 'security.password_reset',
      payload: { method: 'admin', stage: 'requested' },
    });
  });
  return { url: resetUrl(env, issued.raw), expires_at: issued.expires_at };
}

export async function confirmReset(
  db: Db,
  pepper: string,
  rawInput: unknown,
): Promise<{ status: 'reset' }> {
  const parsed = resetConfirmSchema.safeParse(rawInput);
  if (!parsed.success) throw fromZod(parsed.error);

  const tokenHash = hashToken(parsed.data.token, pepper);
  const row = await db.passwordResetToken.findUnique({ where: { token_hash: tokenHash } });
  if (!row || row.used_at || row.expires_at.getTime() <= Date.now()) {
    throw new AppError('invalid_code', {
      message: 'This reset link is not valid any more.',
      hint: 'Request a new one; links work once and expire after 30 minutes.',
    });
  }

  assertPasswordPolicy(parsed.data.password);
  const passwordHash = await hashPassword(parsed.data.password);

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: row.user_id }, data: { password_hash: passwordHash } });
    await tx.passwordResetToken.update({ where: { id: row.id }, data: { used_at: new Date() } });
    await recordEvent(tx, {
      boardId: null,
      actor: { kind: 'user', userId: row.user_id },
      type: 'security.password_reset',
      payload: { method: 'token', stage: 'confirmed' },
    });
  });
  // A reset is the one moment the old password is known to be compromised.
  await revokeAllSessions(db, row.user_id);
  return { status: 'reset' };
}
