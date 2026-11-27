// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Test connection" as an MCP client (K4-07, docs/mcp.md §7).
 *
 * The panel used to hash the presented key and re-run `loadBoardFor` in process:
 * it answered "connected" while `/mcp` was unreachable or refused that very key,
 * which is the one thing the button exists to disprove. This module speaks the
 * protocol instead — `initialize`, then `tools/call whoami`, then
 * `tools/call list_boards` for the board's name and the caller's role — to the
 * instance's own public endpoint, with the key the user pasted.
 *
 * It reads the endpoint the agent will read, so a proxy that swallows `/mcp`, a
 * TLS certificate the container does not trust, or a `-32603` is reported as a
 * refusal rather than as a green tick. `via` in the API response says which path
 * answered: `mcp` here, `inline` only when `KLUI_PUBLIC_URL` is unset.
 */
import { readVersion } from '../lib/version.js';

const TIMEOUT_MS = 5_000;

export type ProbeRefusal = 'unreachable' | 'mcp_error' | 'board_not_found';

export type ProbeResult =
  | { ok: true; via: 'mcp'; board: { id: string; name: string } | null; role: string | null }
  | { ok: false; via: 'mcp'; reason: ProbeRefusal };

type RpcReply = { result?: unknown; error?: { code: number; message: string } };

type Call = { reply: RpcReply | null };

/**
 * One JSON-RPC request. A transport failure and a protocol error are kept
 * apart: the first says the endpoint is not there, the second says it answered
 * and refused, and a panel that confuses them sends the user to the wrong place.
 */
async function call(endpoint: string, raw: string, body: unknown): Promise<Call> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${raw}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // A 429 or a 401 still carries the JSON-RPC error that explains it: parse
    // before deciding, and let the body say what happened.
    const text = await response.text();
    const parsed = JSON.parse(text) as RpcReply;
    return { reply: parsed };
  } catch {
    return { reply: null };
  }
}

/** `structuredContent` when the server sends it, the text content otherwise. */
function payloadOf(reply: RpcReply): Record<string, unknown> | null {
  const result = reply.result as
    { structuredContent?: unknown; content?: { type: string; text?: string }[] } | undefined;
  if (result === undefined || result === null) return null;
  const structured = result.structuredContent;
  if (typeof structured === 'object' && structured !== null) {
    return structured as Record<string, unknown>;
  }
  const [first] = result.content ?? [];
  if (first?.type === 'text' && typeof first.text === 'string') {
    try {
      const parsed: unknown = JSON.parse(first.text);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function toolCall(id: number, name: string, args: Record<string, unknown> = {}): unknown {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

/** The probe. `publicUrl` is the origin an agent is told to use. */
export async function probeAgentKey(publicUrl: string, raw: string): Promise<ProbeResult> {
  const endpoint = `${publicUrl.replace(/\/+$/u, '')}/mcp`;

  const initialized = await call(endpoint, raw, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'klui-setup-test', version: readVersion() },
    },
  });
  if (initialized.reply === null) return { ok: false, via: 'mcp', reason: 'unreachable' };
  if (initialized.reply.error !== undefined) return { ok: false, via: 'mcp', reason: 'mcp_error' };

  const who = await call(endpoint, raw, toolCall(2, 'whoami'));
  if (who.reply === null) return { ok: false, via: 'mcp', reason: 'unreachable' };
  if (who.reply.error !== undefined) return { ok: false, via: 'mcp', reason: 'mcp_error' };
  const identity = payloadOf(who.reply);
  if (identity === null) return { ok: false, via: 'mcp', reason: 'mcp_error' };

  const boardId = identity.board_id;
  if (typeof boardId !== 'string') {
    // A user-scoped key reaches every board its owner belongs to, so there is
    // no single board to name and the role is decided board by board.
    return { ok: true, via: 'mcp', board: null, role: null };
  }

  // `whoami` names the board by id; the panel shows its name and the role the
  // key has there, so the second call is the one that renders. It also proves
  // the list the key reads is scoped to that board.
  const listed = await call(endpoint, raw, toolCall(3, 'list_boards'));
  if (listed.reply === null) return { ok: false, via: 'mcp', reason: 'unreachable' };
  if (listed.reply.error !== undefined) return { ok: false, via: 'mcp', reason: 'mcp_error' };
  const items = payloadOf(listed.reply)?.items;
  const match = Array.isArray(items)
    ? items.find((item): item is { id: string; name: string; role?: unknown } => {
        if (typeof item !== 'object' || item === null) return false;
        return (item as { id?: unknown }).id === boardId;
      })
    : undefined;
  if (match === undefined) return { ok: false, via: 'mcp', reason: 'board_not_found' };

  return {
    ok: true,
    via: 'mcp',
    board: { id: boardId, name: match.name },
    role: typeof match.role === 'string' ? match.role : null,
  };
}
