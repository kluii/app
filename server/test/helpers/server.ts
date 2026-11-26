// SPDX-License-Identifier: AGPL-3.0-only
import type { LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.js';
import { testEnv, type Env } from '../../src/env.js';
import { createHub } from '../../src/realtime/events.js';
import { ensureInstanceSettings } from '../../src/auth/service.js';
import { testDatabaseUrl, testDb } from './db.js';
import type { Db } from '../../src/db.js';
import type { Mailer } from '../../src/lib/mail.js';

export const TEST_SECRETS = {
  sessionSecret: 'test-session-secret-that-is-long-enough',
  tokenPepper: 'test-token-pepper-value',
  encryptionKey: Buffer.alloc(32, 9),
};

export async function startServer(
  options: { mail?: Mailer | null; env?: Partial<Env> } = {},
): Promise<{
  app: ReturnType<typeof buildApp>;
  db: Db;
  client: () => TestClient;
  close: () => Promise<void>;
}> {
  const db = testDb();
  // The boot creates the settings row; the test harness must mirror the boot.
  const env = testEnv({
    DATABASE_URL: testDatabaseUrl(),
    KLUI_PUBLIC_URL: 'http://localhost:8099',
    ...options.env,
  });
  await ensureInstanceSettings(db, env);
  const app = buildApp({
    env,
    db,
    secrets: TEST_SECRETS,
    hub: createHub(),
    ...(options.mail === undefined ? {} : { mail: options.mail }),
  });
  await app.ready();
  return {
    app,
    db,
    client: () => new TestClient(app, db),
    close: async () => {
      await app.close();
      await db.$disconnect();
    },
  };
}

let counter = 0;

export class TestClient {
  readonly app: ReturnType<typeof buildApp>;
  readonly db: Db;
  session: string | null = null;
  csrf: string | null = null;
  readonly suffix: string;

  constructor(app: ReturnType<typeof buildApp>, db: Db) {
    this.app = app;
    this.db = db;
    counter += 1;
    this.suffix = `${Date.now().toString(36)}${counter}`.slice(-10);
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    const cookies: string[] = [];
    if (this.session) cookies.push(`klui_session=${this.session}`);
    if (this.csrf) cookies.push(`klui_csrf=${this.csrf}`);
    return {
      ...(cookies.length > 0 ? { cookie: cookies.join('; ') } : {}),
      ...(this.csrf ? { 'x-klui-csrf': this.csrf } : {}),
      ...extra,
    };
  }

  absorb(response: LightMyRequestResponse): void {
    const cookies = response.cookies as { name: string; value: string }[];
    for (const cookie of cookies) {
      if (cookie.name === 'klui_session' && cookie.value !== '') this.session = cookie.value;
      if (cookie.name === 'klui_csrf' && cookie.value !== '') this.csrf = cookie.value;
    }
  }

  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    const response = await this.app.inject({
      method,
      url,
      headers: {
        ...this.headers(extraHeaders),
        ...(payload ? { 'content-type': 'application/json' } : {}),
      },
      ...(payload ? { payload: JSON.stringify(payload) } : {}),
    });
    this.absorb(response);
    return response;
  }

  async signup(username = `user-${this.suffix}`): Promise<{ id: string; username: string }> {
    const response = await this.request('POST', '/api/v1/auth/signup', {
      email: `${username}@example.com`,
      username,
      password: 'a-long-enough-password',
    });
    if (response.statusCode !== 201) {
      throw new Error(`signup failed: ${response.statusCode} ${response.body}`);
    }
    const body = response.json() as { id: string; username: string };
    return body;
  }
}
