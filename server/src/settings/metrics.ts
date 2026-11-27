// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Prometheus `/metrics` endpoint (K5-03, D-44, docs/deployment.md §7).
 *
 * Off by default (`404`). When `KLUI_METRICS_ENABLED=true`:
 * - if `KLUI_METRICS_TOKEN` is set, requires `Authorization: Bearer <token>`
 *   (constant-time comparison; `401` without it or on mismatch);
 * - otherwise, permits loopback addresses only (`127.0.0.1`, `::1`,
 *   `::ffff:127.0.0.1`) and refuses remote callers with `401`.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db.js';
import { pingDb } from '../db.js';
import type { Env } from '../env.js';
import { bearerToken } from '../auth/actor.js';
import { AppError } from '../lib/errors.js';
import { readVersion } from '../lib/version.js';
import type { Hub } from '../realtime/events.js';

type MetricsContext = {
  env: Env;
  db: Db | null;
  hub: Hub;
};

function isLoopbackIp(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('127.');
}

function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) return false;
  const left = Buffer.from(presented, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function statusClass(code: number): string {
  if (code >= 500) return '5xx';
  if (code >= 400) return '4xx';
  if (code >= 300) return '3xx';
  if (code >= 200) return '2xx';
  return '1xx';
}

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

export function registerMetrics(app: FastifyInstance, context: MetricsContext): void {
  const { env, db, hub } = context;
  const requestCounts = new Map<string, number>();
  let durationSumSeconds = 0;
  let durationCount = 0;

  if (env.KLUI_METRICS_ENABLED) {
    app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
      const path = request.url.split('?')[0] ?? request.url;
      if (path === '/metrics') return;
      const method = request.method.toUpperCase();
      const bucket = statusClass(reply.statusCode);
      const key = `${method}|${bucket}`;
      requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
      durationSumSeconds += reply.elapsedTime / 1000;
      durationCount += 1;
    });
  }

  app.get('/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!env.KLUI_METRICS_ENABLED) {
      throw new AppError('not_found', { message: 'Not found.', hint: null });
    }

    if (env.KLUI_METRICS_TOKEN !== null) {
      const presented = bearerToken(request);
      if (!tokenMatches(presented, env.KLUI_METRICS_TOKEN)) {
        reply.header('www-authenticate', 'Bearer');
        throw new AppError('unauthenticated', {
          message: 'A valid metrics bearer token is required.',
          hint: 'Send Authorization: Bearer $KLUI_METRICS_TOKEN.',
        });
      }
    } else if (!isLoopbackIp(request.ip)) {
      reply.header('www-authenticate', 'Bearer');
      throw new AppError('unauthenticated', {
        message: 'Metrics are restricted to loopback unless KLUI_METRICS_TOKEN is set.',
        hint: 'Scrape from 127.0.0.1 or configure KLUI_METRICS_TOKEN.',
      });
    }

    const dbUp = db ? await pingDb(db) : false;
    const memory = process.memoryUsage();
    const version = escapeLabel(readVersion());

    const lines: string[] = [
      '# HELP klui_info Build metadata for this Klui process.',
      '# TYPE klui_info gauge',
      `klui_info{version="${version}"} 1`,
      '# HELP klui_db_up Whether PostgreSQL answered SELECT 1 (1 = up, 0 = down).',
      '# TYPE klui_db_up gauge',
      `klui_db_up ${dbUp ? 1 : 0}`,
      '# HELP klui_process_uptime_seconds Process uptime in seconds.',
      '# TYPE klui_process_uptime_seconds gauge',
      `klui_process_uptime_seconds ${process.uptime().toFixed(3)}`,
      '# HELP klui_process_resident_memory_bytes Resident set size in bytes.',
      '# TYPE klui_process_resident_memory_bytes gauge',
      `klui_process_resident_memory_bytes ${memory.rss}`,
      '# HELP klui_process_heap_used_bytes V8 heap used in bytes.',
      '# TYPE klui_process_heap_used_bytes gauge',
      `klui_process_heap_used_bytes ${memory.heapUsed}`,
      '# HELP klui_sse_subscribers Active SSE subscribers connected to this process.',
      '# TYPE klui_sse_subscribers gauge',
      `klui_sse_subscribers ${hub.size()}`,
      '# HELP klui_http_requests_total Completed HTTP requests by method and status class.',
      '# TYPE klui_http_requests_total counter',
    ];

    for (const [key, count] of [...requestCounts.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const [method, bucket] = key.split('|');
      lines.push(
        `klui_http_requests_total{method="${escapeLabel(method ?? '')}",status_class="${escapeLabel(bucket ?? '')}"} ${count}`,
      );
    }

    lines.push(
      '# HELP klui_http_request_duration_seconds_sum Total HTTP request duration in seconds.',
      '# TYPE klui_http_request_duration_seconds_sum counter',
      `klui_http_request_duration_seconds_sum ${durationSumSeconds.toFixed(6)}`,
      '# HELP klui_http_request_duration_seconds_count Count of timed HTTP requests.',
      '# TYPE klui_http_request_duration_seconds_count counter',
      `klui_http_request_duration_seconds_count ${durationCount}`,
    );

    return reply
      .code(200)
      .header('cache-control', 'no-store')
      .header('x-robots-tag', 'noindex')
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(`${lines.join('\n')}\n`);
  });
}
