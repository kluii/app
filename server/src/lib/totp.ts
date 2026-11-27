// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TOTP (RFC 6238) on top of HOTP (RFC 4226), SHA-1, 6 digits, 30 s steps.
 *
 * Hand-written on `node:crypto` on purpose: the algorithm is 30 lines and the
 * alternative is a browser-shipped dependency that would need an ADR. The
 * vectors in `server/test/totp.test.ts` are the RFC's own.
 */
import { createHmac, randomBytes } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_SECRET_BYTES = 20;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31] ?? '';
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31] ?? '';
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of clean) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error('not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function timeStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
}

export function totp(secret: string, atMs: number = Date.now(), digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secret), timeStep(atMs), digits);
}

/** 20 random bytes, base32 — what every authenticator app expects. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

export function otpauthUrl(input: {
  secret: string;
  issuer: string;
  account: string;
  digits?: number;
  period?: number;
}): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(input.digits ?? TOTP_DIGITS),
    period: String(input.period ?? TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export type TotpVerification =
  { ok: true; step: number } | { ok: false; reason: 'invalid' | 'replay' };

/**
 * ±1 step of clock drift is accepted, and a step may be spent once: the caller
 * persists `step` as `last_step`, so a captured code cannot be replayed.
 */
export function verifyTotp(input: {
  secret: string;
  code: string;
  atMs?: number;
  window?: number;
  lastStep?: number | null;
}): TotpVerification {
  const code = input.code.trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'invalid' };

  const key = base32Decode(input.secret);
  const current = timeStep(input.atMs ?? Date.now());
  const window = input.window ?? 1;

  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (step < 0) continue;
    if (hotp(key, step) === code) {
      if (input.lastStep !== null && input.lastStep !== undefined && step <= input.lastStep) {
        return { ok: false, reason: 'replay' };
      }
      return { ok: true, step };
    }
  }
  return { ok: false, reason: 'invalid' };
}
