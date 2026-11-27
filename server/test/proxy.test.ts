// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K3-07 — the operator is told when the deployment shape makes the buckets lie.
 *
 * The limb: `compose.yaml` passes `KLUI_TRUSTED_PROXY_HOPS=0`, and the documented
 * deployment sits behind one proxy, so every anonymous visitor shares the
 * proxy's address: one bucket of ten writes, and an IP ban that lands on the
 * proxy. The default stays (it is right for a directly exposed instance); what
 * was missing is one line saying so.
 */
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { FastifyServerOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { testEnv } from '../src/env.js';
import { createHub } from '../src/realtime/events.js';
import { TEST_SECRETS } from './helpers/server.js';

async function appWith(hops: number) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  const logger: NonNullable<FastifyServerOptions['logger']> = { level: 'warn', stream };
  const app = buildApp({
    env: testEnv({ KLUI_TRUSTED_PROXY_HOPS: hops, KLUI_LOG_LEVEL: 'warn' }),
    db: null,
    secrets: TEST_SECRETS,
    hub: createHub(),
    logger,
  });
  await app.ready();
  return { app, lines };
}

function warnings(lines: string[]): string[] {
  return lines.filter((line) => line.includes('KLUI_TRUSTED_PROXY_HOPS=0'));
}

describe('a proxy that is not trusted', () => {
  it('warns once, naming the variable and the doc line, when the header arrives', async () => {
    const { app, lines } = await appWith(0);
    try {
      await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { 'x-forwarded-for': '198.51.100.7' },
      });
      const warned = warnings(lines);
      expect(warned).toHaveLength(1);
      const [line] = warned;
      expect(line).toContain('KLUI_TRUSTED_PROXY_HOPS');
      // The address the instance sees is the proxy's: that is the whole defect.
      expect(line).toContain('127.0.0.1');
      expect(line).toContain('docs/deployment.md §4');

      // Once per process: a second proxied request writes nothing.
      await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { 'x-forwarded-for': '198.51.100.8' },
      });
      expect(warnings(lines)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('stays quiet without the header, and with a trusted hop', async () => {
    const plain = await appWith(0);
    try {
      await plain.app.inject({ method: 'GET', url: '/healthz' });
      expect(warnings(plain.lines)).toEqual([]);
    } finally {
      await plain.app.close();
    }

    const trusted = await appWith(1);
    try {
      await trusted.app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { 'x-forwarded-for': '198.51.100.7' },
      });
      expect(warnings(trusted.lines)).toEqual([]);
    } finally {
      await trusted.app.close();
    }
  });
});
