// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Opaque prefixed ids: `<prefix>_` + base62, 26 characters total.
 * Clients must treat them as opaque (docs/api.md §2); they are not UUIDs.
 */
import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const LIMIT = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

export const ID_TOTAL_LENGTH = 26;

export const ID_PREFIXES = [
  'usr',
  'ses',
  'brd',
  'col',
  'crd',
  'cmt',
  'evt',
  'lnk',
  'key',
  'pnd',
  'sum',
  'job',
  'bmb',
  'bsr',
  'btc',
  'oau',
  'ban',
  'rcv',
  'dgt',
  'not',
] as const;

export type IdPrefix = (typeof ID_PREFIXES)[number];

export function base62(length: number): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < LIMIT) {
        out += ALPHABET[byte % ALPHABET.length];
        if (out.length === length) break;
      }
    }
  }
  return out;
}

export function newId(prefix: IdPrefix): string {
  const suffixLength = ID_TOTAL_LENGTH - prefix.length - 1;
  return `${prefix}_${base62(suffixLength)}`;
}

export function isId(value: string, prefix?: IdPrefix): boolean {
  const expected = prefix
    ? new RegExp(`^${prefix}_[0-9A-Za-z]{${ID_TOTAL_LENGTH - prefix.length - 1}}$`)
    : /^[a-z]{3}_[0-9A-Za-z]{22}$/;
  return expected.test(value);
}

/** Credential-shaped tokens: base62, never logged, stored hashed (docs/permissions.md §4.2). */
export function opaqueToken(length = 32): string {
  return base62(length);
}

/** Session ids are 32 random bytes, base64url, stored as sha256. */
export function sessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function anonActorId(): string {
  return randomBytes(16).toString('base64url');
}
