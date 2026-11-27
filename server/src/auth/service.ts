// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Accounts, sessions and the bootstrap admin (docs/features/auth.md).
 * No user enumeration on login: the same body and a comparable duration for an
 * unknown account and a wrong password.
 */
import { Prisma } from '@prisma/client';
import type { ZodType } from 'zod';
import type { Db } from '../db.js';
import type { Env } from '../env.js';
import { AppError, fromZod } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { hashPassword, assertPasswordPolicy, verifyPassword } from '../lib/password.js';
import { recordEvent } from '../lib/events.js';
import { loginSchema, signupSchema, type LoginInput } from '../contracts/auth.js';
import { issueSession, revokeAllSessions, type IssuedSession } from './sessions.js';
import { checkSecondFactor, type TotpPolicy } from './totp.js';

export type AuthMeta = { ip: string | null; userAgent: string | null };

export type AuthenticatedUser = {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  is_instance_admin: boolean;
  locale: string;
  /** The row's creation date, so `/me` never invents one. */
  created_at: Date;
};

export async function ensureInstanceSettings(db: Db, env: Env): Promise<void> {
  await db.instanceSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      registration_open: env.KLUI_REGISTRATION_OPEN,
      totp_policy: env.KLUI_TOTP_POLICY,
    },
    update: {},
  });
}

/** The one shape a duplicate account answers with (docs/api.md §3). */
function taken(usernameTaken: boolean): AppError {
  return usernameTaken
    ? new AppError('conflict', {
        message: 'That username is taken.',
        hint: 'Pick another one; usernames are unique regardless of case.',
      })
    : new AppError('conflict', {
        message: 'An account already uses this address.',
        hint: 'Sign in instead, or reset the password.',
      });
}

export async function registrationOpen(db: Db, env: Env): Promise<boolean> {
  if (!env.KLUI_REGISTRATION_OPEN) return false;
  const settings = await db.instanceSettings.findUnique({ where: { id: 1 } });
  return settings ? settings.registration_open : true;
}

export async function signup(
  db: Db,
  env: Env,
  pepper: string,
  rawInput: unknown,
  meta: AuthMeta,
): Promise<{ user: AuthenticatedUser; session: IssuedSession }> {
  const input = parse(signupSchema, rawInput);
  assertPasswordPolicy(input.password);
  if (!(await registrationOpen(db, env))) {
    throw new AppError('registration_closed', {
      hint: 'Ask the instance admin to open registration.',
    });
  }

  const email = input.email;
  const username = input.username.toLowerCase();
  const passwordHash = await hashPassword(input.password);

  // A renamed account keeps its old name for 90 days (D-13): someone who takes
  // it would inherit every link still pointing at the old profile.
  const reservation = await db.usernameReservation.findUnique({ where: { username } });
  if (reservation && reservation.reserved_until.getTime() > Date.now()) {
    throw new AppError('conflict', {
      message: 'That username was used recently and is still reserved.',
      hint: 'Pick another one; a renamed account keeps its old name for 90 days.',
    });
  }

  const existing = await db.user.findFirst({
    where: { OR: [{ email }, { username }] },
    select: { email: true, username: true },
  });
  if (existing) throw taken(existing.username === username);

  // One signup at a time, per database. The bootstrap decision reads the whole
  // user table, so two signups arriving together must not both see it empty; the
  // advisory lock is what makes that true, and it is taken *inside* the
  // transaction so it is released on commit or rollback. `Serializable` was the
  // first attempt and it was not enough: with eight concurrent signups Postgres
  // aborted one with 40001 even with the lock held, and the retry gave up after
  // five attempts (test/tx.test.ts). A queue with no aborts beats a race with
  // retries, and signing up is rare enough that the queue is free.
  const user = await db
    .$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('klui:signup'))`;
      const count = await tx.user.count();
      const created = await tx.user.create({
        data: {
          id: newId('usr'),
          email,
          username,
          password_hash: passwordHash,
          is_instance_admin: count === 0,
        },
      });
      await tx.instanceSettings.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
      });
      await recordEvent(tx, {
        boardId: null,
        actor: { kind: 'user', userId: created.id },
        type: 'security.login',
        payload: { method: 'password', action: 'signup' },
      });
      return created;
    })
    .catch((error: unknown) => {
      // The pre-check ran before the lock, so two signups naming the same address
      // can both pass it. The unique index is the arbiter, and its violation is the
      // same 409 the pre-check would have answered, not a 500.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String((error.meta as { target?: unknown } | undefined)?.target ?? '');
        throw taken(/username/u.test(target));
      }
      throw error;
    });

  const session = await issueSession(db, {
    userId: user.id,
    pepper,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { user: toAuthenticated(user), session };
}

const DUMMY_HASH_CACHE: { value: string | null } = { value: null };

async function dummyHash(): Promise<string> {
  DUMMY_HASH_CACHE.value ??= await hashPassword('dummy-password-for-timing-only');
  return DUMMY_HASH_CACHE.value;
}

export type SecondFactorConfig = {
  encryptionKey: Buffer;
  policy: TotpPolicy;
  /** `available` never blocks a password-only login; `required` does. */
};

export async function login(
  db: Db,
  pepper: string,
  rawInput: unknown,
  meta: AuthMeta,
  secondFactor: SecondFactorConfig,
): Promise<{ user: AuthenticatedUser; session: IssuedSession }> {
  const input: LoginInput = parse(loginSchema, rawInput);
  const identifier = input.email_or_username.trim().toLowerCase();
  const user = await db.user.findFirst({
    where: { OR: [{ email: identifier }, { username: identifier }] },
  });

  const ok = await verifyPassword(user?.password_hash ?? (await dummyHash()), input.password);

  if (!user || !ok) {
    if (user) {
      await recordLoginFailure(db, user.id);
    }
    throw new AppError('unauthenticated', {
      message: 'The email or password is incorrect.',
      hint: null,
    });
  }

  // Checked after the password, so a ban is not an oracle for a wrong guess.
  const ban = await db.ban.findFirst({
    where: {
      subject: user.id,
      subject_kind: 'user',
      OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (ban) throw new AppError('banned');

  // The password matched; the factor decides whether a session exists at all.
  const factor = await checkSecondFactor(db, secondFactor, user, input, secondFactor.policy);

  const session = await issueSession(db, {
    userId: user.id,
    pepper,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  await db.$transaction(async (tx) => {
    await recordEvent(tx, {
      boardId: null,
      actor: { kind: 'user', userId: user.id },
      type: 'security.login',
      payload: { method: factor.method ?? 'password' },
    });
  });
  return { user: toAuthenticated(user), session };
}

async function recordLoginFailure(db: Db, userId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await recordEvent(tx, {
      boardId: null,
      actor: { kind: 'user', userId },
      type: 'security.login_failed',
      payload: { method: 'password' },
    });
  });
}

export async function logout(db: Db, sessionId: string, userId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.session.updateMany({
      where: { id: sessionId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    await recordEvent(tx, {
      boardId: null,
      actor: { kind: 'user', userId },
      type: 'security.session_revoked',
      payload: { scope: 'current' },
    });
  });
}

export async function logoutAll(db: Db, userId: string): Promise<number> {
  const count = await revokeAllSessions(db, userId);
  await db.$transaction(async (tx) => {
    await recordEvent(tx, {
      boardId: null,
      actor: { kind: 'user', userId },
      type: 'security.session_revoked',
      payload: { scope: 'all', revoked: count },
    });
  });
  return count;
}

export function toAuthenticated(user: {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  is_instance_admin: boolean;
  locale: string;
  created_at: Date;
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    display_name: user.display_name,
    is_instance_admin: user.is_instance_admin,
    locale: user.locale,
    created_at: user.created_at,
  };
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw fromZod(result.error);
  return result.data;
}
