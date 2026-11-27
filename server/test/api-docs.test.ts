// SPDX-License-Identifier: AGPL-3.0-only
/**
 * docs/api.md §3–§7 are claims about the running server, and this is the test
 * that holds them.
 *
 * Nothing checked them before: `docs/api.md` documented three `/auth/oidc/*`
 * routes while the repository contained no OIDC code at all, and a reader who
 * trusted the table would build a client against a 404. Two rules, both
 * directions:
 *
 * 1. every path documented in §3–§7 is registered on the app, or — when one
 *    is not served yet — is named in `## Not yet served`;
 * 2. every registered `/api/v1` route is documented — a route that ships
 *    undocumented is the same defect seen from the other side.
 *
 * The routes are read from the source, like the parity test: Fastify exposes no
 * public route table, and `printRoutes()` prints a radix tree rather than paths.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const REPO = new URL('../../', import.meta.url).pathname;
const SRC = new URL('../src/', import.meta.url).pathname;
const DOC = readFileSync(`${REPO}docs/api.md`, 'utf8');
const METHODS = 'GET|POST|PATCH|PUT|DELETE';

type Row = { method: string; path: string };

/** The sections that list served paths: §3, §3b, §4, §5, §6, §7. */
function servedSections(): string[] {
  return DOC.split(/\n## /u).filter((section) => /^[3-7]/u.test(section));
}

function tableRows(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split('\n')) {
    const match = new RegExp(`^\\| \`(${METHODS})\` \\| \`([^\`]+)\` \\|`, 'u').exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      rows.push({ method: match[1], path: match[2] });
    }
  }
  return rows;
}

/** `## Not yet served`: `| \`GET\` | \`/path\` | K5-09 |`. */
function futureRows(): { row: Row; roadmap: string }[] {
  const section = DOC.split(/\n## /u).find((part) => part.startsWith('Not yet served'));
  if (section === undefined) return [];
  return section
    .split('\n')
    .map((line) => {
      const match = new RegExp(
        `^\\| \`(${METHODS})\` \\| \`([^\`]+)\` \\| (K\\d+-\\d+) \\|$`,
        'u',
      ).exec(line.trim());
      if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
      return { row: { method: match[1], path: match[2] }, roadmap: match[3] };
    })
    .filter((entry): entry is { row: Row; roadmap: string } => entry !== null);
}

/** Every `app.<method>('<path>')` literal in the server. */
function registered(): Set<string> {
  const found = new Set<string>();
  for (const file of readdirSync(SRC, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(`${SRC}${file}`, 'utf8');
    for (const match of source.matchAll(
      new RegExp(`\\bapp\\.(get|post|patch|put|delete)\\(\\s*'([^']+)'`, 'gu'),
    )) {
      const [, method, path] = match;
      if (method && path) found.add(`${method.toUpperCase()} ${path}`);
    }
  }
  return found;
}

const routes = registered();
const documented = tableRows(servedSections().join('\n## '));
const future = futureRows();

/** `docs/api.md` writes `/boards` for `/api/v1/boards`, and `/mcp` for `/mcp`. */
function servedAs(row: Row): string[] {
  const raw = `${row.method} ${row.path}`;
  const prefixed = `${row.method} /api/v1${row.path}`;
  return row.path.startsWith('/api/') ? [raw] : [raw, prefixed];
}

describe('docs/api.md is the routes the server actually answers', () => {
  it('parses the table it is checking', () => {
    // A broken parser would pass every assertion below by finding nothing.
    expect(documented.length).toBeGreaterThanOrEqual(60);
    expect(routes.size).toBeGreaterThanOrEqual(60);
  });

  it('documents no path the server does not serve, unless it is future work', () => {
    const futureKeys = new Set(
      future.flatMap(({ row }) => [row.path, `${row.method} ${row.path}`]),
    );
    const missing = documented
      .filter((row) => !servedAs(row).some((key) => routes.has(key)))
      .filter((row) => !futureKeys.has(row.path) && !futureKeys.has(`${row.method} ${row.path}`))
      .map((row) => `${row.method} ${row.path}`);
    expect(missing).toEqual([]);
  });

  it('keeps the future list honest: a route that is not served', () => {
    const problems: string[] = [];
    for (const { row, roadmap } of future) {
      if (servedAs(row).some((key) => routes.has(key))) {
        problems.push(`${row.path} is served now, so it is not future work (${roadmap})`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('documents every route it serves under /api/v1', () => {
    const documentedKeys = new Set(documented.flatMap(servedAs));
    const undocumented = [...routes]
      .filter((key) => key.includes(' /api/v1/'))
      .filter((key) => !documentedKeys.has(key))
      .sort();
    expect(undocumented).toEqual([]);
  });
});
