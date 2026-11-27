// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OIDC routes (docs/api.md §3 & §3b, docs/features/auth.md §7, K5-09).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { isSecureOrigin } from '../env.js';
import { AppError, fromZod } from '../lib/errors.js';
import { requireUser } from './request.js';
import { rotateCsrfCookie, setSessionCookie } from './sessions.js';
import {
  OIDC_STATE_COOKIE,
  buildAuthorizeRedirect,
  createOidcProvider,
  deleteOidcProvider,
  handleOidcCallback,
  listAdminOidcProviders,
  listEnabledOidcProviders,
  listLinkedOidcAccounts,
  testOidcProvider,
  unlinkOidcAccount,
  updateOidcProvider,
  type OidcStateCookie,
} from './oidc.js';

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i, 'lowercase letters, digits, and hyphens');

const createProviderSchema = z
  .object({
    slug: slugSchema,
    name: z.string().trim().min(1).max(80),
    issuer_url: z.string().trim().url().max(500),
    client_id: z.string().trim().min(1).max(200),
    client_secret: z.string().min(1).max(500),
    scopes: z.string().trim().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const updateProviderSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    issuer_url: z.string().trim().url().max(500).optional(),
    client_id: z.string().trim().min(1).max(200).optional(),
    client_secret: z.string().min(1).max(500).optional(),
    scopes: z.string().trim().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

function callbackUri(request: FastifyRequest, publicUrl: string | null, slug: string): string {
  const origin = publicUrl
    ? publicUrl.replace(/\/+$/u, '')
    : `${request.protocol}://${request.headers.host ?? '127.0.0.1'}`;
  return `${origin}/api/v1/auth/oidc/${encodeURIComponent(slug.toLowerCase())}/callback`;
}

function readStateCookie(request: FastifyRequest): OidcStateCookie | null {
  const raw = request.cookies[OIDC_STATE_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  try {
    const parsed = JSON.parse(unsigned.value) as OidcStateCookie;
    if (
      typeof parsed.state !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.code_verifier !== 'string' ||
      typeof parsed.provider !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function registerOidcRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };
  const secure = isSecureOrigin(context.env);

  /** Public list of enabled OIDC providers for the sign-in screen. */
  app.get('/api/v1/auth/oidc/providers', async () => {
    return { items: await listEnabledOidcProviders(database()) };
  });

  app.get('/api/v1/auth/oidc/:provider/start', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const redirectUri = callbackUri(request, context.env.KLUI_PUBLIC_URL, provider);
    const { authorizeUrl, cookiePayload } = await buildAuthorizeRedirect(database(), {
      slug: provider,
      redirectUri,
      mode: 'login',
    });
    reply.setCookie(OIDC_STATE_COOKIE, JSON.stringify(cookiePayload), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure,
      signed: true,
      maxAge: 600,
    });
    return reply.redirect(authorizeUrl, 302);
  });

  app.post('/api/v1/auth/oidc/:provider/link', async (request, reply) => {
    const userId = requireUser(request);
    const { provider } = request.params as { provider: string };
    const redirectUri = callbackUri(request, context.env.KLUI_PUBLIC_URL, provider);
    const { authorizeUrl, cookiePayload } = await buildAuthorizeRedirect(database(), {
      slug: provider,
      redirectUri,
      mode: 'link',
      userId,
    });
    reply.setCookie(OIDC_STATE_COOKIE, JSON.stringify(cookiePayload), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure,
      signed: true,
      maxAge: 600,
    });
    return reply.code(200).send({ url: authorizeUrl });
  });

  app.get('/api/v1/auth/oidc/:provider/callback', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const query = request.query as { code?: string; state?: string; error?: string };
    const cookie = readStateCookie(request);
    reply.clearCookie(OIDC_STATE_COOKIE, { path: '/' });

    if (query.error) {
      throw new AppError('unauthenticated', {
        message: `OIDC provider refused authentication (${query.error}).`,
        hint: 'Try again or sign in with your local password.',
      });
    }
    if (
      !cookie ||
      !query.code ||
      !query.state ||
      cookie.state !== query.state ||
      cookie.provider !== provider.toLowerCase()
    ) {
      throw new AppError('unauthenticated', {
        message: 'OIDC callback state could not be verified.',
        hint: 'Start the sign-in flow again.',
      });
    }

    const currentUserId = request.actor?.kind === 'user' ? request.actor.userId : null;
    const redirectUri = callbackUri(request, context.env.KLUI_PUBLIC_URL, provider);
    const outcome = await handleOidcCallback(
      database(),
      context.env,
      {
        encryptionKey: context.secrets.encryptionKey,
        tokenPepper: context.secrets.tokenPepper,
      },
      {
        slug: provider,
        code: query.code,
        redirectUri,
        cookie,
        currentUserId,
        ip: request.ip ?? null,
        userAgent:
          typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
      },
    );

    if (outcome.kind === 'link_required') {
      const accept = String(request.headers.accept ?? '');
      if (accept.includes('text/html') && !accept.includes('application/json')) {
        return reply.redirect('/login?oidc_error=link_required', 302);
      }
      throw new AppError('conflict', {
        message: 'An existing local account already uses this email address.',
        hint: 'Sign in with your password first, then explicitly link this provider in Account settings.',
      });
    }

    if (outcome.kind === 'linked') {
      return reply.redirect('/settings?oidc=linked', 302);
    }

    setSessionCookie(reply, outcome.session.raw, {
      secure,
      expires_at: outcome.session.expires_at,
    });
    rotateCsrfCookie(reply, secure);
    return reply.redirect('/boards', 302);
  });

  app.get('/api/v1/me/oidc', async (request) => {
    const userId = requireUser(request);
    return { items: await listLinkedOidcAccounts(database(), userId) };
  });

  app.delete('/api/v1/me/oidc/:provider', async (request, reply) => {
    const userId = requireUser(request);
    const { provider } = request.params as { provider: string };
    await unlinkOidcAccount(database(), userId, provider);
    return reply.code(204).send();
  });

  app.get('/api/v1/admin/oidc/providers', async (request) => {
    const adminId = requireUser(request);
    return { items: await listAdminOidcProviders(database(), adminId) };
  });

  app.post('/api/v1/admin/oidc/providers', async (request, reply) => {
    const adminId = requireUser(request);
    const parsed = createProviderSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const created = await createOidcProvider(
      database(),
      adminId,
      context.secrets.encryptionKey,
      parsed.data,
    );
    return reply.code(201).send(created);
  });

  app.patch('/api/v1/admin/oidc/providers/:slug', async (request) => {
    const adminId = requireUser(request);
    const { slug } = request.params as { slug: string };
    const parsed = updateProviderSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    return updateOidcProvider(
      database(),
      adminId,
      context.secrets.encryptionKey,
      slug,
      parsed.data,
    );
  });

  app.delete('/api/v1/admin/oidc/providers/:slug', async (request, reply) => {
    const adminId = requireUser(request);
    const { slug } = request.params as { slug: string };
    await deleteOidcProvider(database(), adminId, slug);
    return reply.code(204).send();
  });

  app.post('/api/v1/admin/oidc/providers/:slug/test', async (request) => {
    const adminId = requireUser(request);
    const { slug } = request.params as { slug: string };
    return testOidcProvider(database(), adminId, slug);
  });
}
