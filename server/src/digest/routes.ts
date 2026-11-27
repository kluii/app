// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The digest over HTTP (docs/api.md §7, docs/features/digest.md §2).
 *
 * Two of these routes carry a credential in the URL — the RSS feed and the
 * unsubscribe link — and both are the reason the tokens are hashed at rest,
 * `noindex`, and never logged. The feed answers without a session because a feed
 * reader has none; the unsubscribe link answers without one because the point of
 * one click is that it works when the session has expired.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor, requireUser } from '../auth/request.js';
import { AppError, fromZod } from '../lib/errors.js';
import { digestUpdateSchema } from '../contracts/digest.js';
import { escapeHtml } from '../public/meta.js';
import {
  deliverDigest,
  digestFeed,
  digestFor,
  readDigestPref,
  unsubscribe,
  updateDigestPref,
} from './service.js';

export function registerDigestRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db)
      throw new AppError('internal', { message: 'database is required', hint: null });
    return context.db;
  };

  app.get('/api/v1/me/digest', async (request) => {
    const userId = requireUser(request);
    return readDigestPref(database(), userId);
  });

  app.patch('/api/v1/me/digest', async (request) => {
    const userId = requireUser(request);
    const actor = requireActor(request);
    const parsed = digestUpdateSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    return updateDigestPref(database(), {
      userId,
      actor,
      pepper: context.secrets.tokenPepper,
      publicUrl: context.env.KLUI_PUBLIC_URL,
      update: parsed.data,
    });
  });

  /**
   * The real thing, for the account's own eyes: build the digest from the log
   * and deliver it to the configured channel. An empty digest says so and sends
   * nothing, which is the same rule the scheduler follows.
   */
  app.post('/api/v1/me/digest/test', async (request) => {
    const userId = requireUser(request);
    const db = database();
    const pref = await db.digestPref.findUnique({ where: { user_id: userId } });
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true, username: true },
    });
    if (!user) throw new AppError('not_found', { message: 'Not found.', hint: null });

    const digest = await digestFor(db, {
      userId,
      now: new Date(),
      timezone: pref?.timezone ?? 'UTC',
      since: pref?.last_sent_at ?? null,
    });
    if (digest.empty) return { sent: false, reason: 'empty' };

    if (pref === null || (pref.webhook_url === null && pref.email === null)) {
      throw new AppError('validation_failed', {
        message: 'No channel is configured for this digest.',
        hint: 'Set a webhook or an email address first: a test with nowhere to send is not a test.',
        details: [{ path: 'webhook', code: 'custom', message: 'no channel configured' }],
      });
    }
    const mail = context.mail ?? null;
    if (pref.email !== null && mail === null && pref.webhook_url === null) {
      throw new AppError('email_not_configured');
    }
    const result = await deliverDigest({ mail, pref, digest });
    if (!result.ok) {
      if (result.error === 'email_not_configured') throw new AppError('email_not_configured');
      throw new AppError('service_unavailable', {
        message: 'The digest could not be delivered.',
        hint: result.error,
      });
    }
    return {
      sent: true,
      sections: digest.sections.length,
      bytes: Buffer.byteLength(digest.text, 'utf8'),
    };
  });

  app.get('/api/v1/me/digest/rss/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const feed = await digestFeed(database(), { token, pepper: context.secrets.tokenPepper });
    if (!feed) throw new AppError('not_found', { message: 'Not found.', hint: null });
    reply
      .type('application/rss+xml; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('x-robots-tag', 'noindex');
    return rssXml(feed);
  });

  app.get('/api/v1/me/digest/unsubscribe/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const done = await unsubscribe(database(), { token, pepper: context.secrets.tokenPepper });
    if (!done) throw new AppError('not_found', { message: 'Not found.', hint: null });
    reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('x-robots-tag', 'noindex');
    return UNSUBSCRIBED_PAGE;
  });
}

/**
 * One item, the digest that was sent. A feed of what happened is not this
 * feature: this is the digest the account already received, kept for a reader.
 */
export function rssXml(feed: { username: string; text: string; sentAt: Date }): string {
  const title = escapeHtml(`Klui digest — ${feed.username}`);
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0"><channel>',
    `<title>${title}</title>`,
    '<link>/</link>',
    '<description>The daily digest, computed from the event log.</description>',
    '<item>',
    `<title>${escapeHtml(feed.text.split('\n')[0] ?? 'Digest')}</title>`,
    `<pubDate>${feed.sentAt.toUTCString()}</pubDate>`,
    `<description>${escapeHtml(feed.text)}</description>`,
    '</item>',
    '</channel></rss>',
  ].join('\n');
}

/** No JavaScript, no redirect, no second click: the link is the action. */
const UNSUBSCRIBED_PAGE = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<meta name="robots" content="noindex">',
  '<title>Unsubscribed — Klui</title></head>',
  '<body><main style="max-width:32rem;margin:4rem auto;font-family:system-ui;padding:0 1rem">',
  '<h1>You are unsubscribed.</h1>',
  '<p>The digest is off for this account. Nothing is deleted, and signing in turns it back on.</p>',
  '</main></body></html>',
].join('');
