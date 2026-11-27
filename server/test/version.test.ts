// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One version number (D-42, K5-10).
 *
 * `compose.yaml` tagged the image `klui:2.0.0` while the three package.json
 * files said `0.1.0` and `/healthz` reported `0.1.0`: a deploy proof that
 * disagrees with itself is not a proof. The tag now reads the package version,
 * and this file is what keeps the four places honest — the compose default is a
 * second literal, so it needs a test rather than a comment.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { startServer } from './helpers/server.js';
import { readVersion } from '../src/lib/version.js';

const ROOT = new URL('../../', import.meta.url).pathname;

function versionOf(path: string): string {
  const parsed = JSON.parse(readFileSync(`${ROOT}${path}`, 'utf8')) as { version?: string };
  return parsed.version ?? '';
}

describe('one version number', () => {
  it('is the same in the three package.json files', () => {
    const root = versionOf('package.json');
    expect(root).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(versionOf('server/package.json')).toBe(root);
    expect(versionOf('web/package.json')).toBe(root);
  });

  it('is the tag compose builds and the version healthz reports', async () => {
    const root = versionOf('package.json');
    const compose = readFileSync(`${ROOT}compose.yaml`, 'utf8');
    const tag = /image:\s*klui:\$\{KLUI_VERSION:-([^}\s]+)\}/u.exec(compose);
    expect(tag?.[1], 'compose.yaml must default the tag to the package version').toBe(root);

    // The body, not the constant: /healthz is what a stranger curls.
    const harness = await startServer();
    try {
      const health = await harness.app.inject({ method: 'GET', url: '/healthz' });
      expect(health.statusCode).toBe(200);
      expect((health.json() as { version: string }).version).toBe(root);
    } finally {
      await harness.close();
    }
    expect(readVersion()).toBe(root);
  });
});
