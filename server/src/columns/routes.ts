// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor } from '../auth/request.js';
import { AppError } from '../lib/errors.js';
import { createColumnSchema, deleteColumnSchema, updateColumnSchema } from '../contracts/cards.js';
import { createColumn, deleteColumn, updateColumn } from './service.js';

export function registerColumnRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  app.post('/api/v1/boards/:id/columns', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = createColumnSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('validation_failed', {
        message: 'A column needs a name of at most 64 characters.',
        hint: 'Send {"name":"Doing"}.',
      });
    }
    const column = await createColumn({ db: database(), actor, hub: context.hub }, id, parsed.data);
    return reply.code(201).send(column);
  });

  app.patch('/api/v1/columns/:id', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = updateColumnSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('validation_failed', {
        message: 'Rename needs a name of at most 64 characters.',
        hint: 'Send {"name":"Doing"}.',
      });
    }
    return updateColumn({ db: database(), actor, hub: context.hub }, id, parsed.data);
  });

  app.delete('/api/v1/columns/:id', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = deleteColumnSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new AppError('validation_failed', {
        message: 'A column deletion takes move_cards_to or delete_cards.',
        hint: 'Send {"move_cards_to":"col_…"} or {"delete_cards":true}.',
      });
    }
    await deleteColumn({ db: database(), actor, hub: context.hub }, id, parsed.data);
    return reply.code(204).send();
  });
}
