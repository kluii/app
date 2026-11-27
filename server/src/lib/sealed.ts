// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AES-256-GCM for the few values that must be readable again later (a TOTP
 * secret cannot be hashed: the server needs it to check a code). Everything
 * that is only ever compared is stored hashed instead (D-33).
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, base64url, so a future key rotation can
 * recognise what it is reading.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;

export function seal(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function open(key: Buffer, sealed: string): string {
  const [version, iv, tag, ciphertext] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error('unknown sealed value');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
