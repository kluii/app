// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Write links (docs/features/links-and-anonymous.md §3).
 *
 * The token is 32 base62 characters, returned in one response and never stored:
 * the row keeps `sha256(token + pepper)`. The cookie a visitor receives holds
 * `linkId.boardId`, signed with the instance secret, and the row is re-read on
 * every request — so revoking a link is effective on the next call.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db.js';
import { hashToken } from '../lib/hash.js';
import { newId, base62 } from '../lib/ids.js';

export const LINK_COOKIE = 'klui_link';
export const LINK_TTL_DAYS = 30;

export function linkToken(): string {
  return base62(32);
}

export function linkCookieValue(linkId: string, boardId: string): string {
  return `${linkId}.${boardId}`;
}

export function setLinkCookie(
  reply: FastifyReply,
  input: { linkId: string; boardId: string; secure: boolean },
): void {
  reply.setCookie(LINK_COOKIE, linkCookieValue(input.linkId, input.boardId), {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: input.secure,
    maxAge: LINK_TTL_DAYS * 24 * 60 * 60,
  });
}

export function clearLinkCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(LINK_COOKIE, { path: '/', secure });
}

/** `linkId.boardId` from a valid signed cookie; anything else is no credential. */
export function readLinkCookie(
  request: FastifyRequest,
): { linkId: string; boardId: string } | null {
  const raw = request.cookies[LINK_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const [linkId, boardId] = unsigned.value.split('.');
  if (!linkId || !boardId) return null;
  return { linkId, boardId };
}

export async function findActiveLink(
  db: Db,
  input: { linkId: string; boardId: string },
): Promise<{ id: string; board_id: string; role: 'read' | 'edit' } | null> {
  const link = await db.boardLink.findFirst({
    where: { id: input.linkId, board_id: input.boardId, revoked_at: null },
    select: { id: true, board_id: true, role: true },
  });
  return link;
}

/** At most one write a minute: a read must not become a write amplification vector. */
export async function touchLink(db: Db, linkId: string): Promise<void> {
  const row = await db.boardLink.findUnique({
    where: { id: linkId },
    select: { last_used_at: true },
  });
  if (row?.last_used_at && Date.now() - row.last_used_at.getTime() < 60_000) return;
  await db.boardLink.update({ where: { id: linkId }, data: { last_used_at: new Date() } });
}

export function newLinkId(): string {
  return newId('lnk');
}

export function hashLinkToken(raw: string, pepper: string): string {
  return hashToken(raw, pepper);
}
