// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Event-driven notifications (docs/features/digest.md §1, K5-04).
 *
 * Notifications are account-scoped, deduplicated on `(user_id, kind, event_id)`
 * in Postgres, individually mutable per type, and optionally mirrored to an
 * HTTPS webhook for assignment and mention events. A broken or unconfigured
 * webhook logs a single failure and never enters a retry storm.
 */
import { isIP } from 'node:net';
import { Prisma } from '@prisma/client';
import type { Db } from '../db.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';

export const NOTIFICATION_KINDS = [
  'assignment',
  'mention',
  'due_soon',
  'moderation_pending',
  'invitation',
  'board_closed',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

const WEBHOOK_KINDS = new Set<NotificationKind>(['assignment', 'mention']);
const MAX_WEBHOOK_FAILURES = 10;

export type NotificationLogger = {
  warn: (obj: unknown, msg?: string) => void;
};

export type NotificationDto = {
  id: string;
  kind: string;
  event_id: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type NotificationPrefDto = {
  muted_kinds: NotificationKind[];
  webhook_url: string | null;
  failures: number;
};

export type NotifyResult = {
  created: boolean;
  muted?: boolean;
  duplicate?: boolean;
  id?: string;
};

export type WebhookDeliveryResult = {
  delivered: boolean;
  attempts: number;
};

function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

function parseMutedKinds(raw: unknown): NotificationKind[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<NotificationKind>();
  for (const item of raw) {
    if (isNotificationKind(item)) unique.add(item);
  }
  return [...unique];
}

function invalidWebhookUrl(message: string, detail: string): AppError {
  return new AppError('validation_failed', {
    message,
    hint: 'Point the webhook at a public https endpoint you control.',
    details: [{ path: 'webhook_url', code: 'custom', message: detail }],
  });
}

/** Loopback, private, link-local and "this network": never a webhook target. */
function isInternalIpv4(octets: readonly number[]): boolean {
  const a = octets[0] ?? 0;
  const b = octets[1] ?? 0;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * IPv6 literal already canonicalized by the URL parser: zeros compressed and
 * hex lowercased, so the textual prefixes below are stable.
 */
function isInternalIpv6(address: string): boolean {
  if (address === '::' || address === '::1') return true;

  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(address);
  if (mapped) {
    const hi = Number.parseInt(mapped[1] ?? '0', 16);
    const lo = Number.parseInt(mapped[2] ?? '0', 16);
    return isInternalIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  }

  const first = Number.parseInt(address.split(':')[0] ?? '', 16);
  if (!Number.isInteger(first)) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  return false;
}

/**
 * Refuse a webhook target that points inside the network.
 *
 * Called on write and again before every delivery, because a stored row can
 * predate the rule. https only, no credentials in the URL, and no host that is a
 * local name or an internal address literal.
 *
 * Residual risk, accepted by this change: the guard reads the URL, not the DNS
 * answer, so a public hostname that resolves to a private address (a cooperating
 * domain, or a rebinding record) is still reachable, and a public host can still
 * redirect inward. Closing that needs a resolve-then-pin fetch — resolve, check
 * every returned address, connect to the pinned address and refuse redirects —
 * which is a separate change.
 */
export function assertPublicWebhookUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalidWebhookUrl('A webhook URL must be an absolute https URL.', 'unparseable URL');
  }
  if (url.protocol !== 'https:') {
    throw invalidWebhookUrl('A webhook URL must be https.', 'expected the https scheme');
  }
  if (url.username !== '' || url.password !== '') {
    throw invalidWebhookUrl('A webhook URL must not carry credentials.', 'credentials in the URL');
  }

  // The URL parser keeps a trailing root dot (`localhost.`) and the brackets
  // around an IPv6 literal; the guard has to see the bare host.
  const bracketed = url.hostname.toLowerCase();
  const host = bracketed.endsWith('.') ? bracketed.slice(0, -1) : bracketed;
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  const version = isIP(bare);
  if (version !== 0) {
    const internal =
      version === 4 ? isInternalIpv4(bare.split('.').map(Number)) : isInternalIpv6(bare);
    if (internal) {
      throw invalidWebhookUrl(
        'A webhook URL must not point at a loopback, private or link-local address.',
        'internal address literal',
      );
    }
    return;
  }

  if (
    bare === 'localhost' ||
    bare.endsWith('.localhost') ||
    bare.endsWith('.local') ||
    bare.endsWith('.internal') ||
    !bare.includes('.')
  ) {
    throw invalidWebhookUrl(
      'A webhook URL must name a public host.',
      'local or single-label hostname',
    );
  }
}

function formatWebhookText(kind: NotificationKind, payload: Record<string, unknown>): string {
  const title = typeof payload.title === 'string' ? payload.title : null;
  const excerpt = typeof payload.body_excerpt === 'string' ? payload.body_excerpt : null;
  const boardName = typeof payload.board_name === 'string' ? payload.board_name : null;
  switch (kind) {
    case 'assignment':
      return title ? `Klui: Assigned to card "${title}"` : 'Klui: You were assigned a card.';
    case 'mention':
      return excerpt
        ? `Klui: Mentioned in a comment — ${excerpt}`
        : 'Klui: You were mentioned in a comment.';
    case 'due_soon':
      return title
        ? `Klui: Card "${title}" is due within 24 hours.`
        : 'Klui: A card is due within 24 hours.';
    case 'moderation_pending':
      return title
        ? `Klui: Pending card "${title}" awaits approval.`
        : 'Klui: A pending card awaits approval.';
    case 'invitation':
      return boardName
        ? `Klui: Invited to board "${boardName}".`
        : 'Klui: You were invited to a board.';
    case 'board_closed':
      return boardName ? `Klui: Board "${boardName}" was closed.` : 'Klui: A board was closed.';
  }
}

export async function deliverNotificationWebhook(
  db: Db,
  userId: string,
  notification: { kind: NotificationKind; payload: Record<string, unknown> },
  logger?: NotificationLogger,
): Promise<WebhookDeliveryResult> {
  const pref = await db.notificationPref.findUnique({ where: { user_id: userId } });
  if (!pref || pref.webhook_url === null) {
    logger?.warn(
      { user_id: userId, kind: notification.kind },
      'notification webhook delivery skipped: webhook not configured',
    );
    return { delivered: false, attempts: 0 };
  }

  // A row written before the host rule existed must not become a request now.
  try {
    assertPublicWebhookUrl(pref.webhook_url);
  } catch {
    logger?.warn(
      { user_id: userId, kind: notification.kind },
      'notification webhook delivery skipped: target is not a public https URL',
    );
    return { delivered: false, attempts: 0 };
  }

  const text = formatWebhookText(notification.kind, notification.payload);
  try {
    const response = await fetch(pref.webhook_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Discord reads `content` + `username`, Slack reads `text`.
      body: JSON.stringify({ content: text, text, username: 'Klui' }),
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      if (pref.failures > 0) {
        await db.notificationPref.update({
          where: { user_id: userId },
          data: { failures: 0 },
        });
      }
      return { delivered: true, attempts: 1 };
    }
    const failures = pref.failures + 1;
    await db.notificationPref.update({
      where: { user_id: userId },
      data: {
        failures,
        ...(failures >= MAX_WEBHOOK_FAILURES ? { webhook_url: null } : {}),
      },
    });
    logger?.warn(
      { user_id: userId, kind: notification.kind, status: response.status, failures },
      'notification webhook delivery failed',
    );
    return { delivered: false, attempts: 1 };
  } catch (error) {
    const failures = pref.failures + 1;
    await db.notificationPref.update({
      where: { user_id: userId },
      data: {
        failures,
        ...(failures >= MAX_WEBHOOK_FAILURES ? { webhook_url: null } : {}),
      },
    });
    logger?.warn(
      {
        user_id: userId,
        kind: notification.kind,
        err: error instanceof Error ? error.message : String(error),
        failures,
      },
      'notification webhook delivery failed',
    );
    return { delivered: false, attempts: 1 };
  }
}

export async function notify(
  db: Db,
  input: {
    userId: string;
    kind: NotificationKind;
    eventId?: string | null;
    payload: Record<string, unknown>;
    logger?: NotificationLogger;
  },
): Promise<NotifyResult> {
  const pref = await db.notificationPref.findUnique({ where: { user_id: input.userId } });
  const muted = parseMutedKinds(pref?.muted_kinds);
  if (muted.includes(input.kind)) {
    return { created: false, muted: true };
  }

  try {
    const row = await db.notification.create({
      data: {
        id: newId('not'),
        user_id: input.userId,
        kind: input.kind,
        event_id: input.eventId ?? null,
        payload: input.payload as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    if (pref?.webhook_url && WEBHOOK_KINDS.has(input.kind)) {
      void deliverNotificationWebhook(
        db,
        input.userId,
        { kind: input.kind, payload: input.payload },
        input.logger,
      ).catch(() => {
        // Delivery errors are already logged inside deliverNotificationWebhook.
      });
    }

    return { created: true, id: row.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { created: false, duplicate: true };
    }
    throw error;
  }
}

/** Notify assignees of open cards due within the next 24 hours; deduplicated per card + UTC day. */
export async function notifyDueSoon(db: Db, now = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const cards = await db.card.findMany({
    where: {
      done: false,
      assignee_id: { not: null },
      due_at: { gte: now, lte: horizon },
      board: { closed_at: null },
    },
    select: { id: true, board_id: true, title: true, due_at: true, assignee_id: true },
  });
  let created = 0;
  for (const card of cards) {
    if (!card.assignee_id || !card.due_at) continue;
    const day = card.due_at.toISOString().slice(0, 10);
    const result = await notify(db, {
      userId: card.assignee_id,
      kind: 'due_soon',
      eventId: `due_soon:${card.id}:${day}`,
      payload: {
        board_id: card.board_id,
        card_id: card.id,
        title: card.title,
        due_at: card.due_at.toISOString(),
      },
    });
    if (result.created) created += 1;
  }
  return created;
}

export async function listNotifications(
  db: Db,
  userId: string,
  limit = 50,
): Promise<{ items: NotificationDto[]; unread_count: number }> {
  const capped = Math.min(100, Math.max(1, limit));
  const [rows, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { user_id: userId },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: capped,
    }),
    db.notification.count({
      where: { user_id: userId, read_at: null },
    }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      event_id: row.event_id,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      read_at: row.read_at ? row.read_at.toISOString() : null,
      created_at: row.created_at.toISOString(),
    })),
    unread_count: unreadCount,
  };
}

export async function markNotificationRead(db: Db, userId: string, id: string): Promise<void> {
  const existing = await db.notification.findFirst({
    where: { id, user_id: userId },
    select: { id: true, read_at: true },
  });
  if (!existing) {
    throw new AppError('not_found', { message: 'Notification not found.', hint: null });
  }
  if (existing.read_at === null) {
    await db.notification.update({
      where: { id },
      data: { read_at: new Date() },
    });
  }
}

export async function markAllNotificationsRead(db: Db, userId: string): Promise<void> {
  await db.notification.updateMany({
    where: { user_id: userId, read_at: null },
    data: { read_at: new Date() },
  });
}

export async function readNotificationPrefs(db: Db, userId: string): Promise<NotificationPrefDto> {
  const pref = await db.notificationPref.findUnique({ where: { user_id: userId } });
  return {
    muted_kinds: parseMutedKinds(pref?.muted_kinds),
    webhook_url: pref?.webhook_url ?? null,
    failures: pref?.failures ?? 0,
  };
}

export async function updateNotificationPrefs(
  db: Db,
  userId: string,
  input: { muted_kinds?: NotificationKind[]; webhook_url?: string | null },
): Promise<NotificationPrefDto> {
  if (input.webhook_url !== undefined && input.webhook_url !== null) {
    assertPublicWebhookUrl(input.webhook_url);
  }
  const muted = input.muted_kinds === undefined ? undefined : [...new Set(input.muted_kinds)];
  const data = {
    ...(muted === undefined ? {} : { muted_kinds: muted }),
    ...(input.webhook_url === undefined ? {} : { webhook_url: input.webhook_url, failures: 0 }),
  };
  const row = await db.notificationPref.upsert({
    where: { user_id: userId },
    create: {
      user_id: userId,
      muted_kinds: muted ?? [],
      webhook_url: input.webhook_url ?? null,
    },
    update: data,
  });
  return {
    muted_kinds: parseMutedKinds(row.muted_kinds),
    webhook_url: row.webhook_url,
    failures: row.failures,
  };
}

/** Extract lowercased unique `@username` mentions from a comment body. */
export function extractMentions(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/(?:^|[\s(])@([a-z0-9][a-z0-9_-]{1,31})\b/gi)) {
    const username = match[1]?.toLowerCase();
    if (username) found.add(username);
  }
  return [...found];
}
