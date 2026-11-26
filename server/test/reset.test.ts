// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K1-05: password reset, fail-closed. The three ways this feature lies in the
 * wild are covered here: pretending to send without SMTP, accepting a used
 * token twice, and leaving the old sessions alive after a reset.
 */
import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMailer, recordingMailer, type Mail } from '../src/lib/mail.js';
import { resetThrottleForTests } from '../src/auth/reset.js';
import { testEnv, type Env } from '../src/env.js';
import { makeApp } from './helpers/app.js';
import { startServer, TestClient } from './helpers/server.js';

const mailer = recordingMailer();
let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer({ mail: mailer });
});

afterAll(async () => {
  await harness.close();
});

function lastMail(): Mail {
  const mail = mailer.sent[mailer.sent.length - 1];
  if (!mail) throw new Error('nothing was sent');
  return mail;
}

function tokenFrom(mail: Mail): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(mail.text);
  if (!match?.[1]) throw new Error('no token in the mail');
  return match[1];
}

describe('the reset endpoint without SMTP', () => {
  it('answers 503 email_not_configured instead of pretending to send', async () => {
    const app = makeApp({ env: { KLUI_SMTP_HOST: null, KLUI_SMTP_FROM: null }, db: harness.db });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset/request',
        payload: { email: 'anyone@example.com' },
        headers: { 'content-type': 'application/json' },
      });
      expect(response.statusCode).toBe(503);
      expect((response.json() as { error: { code: string } }).error.code).toBe(
        'email_not_configured',
      );
    } finally {
      await app.close();
    }
  });
});

describe('the reset flow', () => {
  it('always answers 202, even for an address that does not exist', async () => {
    resetThrottleForTests();
    const c = harness.client();
    const response = await c.request('POST', '/api/v1/auth/reset/request', {
      email: 'nobody-here@example.com',
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'accepted' });
  });

  it('mails a single-use token that revokes every session on use', async () => {
    resetThrottleForTests();
    const c = harness.client();
    const user = await c.signup(`reset-${c.suffix}`);

    const requested = await c.request('POST', '/api/v1/auth/reset/request', {
      email: `${user.username}@example.com`,
    });
    expect(requested.statusCode).toBe(202);
    const token = tokenFrom(lastMail());

    // The old session still works until the reset is confirmed.
    expect((await c.request('GET', '/api/v1/me')).statusCode).toBe(200);

    const confirmed = await c.request('POST', '/api/v1/auth/reset/confirm', {
      token,
      password: 'a-brand-new-passphrase',
    });
    expect(confirmed.statusCode).toBe(200);

    // Every session is gone: the old cookie is a stranger now.
    expect((await c.request('GET', '/api/v1/me')).statusCode).toBe(401);

    const reused = await harness.client().request('POST', '/api/v1/auth/reset/confirm', {
      token,
      password: 'another-new-passphrase',
    });
    expect(reused.statusCode).toBe(400);
    expect((reused.json() as { error: { code: string } }).error.code).toBe('invalid_code');

    const fresh = new TestClient(harness.app, harness.db);
    const oldPassword = await fresh.request('POST', '/api/v1/auth/login', {
      email_or_username: user.username,
      password: 'a-long-enough-password',
    });
    expect(oldPassword.statusCode).toBe(401);

    const newPassword = await fresh.request('POST', '/api/v1/auth/login', {
      email_or_username: user.username,
      password: 'a-brand-new-passphrase',
    });
    expect(newPassword.statusCode).toBe(200);
  });

  it('retires the previous token when a second reset is requested', async () => {
    resetThrottleForTests();
    const c = harness.client();
    const user = await c.signup(`retire-${c.suffix}`);

    await c.request('POST', '/api/v1/auth/reset/request', {
      email: `${user.username}@example.com`,
    });
    const first = tokenFrom(lastMail());
    await c.request('POST', '/api/v1/auth/reset/request', {
      email: `${user.username}@example.com`,
    });
    const second = tokenFrom(lastMail());

    const stale = await harness.client().request('POST', '/api/v1/auth/reset/confirm', {
      token: first,
      password: 'a-brand-new-passphrase',
    });
    expect(stale.statusCode).toBe(400);

    const live = await harness.client().request('POST', '/api/v1/auth/reset/confirm', {
      token: second,
      password: 'a-brand-new-passphrase',
    });
    expect(live.statusCode).toBe(200);
  });

  it('throttles repeated requests for the same account', async () => {
    resetThrottleForTests();
    const c = harness.client();
    const user = await c.signup(`throttle-${c.suffix}`);
    const email = `${user.username}@example.com`;

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await c.request('POST', '/api/v1/auth/reset/request', { email });
      statuses.push(response.statusCode);
    }
    expect(statuses).toEqual([202, 202, 202, 429]);
  });

  it('lets an instance admin issue a link for an account, and nobody else', async () => {
    resetThrottleForTests();
    const admin = harness.client();
    const adminUser = await admin.signup(`admin-${admin.suffix}`);
    await harness.db.user.update({
      where: { id: adminUser.id },
      data: { is_instance_admin: true },
    });
    const member = harness.client();
    const target = await member.signup(`target-${member.suffix}`);

    const stranger = await member.request('POST', `/api/v1/admin/users/${target.id}/reset`);
    expect(stranger.statusCode).toBe(403);

    const asAdmin = await admin.request('POST', `/api/v1/admin/users/${target.id}/reset`);
    expect(asAdmin.statusCode).toBe(201);
    const body = asAdmin.json() as { url: string; expires_at: string };
    expect(body.url).toContain('/reset?token=');
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('the SMTP transport', () => {
  it('is null when the instance cannot send', () => {
    const unset = testEnv({ KLUI_SMTP_HOST: null, KLUI_SMTP_FROM: null });
    expect(createMailer(unset)).toBeNull();
  });

  it('speaks enough SMTP for a real message', async () => {
    const conversations: string[] = [];
    const server: Server = createServer((socket) => {
      let buffer = '';
      socket.write('220 fake.localhost ESMTP\r\n');
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        if (buffer.includes('\r\n.\r\n')) {
          conversations.push(buffer);
          buffer = '';
          socket.write('250 queued\r\n');
          return;
        }
        const lines = buffer.split('\r\n').filter((line) => line !== '');
        const last = lines[lines.length - 1] ?? '';
        if (last.startsWith('EHLO')) socket.write('250-fake.localhost\r\n250 AUTH PLAIN\r\n');
        else if (last.startsWith('MAIL FROM')) socket.write('250 ok\r\n');
        else if (last.startsWith('RCPT TO')) socket.write('250 ok\r\n');
        else if (last === 'DATA') socket.write('354 go ahead\r\n');
        else if (last === 'QUIT') socket.write('221 bye\r\n');
        else socket.write('502 not implemented\r\n');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    const env: Env = testEnv({
      KLUI_SMTP_HOST: '127.0.0.1',
      KLUI_SMTP_PORT: address.port,
      KLUI_SMTP_FROM: 'klui@example.com',
    });
    const transport = createMailer(env);
    if (!transport) throw new Error('the mailer was not configured');

    try {
      await transport.send({
        to: 'reader@example.com',
        subject: 'Reset your Klui password',
        text: 'Open http://localhost/reset?token=abc',
      });
      const message = conversations.join('');
      expect(message).toContain('MAIL FROM');
      expect(message).toContain('RCPT TO:<reader@example.com>');
      expect(message).toContain('Subject: Reset your Klui password');
      expect(message).toContain('token=abc');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
