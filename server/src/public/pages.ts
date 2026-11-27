// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The three documents a crawler can reach without running JavaScript: a public
 * profile, a board page's `<head>`, and the crawler files (D-50, §7 of
 * docs/features/links-and-anonymous.md).
 *
 * Everything here reads, never writes; a board's readability is `can()`, like
 * every other surface.
 */
import type { Db } from '../db.js';
import { can, type Actor } from '../lib/authz.js';
import { toPolicy, membershipFor, humanBoardPath, resolvePublicBoard } from '../boards/service.js';
import { isReserved } from '../lib/reserved.js';
import { escapeHtml, injectMeta, PLAIN_META, type PageMeta } from './meta.js';

export type HtmlPage = {
  status: 200 | 404;
  html: string;
  /** Sent as `X-Robots-Tag`, and mirrored by the meta tag. */
  noindex: boolean;
};

function absolute(publicUrl: string | null): string {
  return (publicUrl ?? '').replace(/\/$/, '');
}

/**
 * The prerendered profile. It lives inside `#root`, so React replaces it on the
 * first render; a crawler reads it before that happens. The classes are the
 * app's own (they exist in the bundle), so the page is styled by the product
 * and not by a second design system.
 */
function profileBody(username: string, boards: { name: string; url: string }[]): string {
  const items =
    boards.length === 0
      ? '<li class="text-body-sm text-ink-muted">No public boards yet.</li>'
      : boards
          .map(
            (board) =>
              `<li><a class="text-label underline-offset-4 hover:underline" href="${escapeHtml(board.url)}">${escapeHtml(board.name)}</a></li>`,
          )
          .join('');
  return [
    '<div id="root">',
    '<main class="mx-auto flex w-full max-w-content flex-col gap-6 px-6 py-8">',
    `<h1 class="text-h1">@${escapeHtml(username)}</h1>`,
    `<ul class="flex flex-col gap-2">${items}</ul>`,
    '</main>',
    '</div>',
  ].join('');
}

export function withProfile(
  indexHtml: string,
  input: { username: string; boards: { name: string; url: string }[]; publicUrl: string | null },
): string {
  const body = indexHtml.replace(
    /<div id="root"><\/div>/,
    profileBody(input.username, input.boards),
  );
  return injectMeta(body, {
    title: `${input.username} · Klui`,
    description: `Public boards by ${input.username} on Klui.`,
    canonical: `${absolute(input.publicUrl)}/${input.username}`,
    noindex: false,
  });
}

async function boardMeta(
  db: Db,
  actor: Actor | null,
  boardId: string,
  publicUrl: string | null,
): Promise<PageMeta> {
  const board = await db.board.findUnique({
    where: { id: boardId },
    include: { owner: { select: { username: true } } },
  });
  if (!board) return PLAIN_META;

  const membership = actor ? await membershipFor(db, actor, board.id) : null;
  const readable = actor ? can(actor, 'board.read', toPolicy(board), membership).allow : false;
  // Unreadable is indistinguishable from non-existent: no name, no canonical.
  if (!readable) return PLAIN_META;

  const path = humanBoardPath(board);
  if (board.visibility === 'public') {
    return {
      title: `${board.name} · ${board.owner.username} · Klui`,
      description: `${board.name}, a board by ${board.owner.username} on Klui.`,
      canonical: `${absolute(publicUrl)}${path}`,
      noindex: false,
    };
  }
  // A private board's name is the actor's business; a link board's URL is a
  // secret, so neither may be indexed.
  return {
    title: `${board.name} · ${board.owner.username} · Klui`,
    description: `${board.name}, a board on Klui.`,
    canonical: null,
    noindex: true,
  };
}

/**
 * Resolves an HTML navigation. `null` means "not a public document": the shell
 * is served unchanged, exactly as before this module existed.
 */
export async function renderHtmlPage(input: {
  db: Db;
  actor: Actor | null;
  indexHtml: string;
  path: string;
  publicUrl: string | null;
}): Promise<HtmlPage | null> {
  const segments = input.path.split('?')[0]?.split('/').filter(Boolean) ?? [];
  const first = segments[0];
  if (first === undefined || segments.length > 2) return null;
  if (first === 'assets' || first === 'l' || first === 'api' || first === 'mcp') return null;

  if (segments.length === 2) {
    const segment = segments[1] ?? '';
    const target = await resolvePublicBoard(input.db, first, segment);
    if (!target)
      return { status: 200, html: injectMeta(input.indexHtml, PLAIN_META), noindex: true };
    const meta = await boardMeta(input.db, input.actor, target.id, input.publicUrl);
    return { status: 200, html: injectMeta(input.indexHtml, meta), noindex: meta.noindex };
  }

  if (isReserved(first)) return null;
  const user = await input.db.user.findUnique({
    where: { username: first.toLowerCase() },
    select: { id: true, username: true },
  });
  if (!user) return { status: 404, html: injectMeta(input.indexHtml, PLAIN_META), noindex: true };

  const boards = await input.db.board.findMany({
    where: { owner_id: user.id, visibility: 'public', closed_at: null },
    orderBy: [{ updated_at: 'desc' }, { id: 'asc' }],
    select: { name: true, slug: true },
  });
  const items = boards.map((board) => ({
    name: board.name,
    url: `${absolute(input.publicUrl)}/${user.username}/${board.slug}`,
  }));
  return {
    status: 200,
    html: withProfile(input.indexHtml, {
      username: user.username,
      boards: items,
      publicUrl: input.publicUrl,
    }),
    noindex: false,
  };
}

export function robotsTxt(publicUrl: string | null): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /l/',
    'Disallow: /mcp',
    `Sitemap: ${absolute(publicUrl)}/sitemap.xml`,
    '',
  ].join('\n');
}

/** Public boards and the profiles that own them; nothing else, ever. */
export async function sitemapXml(db: Db, publicUrl: string | null): Promise<string> {
  const boards = await db.board.findMany({
    where: { visibility: 'public', closed_at: null },
    orderBy: [{ owner_id: 'asc' }, { slug: 'asc' }],
    select: { slug: true, updated_at: true, owner: { select: { username: true } } },
  });
  const profiles = [...new Set(boards.map((board) => board.owner.username))].sort();
  const urls = [
    ...profiles.map((username) => ({ loc: `${absolute(publicUrl)}/${username}`, lastmod: null })),
    ...boards.map((board) => ({
      loc: `${absolute(publicUrl)}/${board.owner.username}/${board.slug}`,
      lastmod: board.updated_at.toISOString(),
    })),
  ];
  const entries = urls.map((entry) =>
    [
      '  <url>',
      `    <loc>${escapeHtml(entry.loc)}</loc>`,
      ...(entry.lastmod === null ? [] : [`    <lastmod>${entry.lastmod}</lastmod>`]),
      '  </url>',
    ].join('\n'),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}
