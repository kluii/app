// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Credential → actor (docs/permissions.md §3 step 1). An invalid, revoked or
 * expired credential answers 401 invalid_credential: the credential itself is
 * the subject, never a 404 that pretends the board does not exist.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db.js';
import { AppError } from '../lib/errors.js';
import { hashToken } from '../lib/hash.js';
import { sessionCookieName } from '../contracts/auth.js';
import type { Actor } from '../lib/authz.js';
import { clearLinkCookie, findActiveLink, readLinkCookie, touchLink } from '../links/service.js';
import { readAnonCookie } from '../anon/service.js';
import { isAgentKey } from '../agents/service.js';

export function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined;
  return value;
}

export async function resolveActor(
  db: Db,
  pepper: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  request.actor = null;
  request.sessionId = null;
  request.userId = null;
  request.agentKeyId = null;

  const bearer = bearerToken(request);
  // An agent key is a bearer credential with its own resolver: it carries a
  // scope, and a revoked key must stop on the next call (K4-01).
  if (bearer !== undefined && isAgentKey(bearer)) {
    await resolveAgentActor(db, pepper, request, bearer);
    return;
  }
  const cookie = request.cookies[sessionCookieName];
  const raw = bearer ?? cookie;
  if (!raw) {
    await resolveLinkActor(db, request, reply);
    if (!request.actor) resolveAnonActor(request);
    return;
  }

  // A bearer credential wins over a cookie when both are present.
  const session = await db.session.findUnique({
    where: { token_hash: hashToken(raw, pepper) },
  });

  if (!session || session.revoked_at !== null || session.expires_at.getTime() <= Date.now()) {
    if (bearer) throw new AppError('invalid_credential');
    // A stale session cookie is not a reason to ignore a link or anon cookie.
    await resolveLinkActor(db, request, reply);
    if (!request.actor) resolveAnonActor(request);
    return;
  }

  // A ban is enforced before authorization: it leaks nothing about any board.
  const ban = await db.ban.findFirst({
    where: {
      subject: session.user_id,
      subject_kind: 'user',
      OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (ban) throw new AppError('banned');

  request.actor = { kind: 'user', userId: session.user_id } satisfies Actor;
  request.sessionId = session.id;
  request.userId = session.user_id;

  // last_seen_at is for ordering the session list, not a security decision.
  if (Date.now() - session.last_seen_at.getTime() > 60_000) {
    await db.session.update({ where: { id: session.id }, data: { last_seen_at: new Date() } });
  }
}

/**
 * The agent credential: a `kb_` key is looked up by hash, its expiry and
 * revocation checked on every request, and its scope baked into the actor.
 * `last_used_at` is written at most once a minute — it is a display value, not a
 * security decision.
 */
async function resolveAgentActor(
  db: Db,
  pepper: string,
  request: FastifyRequest,
  raw: string,
): Promise<void> {
  const key = await db.agentKey.findUnique({ where: { key_hash: hashToken(raw, pepper) } });
  if (!key || key.revoked_at !== null || key.expires_at.getTime() <= Date.now()) {
    throw new AppError('invalid_credential');
  }
  const ban = await db.ban.findFirst({
    where: {
      subject: key.user_id,
      subject_kind: 'user',
      OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (ban) throw new AppError('banned');

  request.actor = {
    kind: 'agent',
    userId: key.user_id,
    scope: key.scope,
    ...(key.board_id === null ? {} : { boardId: key.board_id }),
  } satisfies Actor;
  request.agentKeyId = key.id;
  request.userId = key.user_id;

  if (key.last_used_at === null || Date.now() - key.last_used_at.getTime() > 60_000) {
    await db.agentKey.update({ where: { id: key.id }, data: { last_used_at: new Date() } });
  }
}

/**
 * The second credential: a visitor who opened `/l/<token>` holds a signed
 * cookie naming one link. The link row is re-read here, so revoking it stops
 * the next request without a session refresh.
 */
async function resolveLinkActor(
  db: Db,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const cookie = readLinkCookie(request);
  if (!cookie) return;
  const link = await findActiveLink(db, cookie);
  if (!link) {
    // Revoked or forged: drop the cookie and stay anonymous.
    clearLinkCookie(reply, false);
    return;
  }
  request.actor = {
    kind: 'link',
    boardId: link.board_id,
    role: link.role,
    linkId: link.id,
  } satisfies Actor;
  await touchLink(db, link.id);
}

/**
 * The third credential: an anonymous visitor who gave a display name. It is a
 * signed value, not a database row — `can()` decides what it may read and write,
 * and the board it names is part of the value.
 */
function resolveAnonActor(request: FastifyRequest): void {
  const identity = readAnonCookie(request);
  if (!identity) return;
  request.actor = {
    kind: 'anon',
    boardId: identity.boardId,
    label: identity.label,
    anonId: identity.anonId,
  } satisfies Actor;
}
