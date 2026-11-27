// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K3-01 — visibility is a property of the URL, not a hope.
 *
 * Three exits: a `link` board answers 404 on a wrong suffix and on the suffix it
 * used to have; a `public` board is crawlable with a clean canonical URL while a
 * `link` board is not; the owner profile lists the public boards and nothing
 * else.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from './helpers/server.js';

const WEB_DIR = new URL('./fixtures/web', import.meta.url).pathname;

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer({ webDir: WEB_DIR });
});

afterAll(async () => {
  await harness.close();
});

type Board = {
  id: string;
  slug: string;
  visibility: string;
  link_suffix: string | null;
  url: string | null;
  owner: { username: string };
};

async function signedIn(prefix: string): Promise<{
  c: ReturnType<typeof harness.client>;
  username: string;
}> {
  const c = harness.client();
  const username = `${prefix}-${c.suffix}`;
  await c.signup(username);
  return { c, username };
}

async function createBoard(
  c: ReturnType<typeof harness.client>,
  name: string,
  visibility?: string,
): Promise<Board> {
  const response = await c.request('POST', '/api/v1/boards', {
    name,
    ...(visibility === undefined ? {} : { visibility }),
  });
  expect(response.statusCode).toBe(201);
  return response.json() as Board;
}

describe('the link suffix', () => {
  it('is generated when a board becomes a link board, and the bare slug stops resolving', async () => {
    const { c, username } = await signedIn('linkgen');
    const board = await createBoard(c, 'Retro S3');
    expect(board.link_suffix).toBeNull();

    const patched = await c.request('PATCH', `/api/v1/boards/${board.id}`, {
      visibility: 'link',
      link_role: 'read',
    });
    expect(patched.statusCode).toBe(200);
    const link = patched.json() as Board;
    expect(link.link_suffix).toMatch(/^[a-z2-9]{4}$/u);
    expect(link.url).toBe(`http://localhost:8099/${username}/${board.slug}-${link.link_suffix}`);

    const wrong = await c.request(
      'GET',
      `/api/v1/users/${username}/boards/${board.slug}-zzzz`,
      undefined,
      { accept: 'text/html' },
    );
    expect(wrong.statusCode).toBe(404);

    const bare = await c.request(
      'GET',
      `/api/v1/users/${username}/boards/${board.slug}`,
      undefined,
      { accept: 'text/html' },
    );
    expect(bare.statusCode).toBe(404);

    const right = await c.request(
      'GET',
      `/api/v1/users/${username}/boards/${board.slug}-${link.link_suffix}`,
      undefined,
      { accept: 'text/html' },
    );
    expect(right.statusCode).toBe(301);
  });

  it('rotates, and the previous URL answers 404 immediately', async () => {
    const { c, username } = await signedIn('rotate');
    const board = await createBoard(c, 'Rotating', 'link');
    const first = board.link_suffix;
    expect(first).toMatch(/^[a-z2-9]{4}$/u);

    const rotated = await c.request('POST', `/api/v1/boards/${board.id}/link-suffix/rotate`, {
      confirm: true,
    });
    expect(rotated.statusCode).toBe(200);
    const next = rotated.json() as Board;
    expect(next.link_suffix).toMatch(/^[a-z2-9]{4}$/u);
    expect(next.link_suffix).not.toBe(first);

    const old = await c.request(
      'GET',
      `/api/v1/users/${username}/boards/${board.slug}-${String(first)}`,
      undefined,
      { accept: 'text/html' },
    );
    expect(old.statusCode).toBe(404);

    const fresh = await c.request(
      'GET',
      `/api/v1/users/${username}/boards/${board.slug}-${String(next.link_suffix)}`,
      undefined,
      { accept: 'text/html' },
    );
    expect(fresh.statusCode).toBe(301);
    expect(fresh.headers.location).toBe(`/${username}/${board.slug}-${String(next.link_suffix)}`);
  });

  it('needs confirmation, a link board, and the right to manage it', async () => {
    const { c } = await signedIn('rotateguard');
    const board = await createBoard(c, 'Private one');

    const unconfirmed = await c.request(
      'POST',
      `/api/v1/boards/${board.id}/link-suffix/rotate`,
      {},
    );
    expect(unconfirmed.statusCode).toBe(400);

    const notLink = await c.request('POST', `/api/v1/boards/${board.id}/link-suffix/rotate`, {
      confirm: true,
    });
    expect(notLink.statusCode).toBe(400);

    const link = await createBoard(c, 'Shared one', 'link');
    const stranger = harness.client();
    await stranger.signup(`stranger-${stranger.suffix}`);
    const denied = await stranger.request('POST', `/api/v1/boards/${link.id}/link-suffix/rotate`, {
      confirm: true,
    });
    expect(denied.statusCode).toBe(404);
  });

  it('records the rotation in the event log', async () => {
    const { c } = await signedIn('rotateevent');
    const board = await createBoard(c, 'Logged', 'link');
    await c.request('POST', `/api/v1/boards/${board.id}/link-suffix/rotate`, { confirm: true });

    const row = await harness.db.event.findFirst({
      where: { board_id: board.id, type: 'board_updated' },
      orderBy: { created_at: 'desc' },
    });
    const payload = row?.payload as { changes?: Record<string, [string, string]> } | undefined;
    expect(payload?.changes?.link_suffix?.[0]).toBe(board.link_suffix);
    expect(payload?.changes?.link_suffix?.[1]).not.toBe(board.link_suffix);
  });
});

describe('what a search engine may index', () => {
  it('marks a link board noindex, even for a member', async () => {
    const { c, username } = await signedIn('noindex');
    const board = await createBoard(c, 'Link board', 'link');
    const response = await c.request('GET', `/${username}/${board.slug}`, undefined, {
      accept: 'text/html',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex');
    expect(response.body).toContain('<meta name="robots" content="noindex"');
    expect(response.body).not.toContain('rel="canonical"');
  });

  it('lets a public board be indexed with a canonical URL and its real name', async () => {
    const { c, username } = await signedIn('publicindex');
    const board = await createBoard(c, 'Public retro', 'public');
    const response = await c.request('GET', `/${username}/${board.slug}`, undefined, {
      accept: 'text/html',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-robots-tag']).toBeUndefined();
    expect(response.body).not.toContain('noindex');
    expect(response.body).toContain(
      `<link rel="canonical" href="http://localhost:8099/${username}/${board.slug}" />`,
    );
    expect(response.body).toContain(`<title>Public retro · ${username} · Klui</title>`);
  });

  it('gives a private board the plain shell, with no name in it', async () => {
    const { c, username } = await signedIn('privateshell');
    const board = await createBoard(c, 'Secret plans');
    const stranger = harness.client();
    const response = await stranger.request('GET', `/${username}/${board.slug}`, undefined, {
      accept: 'text/html',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex');
    expect(response.body).not.toContain('Secret plans');
  });

  it('does not read the last four letters of a slug as a suffix', async () => {
    // `board-under-test` is the exact slug; the old resolver split it into
    // `board-under` + `test` and 404'd it.
    const { c, username } = await signedIn('slugedge');
    const created = await createBoard(c, 'Board under test', 'public');
    expect(created.slug).toBe('board-under-test');

    const response = await c.request('GET', `/${username}/${created.slug}`, undefined, {
      accept: 'text/html',
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(
      `<link rel="canonical" href="http://localhost:8099/${username}/board-under-test" />`,
    );

    const api = await c.request('GET', `/api/v1/users/${username}/boards/${created.slug}/resolve`);
    expect(api.statusCode).toBe(200);
    expect((api.json() as { board_id: string }).board_id).toBe(created.id);
  });

  it('never lets an API response be indexed', async () => {
    const { c } = await signedIn('apinoindex');
    const board = await createBoard(c, 'Api', 'public');
    const response = await c.request('GET', `/api/v1/boards/${board.id}`);
    expect(response.headers['x-robots-tag']).toBe('noindex');
  });
});

describe('the owner profile', () => {
  it('lists public boards, and only public ones', async () => {
    const { c, username } = await signedIn('profile');
    const open = await createBoard(c, 'Open book', 'public');
    const link = await createBoard(c, 'Suffixed', 'link');
    await createBoard(c, 'Closed book');

    const response = await c.request('GET', `/${username}`, undefined, { accept: 'text/html' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(`/${username}/${open.slug}`);
    expect(response.body).not.toContain(`/${username}/${link.slug}`);
    expect(response.body).not.toContain('Closed book');
    expect(response.body).toContain(
      `<link rel="canonical" href="http://localhost:8099/${username}" />`,
    );
  });

  it('answers 404 for a name nobody has, with the shell a browser can render', async () => {
    const c = harness.client();
    const html = await c.request('GET', '/nobody-here-at-all', undefined, { accept: 'text/html' });
    expect(html.statusCode).toBe(404);
    expect(html.body).toContain('<div id="root">');

    const api = await c.request('GET', '/api/v1/users/nobody-here-at-all/boards');
    expect(api.statusCode).toBe(404);
  });

  it('serves the public boards to the SPA as JSON', async () => {
    const { c, username } = await signedIn('profileapi');
    const open = await createBoard(c, 'Open one', 'public');
    await createBoard(c, 'Hidden one');

    const response = await c.request('GET', `/api/v1/users/${username}/boards`);
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: { id: string; name: string; url: string }[] };
    expect(body.items.map((item) => item.id)).toEqual([open.id]);
    expect(body.items[0]?.url).toBe(`http://localhost:8099/${username}/${open.slug}`);
  });
});

describe('the crawler files', () => {
  it('keeps credentialed prefixes out of robots.txt and points at the sitemap', async () => {
    const c = harness.client();
    const response = await c.request('GET', '/robots.txt');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Disallow: /l/');
    expect(response.body).toContain('Disallow: /api/');
    expect(response.body).toContain('Sitemap: http://localhost:8099/sitemap.xml');
  });

  it('lists public boards and profiles in the sitemap, and nothing else', async () => {
    const { c, username } = await signedIn('sitemap');
    const open = await createBoard(c, 'In the map', 'public');
    const link = await createBoard(c, 'Out of the map', 'link');

    const response = await c.request('GET', '/sitemap.xml');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('xml');
    expect(response.body).toContain(`http://localhost:8099/${username}/${open.slug}</loc>`);
    expect(response.body).toContain(`http://localhost:8099/${username}</loc>`);
    expect(response.body).not.toContain(`/${username}/${link.slug}`);
  });
});
