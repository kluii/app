// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The shell contract (D-01, docs/security.md §4): `/` is a redirect decided by
 * the credential that was presented, and a cookie-authenticated write from a
 * foreign origin is refused even when it carries a matching CSRF token.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer();
});

afterAll(async () => {
  await harness.close();
});

describe('GET /', () => {
  it('redirects an anonymous visitor to /login', async () => {
    const c = harness.client();
    const response = await c.request('GET', '/');
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/login');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('redirects a signed-in visitor to /boards', async () => {
    const c = harness.client();
    await c.signup(`shell-${c.suffix}`);
    const response = await c.request('GET', '/');
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/boards');
  });
});

describe('the CSRF origin check', () => {
  it('refuses a cookie-authenticated write from a foreign origin', async () => {
    const c: TestClient = harness.client();
    await c.signup(`origin-${c.suffix}`);
    const response = await c.request(
      'POST',
      '/api/v1/boards',
      { name: 'From elsewhere' },
      { origin: 'https://evil.example' },
    );
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { code: string } }).error.code).toBe('forbidden_origin');
  });

  it('accepts the same request from the public origin', async () => {
    const c = harness.client();
    await c.signup(`origin-ok-${c.suffix}`);
    const response = await c.request(
      'POST',
      '/api/v1/boards',
      { name: 'From home' },
      { origin: 'http://localhost:8099' },
    );
    expect(response.statusCode).toBe(201);
  });
});
