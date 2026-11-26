// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SPA is served from `web/dist` by one process (ADR-0006).
 *
 * Trap: @fastify/static snapshots the asset list at boot, so a rebuild without a
 * restart serves the previous bundle and 404s the new one — a blank page with no
 * console error. /healthz reports the version of the running build.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export type StaticAssets = {
  dir: string;
  indexHtml: string;
  /** sha256 of the inline theme bootstrap, for the CSP script hash. */
  bootstrapHash: string | null;
};

const INLINE_SCRIPT = /<script>([\s\S]*?)<\/script>/;

export function loadStaticAssets(dir: string): StaticAssets | null {
  const indexPath = join(dir, 'index.html');
  if (!existsSync(indexPath)) return null;
  const indexHtml = readFileSync(indexPath, 'utf8');
  const match = INLINE_SCRIPT.exec(indexHtml);
  const inlineScript = match?.[1];
  const bootstrapHash = inlineScript
    ? `sha256-${createHash('sha256').update(inlineScript, 'utf8').digest('base64')}`
    : null;
  return { dir, indexHtml, bootstrapHash };
}

export function registerStatic(app: FastifyInstance, assets: StaticAssets): void {
  app.register(fastifyStatic, {
    root: assets.dir,
    prefix: '/',
    index: false,
    setHeaders(response, path) {
      if (path.endsWith('.html')) {
        response.header('cache-control', 'no-store');
      } else if (path.includes('/assets/')) {
        response.header('cache-control', 'public, max-age=31536000, immutable');
      }
    },
  });

  // D-01: the app contains no marketing route. `/` answers with a redirect,
  // decided by the credential that was actually presented.
  app.get('/', async (request, reply) => {
    return reply
      .header('cache-control', 'no-store')
      .redirect(request.actor ? '/boards' : '/login', 302);
  });
}

/** Any non-API GET that is not a file falls through to the SPA shell. */
export function isSpaNavigation(url: string, accept: string | undefined): boolean {
  if (url.startsWith('/api/') || url.startsWith('/mcp') || url === '/healthz') return false;
  if (!accept || !accept.includes('text/html')) return false;
  const path = url.split('?')[0] ?? url;
  return !/\.[a-z0-9]{2,5}$/i.test(path);
}

export function contentSecurityPolicy(bootstrapHash: string | null): string {
  const scriptSrc = bootstrapHash ? `'self' '${bootstrapHash}'` : "'self'";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}
