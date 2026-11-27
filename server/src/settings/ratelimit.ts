// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The per-session request buckets (docs/api.md §1).
 *
 * `@fastify/rate-limit` was the obvious host and is the wrong one: it gives
 * every route its own store, so "120 writes per minute per user" would have
 * meant 120 per route — a script with twenty routes gets twenty times the
 * budget, and a claim of a global bucket would be false. The same in-memory
 * limiter as the credential buckets, driven from one `onRequest` hook, has the
 * documented meaning and no route to forget.
 *
 * Off unless `KLUI_RATE_LIMIT=on`, which production defaults to and the test
 * suite leaves off. The behaviour is proven by test/ratelimit.test.ts, which
 * builds its own app with small explicit limits.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { RateLimiter } from '../lib/ratelimit.js';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** One limiter per process, like the credential buckets: a restart forgives. */
const sessionLimiter = new RateLimiter();
/** Per agent key, not per user: two agents on one account must not starve each other. */
const agentLimiter = new RateLimiter();
const WINDOW_MS = 60_000;

export function isWrite(request: FastifyRequest): boolean {
  return WRITE_METHODS.has(request.method.toUpperCase());
}

export function sessionKey(request: FastifyRequest): string {
  const which = request.userId ?? request.ip;
  return `${isWrite(request) ? 'write' : 'read'}:${which}`;
}

export function limitFor(env: Env, request: FastifyRequest): number {
  return isWrite(request) ? env.KLUI_RATE_LIMIT_WRITES : env.KLUI_RATE_LIMIT_READS;
}

/** `/healthz` and the SSE stream are never counted: one is a probe, one is a socket. */
export function exemptFromSessionBuckets(request: FastifyRequest): boolean {
  const path = request.url.split('?')[0] ?? request.url;
  if (path === '/healthz') return true;
  if (path === '/api/v1/stream') return true;
  // Static assets and the SPA shell are not session traffic.
  return !path.startsWith('/api/v1/');
}

/**
 * `/mcp` charges its own bucket inside the route, after the JSON-RPC body says
 * whether the call reads or writes (docs/mcp.md §5, mcp/ratelimit.ts). Charging
 * it here first would bill every read at the write price — the gap D-57
 * recorded — or, worse, charge it twice.
 */
export function isMcpRequest(request: FastifyRequest): boolean {
  return (request.url.split('?')[0] ?? request.url) === '/mcp';
}

export function registerRateLimit(app: FastifyInstance, env: Env): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // The agent buckets are always on, like the anonymous ones: an agent loop is
    // an incident whether or not the session buckets were switched off.
    if (request.agentKeyId !== null) {
      if (isMcpRequest(request)) return;
      const max = isWrite(request) ? env.KLUI_AGENT_WRITES : env.KLUI_AGENT_READS;
      const key = `agent:${request.agentKeyId}:${isWrite(request) ? 'write' : 'read'}`;
      const result = agentLimiter.take(key, { max, windowMs: WINDOW_MS });
      reply.header('x-ratelimit-limit', String(max));
      if (!result.allowed) {
        reply.header('retry-after', String(result.retryAfter));
        reply.header('x-ratelimit-remaining', '0');
        throw new AppError('rate_limited', {
          message: 'Too many requests for this agent key.',
          hint: `Wait ${result.retryAfter} seconds, or use the bulk tool.`,
        });
      }
      reply.header('x-ratelimit-remaining', String(Math.max(0, max - agentLimiter.count(key))));
      return;
    }

    if (env.KLUI_RATE_LIMIT !== 'on') return;
    if (exemptFromSessionBuckets(request)) return;
    const key = sessionKey(request);
    const max = limitFor(env, request);
    const result = sessionLimiter.take(key, { max, windowMs: WINDOW_MS });
    reply.header('x-ratelimit-limit', String(max));
    if (result.allowed) {
      reply.header('x-ratelimit-remaining', String(Math.max(0, max - sessionLimiter.count(key))));
      return;
    }
    // Set before the throw: the error handler renders the body, but the header
    // has to survive on the same reply.
    reply.header('retry-after', String(result.retryAfter));
    reply.header('x-ratelimit-remaining', '0');
    throw new AppError('rate_limited', {
      message: 'Too many requests.',
      hint: `Slow down: try again in ${result.retryAfter} seconds.`,
    });
  });
}

export { agentLimiter, sessionLimiter };
