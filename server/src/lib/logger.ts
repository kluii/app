// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Structured logs with no PII and no credentials (docs/security.md §3, §9).
 * The redaction list is applied to every log line, request logs included.
 */
import type { FastifyServerOptions } from 'fastify';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.token',
  '*.password',
  '*.token',
  '*.secret',
  '*.key',
  '*.key_hash',
  '*.token_hash',
  '*.rss_token_hash',
  '*.authorization',
  '*.cookie',
];

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export function loggerOptions(level: LogLevel): NonNullable<FastifyServerOptions['logger']> {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: undefined,
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
}

/** A redacted, path-only request log line: method, path, status, duration, request id. */
export function requestLogLine(input: {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId: string;
}): string {
  return `${input.method} ${redactPath(input.path)} ${input.status} ${Math.round(input.durationMs)}ms req=${input.requestId}`;
}

/** Credential-bearing path segments never reach a log line (trap 8). */
export function redactPath(path: string): string {
  return path
    .replace(/^\/l\/[^/?]+/, '/l/[redacted]')
    .replace(/^\/rss\/[^/?]+/, '/rss/[redacted]')
    .replace(/^\/b\/[^/?]+/, '/b/[redacted]');
}
