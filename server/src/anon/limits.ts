// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Abuse controls for the anonymous paths (docs/security.md §6, K3-07).
 *
 * A display name costs nothing, so the only scarce thing is the write itself:
 * one bucket per board per hour (the flooding vector) and one per address per
 * hour (the scripted vector), both in memory per process like every other
 * bucket in Klui — a restart forgives, and that is documented.
 *
 * A ban on the address is checked here rather than in `can()`: it is an
 * instance-level refusal, not a board permission, and it must answer 403 for an
 * actor who could otherwise read the board.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db.js';
import type { Env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { verifyCap } from '../lib/captcha.js';
import { RateLimiter } from '../lib/ratelimit.js';

const HOUR_MS = 60 * 60 * 1000;

/** One limiter per process, like the credential and session buckets. */
export const anonLimiter = new RateLimiter();

export type Spend = { allowed: true } | { allowed: false; retryAfter: number };

/** Spent once the board is known to accept anonymous writes, not before. */
export function spendJoin(env: Env, ip: string): Spend {
  return anonLimiter.take(`anon:join:${ip}`, {
    max: env.KLUI_ANON_JOINS_PER_IP,
    windowMs: HOUR_MS,
  });
}

/**
 * Peek both buckets before spending either: a board at its cap must not also
 * drain the address's budget, or one busy board would take the office with it.
 */
export function spendWrite(env: Env, boardId: string, ip: string): Spend {
  const boardKey = `anon:board:${boardId}`;
  const board: { max: number; windowMs: number } = {
    max: env.KLUI_ANON_WRITES_PER_BOARD,
    windowMs: HOUR_MS,
  };
  const boardPeek = anonLimiter.peek(boardKey, board);
  if (!boardPeek.allowed) return boardPeek;
  const ipKey = `anon:ip:${ip}`;
  const address: { max: number; windowMs: number } = {
    max: env.KLUI_ANON_WRITES_PER_IP,
    windowMs: HOUR_MS,
  };
  const ipPeek = anonLimiter.peek(ipKey, address);
  if (!ipPeek.allowed) return ipPeek;
  anonLimiter.take(boardKey, board);
  return anonLimiter.take(ipKey, address);
}

/** How many writes this address has made in the current window (captcha gate). */
export function addressWrites(ip: string): number {
  return anonLimiter.count(`anon:ip:${ip}`);
}

export async function addressBanned(db: Db, ip: string): Promise<boolean> {
  const ban = await db.ban.findFirst({
    where: {
      subject: ip,
      subject_kind: 'ip',
      OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
    },
    select: { id: true },
  });
  return ban !== null;
}

/** A ban is enforced before anything else on the anonymous paths. */
export async function assertAddressAllowed(db: Db, ip: string): Promise<void> {
  if (await addressBanned(db, ip)) throw new AppError('banned');
}

export function assertSpent(reply: FastifyReply, spent: Spend, hint: string): void {
  if (spent.allowed) return;
  // Set before the throw: the error handler renders the body, the header has to
  // survive on the same reply.
  reply.header('retry-after', String(spent.retryAfter));
  throw new AppError('rate_limited', {
    message: 'Too many anonymous writes.',
    hint: `${hint} Try again in ${spent.retryAfter} seconds.`,
  });
}

/**
 * Cap past the threshold, and only there: an instance that leaves the captcha
 * off never makes an outbound request, and an address that has not yet written
 * three cards is not asked to prove anything (D-46).
 */
async function guardCaptcha(env: Env, ip: string, capToken: string | undefined): Promise<void> {
  if (!env.KLUI_CAPTCHA_ENABLED || env.KLUI_CAPTCHA_URL === null) return;
  if (addressWrites(ip) < env.KLUI_CAPTCHA_THRESHOLD) return;
  const token = capToken?.trim() ?? '';
  if (token === '') {
    throw new AppError('captcha_required', {
      hint: 'Solve the challenge, then retry with cap_token.',
    });
  }
  const check = await verifyCap({
    url: env.KLUI_CAPTCHA_URL,
    secret: env.KLUI_CAPTCHA_SECRET,
    token,
  });
  if (check.ok) return;
  if (check.reason === 'rejected') {
    throw new AppError('captcha_failed', { hint: 'Solve the challenge again and retry.' });
  }
  throw new AppError('service_unavailable', {
    message: 'The captcha could not be verified.',
    hint: 'The instance captcha is unreachable; try again later.',
  });
}

/** The one call a write path makes: ban, captcha, then both buckets. */
export async function guardAnonWrite(
  request: FastifyRequest,
  reply: FastifyReply,
  env: Env,
  db: Db,
  boardId: string,
  capToken?: string,
): Promise<void> {
  await assertAddressAllowed(db, request.ip);
  await guardCaptcha(env, request.ip, capToken);
  assertSpent(reply, spendWrite(env, boardId, request.ip), 'This board is taking writes slowly.');
}
