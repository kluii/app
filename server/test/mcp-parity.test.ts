// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K4-06 — parity, asserted both ways.
 *
 * docs/mcp.md §6 says "the mapping is a test, not a promise". This is that
 * test:
 *
 * 1. every frozen tool has a row, and every row's route is registered;
 * 2. every board-content route in the server either has a tool or is listed in
 *    `HUMAN_ONLY_ROUTES` with the reason it is human-only — a route added
 *    without a tool fails here, not in review;
 * 3. every argument name documented in docs/mcp.md §3 (mirrored in
 *    `TOOL_EXAMPLES`) is accepted, and renaming one fails naming the tool and
 *    the parameter.
 *
 * The route list is read from the source because Fastify exposes no public
 * route table and `printRoutes()` prints a radix tree, not paths.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOOL_EXAMPLES, TOOL_NAMES, TOOL_SCHEMAS } from '../src/mcp/schemas.js';
import { PARITY, HUMAN_ONLY_ROUTES, PARITY_NAMESPACES } from '../src/mcp/parity.js';
import { TOOL_KINDS } from '../src/mcp/registry.js';
import { zodToRpc } from '../src/mcp/errors.js';

const ROOT = new URL('../src', import.meta.url).pathname;

function routeSources(): { file: string; source: string }[] {
  const files = readdirSync(ROOT, { recursive: true, encoding: 'utf8' }).filter((file) =>
    file.endsWith('.ts'),
  );
  return files.map((file) => ({ file, source: readFileSync(`${ROOT}/${file}`, 'utf8') }));
}

/** Every `app.get('/api/v1/…')` literal in the server, as `METHOD path`. */
function registeredRoutes(): { method: string; path: string; file: string }[] {
  const found: { method: string; path: string; file: string }[] = [];
  for (const { file, source } of routeSources()) {
    for (const match of source.matchAll(/\bapp\.(get|post|patch|put|delete)\(\s*'([^']+)'/gu)) {
      const [, method, path] = match;
      if (!method || !path) continue;
      found.push({ method: method.toUpperCase(), path, file });
    }
  }
  return found;
}

const routes = registeredRoutes();

describe('the parity table holds in both directions', () => {
  it('has one row per frozen tool, no more and no fewer', () => {
    expect(PARITY).toHaveLength(TOOL_NAMES.length);
    expect(PARITY.map((row) => row.tool).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('every tool row names a route the server actually registers', () => {
    const registered = new Set(routes.map((route) => `${route.method} ${route.path}`));
    const missing = PARITY.flatMap((row) => {
      if (row.route === null || row.method === null) return [];
      const paths = [row.route, ...(row.extraRoutes ?? [])];
      return paths
        .map((path) => `${row.method} ${path}`)
        .filter((key) => !registered.has(key))
        .map((key) => `${row.tool} → ${key}`);
    });
    expect(missing).toEqual([]);
  });

  it('every board-content route has a tool or a documented human-only reason', () => {
    const covered = new Set(
      PARITY.flatMap((row) =>
        row.route === null || row.method === null
          ? []
          : [row.route, ...(row.extraRoutes ?? [])].map((path) => `${row.method} ${path}`),
      ),
    );
    for (const row of HUMAN_ONLY_ROUTES) covered.add(`${row.method} ${row.path}`);

    const uncovered = routes
      .filter((route) => PARITY_NAMESPACES.some((prefix) => route.path.startsWith(prefix)))
      .filter((route) => !covered.has(`${route.method} ${route.path}`))
      .map((route) => `${route.method} ${route.path} (${route.file})`);

    expect(uncovered).toEqual([]);
  });

  it('every human-only entry names a real reason and a real route', () => {
    const registered = new Set(routes.map((route) => `${route.method} ${route.path}`));
    for (const row of HUMAN_ONLY_ROUTES) {
      expect(row.why.length, `${row.method} ${row.path} needs a reason`).toBeGreaterThan(20);
      expect(registered.has(`${row.method} ${row.path}`), `${row.path} is not registered`).toBe(
        true,
      );
    }
  });
});

/**
 * docs/mcp.md §5 promises 600 reads a minute and 60 writes per key. That
 * promise is only keepable if every tool has a bucket, so a tool added without
 * one fails here instead of being silently charged at the read price.
 */
describe('every tool has a rate-limit bucket', () => {
  it('classifies all of them, and nothing that writes is a read', () => {
    expect(Object.keys(TOOL_KINDS).sort()).toEqual([...TOOL_NAMES].sort());

    const WRITING = /^(create|update|delete|move|set|bulk)_/u;
    const misclassified = TOOL_NAMES.filter(
      (tool) => WRITING.test(tool) && TOOL_KINDS[tool] !== 'write',
    );
    expect(misclassified).toEqual([]);

    // Reads are exactly the ones that leave no event: a tool whose name says
    // nothing about writing must be listed as a read deliberately.
    expect(TOOL_NAMES.filter((tool) => TOOL_KINDS[tool] === 'read').sort()).toEqual([
      'export_board',
      'get_activity',
      'get_board',
      'get_card',
      'list_boards',
      'list_comments',
      'search_cards',
      'whoami',
    ]);
  });
});

describe('the documented arguments are the ones the schemas accept', () => {
  it('accepts every documented example as written', () => {
    for (const tool of TOOL_NAMES) {
      const parsed = TOOL_SCHEMAS[tool].safeParse(TOOL_EXAMPLES[tool]);
      expect(parsed.success, `${tool} rejects its own documented example`).toBe(true);
    }
  });

  it('fails naming the tool and the parameter when an argument is renamed', () => {
    for (const tool of TOOL_NAMES) {
      const example = TOOL_EXAMPLES[tool] as Record<string, unknown>;
      const [first] = Object.keys(example);
      if (first === undefined) continue; // list_boards and whoami take no arguments

      const renamed = { ...example, [`${first}_renamed`]: example[first] };
      delete renamed[first];
      const parsed = TOOL_SCHEMAS[tool].safeParse(renamed);
      expect(parsed.success, `${tool} accepted a renamed argument`).toBe(false);
      if (parsed.success) continue;

      const error = zodToRpc(tool, parsed.error);
      expect(error.code).toBe(-32602);
      expect(error.message).toContain(tool);
      const named = `${error.message} ${JSON.stringify(error.data)}`;
      expect(
        named.includes(`${first}_renamed`) || named.includes(`'${first}'`),
        `${tool} did not name the renamed parameter (${first}): ${named}`,
      ).toBe(true);
      expect(error.data?.example).toBeDefined();
    }
  });
});
