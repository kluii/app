// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-10, the server half: `GET /api/v1/stream` over a real listening socket,
 * because an SSE response cannot be injected. What is proven here is what the
 * client depends on — the envelope, the silent omission of a board the actor
 * cannot read, replay from `Last-Event-ID`, and `resync` for an id the ring has
 * already dropped.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';

let harness: Awaited<ReturnType<typeof startServer>>;
let baseUrl = '';

beforeAll(async () => {
  harness = await startServer();
  await harness.app.listen({ port: 0, host: '127.0.0.1' });
  const address = harness.app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  // An SSE socket never goes idle: without this, `close` waits out the keep-alive.
  harness.app.server.closeAllConnections();
  await harness.close();
});

type Column = { id: string };

async function boardFor(c: TestClient): Promise<{ boardId: string; columnId: string }> {
  await c.signup(`live-${c.suffix}`);
  const created = await c.request('POST', '/api/v1/boards', { name: 'Live board' });
  expect(created.statusCode).toBe(201);
  const boardId = (created.json() as { id: string }).id;
  const state = await c.request('GET', `/api/v1/boards/${boardId}/state`);
  const column = (state.json() as { columns: Column[] }).columns[0];
  if (!column) throw new Error('no column');
  return { boardId, columnId: column.id };
}

async function addCard(c: TestClient, boardId: string, columnId: string, title: string) {
  const response = await c.request('POST', `/api/v1/boards/${boardId}/cards`, {
    column: columnId,
    title,
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

type Stream = {
  frames: () => string;
  waitFor: (predicate: (text: string) => boolean, label: string) => Promise<string>;
  close: () => void;
};

async function openStream(c: TestClient, query: string, lastEventId?: string): Promise<Stream> {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/v1/stream?${query}`, {
    headers: {
      cookie: `klui_session=${c.session ?? ''}`,
      accept: 'text/event-stream',
      ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
    },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  expect(response.headers.get('cache-control')).toBe('no-store');

  const reader = response.body?.getReader();
  if (!reader) throw new Error('no body');
  const decoder = new TextDecoder();
  let text = '';

  const pump = async (): Promise<void> => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      text += decoder.decode(value, { stream: true });
    }
  };
  void pump().catch(() => undefined);

  return {
    frames: () => text,
    async waitFor(predicate, label) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (predicate(text)) return text;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`timed out waiting for ${label}; got: ${text}`);
    },
    close: () => controller.abort(),
  };
}

describe('the stream', () => {
  it('opens with a comment, then carries a created card in the documented envelope', async () => {
    const c = harness.client();
    const { boardId, columnId } = await boardFor(c);
    const stream = await openStream(c, `board=${boardId}`);

    await stream.waitFor((text) => text.includes(': open'), 'the opening comment');
    await addCard(c, boardId, columnId, 'Streamed card');
    const frames = await stream.waitFor((text) => text.includes('event: card.created'), 'the card');

    const frame = frames
      .split('\n\n')
      .find((block) => block.includes('event: card.created') && block.includes('data: '));
    expect(frame).toBeDefined();
    const id = /^id: (\d+)$/m.exec(frame ?? '');
    expect(id?.[1]).toMatch(/^\d{16,}$/);
    const data = JSON.parse(/^data: (.+)$/m.exec(frame ?? '')?.[1] ?? '{}') as {
      board_id: string;
      entity: string;
      action: string;
      actor_label: string;
      at: string;
    };
    expect(data.board_id).toBe(boardId);
    expect(data.entity).toBe('card');
    expect(data.action).toBe('created');
    expect(data.actor_label).toBe('user');
    expect(Number.isNaN(Date.parse(data.at))).toBe(false);

    stream.close();
  });

  it('omits a board the actor cannot read instead of answering an error', async () => {
    const owner = harness.client();
    const { boardId, columnId } = await boardFor(owner);
    const stranger = harness.client();
    await stranger.signup(`stranger-${stranger.suffix}`);

    const stream = await openStream(stranger, `board=${boardId}`);
    await stream.waitFor((text) => text.includes(': open'), 'the opening comment');

    await addCard(owner, boardId, columnId, 'Not for you');
    // Give the hub a beat to publish, then assert nothing arrived for that board.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(stream.frames()).not.toContain('card.created');
    expect(stream.frames()).not.toContain(boardId);
    stream.close();
  });

  it('replays what arrived after Last-Event-ID, and only that', async () => {
    const c = harness.client();
    const { boardId, columnId } = await boardFor(c);

    const first = await openStream(c, `board=${boardId}`);
    await first.waitFor((text) => text.includes(': open'), 'open');
    const beforeCard = await addCard(c, boardId, columnId, 'Before the disconnect');
    const before = await first.waitFor(
      (text) => text.includes(beforeCard.id),
      'the frame for the first card',
    );
    const lastId = /^id: (\d+)$/m.exec(before.split('\n\n').find((b) => b.includes('id: ')) ?? '');
    const cursor = lastId?.[1];
    expect(cursor).toBeDefined();
    first.close();

    const laterCard = await addCard(c, boardId, columnId, 'While disconnected');

    const resumed = await openStream(c, `board=${boardId}`, cursor);
    const replayed = await resumed.waitFor(
      (text) => text.includes(laterCard.id),
      'the replayed frame',
    );
    expect(replayed).toContain(laterCard.id);
    expect(replayed).not.toContain(beforeCard.id);
    resumed.close();
  });

  it('asks for a resync when the id predates the buffer', async () => {
    const c = harness.client();
    const { boardId } = await boardFor(c);

    const stream = await openStream(c, `board=${boardId}`, '0000000000000000000001');
    await stream.waitFor((text) => text.includes('event: resync'), 'the resync frame');
    stream.close();
  });

  it('keeps the connection open on an unauthenticated request with no boards', async () => {
    // No session: no board is readable, so nothing can be published, but the
    // connection itself is still a valid empty subscription.
    const c = harness.client();
    const { boardId } = await boardFor(c);
    const stream = await openStream(c, `board=${boardId}&board=brd_doesnotexist00000000`);
    await stream.waitFor((text) => text.includes(': open'), 'open');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stream.frames()).not.toContain('brd_doesnotexist');
    stream.close();
  });
});
