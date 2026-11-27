// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The agent buckets, charged where the call is known (docs/mcp.md §5).
 *
 * `settings/ratelimit.ts` charges REST from the HTTP method, and every MCP call
 * is `POST /mcp`: deciding there charged a `list_boards` at the write price, so
 * an agent reading a board was throttled at 60 a minute and 70 reads produced 17
 * refusals (D-57 recorded the gap; this file closes it). The classification is
 * `TOOL_KINDS` beside the registry, and the key is the same `agent:<id>:<bucket>`
 * the REST hook uses, so one key has one read bucket and one write bucket
 * whichever transport spends it.
 */
import type { FastifyReply } from 'fastify';
import type { Env } from '../env.js';
import { agentLimiter } from '../settings/ratelimit.js';
import { isWriteTool } from './registry.js';

const WINDOW_MS = 60_000;

export type McpBucket = 'read' | 'write';

/** A tool call is a write when its tool is; every other method is a read. */
export function bucketOf(message: unknown): McpBucket {
  if (typeof message !== 'object' || message === null) return 'read';
  const { method, params } = message as { method?: unknown; params?: unknown };
  if (method !== 'tools/call') return 'read';
  const name = (params as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' && isWriteTool(name) ? 'write' : 'read';
}

export type McpCharge =
  | { allowed: true; bucket: McpBucket; limit: number }
  | { allowed: false; bucket: McpBucket; limit: number; retryAfter: number };

/**
 * Spends one slot and sets the headers for the bucket that was charged. The
 * caller turns a refusal into the `-32004` body: only the route knows the id.
 */
export function chargeMcp(
  reply: FastifyReply,
  env: Env,
  agentKeyId: string,
  message: unknown,
): McpCharge {
  const bucket = bucketOf(message);
  const limit = bucket === 'write' ? env.KLUI_AGENT_WRITES : env.KLUI_AGENT_READS;
  const key = `agent:${agentKeyId}:${bucket}`;
  const result = agentLimiter.take(key, { max: limit, windowMs: WINDOW_MS });
  reply.header('x-ratelimit-limit', String(limit));
  if (result.allowed) {
    reply.header('x-ratelimit-remaining', String(Math.max(0, limit - agentLimiter.count(key))));
    return { allowed: true, bucket, limit };
  }
  reply.header('x-ratelimit-remaining', '0');
  return { allowed: false, bucket, limit, retryAfter: result.retryAfter };
}

/** The hint names the tool that spends one write instead of many. */
export function refusalHint(retryAfter: number): string {
  return `Slow down: try again in ${retryAfter} seconds, or use bulk_create_cards for more than 5 cards.`;
}
