// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K5-04 — in-app notifications, per-type mute, deduplication by event_id, and
 * webhook delivery without retry storms (docs/features/digest.md §1, ROADMAP.md K5-04).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startServer } from './helpers/server.js';

type NotificationList = {
  items: {
    id: string;
    kind: string;
    event_id: string | null;
    payload: Record<string, unknown>;
    read_at: string | null;
    created_at: string;
  }[];
  unread_count: number;
};

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer();
});

afterAll(async () => {
  await harness.close();
});

describe('notifications (K5-04)', () => {
  it('notifies on invitation, assignment and mention, tracks unread count and marks read', async () => {
    const owner = harness.client();
    const teammate = harness.client();
    const ownerName = `notif-owner-${owner.suffix}`;
    const mateName = `notif-mate-${teammate.suffix}`;
    await owner.signup(ownerName);
    await teammate.signup(mateName);

    const board = await owner.request('POST', '/api/v1/boards', { name: 'Notif board' });
    const boardId = (board.json() as { id: string }).id;
    const state = await owner.request('GET', `/api/v1/boards/${boardId}/state`);
    const columnId = (state.json() as { columns: { id: string }[] }).columns[0]?.id ?? '';

    // 1. Invitation notification
    const invited = await owner.request('POST', `/api/v1/boards/${boardId}/members`, {
      username: mateName,
      role: 'editor',
    });
    expect(invited.statusCode).toBe(201);

    // 2. Assignment notification
    const card = await owner.request('POST', `/api/v1/boards/${boardId}/cards`, {
      column: columnId,
      title: 'Assigned card',
      assignee: mateName,
    });
    expect(card.statusCode).toBe(201);
    const cardId = (card.json() as { id: string }).id;

    // 3. Mention notification in comment
    const comment = await owner.request('POST', `/api/v1/cards/${cardId}/comments`, {
      body: `Hey @${mateName} please review this.`,
    });
    expect(comment.statusCode).toBe(201);

    const list = await teammate.request('GET', '/api/v1/me/notifications');
    expect(list.statusCode).toBe(200);
    const body = list.json() as NotificationList;
    expect(body.unread_count).toBe(3);
    expect(body.items.map((item) => item.kind).sort()).toEqual([
      'assignment',
      'invitation',
      'mention',
    ]);

    // Mark one read → unread_count drops to 2.
    const firstId = body.items[0]?.id ?? '';
    const markedOne = await teammate.request(
      'POST',
      `/api/v1/me/notifications/${firstId}/read`,
      {},
    );
    expect(markedOne.statusCode).toBe(204);
    const afterOne = (
      await teammate.request('GET', '/api/v1/me/notifications')
    ).json() as NotificationList;
    expect(afterOne.unread_count).toBe(2);

    // Mark all read → unread_count drops to 0.
    const markedAll = await teammate.request('POST', '/api/v1/me/notifications/read-all', {});
    expect(markedAll.statusCode).toBe(204);
    const afterAllRead = (
      await teammate.request('GET', '/api/v1/me/notifications')
    ).json() as NotificationList;
    expect(afterAllRead.unread_count).toBe(0);
  });

  it('deduplicates by (user_id, kind, event_id): the same event delivered twice notifies once', async () => {
    const { notify } = await import('../src/notifications/service.js');
    const user = harness.client();
    const created = await user.signup(`notif-dedup-${user.suffix}`);
    const eventId = `evt_dedup_${user.suffix}`;

    const first = await notify(harness.db, {
      userId: created.id,
      kind: 'assignment',
      eventId,
      payload: { card_id: 'crd_1', title: 'Once only' },
    });
    const second = await notify(harness.db, {
      userId: created.id,
      kind: 'assignment',
      eventId,
      payload: { card_id: 'crd_1', title: 'Once only' },
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.duplicate).toBe(true);

    const list = (await user.request('GET', '/api/v1/me/notifications')).json() as NotificationList;
    expect(list.items.filter((item) => item.event_id === eventId)).toHaveLength(1);
  });

  it('respects per-type mute and logs a single failed delivery for an unconfigured or failing webhook (no retry storm)', async () => {
    const { notify, deliverNotificationWebhook } = await import('../src/notifications/service.js');
    const user = harness.client();
    const created = await user.signup(`notif-mute-${user.suffix}`);

    // Mute 'mention' via API.
    const muted = await user.request('PATCH', '/api/v1/me/notifications/prefs', {
      muted_kinds: ['mention'],
    });
    expect(muted.statusCode).toBe(200);
    expect((muted.json() as { muted_kinds: string[] }).muted_kinds).toEqual(['mention']);

    const suppressed = await notify(harness.db, {
      userId: created.id,
      kind: 'mention',
      eventId: `evt_muted_${user.suffix}`,
      payload: { body_excerpt: 'should be muted' },
    });
    expect(suppressed.created).toBe(false);
    expect(suppressed.muted).toBe(true);

    // Unconfigured webhook logs exactly one failed delivery, zero outbound fetch calls, no retry storm.
    const warnings: string[] = [];
    const fetchSpy = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const unconfigured = await deliverNotificationWebhook(
        harness.db,
        created.id,
        { kind: 'assignment', payload: { title: 'Test' } },
        { warn: (obj: unknown, msg?: string) => warnings.push(msg ?? JSON.stringify(obj)) },
      );
      expect(unconfigured.delivered).toBe(false);
      expect(unconfigured.attempts).toBe(0);
      expect(fetchSpy).toHaveBeenCalledTimes(0);
      expect(warnings).toHaveLength(1);

      // Configured failing webhook makes one delivery attempt, logs one failure, no storm.
      warnings.length = 0;
      await user.request('PATCH', '/api/v1/me/notifications/prefs', {
        webhook_url: 'https://hooks.example.com/broken',
      });
      const failed = await deliverNotificationWebhook(
        harness.db,
        created.id,
        { kind: 'assignment', payload: { title: 'Test' } },
        { warn: (obj: unknown, msg?: string) => warnings.push(msg ?? JSON.stringify(obj)) },
      );
      expect(failed.delivered).toBe(false);
      expect(failed.attempts).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(warnings).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * H2 — a webhook URL is an SSRF primitive if the server fetches it blindly: any
 * signed-in account could aim it at an internal HTTPS service. The rule is
 * applied on write and again at send time, because a stored row can predate it.
 */
describe('notification webhook targets (SSRF guard)', () => {
  const INTERNAL_TARGETS = [
    'http://hooks.example.com/insecure',
    'https://localhost/hook',
    'https://localhost./hook',
    'https://api.localhost/hook',
    'https://intranet/hook',
    'https://printer.local/hook',
    'https://metadata.internal/hook',
    'https://127.0.0.1/hook',
    'https://127.9.9.9/hook',
    'https://[::1]/hook',
    'https://10.1.2.3/hook',
    'https://172.16.4.5/hook',
    'https://192.168.0.10/hook',
    'https://169.254.169.254/latest/meta-data/',
    'https://[fe80::1]/hook',
    'https://[fc00::1]/hook',
    'https://0.0.0.0/hook',
    'https://user:pass@hooks.example.com/hook',
  ];

  it('refuses a private, loopback, link-local or local-name target on PATCH /me/notifications/prefs', async () => {
    const user = harness.client();
    const created = await user.signup(`notif-ssrf-${user.suffix}`);

    for (const target of INTERNAL_TARGETS) {
      const refused = await user.request('PATCH', '/api/v1/me/notifications/prefs', {
        webhook_url: target,
      });
      expect(refused.statusCode, target).toBe(400);
      expect((refused.json() as { error: { code: string } }).error.code, target).toBe(
        'validation_failed',
      );
    }

    const stored = await harness.db.notificationPref.findUnique({
      where: { user_id: created.id },
    });
    expect(stored?.webhook_url ?? null).toBeNull();

    // A public https target is still accepted.
    const accepted = await user.request('PATCH', '/api/v1/me/notifications/prefs', {
      webhook_url: 'https://hooks.example.com/services/public',
    });
    expect(accepted.statusCode).toBe(200);
    expect((accepted.json() as { webhook_url: string }).webhook_url).toBe(
      'https://hooks.example.com/services/public',
    );
  });

  it('skips a stored row that points inside the network at send time, without a fetch', async () => {
    const { deliverNotificationWebhook } = await import('../src/notifications/service.js');
    const user = harness.client();
    const created = await user.signup(`notif-stored-${user.suffix}`);

    // Written straight to the table: the row predates the rule.
    await harness.db.notificationPref.upsert({
      where: { user_id: created.id },
      create: { user_id: created.id, webhook_url: 'https://127.0.0.1:9000/internal' },
      update: { webhook_url: 'https://127.0.0.1:9000/internal' },
    });

    const warnings: string[] = [];
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const result = await deliverNotificationWebhook(
        harness.db,
        created.id,
        { kind: 'assignment', payload: { title: 'Internal target' } },
        { warn: (obj: unknown, msg?: string) => warnings.push(msg ?? JSON.stringify(obj)) },
      );
      expect(result.delivered).toBe(false);
      expect(result.attempts).toBe(0);
      expect(fetchSpy).toHaveBeenCalledTimes(0);
      expect(warnings).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
