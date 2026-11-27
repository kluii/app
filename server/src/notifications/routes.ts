// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Account-scoped notification endpoints (docs/features/digest.md §1, K5-04).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireUser } from '../auth/request.js';
import { fromZod } from '../lib/errors.js';
import {
  NOTIFICATION_KINDS,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  readNotificationPrefs,
  updateNotificationPrefs,
} from './service.js';

const kindSchema = z.enum(NOTIFICATION_KINDS);

const patchPrefsSchema = z
  .object({
    muted_kinds: z.array(kindSchema).max(NOTIFICATION_KINDS.length).optional(),
    webhook_url: z.string().trim().url().max(500).nullable().optional(),
  })
  .strict();

export function registerNotificationRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  app.get('/api/v1/me/notifications', async (request) => {
    const userId = requireUser(request);
    const rawLimit = (request.query as { limit?: string }).limit;
    const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 50;
    return listNotifications(database(), userId, Number.isFinite(limit) ? limit : 50);
  });

  app.post('/api/v1/me/notifications/:id/read', async (request, reply) => {
    const userId = requireUser(request);
    const { id } = request.params as { id: string };
    await markNotificationRead(database(), userId, id);
    return reply.code(204).send();
  });

  app.post('/api/v1/me/notifications/read-all', async (request, reply) => {
    const userId = requireUser(request);
    await markAllNotificationsRead(database(), userId);
    return reply.code(204).send();
  });

  app.get('/api/v1/me/notifications/prefs', async (request) => {
    const userId = requireUser(request);
    return readNotificationPrefs(database(), userId);
  });

  app.patch('/api/v1/me/notifications/prefs', async (request) => {
    const userId = requireUser(request);
    const parsed = patchPrefsSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    return updateNotificationPrefs(database(), userId, parsed.data);
  });
}
