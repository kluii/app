// SPDX-License-Identifier: AGPL-3.0-only
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import type { Env } from './env.js';
import type { Db } from './db.js';
import { AppError, toWire } from './lib/errors.js';
import { loggerOptions } from './lib/logger.js';
import { registerHealth } from './settings/health.js';
import { registerRateLimit } from './settings/ratelimit.js';
import {
  contentSecurityPolicy,
  isSpaNavigation,
  loadStaticAssets,
  registerStatic,
} from './settings/static.js';
import type { Secrets } from './lib/secrets.js';
import { createHub, type Hub } from './realtime/events.js';
import { registerRealtimeRoutes } from './realtime/routes.js';
import { resolveActor } from './auth/actor.js';
import { registerAuthRoutes } from './auth/routes.js';
import { CSRF_EXEMPT_PATHS, csrfMatches } from './auth/sessions.js';
import { sessionCookieName } from './contracts/auth.js';
import { registerBoardRoutes } from './boards/routes.js';
import { registerColumnRoutes } from './columns/routes.js';
import { registerCardRoutes } from './cards/routes.js';
import { registerActivityRoutes } from './activity/routes.js';
import { registerResetRoutes } from './auth/reset-routes.js';
import { registerAdminRoutes } from './admin/routes.js';
import { registerExportRoutes } from './export/routes.js';
import { registerImportRoutes } from './import/routes.js';
import type { Mailer } from './lib/mail.js';

export type AppContext = {
  env: Env;
  db: Db | null;
  secrets: Secrets;
  /** In-process SSE hub; publishing happens after commit (D-29). */
  hub?: Hub;
  /** Null when SMTP is unconfigured: the reset endpoint then fails closed. */
  mail?: Mailer | null;
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Accept X-Request-Id only when it is safe to echo, else generate (docs/architecture.md §4). */
function resolveRequestId(header: string | string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : crypto.randomUUID();
}

/**
 * Route registration is wiring only (docs/architecture.md §2). Anything with a
 * decision lives in the domain module that owns it.
 */
export function buildApp(context: AppContext): FastifyInstance {
  const hops = context.env.KLUI_TRUSTED_PROXY_HOPS;
  const hub = context.hub ?? createHub();
  const assets = loadStaticAssets(new URL('../../web/dist', import.meta.url).pathname);
  const csp = contentSecurityPolicy(assets?.bootstrapHash ?? null);

  const app: FastifyInstance = Fastify({
    logger: loggerOptions(context.env.KLUI_LOG_LEVEL),
    bodyLimit: 1024 * 1024,
    trustProxy: hops > 0 ? (_address: string, hop: number) => hop < hops : false,
    genReqId: (raw) => resolveRequestId(raw.headers['x-request-id']),
  });

  app.register(cookie, { secret: context.secrets.sessionSecret, hook: 'onRequest' });

  // Import accepts a file upload (docs/api.md §1). One file, 5 MB, and the JSON
  // body limit on that route is raised to match.
  app.register(multipart, { limits: { files: 1, fileSize: 5 * 1024 * 1024 } });

  app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: context.env.KLUI_ENV === 'production',
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('content-security-policy', csp);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    return payload;
  });

  // D-01: the app contains no marketing route, and `/` answers with a redirect
  // decided by the credential that was actually presented. It is registered
  // outside the static plugin so it works before the SPA is built.
  app.get('/', async (request, reply) => {
    return reply
      .header('cache-control', 'no-store')
      .redirect(request.actor ? '/boards' : '/login', 302);
  });

  if (assets) {
    registerStatic(app, assets);
  }

  // 7. Authentication: resolve the credential into an actor before any handler.
  app.addHook('onRequest', async (request, reply) => {
    if (!context.db) return;
    await resolveActor(context.db, context.secrets.tokenPepper, request, reply);
  });

  // 7b. Request buckets, after the actor is known and before any route exists
  // (settings/ratelimit.ts explains why this is global rather than opt-in).
  registerRateLimit(app, context.env);

  // 8. CSRF double submit for cookie-authenticated writes; bearer is exempt.
  app.addHook('preHandler', async (request) => {
    const method = request.method.toUpperCase();
    if (method !== 'POST' && method !== 'PATCH' && method !== 'PUT' && method !== 'DELETE') return;
    const path = request.url.split('?')[0] ?? request.url;
    if (CSRF_EXEMPT_PATHS.has(path)) return;
    if (request.headers.authorization) return;
    if (!request.cookies[sessionCookieName]) return;
    if (!csrfMatches(request)) {
      throw new AppError('csrf_failed', {
        message: 'The request could not be verified.',
        hint: 'Reload the page: the CSRF cookie and the X-Klui-CSRF header must match.',
      });
    }
    const origin = request.headers.origin;
    if (origin && context.env.KLUI_PUBLIC_URL && !origin.startsWith(context.env.KLUI_PUBLIC_URL)) {
      throw new AppError('forbidden_origin', {
        message: 'The request came from an unexpected origin.',
        hint: null,
      });
    }
  });

  app.register(async (scoped) => {
    registerAuthRoutes(scoped, { ...context, hub });
    registerBoardRoutes(scoped, { ...context, hub });
    registerColumnRoutes(scoped, { ...context, hub });
    registerCardRoutes(scoped, { ...context, hub });
    registerActivityRoutes(scoped, { ...context, hub });
    registerResetRoutes(scoped, { ...context, hub });
    registerAdminRoutes(scoped, { ...context, hub });
    registerExportRoutes(scoped, { ...context, hub });
    registerImportRoutes(scoped, { ...context, hub });
    registerRealtimeRoutes(scoped, { ...context, hub });
  });

  app.register(async (scoped) => {
    registerHealth(scoped, context.db);
  });

  // A shutting-down process says so on every open stream, so clients reconnect
  // with backoff instead of waiting for a dead socket (docs/features/realtime.md §1).
  app.addHook('onClose', async () => {
    hub.closeAll();
  });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof AppError) {
      const { status, body } = toWire(error, String(request.id));
      return reply.code(status).send(body);
    }
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      const appError = new AppError(
        error.statusCode === 415
          ? 'unsupported_media_type'
          : error.statusCode === 413
            ? 'payload_too_large'
            : 'validation_failed',
        { message: error.message, hint: null, status: error.statusCode },
      );
      const { status, body } = toWire(appError, String(request.id));
      return reply.code(status).send(body);
    }
    request.log.error({ err: error }, 'unhandled error');
    const { status, body } = toWire(new AppError('internal'), String(request.id));
    return reply.code(status).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    if (
      assets &&
      request.method === 'GET' &&
      isSpaNavigation(request.url, request.headers.accept)
    ) {
      return reply
        .header('cache-control', 'no-store')
        .type('text/html; charset=utf-8')
        .send(assets.indexHtml);
    }
    const { status, body } = toWire(
      new AppError('not_found', { message: 'Not found.', hint: null, status: 404 }),
      String(request.id),
    );
    request.log.info({ status: 404 }, 'not found');
    return reply.code(status).send(body);
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', String(request.id));
    return payload;
  });

  return app;
}
