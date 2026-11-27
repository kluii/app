// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TOTP and recovery codes over REST (docs/api.md §3). Every handler requires a
 * session, an `Origin`-checked POST and the CSRF double submit: these are
 * credential changes, not reads.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { AppError, fromZod } from '../lib/errors.js';
import { requireUser } from './request.js';
import { confirmEnrollment, disable, enroll, regenerateRecoveryCodes, totpPolicy } from './totp.js';
import { totpDisableSchema, totpVerifySchema, recoveryCodesSchema } from '../contracts/auth.js';

export function registerTotpRoutes(app: FastifyInstance, context: AppContext): void {
  const database = () => {
    if (!context.db)
      throw new AppError('internal', { message: 'database is required', hint: null });
    return context.db;
  };

  const actor = async (request: Parameters<typeof requireUser>[0]) => {
    const userId = requireUser(request);
    const user = await database().user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, email: true },
    });
    if (!user) throw new AppError('unauthenticated');
    return user;
  };

  app.post('/api/v1/auth/totp/enroll', async (request, reply) => {
    const user = await actor(request);
    const db = database();
    const policy = await totpPolicy(db, context.env);
    const enrollment = await enroll(
      db,
      context.secrets,
      user,
      new URL(context.env.KLUI_PUBLIC_URL ?? 'http://localhost').hostname,
      policy,
    );
    reply.header('cache-control', 'no-store');
    return reply.code(201).send(enrollment);
  });

  app.post('/api/v1/auth/totp/verify', async (request) => {
    const user = await actor(request);
    const parsed = totpVerifySchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    return confirmEnrollment(database(), context.secrets, user, parsed.data.code);
  });

  app.post('/api/v1/auth/totp/disable', async (request) => {
    const user = await actor(request);
    const parsed = totpDisableSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    return disable(database(), context.secrets, user, parsed.data);
  });

  app.post('/api/v1/auth/recovery-codes', async (request, reply) => {
    const user = await actor(request);
    const parsed = recoveryCodesSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await regenerateRecoveryCodes(database(), user, parsed.data.password);
    reply.header('cache-control', 'no-store');
    return reply.code(201).send(result);
  });
}
