// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /llms.txt` (docs/mcp.md §8): the agent-facing summary a person or a
 * model reads before wiring a key up.
 *
 * Generated from the registry it describes — `LISTED_TOOLS`, their descriptions
 * and the parity table — so it cannot claim a tool the server does not serve.
 * A hand-written file is a list that is right once.
 */
import { DESCRIPTIONS } from '../mcp/descriptions.js';
import { PARITY } from '../mcp/parity.js';
import { LISTED_TOOLS } from '../mcp/registry.js';

export function llmsTxt(publicUrl: string | null): string {
  const base = (publicUrl ?? '').replace(/\/$/u, '');
  const tools = LISTED_TOOLS.map((name) => `- ${name}: ${DESCRIPTIONS[name]}`).join('\n');
  const routes = PARITY.filter((row) => row.route !== null)
    .map((row) => `- ${row.tool} → ${row.method} ${row.route}`)
    .join('\n');

  return `# Klui

A board where a project ends: account-free participation, bring-your-own agents,
a close-out with a summary, and self-hosting with nothing behind a licence key.

## Agents

Endpoint: POST ${base}/mcp — stateless JSON-RPC 2.0 over HTTP.
Credential: Authorization: Bearer kb_… (an agent key, created in Settings →
Agents; the key is shown once). A key scoped to a board reaches that board and
nothing else.

Tools (${LISTED_TOOLS.length}):
${tools}

Read before you write: call get_board, then pass expected_updated_at when you
update a card you did not just create. Prefer bulk_create_cards over looping
create_card (one write, not fifty). Never invent a board id.

## The same operations over REST

Every tool has a route, and every route a tool (docs/mcp.md §6):
${routes}

## Documents

- ${base}/api/v1/boards/:id/export.json — klui.export/v2, byte-identical to the
  export_board tool.
- ${base}/api/v1/boards/:id/export.md — the same board as Markdown.
`;
}
