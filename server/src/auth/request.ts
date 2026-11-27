// SPDX-License-Identifier: AGPL-3.0-only
import type { Actor } from '../lib/authz.js';
import { AppError } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Resolved by the onRequest hook; null when no credential was presented. */
    actor: Actor | null;
    sessionId: string | null;
    userId: string | null;
    /** Set when the credential is an agent key (K4-01): rate limits key on it. */
    agentKeyId: string | null;
  }
}

/** 401 when a session is required and none was presented (docs/permissions.md §5). */
export function requireUser(request: { userId: string | null }): string {
  if (!request.userId) throw new AppError('unauthenticated');
  return request.userId;
}

export function requireActor(request: { actor: Actor | null }): Actor {
  if (!request.actor) throw new AppError('unauthenticated');
  return request.actor;
}
