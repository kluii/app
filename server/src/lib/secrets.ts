// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Secret resolution and generation (D-41).
 *
 * Order: env → KLUI_SECRETS_DIR/<name> → generate and write 0600 in
 * development. Production fails closed when a required secret is missing: a
 * regenerated session secret logs everyone out and reads as "accounts broken".
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Secrets = {
  sessionSecret: string;
  tokenPepper: string;
  encryptionKey: Buffer;
};

export type SecretsResult =
  | { ok: true; secrets: Secrets; generated: string[] }
  | { ok: false; missing: string[]; message: string };

export type SecretsOptions = {
  /** When false, nothing is written to disk (tests). */
  persist: boolean;
};

const FILE_NAMES = {
  sessionSecret: 'session_secret',
  tokenPepper: 'token_pepper',
  encryptionKey: 'encryption_key',
} as const;

type SecretName = keyof typeof FILE_NAMES;

const ENV_NAMES: Record<
  SecretName,
  'KLUI_SESSION_SECRET' | 'KLUI_TOKEN_PEPPER' | 'KLUI_ENCRYPTION_KEY'
> = {
  sessionSecret: 'KLUI_SESSION_SECRET',
  tokenPepper: 'KLUI_TOKEN_PEPPER',
  encryptionKey: 'KLUI_ENCRYPTION_KEY',
};

export function resolveSecrets(
  env: {
    KLUI_ENV: 'development' | 'production' | 'test';
    KLUI_SECRETS_DIR: string;
    KLUI_SESSION_SECRET: string | null;
    KLUI_TOKEN_PEPPER: string | null;
    KLUI_ENCRYPTION_KEY: string | null;
  },
  options: SecretsOptions = { persist: true },
): SecretsResult {
  const dir = env.KLUI_SECRETS_DIR;
  const generated: string[] = [];
  const missing: string[] = [];

  const read = (name: SecretName): string | null => {
    const fromEnv = env[ENV_NAMES[name]];
    if (fromEnv) return fromEnv;
    const path = join(dir, FILE_NAMES[name]);
    if (existsSync(path)) {
      return readFileSync(path, 'utf8').trim();
    }
    return null;
  };

  const create = (name: SecretName): string => {
    const value =
      name === 'encryptionKey'
        ? randomBytes(32).toString('base64')
        : randomBytes(32).toString('base64url');
    generated.push(ENV_NAMES[name]);
    if (options.persist) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const path = join(dir, FILE_NAMES[name]);
      writeFileSync(path, `${value}\n`, { mode: 0o600 });
      chmodSync(path, 0o600);
    }
    return value;
  };

  const resolve = (name: SecretName): string | null => {
    const existing = read(name);
    if (existing) return existing;
    if (env.KLUI_ENV === 'production') {
      missing.push(ENV_NAMES[name]);
      return null;
    }
    return create(name);
  };

  const sessionSecret = resolve('sessionSecret');
  const tokenPepper = resolve('tokenPepper');
  const encryptionKeyRaw = resolve('encryptionKey');

  if (!sessionSecret || !tokenPepper || !encryptionKeyRaw) {
    const list = missing.map(
      (variable) =>
        `  ${variable}\n    expected  openssl rand -base64 32\n    problem   missing in production (D-41: never generated silently)`,
    );
    return {
      ok: false,
      missing,
      message: `Klui cannot start: ${missing.length} required secret${missing.length === 1 ? '' : 's'} missing.\n\n${list.join('\n')}\n\nProvide them in the environment or in KLUI_SECRETS_DIR (${dir}).`,
    };
  }

  const encryptionKey = Buffer.from(encryptionKeyRaw, 'base64');
  if (encryptionKey.length !== 32) {
    return {
      ok: false,
      missing: ['KLUI_ENCRYPTION_KEY'],
      message:
        'Klui cannot start: 1 required secret is malformed.\n\n  KLUI_ENCRYPTION_KEY\n    expected  openssl rand -base64 32\n    problem   expected 32 bytes after base64 decoding',
    };
  }

  return { ok: true, secrets: { sessionSecret, tokenPepper, encryptionKey }, generated };
}
