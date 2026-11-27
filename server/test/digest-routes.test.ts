// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K5-05 — the digest over HTTP, and the scheduler behind it.
 *
 * The exits the roadmap names: a golden test on a fixed log (that is
 * `digest.test.ts`, on the pure builder), an empty digest performing zero sends,
 * an RSS token hashed at rest and `noindex`, and an unsubscribe link that works
 * without signing in.
 *
 * This file drives the real routes and the real database: the events are the
 * ones the API wrote, the cards are read the way an account reads them, and the
 * deliveries are counted rather than described.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';
import { runDueDigests } from '../src/digest/service.js';
import { recordingMailer } from '../src/lib/mail.js';
import { buildDigest } from '../src/digest/build.js';

const WEB_DIR = new URL('./fixtures/web', import.meta.url).pathname;
const WEBHOOK = 'https://hooks.example.com/digest';

type Board = { id: string };
type Card = { id: string; title: string };
type DigestDto = {
  enabled: boolean;
  hour: number;
  timezone: string;
  channels: { webhook: boolean; email: boolean; rss: boolean };
  last_sent_at: string | null;
  last_result: 'sent' | 'empty' | null;
  rss_url?: string;
  unsubscribe_url?: string;
};

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer({ webDir: WEB_DIR });
});

afterAll(async () => {
  await harness.close();
});

/**
 * A board with one open card and one done card, written through the API — the
 * events the digest reads are the ones the API wrote, not ones the test made up.
 * The client must already be signed in.
 */
async function seededBoard(
  client: TestClient,
): Promise<{ boardId: string; doneTitle: string; openTitle: string }> {
  const created = await client.request('POST', '/api/v1/boards', { name: 'Digest board' });
  const boardId = (created.json() as Board).id;
  const state = await client.request('GET', `/api/v1/boards/${boardId}/state`);
  const [column] = (state.json() as { columns: { id: string }[] }).columns;
  if (!column) throw new Error('no column');

  const doneTitle = `Done ${client.suffix}`;
  const openTitle = `Open ${client.suffix}`;
  const done = await client.request('POST', `/api/v1/boards/${boardId}/cards`, {
    column: column.id,
    title: doneTitle,
  });
  await client.request('PATCH', `/api/v1/cards/${(done.json() as Card).id}`, { done: true });
  await client.request('POST', `/api/v1/boards/${boardId}/cards`, {
    column: column.id,
    title: openTitle,
  });
  return { boardId, doneTitle, openTitle };
}

describe('the digest settings', () => {
  it('starts off, stores the hour and the zone, and refuses a bad zone', async () => {
    const client = harness.client();
    await client.signup(`digest-settings-${client.suffix}`);

    const initial = await client.request('GET', '/api/v1/me/digest');
    expect(initial.statusCode).toBe(200);
    expect((initial.json() as DigestDto).enabled).toBe(false);
    expect((initial.json() as DigestDto).hour).toBe(8);
    expect((initial.json() as DigestDto).timezone).toBe('UTC');

    const patched = await client.request('PATCH', '/api/v1/me/digest', {
      enabled: true,
      hour: 7,
      timezone: 'Europe/Paris',
      webhook: WEBHOOK,
    });
    expect(patched.statusCode).toBe(200);
    const body = patched.json() as DigestDto;
    expect(body.enabled).toBe(true);
    expect(body.hour).toBe(7);
    expect(body.timezone).toBe('Europe/Paris');
    expect(body.channels.webhook).toBe(true);

    const bad = await client.request('PATCH', '/api/v1/me/digest', { timezone: 'Mars/Olympus' });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: { details: { path: string }[] } }).error.details[0]?.path).toBe(
      'timezone',
    );

    const insecure = await client.request('PATCH', '/api/v1/me/digest', {
      webhook: 'http://hooks.example.com/x',
    });
    expect(insecure.statusCode).toBe(400);

    // An account-level URL must not aim the server inside its own network
    // (same rule as the notification webhook).
    for (const internal of [
      'https://127.0.0.1/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/hook',
      'https://intranet/hook',
    ]) {
      const refused = await client.request('PATCH', '/api/v1/me/digest', { webhook: internal });
      expect(refused.statusCode, internal).toBe(400);
      expect((refused.json() as { error: { code: string } }).error.code).toBe('validation_failed');
    }
  });

  it('rotates the RSS token once, hashes it, and stops the old URL', async () => {
    const client = harness.client();
    await client.signup(`digest-rss-${client.suffix}`);
    await seededBoard(client);

    const rotated = await client.request('PATCH', '/api/v1/me/digest', {
      enabled: true,
      rss: 'rotate',
    });
    expect(rotated.statusCode).toBe(200);
    const { rss_url: rssUrl, unsubscribe_url: unsubscribeUrl } = rotated.json() as DigestDto;
    expect(rssUrl).toBeTruthy();
    expect(unsubscribeUrl).toBeTruthy();
    const token = rssUrl?.split('/').pop() ?? '';

    // Hashed at rest: the row does not contain the credential.
    const row = await harness.db.digestPref.findUnique({
      where: { user_id: (await whoami(client)).id },
    });
    expect(row?.rss_token_hash).not.toContain(token);
    expect(row?.rss_token_hash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain(token);

    // A feed with nothing sent yet is a 404, not an empty feed.
    const before = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/me/digest/rss/${token}`,
    });
    expect(before.statusCode).toBe(404);

    // Rotate again: the first URL is dead immediately.
    const second = await client.request('PATCH', '/api/v1/me/digest', { rss: 'rotate' });
    const secondToken = (second.json() as DigestDto).rss_url?.split('/').pop() ?? '';
    expect(secondToken).not.toBe(token);
    const stale = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/me/digest/rss/${token}`,
    });
    expect(stale.statusCode).toBe(404);

    const disabled = await client.request('PATCH', '/api/v1/me/digest', { rss: 'disable' });
    expect((disabled.json() as DigestDto).channels.rss).toBe(false);
  });

  it('unsubscribes one click, without a session', async () => {
    const client = harness.client();
    await client.signup(`digest-unsub-${client.suffix}`);
    const rotated = await client.request('PATCH', '/api/v1/me/digest', {
      enabled: true,
      webhook: WEBHOOK,
    });
    const unsubscribeUrl = (rotated.json() as DigestDto).unsubscribe_url ?? '';
    expect(unsubscribeUrl).toContain('/api/v1/me/digest/unsubscribe/');

    // No cookie at all: the link is the credential.
    const response = await harness.app.inject({ method: 'GET', url: unsubscribeUrl });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['x-robots-tag']).toBe('noindex');
    expect(response.body).toContain('unsubscribed');

    const after = await client.request('GET', '/api/v1/me/digest');
    expect((after.json() as DigestDto).enabled).toBe(false);

    const unknown = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/me/digest/unsubscribe/not-a-token',
    });
    expect(unknown.statusCode).toBe(404);
  });
});

describe('the test send', () => {
  it('delivers to the webhook and reports what it carried', async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { body?: string }) => {
        calls.push({ url: String(url), body: String(init?.body ?? '') });
        return new Response(null, { status: 204 });
      }),
    );
    try {
      const client = harness.client();
      await client.signup(`digest-send-${client.suffix}`);
      await seededBoard(client);
      await client.request('PATCH', '/api/v1/me/digest', { enabled: true, webhook: WEBHOOK });

      const tested = await client.request('POST', '/api/v1/me/digest/test', {});
      expect(tested.statusCode).toBe(200);
      const body = tested.json() as { sent: boolean; sections: number; bytes: number };
      expect(body.sent).toBe(true);
      expect(body.sections).toBeGreaterThan(0);
      expect(body.bytes).toBeGreaterThan(0);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(WEBHOOK);
      const payload = JSON.parse(calls[0]?.body ?? '{}') as { content: string; text: string };
      expect(payload.content).toContain('Klui · Digest board');
      expect(payload.content).toContain('Done');
      expect(payload.text).toBe(payload.content);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sends nothing when the digest is empty, and says why', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return new Response(null, { status: 204 });
      }),
    );
    try {
      const client = harness.client();
      await client.signup(`digest-empty-${client.suffix}`);
      await client.request('PATCH', '/api/v1/me/digest', { enabled: true, webhook: WEBHOOK });

      const tested = await client.request('POST', '/api/v1/me/digest/test', {});
      expect(tested.statusCode).toBe(200);
      expect(tested.json()).toEqual({ sent: false, reason: 'empty' });
      expect(calls).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('delivers by email when SMTP is configured, with the digest as the subject', async () => {
    const mailer = recordingMailer();
    const withMail = await startServer({ webDir: WEB_DIR, mail: mailer });
    try {
      const client = withMail.client();
      await client.signup(`digest-mail-${client.suffix}`);
      const created = await client.request('POST', '/api/v1/boards', { name: 'Mailed board' });
      const boardId = (created.json() as Board).id;
      const state = await client.request('GET', `/api/v1/boards/${boardId}/state`);
      const [column] = (state.json() as { columns: { id: string }[] }).columns;
      if (!column) throw new Error('no column');
      const card = await client.request('POST', `/api/v1/boards/${boardId}/cards`, {
        column: column.id,
        title: `Mailed ${client.suffix}`,
      });
      await client.request('PATCH', `/api/v1/cards/${(card.json() as Card).id}`, { done: true });
      await client.request('PATCH', '/api/v1/me/digest', {
        enabled: true,
        email: `digest-mail-${client.suffix}@example.com`,
      });

      const tested = await client.request('POST', '/api/v1/me/digest/test', {});
      expect(tested.statusCode).toBe(200);
      expect((tested.json() as { sent: boolean }).sent).toBe(true);

      expect(mailer.sent).toHaveLength(1);
      const [mail] = mailer.sent;
      expect(mail?.to).toBe(`digest-mail-${client.suffix}@example.com`);
      expect(mail?.subject).toContain('Klui · Mailed board');
      expect(mail?.text).toContain(`Mailed ${client.suffix}`);
    } finally {
      await withMail.close();
    }
  });

  it('answers 503 when the only channel is email and SMTP is unset', async () => {
    // No mailer in this harness, which is what an instance without SMTP is.
    const client = harness.client();
    await client.signup(`digest-smtp-${client.suffix}`);
    await seededBoard(client);
    await client.request('PATCH', '/api/v1/me/digest', {
      enabled: true,
      email: `digest-smtp-${client.suffix}@example.com`,
    });
    const tested = await client.request('POST', '/api/v1/me/digest/test', {});
    expect(tested.statusCode).toBe(503);
    expect((tested.json() as { error: { code: string } }).error.code).toBe('email_not_configured');
  });
});

describe('the scheduler', () => {
  it('runs once at the account hour, delivers once, and not again that day', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return new Response(null, { status: 204 });
      }),
    );
    try {
      await onlyThisDigest();
      const client = harness.client();
      await client.signup(`digest-cron-${client.suffix}`);
      await seededBoard(client);
      await client.request('PATCH', '/api/v1/me/digest', {
        enabled: true,
        hour: 9,
        timezone: 'Europe/Paris',
        webhook: WEBHOOK,
      });

      // 08:00 UTC is 09:00 in Paris in November: the account's hour.
      const nine = new Date('2026-11-26T08:00:00Z');
      const first = await runDueDigests(harness.db, { env: harness.env, mail: null, now: nine });
      expect(first.sent).toBe(1);
      expect(calls).toHaveLength(1);

      const row = await harness.db.digestPref.findFirst({
        where: { user: { username: `digest-cron-${client.suffix}` } },
      });
      expect(row?.last_sent_at?.toISOString()).toBe(nine.toISOString());
      const stored = row?.last_digest as { text?: string } | null;
      expect(stored?.text).toContain('Klui · Digest board');

      // The same day, the same hour, later tick: nothing.
      const later = await runDueDigests(harness.db, {
        env: harness.env,
        mail: null,
        now: new Date('2026-11-26T08:05:00Z'),
      });
      expect(later.sent).toBe(0);
      expect(calls).toHaveLength(1);

      // The RSS feed now serves exactly what was delivered.
      const rotated = await client.request('PATCH', '/api/v1/me/digest', { rss: 'rotate' });
      const token = (rotated.json() as DigestDto).rss_url?.split('/').pop() ?? '';
      const feed = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/me/digest/rss/${token}`,
      });
      expect(feed.statusCode).toBe(200);
      expect(feed.headers['x-robots-tag']).toBe('noindex');
      expect(feed.body).toContain('Klui · Digest board');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('advances the clock on an empty digest and sends nothing', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return new Response(null, { status: 204 });
      }),
    );
    try {
      await onlyThisDigest();
      const client = harness.client();
      await client.signup(`digest-quiet-${client.suffix}`);
      await client.request('PATCH', '/api/v1/me/digest', {
        enabled: true,
        hour: 9,
        timezone: 'Europe/Paris',
        webhook: WEBHOOK,
      });
      const nine = new Date('2026-11-27T08:00:00Z');
      const run = await runDueDigests(harness.db, { env: harness.env, mail: null, now: nine });
      expect(run.runs).toBe(1);
      expect(run.sent).toBe(0);
      expect(calls).toEqual([]);
      const row = await harness.db.digestPref.findFirst({
        where: { user: { username: `digest-quiet-${client.suffix}` } },
      });
      expect(row?.last_sent_at?.toISOString()).toBe(nine.toISOString());
      expect(row?.last_digest).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the builder is what the message says', () => {
  it('has nothing to say about a log with no cards', () => {
    const digest = buildDigest({
      userId: 'usr_x',
      now: new Date('2026-11-26T09:00:00Z'),
      timezone: 'UTC',
      since: null,
      events: [],
      cards: [],
    });
    expect(digest.empty).toBe(true);
    expect(digest.text).toBe('');
  });
});

/**
 * The sweeper reads every enabled account on the instance, so a scheduler test
 * must be the only enabled one: the fixture database is shared with the other
 * files, and their accounts are not this test's business.
 */
async function onlyThisDigest(): Promise<void> {
  await harness.db.digestPref.updateMany({ where: { enabled: true }, data: { enabled: false } });
}

/** The account behind a client, for assertions that need the id. */
async function whoami(client: TestClient): Promise<{ id: string }> {
  const response = await client.request('GET', '/api/v1/me');
  return response.json() as { id: string };
}
