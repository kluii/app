// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { requireUser } from './request.js';
import {
  login,
  logout,
  logoutAll,
  signup,
  toAuthenticated,
  type AuthenticatedUser,
} from './service.js';
import {
  clearSessionCookie,
  issueSession,
  revokeSession,
  rotateCsrfCookie,
  setSessionCookie,
} from './sessions.js';
import { isSecureOrigin } from '../env.js';
import { totpPolicy } from './totp.js';
import { updateProfile } from './profile.js';
import { registerTotpRoutes } from './totp-routes.js';
import type { Me } from '../contracts/auth.js';
import { AppError } from '../lib/errors.js';
import {
  credentialLimiter,
  LOGIN_ACCOUNT,
  LOGIN_IP,
  SIGNUP_IP,
  loginAccountKey,
  loginIpKey,
  signupIpKey,
  submittedIdentifier,
} from '../lib/ratelimit.js';

/**
 * The credential buckets (docs/api.md §1). Counted here rather than by
 * `@fastify/rate-limit` because the login bucket counts *failures* and a
 * success clears it, and because the answer must not depend on whether the
 * account exists: the key is the submitted identifier and the body is the same
 * 429 either way.
 */
function tooManyAttempts(retryAfter: number): AppError {
  return new AppError('too_many_attempts', {
    message: 'Too many attempts.',
    hint: `Try again in ${retryAfter} seconds.`,
  });
}

function spend(
  reply: { header: (name: string, value: string) => unknown },
  key: string,
  options: { max: number; windowMs: number },
): void {
  const result = credentialLimiter.take(key, options);
  if (result.allowed) return;
  reply.header('retry-after', String(result.retryAfter));
  throw tooManyAttempts(result.retryAfter);
}

export function registerAuthRoutes(app: FastifyInstance, context: AppContext): void {
  const secure = isSecureOrigin(context.env);
  const pepper = context.secrets.tokenPepper;
  const limiting = context.env.KLUI_RATE_LIMIT === 'on';

  app.post('/api/v1/auth/signup', async (request, reply) => {
    if (!context.db) throw new Error('database is required');
    if (limiting) spend(reply, signupIpKey(request.ip), SIGNUP_IP);
    const meta = { ip: request.ip, userAgent: request.headers['user-agent'] ?? null };
    const { user, session } = await signup(context.db, context.env, pepper, request.body, meta);
    setSessionCookie(reply, session.raw, { secure, expires_at: session.expires_at });
    rotateCsrfCookie(reply, secure);
    return reply.code(201).send(await meFor(context.db, user));
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    if (!context.db) throw new Error('database is required');
    const meta = { ip: request.ip, userAgent: request.headers['user-agent'] ?? null };
    const identifier = submittedIdentifier(request.body);
    const accountKey = identifier === null ? null : loginAccountKey(identifier);
    if (limiting) {
      // Peek both before spending either: a full account bucket must not burn
      // an IP slot, and an exhausted IP bucket must not reveal the account.
      const account =
        accountKey === null ? null : credentialLimiter.peek(accountKey, LOGIN_ACCOUNT);
      if (account && !account.allowed) {
        reply.header('retry-after', String(account.retryAfter));
        throw tooManyAttempts(account.retryAfter);
      }
      const ip = credentialLimiter.peek(loginIpKey(request.ip), LOGIN_IP);
      if (!ip.allowed) {
        reply.header('retry-after', String(ip.retryAfter));
        throw tooManyAttempts(ip.retryAfter);
      }
      spend(reply, loginIpKey(request.ip), LOGIN_IP);
      if (accountKey !== null) spend(reply, accountKey, LOGIN_ACCOUNT);
    }
    const policy = await totpPolicy(context.db, context.env);
    const { user, session } = await login(context.db, pepper, request.body, meta, {
      encryptionKey: context.secrets.encryptionKey,
      policy,
    });
    // A success clears the account bucket: four typos then the right password
    // is not a lockout. The IP bucket is not cleared; that is documented.
    if (limiting && accountKey !== null) credentialLimiter.reset(accountKey);
    setSessionCookie(reply, session.raw, { secure, expires_at: session.expires_at });
    rotateCsrfCookie(reply, secure);
    return reply.code(200).send(await meFor(context.db, user));
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
    const factor = await context.db.totpSecret.findUnique({ where: { user_id: userId } });
    reply.header('cache-control', 'no-store');
    return reply.code(200).send(toMe(toAuthenticated(user), Boolean(factor?.confirmed_at)));
  });

  app.patch('/api/v1/me', async (request) => {
    if (!context.db) throw new Error('database is required');
    const userId = requireUser(request);
    const updated = await updateProfile(context.db, userId, request.body);
    const user = await context.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('session points at a missing user');
    const factor = await context.db.totpSecret.findUnique({ where: { user_id: userId } });
    return toMe({ ...toAuthenticated(user), ...updated }, Boolean(factor?.confirmed_at));
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

  registerTotpRoutes(app, context);
}

/**
 * The row as it is. `created_at` comes from the account, never from the clock,
 * and `totp_enabled` is the confirmed factor — a login body that says otherwise
 * makes the security page lie about its own state.
 */
function toMe(user: ReturnType<typeof toAuthenticated>, totpEnabled: boolean): Me {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    display_name: user.display_name,
    totp_enabled: totpEnabled,
    is_instance_admin: user.is_instance_admin,
    created_at: user.created_at.toISOString(),
  };
}

/** Signup and login answer with the account state, factor included. */
async function meFor(db: NonNullable<AppContext['db']>, user: AuthenticatedUser): Promise<Me> {
  const factor = await db.totpSecret.findUnique({ where: { user_id: user.id } });
  return toMe(user, Boolean(factor?.confirmed_at));
}
