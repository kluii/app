// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K5-03 — Prometheus `/metrics` endpoint (docs/deployment.md §7, D-44).
 *
 * Off by default (404). When enabled: bearer-protected when
 * `KLUI_METRICS_TOKEN` is set (401 without it, 200 with it), or loopback-only
 * when no token is configured.
 */
import { describe, expect, it } from 'vitest';
import { startServer } from './helpers/server.js';

describe('/metrics (K5-03)', () => {
  it('answers 404 when KLUI_METRICS_ENABLED is false (the default)', async () => {
    const harness = await startServer({
      env: { KLUI_METRICS_ENABLED: false, KLUI_METRICS_TOKEN: 'unused-token' },
    });
    try {
      const bare = await harness.app.inject({ method: 'GET', url: '/metrics' });
      expect(bare.statusCode).toBe(404);

      const authed = await harness.app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer unused-token' },
      });
      expect(authed.statusCode).toBe(404);
    } finally {
      await harness.close();
    }
  });

  it('requires Bearer KLUI_METRICS_TOKEN when enabled with a token (401 without, 200 with)', async () => {
    const token = 'metrics-scrape-token-32bytes-ok';
    const harness = await startServer({
      env: { KLUI_METRICS_ENABLED: true, KLUI_METRICS_TOKEN: token },
    });
    try {
      const noAuth = await harness.app.inject({
        method: 'GET',
        url: '/metrics',
        remoteAddress: '127.0.0.1',
      });
      expect(noAuth.statusCode).toBe(401);
      expect(noAuth.headers['www-authenticate']).toBe('Bearer');

      const wrong = await harness.app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer wrong-token' },
      });
      expect(wrong.statusCode).toBe(401);

      // Drive one request so the HTTP counter has a real sample.
      const health = await harness.app.inject({ method: 'GET', url: '/healthz' });
      expect(health.statusCode).toBe(200);

      const ok = await harness.app.inject({
        method: 'GET',
        url: '/metrics',
        remoteAddress: '203.0.113.20',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers['content-type']).toContain('text/plain');
      expect(ok.headers['cache-control']).toBe('no-store');
      expect(ok.headers['x-robots-tag']).toBe('noindex');
      expect(ok.body).toContain('# TYPE klui_info gauge');
      expect(ok.body).toContain('klui_db_up 1');
      expect(ok.body).toContain('klui_http_requests_total{method="GET",status_class="2xx"}');
      expect(ok.body).toContain('klui_sse_subscribers 0');
      expect(ok.body).toContain('klui_process_uptime_seconds ');
    } finally {
      await harness.close();
    }
  });

  it('allows loopback only when enabled without a token and refuses remote callers with 401', async () => {
    const harness = await startServer({
      env: { KLUI_METRICS_ENABLED: true, KLUI_METRICS_TOKEN: null },
    });
    try {
      const ipv4 = await harness.app.inject({
        method: 'GET',
        url: '/metrics',
        remoteAddress: '127.0.0.1',
      });
      expect(ipv4.statusCode).toBe(200);
      expect(ipv4.body).toContain('klui_db_up 1');

      const ipv6 = await harness.app.inject({
        method: 'GET',
        url: '/metrics',
        remoteAddress: '::1',
      });
      expect(ipv6.statusCode).toBe(200);

      const remote = await harness.app.inject({
        method: 'GET',
        url: '/metrics',
        remoteAddress: '203.0.113.9',
      });
      expect(remote.statusCode).toBe(401);
      expect(remote.headers['www-authenticate']).toBe('Bearer');
    } finally {
      await harness.close();
    }
  });
});
