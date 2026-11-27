// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K5-06 — optional LLM digest rewrite layer (docs/features/digest.md §2.5, §4).
 *
 * - `KLUI_DIGEST_LLM_URL` unset: zero outbound calls, deterministic digest ships.
 * - `KLUI_DIGEST_LLM_URL` set: receives only the computed payload (header +
 *   sections; never descriptions, comments, emails or ids), capped at 400 words.
 * - Any failure (garbage body, HTTP 500, empty string, > 400 words, network
 *   error) silently falls back to the deterministic text unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import { startServer } from './helpers/server.js';
import { recordingMailer } from '../src/lib/mail.js';
import { buildDigest } from '../src/digest/build.js';
import { runDueDigests } from '../src/digest/service.js';

const WEB_DIR = new URL('./fixtures/web', import.meta.url).pathname;
const LLM_URL = 'https://llm.example.com/v1/chat/completions';
const WEBHOOK = 'https://hooks.example.com/digest-llm';

async function seedCardWithDescription(
  client: ReturnType<Awaited<ReturnType<typeof startServer>>['client']>,
  description: string,
) {
  const board = await client.request('POST', '/api/v1/boards', { name: 'LLM board' });
  const boardId = (board.json() as { id: string }).id;
  const state = await client.request('GET', `/api/v1/boards/${boardId}/state`);
  const columnId = (state.json() as { columns: { id: string }[] }).columns[0]?.id ?? '';
  const card = await client.request('POST', `/api/v1/boards/${boardId}/cards`, {
    column: columnId,
    title: 'Ship optional rewriter',
    description,
  });
  const cardId = (card.json() as { id: string }).id;
  await client.request('PATCH', `/api/v1/cards/${cardId}`, { done: true });
}

describe('optional LLM digest layer (K5-06)', () => {
  it('makes zero outbound HTTP calls when KLUI_DIGEST_LLM_URL is unset', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const mailer = recordingMailer();
    const harness = await startServer({
      webDir: WEB_DIR,
      mail: mailer,
      env: { KLUI_DIGEST_LLM_URL: null, KLUI_DIGEST_LLM_KEY: null },
    });
    try {
      const client = harness.client();
      await client.signup(`digest-nollm-${client.suffix}`);
      await seedCardWithDescription(client, 'Secret description never leaves the box.');
      await client.request('PATCH', '/api/v1/me/digest', {
        enabled: true,
        email: `digest-nollm-${client.suffix}@example.com`,
      });

      const tested = await client.request('POST', '/api/v1/me/digest/test', {});
      expect(tested.statusCode).toBe(200);
      expect((tested.json() as { sent: boolean }).sent).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(0);
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.text).toContain('Ship optional rewriter');
    } finally {
      vi.unstubAllGlobals();
      await harness.close();
    }
  });

  it('delivers the deterministic text unchanged when the LLM endpoint returns garbage', async () => {
    const delivered: string[] = [];
    const llmCalls: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { body?: string }) => {
        if (String(url) === LLM_URL) {
          llmCalls.push(1);
          return new Response('<<< totally broken garbage not json >>>', {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          });
        }
        const payload = JSON.parse(String(init?.body ?? '{}')) as { content: string };
        delivered.push(payload.content);
        return new Response(null, { status: 204 });
      }),
    );

    const harness = await startServer({
      webDir: WEB_DIR,
      env: { KLUI_DIGEST_LLM_URL: LLM_URL, KLUI_DIGEST_LLM_KEY: 'sk-test-key' },
    });
    try {
      const client = harness.client();
      await client.signup(`digest-garbage-${client.suffix}`);
      await seedCardWithDescription(client, 'Private notes.');
      await client.request('PATCH', '/api/v1/me/digest', { enabled: true, webhook: WEBHOOK });

      const tested = await client.request('POST', '/api/v1/me/digest/test', {});
      expect(tested.statusCode).toBe(200);
      expect(llmCalls.length).toBeGreaterThanOrEqual(1);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toContain('Klui · LLM board');
      expect(delivered[0]).toContain('Done (1)');
      expect(delivered[0]).toContain('- Ship optional rewriter');
    } finally {
      vi.unstubAllGlobals();
      await harness.close();
    }
  });

  it('falls back to deterministic text when the LLM exceeds 400 words or fails', async () => {
    const tooLong = Array.from({ length: 405 }, (_, index) => `word${index}`).join(' ');
    const delivered: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { body?: string }) => {
        if (String(url) === LLM_URL) {
          return new Response(JSON.stringify({ choices: [{ message: { content: tooLong } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        const payload = JSON.parse(String(init?.body ?? '{}')) as { content: string };
        delivered.push(payload.content);
        return new Response(null, { status: 204 });
      }),
    );

    const harness = await startServer({
      webDir: WEB_DIR,
      env: { KLUI_DIGEST_LLM_URL: LLM_URL, KLUI_DIGEST_LLM_KEY: 'sk-test-key' },
    });
    try {
      const client = harness.client();
      await client.signup(`digest-long-${client.suffix}`);
      await seedCardWithDescription(client, 'Private notes.');
      await client.request('PATCH', '/api/v1/me/digest', { enabled: true, webhook: WEBHOOK });

      const tested = await client.request('POST', '/api/v1/me/digest/test', {});
      expect(tested.statusCode).toBe(200);
      expect(delivered[0]).toContain('Done (1)');
      expect(delivered[0]).not.toContain('word400');
    } finally {
      vi.unstubAllGlobals();
      await harness.close();
    }
  });

  it('sends only computed sections to the LLM (never descriptions or emails) and delivers rewritten text', async () => {
    const llmRequests: { auth: string | null; body: string }[] = [];
    const delivered: string[] = [];
    const rewritten = 'Today on LLM board: Ship optional rewriter was completed.';

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
        if (String(url) === LLM_URL) {
          llmRequests.push({
            auth: init?.headers?.authorization ?? init?.headers?.Authorization ?? null,
            body: String(init?.body ?? ''),
          });
          return new Response(JSON.stringify({ choices: [{ message: { content: rewritten } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        const payload = JSON.parse(String(init?.body ?? '{}')) as { content: string };
        delivered.push(payload.content);
        return new Response(null, { status: 204 });
      }),
    );

    const harness = await startServer({
      webDir: WEB_DIR,
      env: { KLUI_DIGEST_LLM_URL: LLM_URL, KLUI_DIGEST_LLM_KEY: 'sk-secret-llm' },
    });
    try {
      await harness.db.digestPref.updateMany({
        where: { enabled: true },
        data: { enabled: false },
      });
      const client = harness.client();
      const email = `digest-ok-${client.suffix}@example.com`;
      await client.signup(`digest-ok-${client.suffix}`);
      const secretDescription = 'TOP_SECRET_CARD_DESCRIPTION_NEVER_SEND';
      await seedCardWithDescription(client, secretDescription);
      await client.request('PATCH', '/api/v1/me/digest', {
        enabled: true,
        hour: 9,
        timezone: 'UTC',
        webhook: WEBHOOK,
        email,
      });

      const run = await runDueDigests(harness.db, {
        env: harness.env,
        mail: null,
        now: new Date('2026-11-27T09:00:00Z'),
      });
      expect(run.sent).toBe(1);
      expect(llmRequests).toHaveLength(1);
      expect(llmRequests[0]?.auth).toBe('Bearer sk-secret-llm');
      expect(llmRequests[0]?.body).toContain('Ship optional rewriter');
      expect(llmRequests[0]?.body).not.toContain(secretDescription);
      expect(llmRequests[0]?.body).not.toContain(email);
      expect(delivered).toEqual([rewritten]);
    } finally {
      vi.unstubAllGlobals();
      await harness.close();
    }
  });

  it('never calls the LLM for an empty digest', async () => {
    const digest = buildDigest({
      userId: 'usr_empty',
      now: new Date('2026-11-27T09:00:00Z'),
      timezone: 'UTC',
      since: null,
      events: [],
      cards: [],
    });
    expect(digest.empty).toBe(true);
  });
});
