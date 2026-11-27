// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /boards/:id/search` (docs/api.md §4): the server side of the filter
 * panel and the REST equivalent of the `search_cards` tool.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor } from '../auth/request.js';
import { fromZod } from '../lib/errors.js';
import { idSchema } from '../contracts/common.js';
import { searchCards } from './service.js';

const querySchema = z
  .object({
    q: z.string().max(200).optional(),
    assignee: z.string().max(64).optional(),
    tags: z.string().max(400).optional(),
    done: z.enum(['true', 'false']).optional(),
    column: idSchema('col').optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    cursor: z.string().max(200).optional(),
  })
  .strict();

export function registerSearchRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  app.get('/api/v1/boards/:id/search', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    // `request.query` is a parsed object on Fastify; coercing numbers and the
    // closed enums here keeps a bad filter a 400 that names the field.
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) throw fromZod(parsed.error);
    const { q, assignee, tags, done, column } = parsed.data;
    return searchCards(database(), actor, id, {
      query: q,
      assignee,
      tags: tags === undefined || tags === '' ? undefined : tags.split(','),
      done: done === undefined ? undefined : done === 'true',
      column,
    });
  });
}
