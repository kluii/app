// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Anonymous participation (docs/features/links-and-anonymous.md §4).
 *
 * The display name is not an account: it grants nothing, cannot sign in and is
 * not unique. What makes "edit the card I just created" enforceable is the
 * `anonId`, 16 random bytes minted here and carried in a signed cookie for 12 h,
 * stored on every card the actor creates.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { base62 } from '../lib/ids.js';

export const ANON_COOKIE = 'klui_anon';
export const ANON_TTL_SECONDS = 12 * 60 * 60;

export type AnonIdentity = { boardId: string; anonId: string; label: string };

export function newAnonId(): string {
  return base62(22);
}

/** The cookie is signed by @fastify/cookie; the label is base64url so a dot or a space is safe. */
export function encodeAnon(identity: AnonIdentity): string {
  return `${identity.boardId}.${identity.anonId}.${Buffer.from(identity.label, 'utf8').toString(
    'base64url',
  )}`;
}

export function decodeAnon(value: string): AnonIdentity | null {
  const [boardId, anonId, label] = value.split('.');
  if (!boardId || !anonId || !label) return null;
  try {
    return { boardId, anonId, label: Buffer.from(label, 'base64url').toString('utf8') };
  } catch {
    return null;
  }
}

export function setAnonCookie(reply: FastifyReply, identity: AnonIdentity, secure: boolean): void {
  reply.setCookie(ANON_COOKIE, encodeAnon(identity), {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: ANON_TTL_SECONDS,
  });
}

export function readAnonCookie(request: FastifyRequest): AnonIdentity | null {
  const raw = request.cookies[ANON_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  return decodeAnon(unsigned.value);
}

export function clearAnonCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(ANON_COOKIE, { path: '/', secure });
}
