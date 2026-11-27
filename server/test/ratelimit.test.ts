// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The buckets docs/api.md §1 publishes (K1-02).
 *
 * The default test env runs with `KLUI_RATE_LIMIT=off`, so this file builds its
 * own app with the limiter on and states the limits it relies on instead of
 * inheriting the production numbers: a bucket that only fails at 120 requests
 * is never actually proven.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';
import { credentialLimiter, LOGIN_ACCOUNT, loginAccountKey } from '../src/lib/ratelimit.js';
import { sessionLimiter } from '../src/settings/ratelimit.js';
import { anonLimiter } from '../src/anon/limits.js';

const PASSWORD = 'a-long-enough-password';

function errorCode(body: string): string {
  return (JSON.parse(body) as { error: { code: string } }).error.code;
}

describe('credential buckets', () => {
  let harness: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    harness = await startServer({ env: { KLUI_RATE_LIMIT: 'on' } });
  });

  afterAll(async () => {
    await harness.close();
  });

  // Keys are the submitted identifier and the client IP, both stable across
  // tests in this file, so each test starts from empty buckets.
  beforeEach(() => {
    credentialLimiter.clear();
    sessionLimiter.clear();
  });

  function client(): TestClient {
    return harness.client();
  }

  async function attempt(identifier: string, password: string): Promise<Response> {
    return client().request('POST', '/api/v1/auth/login', {
      email_or_username: identifier,
      password,
    });
  }

  type Response = Awaited<ReturnType<TestClient['request']>>;

  it('answers the sixth wrong password with 429 and Retry-After', async () => {
    const c = client();
    const username = `bucket-${c.suffix}`;
    await c.signup(username);

    const statuses: number[] = [];
    let last: Response | null = null;
    for (let index = 0; index < LOGIN_ACCOUNT.max; index += 1) {
      const response = await attempt(username, 'not-the-right-password');
      statuses.push(response.statusCode);
      expect(response.statusCode).toBe(401);
      last = response;
    }
    expect(last).not.toBeNull();

    const blocked = await attempt(username, 'not-the-right-password');
    expect(blocked.statusCode).toBe(429);
    expect(errorCode(blocked.body)).toBe('too_many_attempts');
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(LOGIN_ACCOUNT.windowMs / 1000);
    // The right password is refused too: the bucket is on the account, not on
    // the guess.
    const correctButBlocked = await attempt(username, PASSWORD);
    expect(correctButBlocked.statusCode).toBe(429);
  });

  it('does not let a locked account lock a different account on the same IP', async () => {
    const first = client();
    const second = client();
    const lockedName = `locked-${first.suffix}`;
    const otherName = `other-${second.suffix}`;
    await first.signup(lockedName);
    await second.signup(otherName);

    for (let index = 0; index < LOGIN_ACCOUNT.max; index += 1) {
      await attempt(lockedName, 'not-the-right-password');
    }
    expect((await attempt(lockedName, PASSWORD)).statusCode).toBe(429);

    // Same IP, different identifier: the account bucket does not cover it.
    const other = await attempt(otherName, PASSWORD);
    expect(other.statusCode).toBe(200);
  });

  it('clears the account bucket once the password is right', async () => {
    const c = client();
    const username = `typo-${c.suffix}`;
    await c.signup(username);

    for (let index = 0; index < LOGIN_ACCOUNT.max - 1; index += 1) {
      expect((await attempt(username, 'not-the-right-password')).statusCode).toBe(401);
    }
    const key = loginAccountKey(username);
    expect(credentialLimiter.count(key)).toBe(LOGIN_ACCOUNT.max - 1);

    const success = await attempt(username, PASSWORD);
    expect(success.statusCode).toBe(200);
    expect(credentialLimiter.count(key)).toBe(0);

    // And the account has its full budget again.
    expect((await attempt(username, 'not-the-right-password')).statusCode).toBe(401);
  });

  it('answers a locked unknown account exactly like a locked real one', async () => {
    const c = client();
    const username = `real-${c.suffix}`;
    await c.signup(username);
    const ghost = `ghost-${c.suffix}`;

    for (let index = 0; index < LOGIN_ACCOUNT.max; index += 1) {
      await attempt(ghost, 'not-the-right-password');
    }
    for (let index = 0; index < LOGIN_ACCOUNT.max; index += 1) {
      await attempt(username, 'not-the-right-password');
    }

    const unknown = await attempt(ghost, 'not-the-right-password');
    const known = await attempt(username, 'not-the-right-password');
    expect(unknown.statusCode).toBe(429);
    expect(known.statusCode).toBe(429);
    // Only the retry delay depends on when the bucket filled, so compare the
    // shape and the message, not the TTL.
    const strip = (body: string): string =>
      (JSON.parse(body) as { error: { hint: string | null } }).error.hint === null
        ? body
        : body.replace(/"hint":"[^"]*"/, '"hint":null');
    expect(strip(unknown.body)).toBe(strip(known.body));
  });
});

describe('session buckets', () => {
  let harness: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    // Small, explicit limits: a bucket that only fires at 120 is not proven.
    harness = await startServer({
      env: { KLUI_RATE_LIMIT: 'on', KLUI_RATE_LIMIT_WRITES: 3, KLUI_RATE_LIMIT_READS: 50 },
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  // Both limiters are per process, so a test must not inherit the previous
  // test's spends.
  beforeEach(() => {
    credentialLimiter.clear();
    sessionLimiter.clear();
  });

  it('counts writes per user and answers the documented envelope', async () => {
    const c = harness.client();
    // Signup itself is keyed on the IP (no session yet); the bucket under test
    // is the signed-in one, so it starts empty here.
    await c.signup(`limits-${c.suffix}`);
    for (let index = 0; index < 3; index += 1) {
      expect((await c.request('PATCH', '/api/v1/me', { display_name: 'Limited' })).statusCode).toBe(
        200,
      );
    }

    // One bucket across every route: 3 writes a minute means 3 writes a minute,
    // not 3 per endpoint.
    const blocked = await c.request('PATCH', '/api/v1/me', { display_name: 'Limited' });
    expect(blocked.statusCode).toBe(429);
    expect(errorCode(blocked.body)).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('does not spend the write bucket on reads', async () => {
    const c = harness.client();
    await c.signup(`reader-${c.suffix}`);
    for (let index = 0; index < 10; index += 1) {
      expect((await c.request('GET', '/api/v1/me')).statusCode).toBe(200);
    }
  });
});

/**
 * K3-07 — `KLUI_TRUSTED_PROXY_HOPS`.
 *
 * A header is data, not identity: `X-Forwarded-For` is written by the client and
 * stays a lie until a proxy this instance was told to trust rewrites it. The
 * bucket key is `request.ip`, so the two configurations below are the whole
 * question: with zero hops a spoofed header must not buy a fresh bucket, with
 * one hop a real proxy's header must be honoured.
 */
describe('trusted proxy hops', () => {
  const SPOOF = '198.51.100.7';
  const OTHER = '203.0.113.9';

  async function joinAttempts(hops: number): Promise<{ statuses: number[]; codes: string[] }> {
    const harness = await startServer({
      env: { KLUI_TRUSTED_PROXY_HOPS: hops, KLUI_ANON_JOINS_PER_IP: 2 },
    });
    try {
      // A board that accepts anonymous writes, created through the normal API.
      const owner = harness.client();
      await owner.signup(`proxy-${owner.suffix}`);
      const created = await owner.request('POST', '/api/v1/boards', {
        name: 'Proxy hops',
        visibility: 'link',
      });
      const boardId = (created.json() as { id: string }).id;
      await owner.request('PATCH', `/api/v1/boards/${boardId}`, {
        link_role: 'read',
        anon_write: 'open',
      });

      const statuses: number[] = [];
      const codes: string[] = [];
      const attempts = [SPOOF, SPOOF, OTHER];
      for (const forwarded of attempts) {
        const response = await harness.app.inject({
          method: 'POST',
          url: `/api/v1/boards/${boardId}/anon`,
          headers: { 'content-type': 'application/json', 'x-forwarded-for': forwarded },
          payload: JSON.stringify({ label: 'proxy' }),
        });
        statuses.push(response.statusCode);
        codes.push(response.statusCode === 200 ? 'ok' : errorCode(response.body));
      }
      return { statuses, codes };
    } finally {
      await harness.close();
    }
  }

  beforeEach(() => {
    anonLimiter.clear();
  });

  it('ignores a spoofed X-Forwarded-For when no proxy is trusted', async () => {
    const { statuses, codes } = await joinAttempts(0);
    // Both spoofed addresses are the same connection, so the third call is the
    // same bucket: a header cannot mint a new one.
    expect(statuses).toEqual([200, 200, 429]);
    expect(codes[2]).toBe('rate_limited');
  });

  it('honours the header when one proxy hop is trusted', async () => {
    const { statuses } = await joinAttempts(1);
    expect(statuses).toEqual([200, 200, 200]);
  });
});

/**
 * K4-01 — the agent bucket is per key, not per user (docs/features/agents.md §2):
 * two agents on one account must not starve each other, and a looping agent must
 * not spend its owner's session budget.
 */
describe('agent key buckets', () => {
  it('limits each key separately and answers 429 with Retry-After', async () => {
    const harness = await startServer({ env: { KLUI_AGENT_WRITES: 2 } });
    try {
      const owner = harness.client();
      await owner.signup(`agent-limit-${owner.suffix}`);
      const created = await owner.request('POST', '/api/v1/boards', { name: 'Limited' });
      const boardId = (created.json() as { id: string }).id;

      const mint = async (name: string): Promise<string> => {
        const response = await owner.request('POST', '/api/v1/agent-keys', {
          name,
          scope: 'board',
          board_id: boardId,
        });
        expect(response.statusCode).toBe(201);
        return (response.json() as { key: string }).key;
      };

      const write = async (key: string) =>
        harness.app.inject({
          method: 'PATCH',
          url: '/api/v1/me',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          payload: JSON.stringify({ display_name: 'Agent' }),
        });

      const first = await mint('first');
      expect((await write(first)).statusCode).toBe(200);
      expect((await write(first)).statusCode).toBe(200);
      const blocked = await write(first);
      expect(blocked.statusCode).toBe(429);
      expect(errorCode(blocked.body)).toBe('rate_limited');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

      // A second key of the same user starts with its own budget.
      const second = await mint('second');
      expect((await write(second)).statusCode).toBe(200);
    } finally {
      await harness.close();
    }
  });
});
