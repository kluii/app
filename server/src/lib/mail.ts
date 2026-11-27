// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Outbound mail, and the reason there is no "pretend success" path: with SMTP
 * unset the reset endpoint answers `503 email_not_configured` instead of
 * accepting a request it cannot fulfil (docs/features/auth.md §6).
 *
 * The transport is a small SMTP client rather than a dependency: the protocol
 * surface Klui needs is EHLO + AUTH PLAIN + MAIL + RCPT + DATA + QUIT, and a
 * mail library would be the largest server dependency in the image.
 */
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import type { Env } from '../env.js';

export type Mail = { to: string; subject: string; text: string };

export type Mailer = {
  send(mail: Mail): Promise<void>;
  /** For the admin UI and the logs: never contains a credential. */
  describe: () => string;
};

export type SmtpConfig = {
  host: string;
  port: number;
  user: string | null;
  pass: string | null;
  from: string;
};

export function smtpConfig(env: Env): SmtpConfig | null {
  if (!env.KLUI_SMTP_HOST || !env.KLUI_SMTP_FROM) return null;
  return {
    host: env.KLUI_SMTP_HOST,
    port: env.KLUI_SMTP_PORT,
    user: env.KLUI_SMTP_USER,
    pass: env.KLUI_SMTP_PASS,
    from: env.KLUI_SMTP_FROM,
  };
}

const TIMEOUT_MS = 10_000;

type Reply = { code: number; lines: string[] };

/**
 * A reply may be multiline (`250-` continuations then `250 `). We read until a
 * line whose fourth character is a space, which is the whole of what EHLO needs.
 */
function readReply(socket: Socket | TLSSocket, buffer: { value: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('smtp timeout')), TIMEOUT_MS);
    const finish = (error?: Error, reply?: Reply) => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      if (error) reject(error);
      else if (reply) resolve(reply);
    };
    const onError = (error: Error) => finish(error);
    const onData = (chunk: Buffer) => {
      buffer.value += chunk.toString('utf8');
      const lines = buffer.value.split('\r\n').filter((line) => line !== '');
      const last = lines[lines.length - 1];
      if (last === undefined || last.length < 4) return;
      if (last[3] === '-') return;
      buffer.value = '';
      finish(undefined, { code: Number(last.slice(0, 3)), lines });
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

function command(
  socket: Socket | TLSSocket,
  buffer: { value: string },
  line: string,
): Promise<Reply> {
  socket.write(`${line}\r\n`);
  return readReply(socket, buffer);
}

function expect(reply: Reply, codes: number[], what: string): void {
  if (!codes.includes(reply.code)) {
    throw new Error(`${what}: ${reply.lines.join(' ')}`);
  }
}

function dotStuff(body: string): string {
  return body
    .replace(/\r?\n/g, '\r\n')
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

async function upgrade(socket: Socket, host: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const secure = tlsConnect({ socket, servername: host }, () => resolve(secure));
    secure.on('error', reject);
  });
}

async function deliver(config: SmtpConfig, mail: Mail): Promise<void> {
  const implicitTls = config.port === 465;
  const socket: Socket | TLSSocket = implicitTls
    ? await new Promise<TLSSocket>((resolve, reject) => {
        const secure = tlsConnect({ host: config.host, port: config.port }, () => resolve(secure));
        secure.on('error', reject);
      })
    : await new Promise<Socket>((resolve, reject) => {
        const plain = netConnect({ host: config.host, port: config.port }, () => resolve(plain));
        plain.on('error', reject);
      });

  const buffer = { value: '' };
  try {
    expect(await readReply(socket, buffer), [220], 'greeting');
    let active: Socket | TLSSocket = socket;

    const ehlo = await command(active, buffer, `EHLO klui`);
    expect(ehlo, [250], 'ehlo');

    // STARTTLS only when the server advertised it, and port 465 is already
    // implicit TLS: announcing a capability is not the same as accepting it.
    const offersStartTls = ehlo.lines.some((line) => line.slice(4) === 'STARTTLS');
    if (!implicitTls && offersStartTls) {
      expect(await command(active, buffer, 'STARTTLS'), [220], 'starttls');
      active = await upgrade(socket, config.host);
      expect(await command(active, buffer, 'EHLO klui'), [250], 'ehlo after starttls');
    }

    if (config.user && config.pass) {
      const token = Buffer.from(`\u0000${config.user}\u0000${config.pass}`, 'utf8').toString(
        'base64',
      );
      expect(await command(active, buffer, `AUTH PLAIN ${token}`), [235], 'auth');
    }

    expect(await command(active, buffer, `MAIL FROM:<${config.from}>`), [250], 'mail from');
    expect(await command(active, buffer, `RCPT TO:<${mail.to}>`), [250, 251], 'rcpt to');
    expect(await command(active, buffer, 'DATA'), [354], 'data');

    const body = [
      `From: ${config.from}`,
      `To: ${mail.to}`,
      `Subject: ${mail.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      mail.text,
    ].join('\r\n');
    active.write(`${dotStuff(body)}\r\n.\r\n`);
    expect(await readReply(active, buffer), [250], 'message body');
    await command(active, buffer, 'QUIT');
  } finally {
    socket.end();
  }
}

export function createMailer(env: Env): Mailer | null {
  const config = smtpConfig(env);
  if (!config) return null;
  return {
    describe: () => `${config.host}:${config.port}`,
    send: (mail) => deliver(config, mail),
  };
}

/** A mailer that records instead of sending: used by the tests, never by the server. */
export function recordingMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return {
    sent,
    describe: () => 'recording',
    send: async (mail) => {
      sent.push(mail);
    },
  };
}
