// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Password reset over REST (docs/api.md §3): the request answers `202` whatever
 * the address, and `503 email_not_configured` when the instance cannot send.
 * The admin path returns a one-time link for out-of-band delivery.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { AppError } from '../lib/errors.js';
import { requireUser } from './request.js';
import { localeOf } from '../i18n/index.js';
import { adminResetLink, confirmReset, requestReset } from './reset.js';

export function registerResetRoutes(app: FastifyInstance, context: AppContext): void {
  const database = () => {
    if (!context.db)
      throw new AppError('internal', { message: 'database is required', hint: null });
    return context.db;
  };

  app.post('/api/v1/auth/reset/request', async (request, reply) => {
    await requestReset(
      database(),
      context.env,
      context.secrets.tokenPepper,
      context.mail ?? null,
      request.body,
      // The link's reader is the account owner; the request's language is the
      // only signal the server has (K5-07).
      localeOf(request.headers['accept-language']),
    );
    return reply.code(202).send({ status: 'accepted' });
  });

  app.post('/api/v1/auth/reset/confirm', async (request, reply) => {
    await confirmReset(database(), context.secrets.tokenPepper, request.body);
    return reply.code(200).send({ status: 'reset' });
  });

  app.post('/api/v1/admin/users/:id/reset', async (request, reply) => {
    const userId = requireUser(request);
    const admin = await database().user.findUnique({
      where: { id: userId },
      select: { is_instance_admin: true },
    });
    if (!admin?.is_instance_admin) {
      throw new AppError('forbidden', {
        message: 'Only an instance admin can issue a reset link.',
        hint: null,
      });
    }
    const { id } = request.params as { id: string };
    const issued = await adminResetLink(database(), context.env, context.secrets.tokenPepper, id);
    reply.header('cache-control', 'no-store');
    return reply.code(201).send({
      url: issued.url,
      expires_at: issued.expires_at.toISOString(),
    });
  });
}
