// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server-side sessions (D-16): id = 32 random bytes, stored as sha256 with the
 * instance pepper, 30 days absolute, rotated on privilege change, revoked on
 * logout-all and on password reset.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db.js';
import { newId, sessionToken } from '../lib/ids.js';
import { constantTimeEqual, hashToken } from '../lib/hash.js';
import { csrfCookieName, csrfHeaderName, sessionCookieName } from '../contracts/auth.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type IssuedSession = { id: string; raw: string; expires_at: Date };

export async function issueSession(
  db: Db,
  input: { userId: string; pepper: string; ip?: string | null; userAgent?: string | null },
): Promise<IssuedSession> {
  const raw = sessionToken();
  const id = newId('ses');
  const expires_at = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: {
      id,
      token_hash: hashToken(raw, input.pepper),
      user_id: input.userId,
      expires_at,
      ip: input.ip ?? null,
      user_agent: input.userAgent?.slice(0, 255) ?? null,
    },
  });
  return { id, raw, expires_at };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.session.updateMany({
    where: { id: sessionId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

export async function revokeAllSessions(db: Db, userId: string): Promise<number> {
  const result = await db.session.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  return result.count;
}

export function setSessionCookie(
  reply: FastifyReply,
  raw: string,
  options: { secure: boolean; expires_at: Date },
): void {
  reply.setCookie(sessionCookieName, raw, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: options.secure,
    expires: options.expires_at,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(sessionCookieName, { path: '/' });
}

/** Double-submit token: readable by the SPA, compared in constant time. */
export function rotateCsrfCookie(reply: FastifyReply, secure: boolean): string {
  const token = sessionToken();
  reply.setCookie(csrfCookieName, token, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    secure,
  });
  return token;
}

export function csrfCookie(request: FastifyRequest): string | undefined {
  return request.cookies[csrfCookieName];
}

export function csrfHeader(request: FastifyRequest): string | undefined {
  const header = request.headers[csrfHeaderName];
  return Array.isArray(header) ? header[0] : header;
}

export function csrfMatches(request: FastifyRequest): boolean {
  const cookie = csrfCookie(request);
  const header = csrfHeader(request);
  if (!cookie || !header) return false;
  return constantTimeEqual(cookie, header);
}

export const CSRF_EXEMPT_PATHS = new Set(['/api/v1/auth/signup', '/api/v1/auth/login']);
