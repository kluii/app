// SPDX-License-Identifier: AGPL-3.0-only
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import type { Env } from './env.js';
import type { Db } from './db.js';
import { AppError, toWire } from './lib/errors.js';
import { loggerOptions } from './lib/logger.js';
import { registerHealth } from './settings/health.js';
import {
  contentSecurityPolicy,
  isSpaNavigation,
  loadStaticAssets,
  registerStatic,
} from './settings/static.js';
import type { Secrets } from './lib/secrets.js';

export type AppContext = {
  env: Env;
  db: Db | null;
  secrets: Secrets;
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
  const assets = loadStaticAssets(new URL('../../web/dist', import.meta.url).pathname);
  const csp = contentSecurityPolicy(assets?.bootstrapHash ?? null);

  const app: FastifyInstance = Fastify({
    logger: loggerOptions(context.env.KLUI_LOG_LEVEL),
    bodyLimit: 1024 * 1024,
    trustProxy: hops > 0 ? (_address: string, hop: number) => hop < hops : false,
    genReqId: (raw) => resolveRequestId(raw.headers['x-request-id']),
  });

  app.register(cookie, { secret: context.secrets.sessionSecret, hook: 'onRequest' });

  app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: context.env.KLUI_ENV === 'production',
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('content-security-policy', csp);
    reply.header('x-content-type-options', 'nosniff');
    reply.header(
      'permissions-policy',
      'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    );
    return payload;
  });

  if (assets) {
    registerStatic(app, assets);
  }

  app.register(async (scoped) => {
    registerHealth(scoped, context.db);
  });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof AppError) {
      const { status, body } = toWire(error, String(request.id));
      return reply.code(status).send(body);
    }
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      const appError = new AppError(
        error.statusCode === 415 ? 'unsupported_media_type' : 'validation_failed',
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
