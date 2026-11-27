// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `<head>` a page deserves (docs/features/links-and-anonymous.md §7).
 *
 * A `link` board is `noindex`; a `public` board carries a clean canonical URL;
 * a page nobody may read keeps the plain shell, so a private name never reaches
 * a stranger's HTML. This is templating, not SSR (D-50): the SPA replaces the
 * document as soon as it boots.
 */

export type PageMeta = {
  title: string;
  description: string;
  canonical: string | null;
  noindex: boolean;
};

const TITLE = /<title>[\s\S]*?<\/title>/;

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The documented 404 shape: nothing about a board, whoever asked. */
export const PLAIN_META: PageMeta = {
  title: 'Klui',
  description: 'A small kanban for small teams and short projects.',
  canonical: null,
  noindex: true,
};

export function injectMeta(indexHtml: string, meta: PageMeta): string {
  const tags = [
    meta.noindex ? '<meta name="robots" content="noindex" />' : null,
    meta.canonical ? `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />` : null,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    '<meta property="og:site_name" content="Klui" />',
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    meta.canonical ? `<meta property="og:url" content="${escapeHtml(meta.canonical)}" />` : null,
  ]
    .filter((tag): tag is string => tag !== null)
    .join('\n    ');

  const withTitle = TITLE.test(indexHtml)
    ? indexHtml.replace(TITLE, `<title>${escapeHtml(meta.title)}</title>`)
    : indexHtml.replace('</head>', `    <title>${escapeHtml(meta.title)}</title>\n  </head>`);

  return withTitle.replace('</head>', `    ${tags}\n  </head>`);
}
