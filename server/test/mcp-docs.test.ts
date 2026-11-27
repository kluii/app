// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K4-08 — docs/mcp.md verified against the schemas, in CI.
 *
 * The frozen surface is described in two places that fail differently: the
 * schemas in `mcp/schemas.ts` decide what the server accepts, and the tables in
 * docs/mcp.md decide what a client author writes. A table that advertises an
 * argument the server refuses is a bug report waiting to happen (it had one:
 * `update_column.position`, which PATCH has never accepted).
 *
 * So: documented arguments must be accepted, required arguments must be
 * documented, and `/llms.txt` must list the tools the server actually serves.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PROTOCOL_CODES } from '../src/mcp/errors.js';
import { LISTED_TOOLS } from '../src/mcp/registry.js';
import { TOOL_NAMES, TOOL_SCHEMAS } from '../src/mcp/schemas.js';
import { llmsTxt } from '../src/public/llms.js';

const DOC = readFileSync(new URL('../../docs/mcp.md', import.meta.url), 'utf8');

/** `| \`tool\` | \`({a, b?})\` |` rows of §3. */
function toolTable(): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of DOC.split('\n')) {
    const match = /^\| `([a-z_]+)` \| `\((.*)\)` \|$/u.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) rows.set(match[1], match[2]);
  }
  return rows;
}

/** Top-level argument names, so `items:[{title}]` does not name `title`. */
function argumentNames(row: string): string[] {
  // The table wraps the arguments in the object they describe: `({board, name?})`.
  const args = row.trim().replace(/^\{/u, '').replace(/\}$/u, '');
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of args) {
    if (char === '[' || char === '{' || char === '(') depth += 1;
    if (char === ']' || char === '}' || char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim() !== '') parts.push(current);
  return parts
    .map((part) => /^([a-z_]+)/u.exec(part.trim())?.[1])
    .filter((name): name is string => name !== undefined);
}

function schemaOf(tool: (typeof TOOL_NAMES)[number]): {
  properties?: Record<string, unknown>;
  required?: string[];
} {
  return z.toJSONSchema(TOOL_SCHEMAS[tool], { io: 'input' }) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

const table = toolTable();

describe('docs/mcp.md and the schemas say the same thing', () => {
  it('documents exactly the frozen tool names', () => {
    expect([...table.keys()].sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('never documents an argument the server refuses', () => {
    const wrong: string[] = [];
    for (const [tool, args] of table) {
      const schema = schemaOf(tool as (typeof TOOL_NAMES)[number]);
      const accepted = new Set(Object.keys(schema.properties ?? {}));
      for (const name of argumentNames(args)) {
        if (!accepted.has(name)) wrong.push(`${tool}.${name}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('documents every required argument', () => {
    const missing: string[] = [];
    for (const [tool, args] of table) {
      const documented = new Set(argumentNames(args));
      const schema = schemaOf(tool as (typeof TOOL_NAMES)[number]);
      for (const name of schema.required ?? []) {
        if (!documented.has(name)) missing.push(`${tool}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * The other direction, which nothing checked: a property added to a schema
   * and left out of the table is an argument a client author never learns
   * exists. `update_card.expected_updated_at` was in that state.
   */
  it('documents every argument the schema accepts', () => {
    const missing: string[] = [];
    for (const [tool, args] of table) {
      const documented = new Set(argumentNames(args));
      const schema = schemaOf(tool as (typeof TOOL_NAMES)[number]);
      for (const name of Object.keys(schema.properties ?? {})) {
        if (!documented.has(name)) missing.push(`${tool}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('lists every error code the transport can answer', () => {
    const codes = new Set(Object.values(PROTOCOL_CODES));
    for (const code of codes) {
      expect(DOC, `docs/mcp.md never mentions ${code}`).toContain(String(code));
    }
  });
});

describe('/llms.txt is generated, not written down', () => {
  const text = llmsTxt('https://app.example.com');

  it('names the endpoint and every served tool with its description', () => {
    expect(text).toContain('https://app.example.com/mcp');
    expect(text).toContain(`Tools (${LISTED_TOOLS.length})`);
    for (const tool of LISTED_TOOLS) expect(text).toContain(`- ${tool}: `);
  });

  it('does not mention a tool the server does not serve', () => {
    const mentioned = [...text.matchAll(/^- ([a-z_]+): /gmu)].map((match) => match[1]);
    expect(mentioned.sort()).toEqual([...LISTED_TOOLS].sort());
  });

  it('points at the export routes, which are the tool and the file alike', () => {
    expect(text).toContain('/api/v1/boards/:id/export.json');
    expect(text).toContain('/api/v1/boards/:id/export.md');
  });
});
