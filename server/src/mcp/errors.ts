// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Protocol errors (docs/mcp.md §2). The application codes are REST's, carried
 * in `data`, so an agent that already knows `board_not_found` does not need a
 * second vocabulary.
 */
import type { ZodError } from 'zod';
import type { AppError } from '../lib/errors.js';
import type { ErrorCode } from '../lib/errors.js';
import { TOOL_EXAMPLES, type ToolName } from './schemas.js';

export type RpcId = string | number | null;

export type RpcErrorBody = {
  jsonrpc: '2.0';
  id: RpcId;
  error: { code: number; message: string; data?: Record<string, unknown> };
};

export const PROTOCOL_CODES: Partial<Record<ErrorCode, number>> = {
  not_found: -32001,
  board_not_found: -32001,
  card_not_found: -32001,
  column_not_found: -32001,
  comment_not_found: -32001,
  link_not_found: -32001,
  member_not_found: -32001,
  pending_not_found: -32001,
  agent_key_not_found: -32001,
  forbidden: -32002,
  board_closed: -32002,
  banned: -32002,
  conflict: -32003,
  column_not_empty: -32003,
  rate_limited: -32004,
  too_many_attempts: -32004,
  validation_failed: -32602,
  // docs/mcp.md §4: an export over the inline limit names the REST endpoint
  // rather than truncating. -32006 is the one code this file adds to §2.
  payload_too_large: -32006,
  service_unavailable: -32603,
};

export function appErrorToRpc(error: AppError): {
  code: number;
  message: string;
  data?: Record<string, unknown>;
} {
  const code = PROTOCOL_CODES[error.code] ?? -32603;
  const data: Record<string, unknown> = { code: error.code };
  if (error.hint !== null) data.hint = error.hint;
  if (error.details !== undefined) data.details = error.details;
  if (error.current !== undefined) data.current = error.current;
  if (error.code === 'rate_limited' || error.code === 'too_many_attempts') {
    const match = /(\d+) seconds/u.exec(error.hint ?? '');
    data.retry_after_s = match?.[1] === undefined ? 60 : Number(match[1]);
  }
  return { code, message: error.message, data };
}

/**
 * One issue, named: the parameter, the type it wanted, what arrived, and an
 * example that would work. A bare "invalid params" is a puzzle.
 */
export function zodToRpc(tool: ToolName, error: ZodError): RpcErrorBody['error'] {
  const issue = error.issues[0];
  // An unknown key has an empty path; naming it is the difference between
  // "something is wrong" and "`board_id` is not a parameter, send `board`".
  const parameter =
    issue?.code === 'unrecognized_keys'
      ? (issue.keys?.[0] ?? '')
      : (issue?.path.map(String).join('.') ?? '');
  const received = issue?.code === 'invalid_type' ? String(issue.input) : undefined;
  return {
    code: -32602,
    message: `Invalid params for ${tool}: '${parameter || '(body)'}' ${
      issue?.message ?? 'is not valid'
    }.`,
    data: {
      parameter: parameter || null,
      expected: (issue as { expected?: string } | undefined)?.expected ?? issue?.code ?? 'unknown',
      received: received ?? null,
      example: TOOL_EXAMPLES[tool],
      hint: issue?.message ?? 'Fix the parameter named above.',
    },
  };
}

/**
 * Edit distance, so a guessed tool name costs one round trip, not five. One row
 * of the matrix is kept, which is all the distance needs.
 */
function distance(a: string, b: string): number {
  const row: number[] = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(above + 1, (row[j - 1] ?? 0) + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return row[b.length] ?? 0;
}

export function closestTools(name: string, names: readonly string[]): string[] {
  return [...names]
    .map((candidate) => ({ candidate, score: distance(name, candidate) }))
    .sort(
      (left, right) => left.score - right.score || left.candidate.localeCompare(right.candidate),
    )
    .slice(0, 3)
    .map((entry) => entry.candidate);
}
