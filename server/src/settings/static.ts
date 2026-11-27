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
}

/** Any non-API GET that is not a file falls through to the SPA shell. */
export function isSpaNavigation(url: string, accept: string | undefined): boolean {
  if (url.startsWith('/api/') || url.startsWith('/mcp') || url === '/healthz' || url === '/metrics')
    return false;
  if (!accept || !accept.includes('text/html')) return false;
  const path = url.split('?')[0] ?? url;
  return !/\.[a-z0-9]{2,5}$/i.test(path);
}

/**
 * The CSP is `'self'` plus the theme bootstrap hash, and nothing else, unless an
 * analytics URL is configured: a tag the policy blocks is a feature that only
 * looks shipped. The origin of `KLUI_ANALYTICS_URL` is then allowed for
 * `script-src` (the tag) and `connect-src` (the beacon the script sends).
 */
export function contentSecurityPolicy(
  bootstrapHash: string | null,
  analyticsUrl: string | null = null,
): string {
  const analyticsOrigin = analyticsUrl === null ? null : originOf(analyticsUrl);
  const scripts = [bootstrapHash ? `'${bootstrapHash}'` : null, analyticsOrigin].filter(
    (part): part is string => part !== null,
  );
  const scriptSrc = ["'self'", ...scripts].join(' ');
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src ${["'self'", ...(analyticsOrigin === null ? [] : [analyticsOrigin])].join(' ')}`,
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}

/** `https://analytics.example.com/a/b.js` → `https://analytics.example.com`. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
