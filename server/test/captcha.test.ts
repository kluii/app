// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K3-07 — Cap behind a threshold, off by default (D-46).
 *
 * The test stands up the smallest possible Cap-shaped server instead of mocking
 * `fetch`: the contract Klui expects from a Cap instance is exactly what the
 * stub answers, and a mocked client would prove only that the mock was called.
 * The threshold is 1 so the second write is the one that must present a token.
 */
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';
import { anonLimiter } from '../src/anon/limits.js';
import type { Db } from '../src/db.js';
import { setLegacyPolicy } from './helpers/legacy.js';
import { startServer, type TestClient } from './helpers/server.js';

let stub: Server;
let stubUrl = '';
const seen: { token: string; authorization: string | undefined }[] = [];

beforeAll(async () => {
  stub = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    request.on('end', () => {
      const parsed = JSON.parse(body || '{}') as { token?: string };
      seen.push({
        token: parsed.token ?? '',
        authorization: request.headers.authorization,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ success: parsed.token === 'good-token' }));
    });
  });
  await new Promise<void>((resolve) => {
    stub.listen(0, '127.0.0.1', () => resolve());
  });
  const address = stub.address();
  if (address === null || typeof address === 'string') throw new Error('no stub port');
  stubUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    stub.close((error) => (error ? reject(error) : resolve()));
  });
});

type Board = { id: string; visibility: string; anon_write: string };

async function openBoard(c: TestClient, db: Db): Promise<Board> {
  await c.signup(`cap-owner-${c.suffix}`);
  const created = await c.request('POST', '/api/v1/boards', {
    name: 'Captcha board',
    visibility: 'link',
  });
  const id = (created.json() as { id: string }).id;
  const patched = await c.request('PATCH', `/api/v1/boards/${id}`, { link_role: 'read' });
  // A legacy row keeps the join gate open; the write it used to allow is gone.
  await setLegacyPolicy(db, id, { anonWrite: 'open' });
  return patched.json() as Board;
}

class Visitor {
  private cookie: string | null = null;

  constructor(readonly client: TestClient) {}

  async join(boardId: string): Promise<number> {
    const response = await this.client.app.inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/anon`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ label: 'Human' }),
    });
    const header = response.headers['set-cookie'];
    const raw = Array.isArray(header) ? header[0] : header;
    const pair = raw?.split(';')[0];
    if (pair?.startsWith('klui_anon=')) this.cookie = pair;
    return response.statusCode;
  }

  async create(
    boardId: string,
    column: string,
    capToken?: string,
  ): Promise<{ statusCode: number; code: string | null }> {
    const payload: Record<string, unknown> = { column, title: 'Written by a human' };
    if (capToken !== undefined) payload.cap_token = capToken;
    const response = await this.client.app.inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/cards`,
      headers: {
        ...(this.cookie === null ? {} : { cookie: this.cookie }),
        'content-type': 'application/json',
      },
      payload: JSON.stringify(payload),
    });
    const body = JSON.parse(response.body) as { error?: { code: string } };
    return { statusCode: response.statusCode, code: body.error?.code ?? null };
  }

  async firstColumn(boardId: string): Promise<string> {
    const response = await this.client.app.inject({
      method: 'GET',
      url: `/api/v1/boards/${boardId}/state`,
      headers: this.cookie === null ? {} : { cookie: this.cookie },
    });
    const body = JSON.parse(response.body) as { columns: { id: string }[] };
    const column = body.columns[0];
    if (!column) throw new Error('board has no column');
    return column.id;
  }
}

describe('the captcha gate', () => {
  let harness: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    harness = await startServer({
      env: {
        KLUI_CAPTCHA_ENABLED: true,
        KLUI_CAPTCHA_URL: stubUrl,
        KLUI_CAPTCHA_SECRET: 'cap-secret',
        KLUI_CAPTCHA_THRESHOLD: 1,
      },
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(() => {
    anonLimiter.clear();
    seen.length = 0;
  });

  it('never challenges a write it would refuse: no anonymous write is left to gate', async () => {
    const board = await openBoard(harness.client(), harness.db);
    const visitor = new Visitor(harness.client());
    expect(await visitor.join(board.id)).toBe(200);
    const column = await visitor.firstColumn(board.id);

    // The gate sits behind `can()`: a write that can never be accepted is
    // refused before a token is asked for, and no request leaves the instance.
    const refused = await visitor.create(board.id, column, 'good-token');
    expect(refused.statusCode).toBe(403);
    expect(refused.code).toBe('forbidden');
    expect(seen).toHaveLength(0);
  });

  it('refuses to boot with the captcha enabled and no instance URL', () => {
    const result = loadEnv({
      KLUI_ENV: 'development',
      DATABASE_URL: 'postgresql://klui:klui@127.0.0.1:5432/klui',
      KLUI_CAPTCHA_ENABLED: 'true',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.variable)).toContain('KLUI_CAPTCHA_URL');
  });

  it('refuses the write on an instance with no captcha, with no challenge either way', async () => {
    const plain = await startServer();
    try {
      anonLimiter.clear();
      const board = await openBoard(plain.client(), plain.db);
      const visitor = new Visitor(plain.client());
      expect(await visitor.join(board.id)).toBe(200);
      const column = await visitor.firstColumn(board.id);
      for (let index = 0; index < 3; index += 1) {
        const response = await visitor.create(board.id, column);
        expect(response.statusCode).toBe(403);
        expect(response.code).toBe('forbidden');
      }
    } finally {
      await plain.close();
    }
  });
});
