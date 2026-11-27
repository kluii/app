// SPDX-License-Identifier: AGPL-3.0-only
import { hash, verify } from '@node-rs/argon2';
import { AppError } from './errors.js';
import { BREACHED_PASSWORDS } from './breached.js';

/**
 * argon2id (the library's default algorithm), tuned to roughly 250 ms on a
 * 2 vCPU box (ADR-0009 parameters). Length beats symbol theatre: 12 characters
 * minimum, no composition rules.
 */
export const ARGON2_OPTIONS = {
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 256;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  try {
    return await verify(hashValue, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AppError('validation_failed', {
      message: 'The password is too short.',
      hint: `Use at least ${PASSWORD_MIN_LENGTH} characters; a passphrase is easier to remember than a symbol.`,
      details: [
        {
          path: 'password',
          code: 'too_small',
          message: `expected at least ${PASSWORD_MIN_LENGTH} characters`,
        },
      ],
    });
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    throw new AppError('validation_failed', {
      message: 'The password is too long.',
      hint: `Keep it under ${PASSWORD_MAX_BYTES} bytes.`,
      details: [{ path: 'password', code: 'too_big', message: 'expected at most 256 bytes' }],
    });
  }
  if (isBreached(password)) {
    throw new AppError('validation_failed', {
      message: 'That password appears in a known breach list.',
      hint: 'Choose a password you have not used anywhere else.',
      details: [{ path: 'password', code: 'breached', message: 'found in the local deny list' }],
    });
  }
}

/**
 * A local deny list plus an entropy floor. No password ever leaves the
 * instance: the k-anonymity range query is documented as an operational
 * addition, not a silent network call (docs/security.md §4).
 */
export function isBreached(password: string): boolean {
  const normalised = password.toLowerCase();
  if (BREACHED_PASSWORDS.has(normalised)) return true;
  const unique = new Set(normalised).size;
  return normalised.length < 20 && unique < 6;
}
