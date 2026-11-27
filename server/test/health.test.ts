// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp } from './helpers/app.js';
import { readVersion } from '../src/lib/version.js';

const apps: ReturnType<typeof makeApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('GET /healthz', () => {
  it('answers the contract shape and reports the version from package.json', async () => {
    const app = makeApp();
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    // The version is read, not pinned: bumping it must not require editing a test.
    expect(response.json()).toEqual({ status: 'error', version: readVersion(), db: 'down' });
  });
});
