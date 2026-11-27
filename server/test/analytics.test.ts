// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K5-02 — the analytics gate, both states.
 *
 * `KLUI_ANALYTICS_URL` was declared in `env.ts` and consumed by nothing. Two
 * properties make it a gate rather than a feature flag: unset emits no tag and
 * no request (so a self-hoster who never set it is not tracked by a tag they did
 * not ask for), and set emits exactly one tag whose origin the CSP allows (a
 * tag the policy blocks is a feature that only looks shipped).
 *
 * "No request" is asserted twice: the document contains no analytics markup,
 * and serving it calls `fetch` zero times — the request in the set state is the
 * browser's, not the server's.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startServer } from './helpers/server.js';

const WEB_DIR = new URL('./fixtures/web', import.meta.url).pathname;
const ANALYTICS = 'https://analytics.example.com/script.js';

async function appWith(analytics: string | null) {
  return startServer({ webDir: WEB_DIR, env: { KLUI_ANALYTICS_URL: analytics } });
}

async function page(analytics: string | null) {
  const harness = await appWith(analytics);
  try {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/boards',
      headers: { accept: 'text/html' },
    });
    return {
      status: response.statusCode,
      html: response.body,
      csp: String(response.headers['content-security-policy'] ?? ''),
    };
  } finally {
    await harness.close();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the analytics gate', () => {
  it('emits one script tag and allows its origin when the variable is set', async () => {
    const { status, html, csp } = await page(ANALYTICS);
    expect(status).toBe(200);
    expect(html).toContain(`<script defer src="${ANALYTICS}" data-klui-analytics></script>`);
    expect(html.split('data-klui-analytics').length - 1).toBe(1);
    // Inside the head, so it is a deferred document-level script.
    expect(html.indexOf('data-klui-analytics')).toBeLessThan(html.indexOf('</head>'));
    expect(csp).toContain("script-src 'self' https://analytics.example.com");
    expect(csp).toContain("connect-src 'self' https://analytics.example.com");
  });

  it('emits no tag, no origin and no outbound request when the variable is unset', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { html, csp } = await page(null);
    expect(html).not.toContain('data-klui-analytics');
    expect(html).not.toContain('analytics.example.com');
    // A single external script would be the tell: there are none.
    expect(html).not.toMatch(/<script[^>]*src="https?:/u);
    expect(csp).not.toContain('analytics.example.com');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not touch a JSON body', async () => {
    const harness = await appWith(ANALYTICS);
    try {
      const health = await harness.app.inject({ method: 'GET', url: '/healthz' });
      expect(String(health.headers['content-type'] ?? '')).not.toContain('text/html');
      expect(health.body).not.toContain('data-klui-analytics');
    } finally {
      await harness.close();
    }
  });
});
