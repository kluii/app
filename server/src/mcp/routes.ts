// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /mcp` — stateless JSON-RPC 2.0 (docs/mcp.md §1).
 *
 * No session, no state between calls: the credential on the request is the
 * whole context, which is why revocation is effective on the next call. A
 * `GET` answers 405 rather than pretending the endpoint streams.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { AppError } from '../lib/errors.js';
import { readVersion } from '../lib/version.js';
import { TOOL_EXAMPLES, TOOL_NAMES, TOOL_SCHEMAS, type ToolName } from './schemas.js';
import { LISTED_TOOLS, handlerFor } from './registry.js';
import { DESCRIPTIONS } from './descriptions.js';
import { appErrorToRpc, closestTools, zodToRpc, type RpcId } from './errors.js';
import { chargeMcp, refusalHint } from './ratelimit.js';
import { createHub } from '../realtime/events.js';

const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_VERSIONS = new Set([PROTOCOL_VERSION, '2025-03-26']);

type RpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

type RpcResponse = {
  jsonrpc: '2.0';
  id: RpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: Record<string, unknown> };
};

function idOf(message: RpcRequest): RpcId {
  if (typeof message.id === 'string' || typeof message.id === 'number') return message.id;
  return null;
}

function errorOf(
  id: RpcId,
  code: number,
  message: string,
  data?: Record<string, unknown>,
): RpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function toolSchemas(): {
  name: ToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}[] {
  return LISTED_TOOLS.map((name) => ({
    name,
    description: DESCRIPTIONS[name],
    inputSchema: z.toJSONSchema(TOOL_SCHEMAS[name], { io: 'input' }) as Record<string, unknown>,
  }));
}

async function handleToolCall(
  context: AppContext,
  request: FastifyRequest,
  message: RpcRequest,
): Promise<RpcResponse> {
  const id = idOf(message);
  const params = message.params as { name?: unknown; arguments?: unknown } | undefined;
  if (params === undefined || typeof params.name !== 'string') {
    return errorOf(id, -32602, "Invalid params: 'name' must be a tool name.", {
      parameter: 'name',
      expected: 'string',
      received: params?.name === undefined ? 'undefined' : typeof params.name,
      example: TOOL_EXAMPLES.list_boards,
    });
  }
  const name = params.name;
  // A frozen name with no handler is not callable: it is not in `tools/list`, so
  // calling it is calling an unknown tool. -32603 is reserved for a genuine
  // internal failure, never for "not built yet".
  const tool = TOOL_NAMES.find((candidate) => candidate === name);
  const handler = tool === undefined ? undefined : handlerFor(tool);
  if (tool === undefined || handler === undefined) {
    return errorOf(id, -32601, `Unknown tool: ${name}.`, {
      hint: `Did you mean ${closestTools(name, LISTED_TOOLS).join(', ')}?`,
    });
  }
  const parsed = TOOL_SCHEMAS[tool].safeParse(params.arguments ?? {});
  if (!parsed.success) return { jsonrpc: '2.0', id, error: zodToRpc(tool, parsed.error) };

  const db = context.db;
  if (!db) throw new AppError('internal', { message: 'database is required', hint: null });
  if (!request.actor) throw new AppError('unauthenticated');

  try {
    const result = await handler(
      { db, actor: request.actor, env: context.env, hub: context.hub ?? createHub() },
      parsed.data as never,
    );
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
        isError: false,
      },
    };
  } catch (error) {
    if (error instanceof AppError) {
      return { jsonrpc: '2.0', id, error: appErrorToRpc(error) };
    }
    throw error;
  }
}

async function handleMessage(
  context: AppContext,
  request: FastifyRequest,
  raw: unknown,
): Promise<RpcResponse | null> {
  if (typeof raw !== 'object' || raw === null) {
    return errorOf(null, -32600, 'Invalid Request: expected a JSON object.');
  }
  const message = raw as RpcRequest;
  const id = idOf(message);
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return errorOf(id, -32600, "Invalid Request: 'jsonrpc' must be '2.0' and 'method' a string.");
  }

  // Notifications are accepted and answered with 202, in a batch or alone.
  if (message.method.startsWith('notifications/')) return null;

  switch (message.method) {
    case 'initialize': {
      const params = message.params as { protocolVersion?: unknown } | undefined;
      const requested =
        typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: SUPPORTED_VERSIONS.has(requested) ? requested : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'klui', version: readVersion() },
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: toolSchemas() } };
    case 'tools/call':
      return handleToolCall(context, request, message);
    default:
      return errorOf(id, -32601, `Unknown method: ${message.method}.`, {
        hint: 'Supported: initialize, ping, tools/list, tools/call, notifications/*.',
      });
  }
}

function isMcpActor(actor: FastifyRequest['actor']): boolean {
  return actor !== null && (actor.kind === 'user' || actor.kind === 'agent');
}

export function registerMcpRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/mcp', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('allow', 'POST');
    return reply.code(405).send({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32600,
        message: 'GET /mcp is not supported.',
        data: { hint: 'POST a JSON-RPC message to /mcp.' },
      },
    });
  });

  app.post(
    '/mcp',
    {
      // Refuse unauthenticated, anonymous (`klui_anon`) and link (`klui_link`)
      // requests before the body is read, regardless of the method or tool
      // (docs/mcp.md §1).
      preParsing: async (request, reply, payload) => {
        if (!isMcpActor(request.actor)) {
          reply.header('www-authenticate', 'Bearer');
          await reply.code(401).send(
            errorOf(null, -32001, 'Unauthenticated: MCP needs a bearer credential.', {
              hint: 'Send Authorization: Bearer kb_… (an agent key) or a user session.',
            }),
          );
          return;
        }
        return payload;
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const contentType = request.headers['content-type'] ?? '';
      if (!contentType.toLowerCase().includes('application/json')) {
        throw new AppError('unsupported_media_type', {
          message: 'The MCP endpoint reads application/json.',
          hint: 'Send Content-Type: application/json.',
        });
      }
      if (!isMcpActor(request.actor)) {
        reply.header('www-authenticate', 'Bearer');
        return reply.code(401).send(
          errorOf(null, -32001, 'Unauthenticated: MCP needs a bearer credential.', {
            hint: 'Send Authorization: Bearer kb_… (an agent key) or a user session.',
          }),
        );
      }

      const body = request.body;
      const batch = Array.isArray(body);
      const messages = batch ? body : [body];

      // The bucket is charged here, and only here: `params.name` is what says a
      // call reads or writes, and it exists only after the body is parsed
      // (docs/mcp.md §5, mcp/ratelimit.ts). A batch is charged for every message
      // before any of them runs, so a refused batch does nothing.
      if (request.agentKeyId !== null) {
        for (const message of messages) {
          const charge = chargeMcp(reply, context.env, request.agentKeyId, message);
          if (!charge.allowed) {
            reply.header('retry-after', String(charge.retryAfter));
            return reply.code(429).send(
              errorOf(
                idOf(message as RpcRequest),
                -32004,
                `Too many ${charge.bucket} calls for this agent key.`,
                {
                  code: 'rate_limited',
                  bucket: charge.bucket,
                  limit: charge.limit,
                  retry_after_s: charge.retryAfter,
                  hint: refusalHint(charge.retryAfter),
                },
              ),
            );
          }
        }
      }

      const responses: RpcResponse[] = [];
      for (const message of messages) {
        const response = await handleMessage(context, request, message);
        if (response !== null) responses.push(response);
      }
      if (responses.length === 0) return reply.code(202).send();
      return batch ? responses : responses[0];
    },
  );
}
