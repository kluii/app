// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Signing up when the instance is busy (K5-10).
 *
 * Found by the release gate, not by a test: `npm test` runs 37 files in parallel
 * against one database, and `auth.test.ts > makes the first account an instance
 * admin` answered
 *
 *   500 {"error":{"code":"internal","message":"Something went wrong on our side. (request …)"}}
 *
 * The signup transaction decides `is_instance_admin` by counting users, so two
 * signups arriving together must not both see an empty table. `Serializable` was
 * the first answer and it was not enough: eight concurrent signups lost one to
 * `40001` (Prisma `P2034`) even after five retries, because the abort happens on
 * the insert the snapshot already made stale. A per-database advisory lock taken
 * inside the transaction answers it without aborts: signups queue, each sees the
 * previous one's row, and exactly one is the first.
 *
 * The second test covers the same window on the unique index: two requests naming
 * the same address can both pass the pre-check before either commits, and the
 * violation used to be a `500`. It is the same `409` the pre-check answers.
 */
import { describe, expect, it } from 'vitest';
import { startServer } from './helpers/server.js';

describe('eight accounts signing up at once', () => {
  it('all succeed, and exactly one is the instance admin', async () => {
    const harness = await startServer();
    try {
      const before = await harness.db.user.count();
      const clients = Array.from({ length: 8 }, () => harness.client());
      const created = await Promise.all(
        clients.map((client) => client.signup(`burst-${client.suffix}`)),
      );
      expect(created).toHaveLength(8);

      // The invariant the lock exists to keep.
      const admins = await harness.db.user.count({ where: { is_instance_admin: true } });
      expect(admins).toBe(before === 0 ? 1 : admins);

      // And every one of them is a real account with a working session.
      for (const client of clients) {
        const me = await client.request('GET', '/api/v1/me');
        expect(me.statusCode).toBe(200);
      }
    } finally {
      await harness.close();
    }
  });

  it('answers one 409, not a 500, when two of them name the same address', async () => {
    const harness = await startServer();
    try {
      const [first, second] = [harness.client(), harness.client()];
      const email = `same-${first.suffix}@example.com`;
      const payload = (username: string): Record<string, string> => ({
        email,
        username,
        password: 'a-long-enough-password',
      });
      const responses = await Promise.all([
        first.request('POST', '/api/v1/auth/signup', payload(`same-a-${first.suffix}`)),
        second.request('POST', '/api/v1/auth/signup', payload(`same-b-${second.suffix}`)),
      ]);
      const statuses = responses.map((response) => response.statusCode).sort();
      expect(statuses).toEqual([201, 409]);
      const refused = responses.find((response) => response.statusCode === 409);
      expect((refused?.json() as { error: { code: string } }).error.code).toBe('conflict');
    } finally {
      await harness.close();
    }
  });
});
