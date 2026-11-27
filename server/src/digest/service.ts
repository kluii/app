// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The digest's storage and delivery (docs/features/digest.md §2–§3).
 *
 * `build.ts` decides what the digest says; this file decides when it is sent,
 * through which channel, and what the account's settings are. The scheduling
 * state is `last_sent_at` and nothing else: a failed delivery does not advance
 * it, so a broken webhook retries instead of silently skipping a day, and ten
 * consecutive failures disable the channel rather than hammering it forever.
 */
import type { Db } from '../db.js';
import type { Actor } from '../lib/authz.js';
import type { Env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { recordEvent } from '../lib/events.js';
import { base62 } from '../lib/ids.js';
import { hashToken } from '../lib/hash.js';
import type { Mailer } from '../lib/mail.js';
import { Prisma } from '@prisma/client';
import {
  buildDigest,
  hourIn,
  isTimezone,
  sameDayIn,
  type Digest,
  type DigestCard,
  type DigestEvent,
} from './build.js';
import { rewriteDigest } from './llm.js';

const MAX_FAILURES = 10;

export type DigestChannels = { webhook: boolean; email: boolean; rss: boolean };

export type DigestDto = {
  enabled: boolean;
  hour: number;
  timezone: string;
  channels: DigestChannels;
  last_sent_at: string | null;
  /** What the last run found: `sent`, `empty`, or null before the first run. */
  last_result: 'sent' | 'empty' | null;
  /** Only present in the response that rotated the token. */
  rss_url?: string;
  unsubscribe_url?: string;
};

export type DigestUpdate = {
  enabled?: boolean;
  hour?: number;
  timezone?: string;
  webhook?: string | null;
  email?: string | null;
  rss?: 'rotate' | 'disable';
};

function newToken(): string {
  return base62(32);
}

function absolute(publicUrl: string | null, path: string): string {
  return publicUrl === null ? path : `${publicUrl.replace(/\/+$/u, '')}${path}`;
}

function dtoOf(
  pref: {
    enabled: boolean;
    hour: number;
    timezone: string;
    webhook_url: string | null;
    email: string | null;
    rss_token_hash: string | null;
    last_sent_at: Date | null;
    last_digest: unknown;
  },
  extra: { rss_url?: string; unsubscribe_url?: string } = {},
): DigestDto {
  const lastResult =
    pref.last_sent_at === null ? null : pref.last_digest === null ? 'empty' : 'sent';
  return {
    enabled: pref.enabled,
    hour: pref.hour,
    timezone: pref.timezone,
    channels: {
      webhook: pref.webhook_url !== null,
      email: pref.email !== null,
      rss: pref.rss_token_hash !== null,
    },
    last_sent_at: pref.last_sent_at?.toISOString() ?? null,
    last_result: lastResult,
    ...extra,
  };
}

export async function readDigestPref(db: Db, userId: string): Promise<DigestDto> {
  const pref = await db.digestPref.findUnique({ where: { user_id: userId } });
  if (!pref) {
    return {
      enabled: false,
      hour: 8,
      timezone: 'UTC',
      channels: { webhook: false, email: false, rss: false },
      last_sent_at: null,
      last_result: null,
    };
  }
  return dtoOf(pref);
}

/**
 * A settings write. `rss: 'rotate'` is the only way a token is ever returned:
 * it is hashed at rest like every credential in this repository, and the URL is
 * in this response and nowhere else.
 */
export async function updateDigestPref(
  db: Db,
  input: {
    userId: string;
    actor: Actor;
    pepper: string;
    publicUrl: string | null;
    update: DigestUpdate;
  },
): Promise<DigestDto> {
  const { update } = input;
  if (update.timezone !== undefined && !isTimezone(update.timezone)) {
    throw new AppError('validation_failed', {
      message: `"${update.timezone}" is not an IANA timezone.`,
      hint: 'Use a zone like Europe/Paris or America/New_York, not an offset.',
      details: [{ path: 'timezone', code: 'custom', message: 'expected an IANA zone' }],
    });
  }
  if (update.webhook !== undefined && update.webhook !== null) {
    if (!/^https:\/\//u.test(update.webhook)) {
      throw new AppError('validation_failed', {
        message: 'A webhook URL must be https.',
        hint: 'Discord and Slack both accept https webhooks only.',
        details: [{ path: 'webhook', code: 'custom', message: 'expected an https URL' }],
      });
    }
  }

  const existing = await db.digestPref.findUnique({ where: { user_id: input.userId } });
  const rotating = update.rss === 'rotate';
  const rssToken = rotating ? newToken() : null;
  const unsubscribeToken = rotating || existing === null ? newToken() : null;
  const data = {
    ...(update.enabled === undefined ? {} : { enabled: update.enabled }),
    ...(update.hour === undefined ? {} : { hour: update.hour }),
    ...(update.timezone === undefined ? {} : { timezone: update.timezone }),
    ...(update.webhook === undefined ? {} : { webhook_url: update.webhook }),
    ...(update.email === undefined ? {} : { email: update.email }),
    ...(rotating ? { rss_token_hash: hashToken(rssToken ?? '', input.pepper) } : {}),
    ...(update.rss === 'disable' ? { rss_token_hash: null } : {}),
    ...(unsubscribeToken === null
      ? {}
      : {
          unsubscribe_hash: hashToken(unsubscribeToken, input.pepper),
          // A failed token is not a failed channel: a rotate starts clean.
          failures: 0,
        }),
  };

  const pref = await db.$transaction(async (tx) => {
    const row = await tx.digestPref.upsert({
      where: { user_id: input.userId },
      create: { user_id: input.userId, ...data },
      update: data,
    });
    await recordEvent(tx, {
      boardId: null,
      actor: input.actor,
      type: 'digest.updated',
      payload: { changes: Object.keys(update) },
    });
    return row;
  });

  const extra: { rss_url?: string; unsubscribe_url?: string } = {};
  if (rssToken !== null) {
    extra.rss_url = absolute(input.publicUrl, `/api/v1/me/digest/rss/${rssToken}`);
  }
  if (unsubscribeToken !== null) {
    extra.unsubscribe_url = absolute(
      input.publicUrl,
      `/api/v1/me/digest/unsubscribe/${unsubscribeToken}`,
    );
  }
  return dtoOf(pref, extra);
}

/** One digest's worth of input for one account: the boards it can read, no more. */
export async function digestFor(
  db: Db,
  input: { userId: string; now: Date; timezone: string; since: Date | null },
): Promise<Digest> {
  const memberships = await db.boardMember.findMany({
    where: { user_id: input.userId },
    select: { board_id: true },
  });
  const boardIds = memberships.map((row) => row.board_id);
  if (boardIds.length === 0) {
    return buildDigest({
      userId: input.userId,
      now: input.now,
      timezone: input.timezone,
      since: input.since,
      events: [],
      cards: [],
    });
  }

  const [rows, events] = await Promise.all([
    db.card.findMany({
      where: { board_id: { in: boardIds } },
      include: {
        column: { select: { name: true } },
        board: { select: { name: true } },
      },
      orderBy: [{ due_at: 'asc' }, { id: 'asc' }],
    }),
    db.event.findMany({
      where: {
        board_id: { in: boardIds },
        ...(input.since === null ? {} : { created_at: { gt: input.since } }),
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: 2_000,
    }),
  ]);

  const cards: DigestCard[] = rows.map((row) => ({
    id: row.id,
    boardId: row.board_id,
    boardName: row.board.name,
    columnName: row.column.name,
    title: row.title,
    done: row.done,
    dueAt: row.due_at,
    assigneeId: row.assignee_id,
    assigneeLabel: row.assignee_label,
    position: row.position.toString(),
  }));
  const mapped: DigestEvent[] = events.map((row) => ({
    // The database stores `card_completed`; the log's own vocabulary is dotted.
    type: row.type.replaceAll('_', '.'),
    boardId: row.board_id,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    actorLabel: row.actor_label,
    createdAt: row.created_at,
  }));

  return buildDigest({
    userId: input.userId,
    now: input.now,
    timezone: input.timezone,
    since: input.since,
    events: mapped,
    cards,
  });
}

export type DeliveryResult = { ok: true } | { ok: false; error: string };

/**
 * The channels, in the order the document lists them. Webhook and email both
 * carry the same computed text; RSS reads what was stored, so it cannot drift
 * from what was sent.
 */
export async function deliverDigest(input: {
  mail: Mailer | null;
  pref: { webhook_url: string | null; email: string | null };
  digest: Digest;
}): Promise<DeliveryResult> {
  const { digest } = input;
  const sent: string[] = [];
  if (input.pref.webhook_url !== null) {
    try {
      const response = await fetch(input.pref.webhook_url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Discord reads `content`, Slack reads `text`: one payload, both clients.
        body: JSON.stringify({ content: digest.text, text: digest.text, username: 'Klui' }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return { ok: false, error: `webhook answered ${response.status}` };
      sent.push('webhook');
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'webhook failed' };
    }
  }
  const email = input.pref.email ?? null;
  if (email !== null) {
    if (input.mail === null) {
      if (sent.length === 0) return { ok: false, error: 'email_not_configured' };
    } else {
      try {
        await input.mail.send({ to: email, subject: digest.header, text: digest.text });
        sent.push('email');
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'email failed' };
      }
    }
  }
  if (sent.length === 0 && email === null && input.pref.webhook_url === null) {
    return { ok: false, error: 'no_channel' };
  }
  return { ok: true };
}

/**
 * The sweeper's job: every enabled account whose local hour has come and which
 * has not had a run today. An empty digest is a completed run that sends
 * nothing — `last_sent_at` advances so the account is not re-evaluated every
 * five minutes, and zero deliveries happen.
 */
export async function runDueDigests(
  db: Db,
  options: { env: Env; mail: Mailer | null; now?: Date },
): Promise<{ runs: number; sent: number }> {
  const now = options.now ?? new Date();
  const prefs = await db.digestPref.findMany({
    where: { enabled: true },
    include: { user: { select: { id: true, email: true } } },
  });

  let runs = 0;
  let sent = 0;
  for (const pref of prefs) {
    if (!isTimezone(pref.timezone)) continue;
    if (hourIn(pref.timezone, now) !== pref.hour) continue;
    if (pref.last_sent_at !== null && sameDayIn(pref.timezone, pref.last_sent_at, now)) continue;

    const computed = await digestFor(db, {
      userId: pref.user_id,
      now,
      timezone: pref.timezone,
      since: pref.last_sent_at,
    });
    runs += 1;

    if (computed.empty) {
      await db.digestPref.update({
        where: { user_id: pref.user_id },
        data: { last_sent_at: now, last_digest: Prisma.DbNull },
      });
      continue;
    }

    const digest = await rewriteDigest(computed, {
      url: options.env.KLUI_DIGEST_LLM_URL,
      apiKey: options.env.KLUI_DIGEST_LLM_KEY,
    });

    const result = await deliverDigest({ mail: options.mail, pref, digest });
    if (result.ok) {
      sent += 1;
      await db.digestPref.update({
        where: { user_id: pref.user_id },
        data: {
          last_sent_at: now,
          last_digest: {
            header: digest.header,
            text: digest.text,
            sections: digest.sections,
          },
          failures: 0,
        },
      });
      continue;
    }
    const failures = pref.failures + 1;
    await db.digestPref.update({
      where: { user_id: pref.user_id },
      data: { failures, ...(failures >= MAX_FAILURES ? { enabled: false } : {}) },
    });
  }
  return { runs, sent };
}

/** The RSS feed: what was actually sent, and nothing invented. */
export async function digestFeed(
  db: Db,
  input: { token: string; pepper: string },
): Promise<{ username: string; text: string; sentAt: Date } | null> {
  const hash = hashToken(input.token, input.pepper);
  const pref = await db.digestPref.findFirst({
    where: { rss_token_hash: hash },
    include: { user: { select: { username: true } } },
  });
  if (!pref || pref.last_digest === null || pref.last_sent_at === null) return null;
  const stored = pref.last_digest as { text?: unknown };
  if (typeof stored.text !== 'string') return null;
  return { username: pref.user.username, text: stored.text, sentAt: pref.last_sent_at };
}

/** One click, no sign-in, no account deletion: `enabled: false` and that is all. */
export async function unsubscribe(
  db: Db,
  input: { token: string; pepper: string },
): Promise<boolean> {
  const hash = hashToken(input.token, input.pepper);
  const pref = await db.digestPref.findFirst({ where: { unsubscribe_hash: hash } });
  if (!pref) return false;
  await db.digestPref.update({ where: { user_id: pref.user_id }, data: { enabled: false } });
  return true;
}
