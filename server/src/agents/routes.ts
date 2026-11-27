// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Issuance, listing, revocation and "test connection" (docs/api.md §3c).
 *
 * A session issues keys; a key cannot issue keys. That is not a UI rule: the
 * agent actor is refused here before the body is even read.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor } from '../auth/request.js';
import { AppError, fromZod } from '../lib/errors.js';
import { createAgentKeySchema, testAgentKeySchema } from '../contracts/agents.js';
import { createAgentKey, listAgentKeys, revokeAgentKey, testAgentKey } from './service.js';

export function registerAgentKeyRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db)
      throw new AppError('internal', { message: 'database is required', hint: null });
    return context.db;
  };

  app.post('/api/v1/agent-keys', async (request, reply) => {
    const actor = requireActor(request);
    if (actor.kind !== 'user') {
      throw new AppError('forbidden', {
        message: 'A credential cannot mint another credential.',
        hint: 'Issue agent keys from a signed-in session.',
      });
    }
    const parsed = createAgentKeySchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const created = await createAgentKey(database(), {
      actor: { kind: 'user', userId: actor.userId },
      pepper: context.secrets.tokenPepper,
      name: parsed.data.name,
      scope: parsed.data.scope,
      ...(parsed.data.board_id === undefined ? {} : { boardId: parsed.data.board_id }),
      ...(parsed.data.expires_in_days === undefined
        ? {}
        : { expiresInDays: parsed.data.expires_in_days }),
    });
    return reply.code(201).send(created);
  });

  app.get('/api/v1/agent-keys', async (request) => {
    const actor = requireActor(request);
    if (actor.kind !== 'user' && actor.kind !== 'agent') throw new AppError('unauthenticated');
    return listAgentKeys(database(), actor.kind === 'agent' ? actor.userId : actor.userId);
  });

  app.delete('/api/v1/agent-keys/:id', async (request, reply) => {
    const actor = requireActor(request);
    if (actor.kind !== 'user') {
      throw new AppError('forbidden', {
        message: 'A credential cannot revoke credentials.',
        hint: 'Revoke agent keys from a signed-in session.',
      });
    }
    const { id } = request.params as { id: string };
    await revokeAgentKey(database(), { kind: 'user', userId: actor.userId }, id);
    return reply.code(204).send();
  });

  app.post('/api/v1/agent-keys/:id/test', async (request) => {
    const actor = requireActor(request);
    if (actor.kind !== 'user') throw new AppError('forbidden');
    const parsed = testAgentKeySchema.safeParse(request.body ?? {});
    if (!parsed.success) throw fromZod(parsed.error);
    const { id } = request.params as { id: string };
    return testAgentKey(database(), {
      userId: actor.userId,
      pepper: context.secrets.tokenPepper,
      id,
      ...(parsed.data.key === undefined ? {} : { presented: parsed.data.key }),
    });
  });
}
