// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { requireUser } from './request.js';
import { login, logout, logoutAll, signup, toAuthenticated } from './service.js';
import {
  clearSessionCookie,
  issueSession,
  revokeSession,
  rotateCsrfCookie,
  setSessionCookie,
} from './sessions.js';
import { isSecureOrigin } from '../env.js';
import type { Me } from '../contracts/auth.js';

export function registerAuthRoutes(app: FastifyInstance, context: AppContext): void {
  const secure = isSecureOrigin(context.env);
  const pepper = context.secrets.tokenPepper;

  app.post('/api/v1/auth/signup', async (request, reply) => {
    if (!context.db) throw new Error('database is required');
    const meta = { ip: request.ip, userAgent: request.headers['user-agent'] ?? null };
    const { user, session } = await signup(context.db, context.env, pepper, request.body, meta);
    setSessionCookie(reply, session.raw, { secure, expires_at: session.expires_at });
    rotateCsrfCookie(reply, secure);
    return reply.code(201).send(toMe(user));
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    if (!context.db) throw new Error('database is required');
    const meta = { ip: request.ip, userAgent: request.headers['user-agent'] ?? null };
    const { user, session } = await login(context.db, pepper, request.body, meta);
    setSessionCookie(reply, session.raw, { secure, expires_at: session.expires_at });
    rotateCsrfCookie(reply, secure);
    return reply.code(200).send(toMe(user));
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    if (!context.db) throw new Error('database is required');
    const userId = requireUser(request);
    if (request.sessionId) await logout(context.db, request.sessionId, userId);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.post('/api/v1/auth/logout-all', async (request, reply) => {
    if (!context.db) throw new Error('database is required');
    const userId = requireUser(request);
    await logoutAll(context.db, userId);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get('/api/v1/me', async (request, reply) => {
    if (!context.db) throw new Error('database is required');
    const userId = requireUser(request);
    const user = await context.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('session points at a missing user');
    // Refreshing the CSRF cookie on /me keeps a reloaded tab able to write.
    if (!request.cookies['klui_csrf']) rotateCsrfCookie(reply, secure);
    reply.header('cache-control', 'no-store');
    return reply.code(200).send(toMe(toAuthenticated(user)));
  });

  app.get('/api/v1/me/sessions', async (request) => {
    if (!context.db) throw new Error('database is required');
    const userId = requireUser(request);
    const sessions = await context.db.session.findMany({
      where: { user_id: userId, revoked_at: null, expires_at: { gt: new Date() } },
      orderBy: { last_seen_at: 'desc' },
    });
    return {
      items: sessions.map((row) => ({
        id: row.id,
        ip: row.ip,
        user_agent: row.user_agent,
        created_at: row.created_at.toISOString(),
        last_seen_at: row.last_seen_at.toISOString(),
        current: row.id === request.sessionId,
      })),
    };
  });

  app.delete('/api/v1/me/sessions/:id', async (request, reply) => {
    if (!context.db) throw new Error('database is required');
    const userId = requireUser(request);
    const params = request.params as { id: string };
    const row = await context.db.session.findFirst({ where: { id: params.id, user_id: userId } });
    if (!row) {
      return reply.code(404).send({
        error: { code: 'not_found', message: 'Not found.', hint: null },
      });
    }
    await revokeSession(context.db, params.id);
    if (params.id === request.sessionId) clearSessionCookie(reply);
    return reply.code(204).send();
  });

  // Issuing a session for an already-authenticated actor is a privilege change:
  // the new id is what a stolen cookie cannot follow (D-16).
  app.post('/api/v1/me/rotate', async (request, reply) => {
    if (!context.db) throw new Error('database is required');
    const userId = requireUser(request);
    if (request.sessionId) await revokeSession(context.db, request.sessionId);
    const session = await issueSession(context.db, {
      userId,
      pepper,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    setSessionCookie(reply, session.raw, { secure, expires_at: session.expires_at });
    return reply.code(204).send();
  });
}

function toMe(user: ReturnType<typeof toAuthenticated>): Me {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    display_name: user.display_name,
    totp_enabled: false,
    is_instance_admin: user.is_instance_admin,
    created_at: new Date().toISOString(),
  };
}
