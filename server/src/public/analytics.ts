// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K5-02 — analytics, gated by one variable, injected at request time.
 *
 * `KLUI_ANALYTICS_URL` was declared in `env.ts` and consumed by nothing, so an
 * operator who set it got silence and an operator who left it unset got the
 * same. The rule is the product's rule: unset means no tag and no request, set
 * means exactly one script tag in the document, before `</head>`, pointing at
 * the URL that was configured.
 *
 * Injection is an `onSend` hook rather than a string edit at three send sites:
 * the SPA shell, a prerendered profile and a board page's head all leave through
 * `text/html`, and a fourth surface added later is covered without anyone
 * remembering this file. The server itself never makes the request — the browser
 * does, once, and only when the tag exists.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../env.js';
import { escapeHtml } from './meta.js';

/** The document the browser loads, and the only thing this rewrites. */
function isHtml(reply: FastifyReply): boolean {
  const header = reply.getHeader('content-type');
  return typeof header === 'string' && header.toLowerCase().includes('text/html');
}

export function analyticsTag(url: string): string {
  return `<script defer src="${escapeHtml(url)}" data-klui-analytics></script>`;
}

export function withAnalytics(html: string, url: string | null): string {
  if (url === null) return html;
  const tag = analyticsTag(url);
  if (html.includes('data-klui-analytics')) return html;
  const at = html.lastIndexOf('</head>');
  if (at === -1) return `${tag}${html}`;
  return `${html.slice(0, at)}${tag}${html.slice(at)}`;
}

export function registerAnalytics(app: FastifyInstance, env: Env): void {
  const url = env.KLUI_ANALYTICS_URL;
  if (url === null) return;
  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    if (request.method !== 'GET') return payload;
    if (!isHtml(reply)) return payload;
    if (typeof payload === 'string') return withAnalytics(payload, url);
    if (Buffer.isBuffer(payload)) return Buffer.from(withAnalytics(payload.toString('utf8'), url));
    return payload;
  });
}
