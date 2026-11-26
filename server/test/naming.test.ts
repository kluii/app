// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K1-08: usernames, slugs and the reserved list. Each row of the table is a
 * rule a stranger can check, and the two redirects are the part that cannot be
 * fixed later: a stale link that lands on a stranger's board is a leak.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isReserved, reservedWords } from '../src/lib/reserved.js';
import { slugSchema, usernameSchema } from '../src/contracts/auth.js';
import { startServer, TestClient } from './helpers/server.js';

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer();
});

afterAll(async () => {
  await harness.close();
});

type Board = { id: string; slug: string; name: string };
type Me = { username: string; display_name: string | null; email: string };

describe('the username rules', () => {
  const cases: [string, string][] = [
    ['jo', 'too short'],
    ['a'.repeat(33), 'too long'],
    ['-leading', 'a leading hyphen'],
    ['trailing-', 'a trailing hyphen'],
    ['Upper-Case', 'an uppercase letter'],
    ['with space', 'a space'],
    ['under_score', 'an underscore'],
    ['admin', 'a reserved word'],
    ['API', 'a reserved word in another case'],
  ];

  it.each(cases)('rejects %s (%s)', (value) => {
    expect(usernameSchema.safeParse(value).success).toBe(false);
  });

  it('accepts the shapes a person actually types', () => {
    for (const value of ['abc', 'ana-maria', 'a1b2c3', 'x'.repeat(32)]) {
      expect(usernameSchema.safeParse(value).success).toBe(true);
    }
  });

  it('keeps a reserved list with no duplicates and no uppercase entries', () => {
    const words = reservedWords();
    expect(new Set(words).size).toBe(words.length);
    for (const word of words) expect(word).toBe(word.toLowerCase());
    expect(isReserved('Docs')).toBe(true);
  });

  it('refuses a signup that uses a reserved word, with a validation code', async () => {
    const c = harness.client();
    const response = await c.request('POST', '/api/v1/auth/signup', {
      email: `reserved-${c.suffix}@example.com`,
      username: 'support',
      password: 'a-long-enough-password',
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details?: { code: string }[] } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details?.some((detail) => detail.code === 'custom')).toBe(true);
  });

  it('answers 409 on a duplicate, and rejects the uppercase spelling before that', async () => {
    const c = harness.client();
    const username = `case-${c.suffix}`;
    const first = await c.request('POST', '/api/v1/auth/signup', {
      email: `${username}@example.com`,
      username,
      password: 'a-long-enough-password',
    });
    expect(first.statusCode).toBe(201);

    // Uniqueness is case-insensitive by construction: only lowercase is stored
    // and only lowercase is accepted, so the uppercase spelling never reaches
    // the uniqueness check — it is a shape error, which is the cheaper answer.
    const uppercase = await harness.client().request('POST', '/api/v1/auth/signup', {
      email: `upper-${c.suffix}@example.com`,
      username: username.toUpperCase(),
      password: 'a-long-enough-password',
    });
    expect(uppercase.statusCode).toBe(400);

    const duplicate = await harness.client().request('POST', '/api/v1/auth/signup', {
      email: `dupe-${c.suffix}@example.com`,
      username,
      password: 'a-long-enough-password',
    });
    expect(duplicate.statusCode).toBe(409);
  });
});

describe('renaming an account', () => {
  it('reserves the old name for 90 days and redirects it to the new one', async () => {
    const c = harness.client();
    const oldName = `before-${c.suffix}`;
    await c.signup(oldName);
    const board = (
      await c.request('POST', '/api/v1/boards', { name: 'Rename proof' })
    ).json() as Board;

    const newName = `after-${c.suffix}`;
    const renamed = await c.request('PATCH', '/api/v1/me', { username: newName });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as Me).username).toBe(newName);

    const me = await c.request('GET', '/api/v1/me');
    expect((me.json() as Me).username).toBe(newName);

    // A reader gets the human URL of the board, not an API path: the old
    // username redirects through the resolver, the new username resolves.
    const oldLink = await c.request('GET', `/api/v1/users/${oldName}/boards/${board.slug}`);
    expect(oldLink.statusCode).toBe(301);
    expect(oldLink.headers.location).toBe(`/${newName}/${board.slug}`);

    const newLink = await c.request('GET', `/api/v1/users/${newName}/boards/${board.slug}`);
    expect(newLink.statusCode).toBe(301);
    expect(newLink.headers.location).toBe(`/${newName}/${board.slug}`);

    // A stranger with no credential learns nothing: not the id, not the slug.
    const anonymous = new TestClient(harness.app, harness.db);
    const hidden = await anonymous.request('GET', `/api/v1/users/${newName}/boards/${board.slug}`);
    expect(hidden.statusCode).toBe(404);

    // The old name stays reserved: a stranger cannot take it during the window.
    const squatter = harness.client();
    const taken = await squatter.request('POST', '/api/v1/auth/signup', {
      email: `squat-${squatter.suffix}@example.com`,
      username: oldName,
      password: 'a-long-enough-password',
    });
    expect([409, 400]).toContain(taken.statusCode);
  });

  it('refuses a rename onto a name someone else holds, and onto a reserved word', async () => {
    const c = harness.client();
    await c.signup(`holder-${c.suffix}`);

    const other = harness.client();
    const otherName = `other-${other.suffix}`;
    await other.signup(otherName);

    const conflict = await c.request('PATCH', '/api/v1/me', { username: otherName });
    expect(conflict.statusCode).toBe(409);

    const reserved = await c.request('PATCH', '/api/v1/me', { username: 'settings' });
    expect(reserved.statusCode).toBe(400);
  });

  it('sets and clears the display name', async () => {
    const c = harness.client();
    await c.signup(`display-${c.suffix}`);

    const set = await c.request('PATCH', '/api/v1/me', { display_name: 'Ana Maria' });
    expect(set.statusCode).toBe(200);
    expect((set.json() as Me).display_name).toBe('Ana Maria');

    const cleared = await c.request('PATCH', '/api/v1/me', { display_name: null });
    expect((cleared.json() as Me).display_name).toBeNull();
  });
});

describe('renaming a board slug', () => {
  it('redirects the old slug for 90 days and keeps the new one', async () => {
    const c = harness.client();
    await c.signup(`slugger-${c.suffix}`);
    const board = (
      await c.request('POST', '/api/v1/boards', { name: 'Slug proof' })
    ).json() as Board;

    const renamed = await c.request('PATCH', `/api/v1/boards/${board.id}`, { slug: 'sprint-42' });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as Board).slug).toBe('sprint-42');

    const username = `slugger-${c.suffix}`;
    const oldSlug = await c.request('GET', `/api/v1/users/${username}/boards/${board.slug}`);
    expect(oldSlug.statusCode).toBe(301);
    expect(oldSlug.headers.location).toBe(`/${username}/sprint-42`);

    const newSlug = await c.request('GET', `/api/v1/users/${username}/boards/sprint-42`);
    expect(newSlug.statusCode).toBe(301);
    expect(newSlug.headers.location).toBe(`/${username}/sprint-42`);
  });

  it('refuses a reserved slug and a slug that is too short', () => {
    expect(slugSchema.safeParse('login').success).toBe(false);
    expect(slugSchema.safeParse('ab').success).toBe(false);
    expect(slugSchema.safeParse('sprint-42').success).toBe(true);
  });
});

describe('a name that never existed', () => {
  it('answers 404, not a redirect', async () => {
    const c = new TestClient(harness.app, harness.db);
    const response = await c.request('GET', '/api/v1/users/nobody-at-all/boards/nothing-here');
    expect(response.statusCode).toBe(404);
  });
});
