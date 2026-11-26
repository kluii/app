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
  _reply: FastifyReply,
): Promise<void> {
  request.actor = null;
  request.sessionId = null;
  request.userId = null;

  const bearer = bearerToken(request);
  const cookie = request.cookies[sessionCookieName];
  const raw = bearer ?? cookie;
  if (!raw) return;

  // A bearer credential wins over a cookie when both are present.
  const session = await db.session.findUnique({
    where: { token_hash: hashToken(raw, pepper) },
  });

  if (!session || session.revoked_at !== null || session.expires_at.getTime() <= Date.now()) {
    if (bearer) throw new AppError('invalid_credential');
    return;
  }

  request.actor = { kind: 'user', userId: session.user_id } satisfies Actor;
  request.sessionId = session.id;
  request.userId = session.user_id;

  // last_seen_at is for ordering the session list, not a security decision.
  if (Date.now() - session.last_seen_at.getTime() > 60_000) {
    await db.session.update({ where: { id: session.id }, data: { last_seen_at: new Date() } });
  }
}
