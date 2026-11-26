// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Instance administration over REST. Every handler re-checks the admin role
 * from the database, not from a token claim: an admin role removed a second ago
 * must stop working on the next request.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { AppError, fromZod } from '../lib/errors.js';
import { requireUser } from '../auth/request.js';
import { banUserSchema } from '../contracts/admin.js';
import { banUser, listUsers, unbanUser } from './service.js';

export function registerAdminRoutes(app: FastifyInstance, context: AppContext): void {
  const database = () => {
    if (!context.db)
      throw new AppError('internal', { message: 'database is required', hint: null });
    return context.db;
  };

  app.get('/api/v1/admin/users', async (request) => {
    const adminId = requireUser(request);
    const query = request.query as { cursor?: string; q?: string };
    const page = await listUsers(database(), adminId, {
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.q ? { query: query.q } : {}),
    });
    return page;
  });

  app.post('/api/v1/admin/users/:id/ban', async (request, reply) => {
    const adminId = requireUser(request);
    const parsed = banUserSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const { id } = request.params as { id: string };
    const result = await banUser(database(), adminId, id, parsed.data);
    return reply.code(201).send(result);
  });

  app.delete('/api/v1/admin/users/:id/ban', async (request, reply) => {
    const adminId = requireUser(request);
    const { id } = request.params as { id: string };
    await unbanUser(database(), adminId, id);
    return reply.code(204).send();
  });
}
