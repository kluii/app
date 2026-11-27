// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Environment validation, fail-closed (docs/architecture.md §8).
 *
 * A failed boot prints ONE message that lists every problem with the variable
 * name, the expected shape and one working example, then exits non-zero.
 */

export type KluiEnvName = 'development' | 'production' | 'test';

export type Env = {
  KLUI_ENV: KluiEnvName;
  KLUI_PORT: number;
  KLUI_PUBLIC_URL: string | null;
  DATABASE_URL: string;
  KLUI_SESSION_SECRET: string | null;
  KLUI_TOKEN_PEPPER: string | null;
  KLUI_ENCRYPTION_KEY: string | null;
  KLUI_SECRETS_DIR: string;
  KLUI_TRUSTED_PROXY_HOPS: number;
  KLUI_REGISTRATION_OPEN: boolean;
  KLUI_TOTP_POLICY: 'available' | 'required' | 'disabled';
  KLUI_SMTP_HOST: string | null;
  KLUI_SMTP_PORT: number;
  KLUI_SMTP_USER: string | null;
  KLUI_SMTP_PASS: string | null;
  KLUI_SMTP_FROM: string | null;
  KLUI_ANALYTICS_URL: string | null;
  KLUI_METRICS_ENABLED: boolean;
  KLUI_METRICS_TOKEN: string | null;
  KLUI_CAPTCHA_ENABLED: boolean;
  KLUI_CAPTCHA_URL: string | null;
  KLUI_CAPTCHA_SECRET: string | null;
  KLUI_CAPTCHA_THRESHOLD: number;
  KLUI_ANON_WRITES_PER_BOARD: number;
  KLUI_ANON_WRITES_PER_IP: number;
  KLUI_ANON_JOINS_PER_IP: number;
  KLUI_DIGEST_LLM_URL: string | null;
  KLUI_DIGEST_LLM_KEY: string | null;
  KLUI_RETENTION_EVENTS_DAYS: number;
  KLUI_OPENAPI: boolean;
  KLUI_DEMO_RESET: boolean;
  KLUI_LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  /** `on` limits the API; the default is on in production and off elsewhere. */
  KLUI_RATE_LIMIT: 'on' | 'off';
  KLUI_RATE_LIMIT_WRITES: number;
  KLUI_RATE_LIMIT_READS: number;
};

export type EnvProblem = { variable: string; expected: string; problem: string };

export type EnvResult =
  { ok: true; env: Env } | { ok: false; problems: EnvProblem[]; message: string };

const EXAMPLES: Record<string, string> = {
  DATABASE_URL: 'postgresql://klui:klui@localhost:5432/klui',
  KLUI_PUBLIC_URL: 'https://boards.example.com',
  KLUI_SESSION_SECRET: 'openssl rand -base64 32',
  KLUI_TOKEN_PEPPER: 'openssl rand -hex 32',
  KLUI_ENCRYPTION_KEY: 'openssl rand -base64 32',
  KLUI_PORT: '8080',
  KLUI_ENV: 'development',
  KLUI_SECRETS_DIR: '/data/secrets',
  KLUI_TRUSTED_PROXY_HOPS: '1',
  KLUI_REGISTRATION_OPEN: 'true',
  KLUI_TOTP_POLICY: 'available',
  KLUI_SMTP_HOST: 'smtp.example.com',
  KLUI_SMTP_PORT: '587',
  KLUI_SMTP_FROM: 'boards@example.com',
  KLUI_ANALYTICS_URL: 'https://analytics.example.com/script.js',
  KLUI_METRICS_TOKEN: 'openssl rand -hex 24',
  KLUI_CAPTCHA_URL: 'https://cap.example.com',
  KLUI_CAPTCHA_SECRET: 'openssl rand -hex 32',
  KLUI_ANON_WRITES_PER_BOARD: '30',
  KLUI_ANON_WRITES_PER_IP: '10',
  KLUI_ANON_JOINS_PER_IP: '20',
  KLUI_RETENTION_EVENTS_DAYS: '365',
  KLUI_LOG_LEVEL: 'info',
  KLUI_RATE_LIMIT: 'on',
  KLUI_RATE_LIMIT_WRITES: '120',
  KLUI_RATE_LIMIT_READS: '600',
};

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const TOTP_POLICIES = ['available', 'required', 'disabled'] as const;
const ENV_NAMES = ['development', 'production', 'test'] as const;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): EnvResult {
  const problems: EnvProblem[] = [];
  const get = (name: string): string | undefined => {
    const value = source[name];
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  };
  const fail = (variable: string, expected: string, problem: string): void => {
    problems.push({ variable, expected, problem });
  };

  const text = (name: string, fallback: string | null): string | null => get(name) ?? fallback;

  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const raw = get(name);
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw)) {
      fail(name, `a whole number in ${min}..${max}`, `expected digits, got "${raw}"`);
      return fallback;
    }
    const value = Number(raw);
    if (value < min || value > max) {
      fail(name, `a whole number in ${min}..${max}`, `${value} is out of range`);
      return fallback;
    }
    return value;
  };

  const boolean = (name: string, fallback: boolean): boolean => {
    const raw = get(name);
    if (raw === undefined) return fallback;
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    fail(name, 'true or false', `expected "true" or "false", got "${raw}"`);
    return fallback;
  };

  const url = (name: string, fallback: string | null): string | null => {
    const raw = get(name);
    if (raw === undefined) return fallback;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        fail(name, EXAMPLES[name] ?? 'an http(s) URL', `unsupported protocol "${parsed.protocol}"`);
        return fallback;
      }
      return raw;
    } catch {
      fail(name, EXAMPLES[name] ?? 'an http(s) URL', `"${raw}" is not a URL`);
      return fallback;
    }
  };

  const oneOf = <T extends string>(name: string, values: readonly T[], fallback: T): T => {
    const raw = get(name);
    if (raw === undefined) return fallback;
    if ((values as readonly string[]).includes(raw)) return raw as T;
    fail(name, values.join(' | '), `expected one of ${values.join(', ')}, got "${raw}"`);
    return fallback;
  };

  const databaseUrl = get('DATABASE_URL');
  if (databaseUrl === undefined) {
    fail(
      'DATABASE_URL',
      EXAMPLES.DATABASE_URL ?? '',
      'required: the API cannot boot without a database',
    );
  } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    fail(
      'DATABASE_URL',
      EXAMPLES.DATABASE_URL ?? '',
      'expected a postgres:// or postgresql:// URL',
    );
  }

  const envName = oneOf('KLUI_ENV', ENV_NAMES, 'development');
  const smtpFrom = get('KLUI_SMTP_FROM') ?? null;
  if (smtpFrom !== null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(smtpFrom)) {
    fail('KLUI_SMTP_FROM', EXAMPLES.KLUI_SMTP_FROM ?? '', `"${smtpFrom}" is not an email address`);
  }

  const sessionSecret = get('KLUI_SESSION_SECRET') ?? null;
  if (sessionSecret !== null && sessionSecret.length < 32) {
    fail(
      'KLUI_SESSION_SECRET',
      EXAMPLES.KLUI_SESSION_SECRET ?? '',
      'expected at least 32 characters',
    );
  }
  const tokenPepper = get('KLUI_TOKEN_PEPPER') ?? null;
  if (tokenPepper !== null && tokenPepper.length < 16) {
    fail('KLUI_TOKEN_PEPPER', EXAMPLES.KLUI_TOKEN_PEPPER ?? '', 'expected at least 16 characters');
  }
  const encryptionKey = get('KLUI_ENCRYPTION_KEY') ?? null;
  if (encryptionKey !== null && Buffer.from(encryptionKey, 'base64').length !== 32) {
    fail(
      'KLUI_ENCRYPTION_KEY',
      EXAMPLES.KLUI_ENCRYPTION_KEY ?? '',
      'expected 32 base64-encoded bytes',
    );
  }

  const env: Env = {
    KLUI_ENV: envName,
    KLUI_PORT: integer('KLUI_PORT', 8080, 1, 65535),
    KLUI_PUBLIC_URL: url('KLUI_PUBLIC_URL', null),
    DATABASE_URL: databaseUrl ?? '',
    KLUI_SESSION_SECRET: sessionSecret,
    KLUI_TOKEN_PEPPER: tokenPepper,
    KLUI_ENCRYPTION_KEY: encryptionKey,
    KLUI_SECRETS_DIR: text('KLUI_SECRETS_DIR', '/data/secrets') ?? '/data/secrets',
    KLUI_TRUSTED_PROXY_HOPS: integer('KLUI_TRUSTED_PROXY_HOPS', 0, 0, 10),
    KLUI_REGISTRATION_OPEN: boolean('KLUI_REGISTRATION_OPEN', true),
    KLUI_TOTP_POLICY: oneOf('KLUI_TOTP_POLICY', TOTP_POLICIES, 'available'),
    KLUI_SMTP_HOST: text('KLUI_SMTP_HOST', null),
    KLUI_SMTP_PORT: integer('KLUI_SMTP_PORT', 587, 1, 65535),
    KLUI_SMTP_USER: text('KLUI_SMTP_USER', null),
    KLUI_SMTP_PASS: text('KLUI_SMTP_PASS', null),
    KLUI_SMTP_FROM: smtpFrom,
    KLUI_ANALYTICS_URL: url('KLUI_ANALYTICS_URL', null),
    KLUI_METRICS_ENABLED: boolean('KLUI_METRICS_ENABLED', false),
    KLUI_METRICS_TOKEN: text('KLUI_METRICS_TOKEN', null),
    KLUI_CAPTCHA_ENABLED: boolean('KLUI_CAPTCHA_ENABLED', false),
    KLUI_CAPTCHA_URL: url('KLUI_CAPTCHA_URL', null),
    KLUI_CAPTCHA_SECRET: text('KLUI_CAPTCHA_SECRET', null),
    KLUI_CAPTCHA_THRESHOLD: integer('KLUI_CAPTCHA_THRESHOLD', 3, 1, 1000),
    KLUI_ANON_WRITES_PER_BOARD: integer('KLUI_ANON_WRITES_PER_BOARD', 30, 1, 100_000),
    KLUI_ANON_WRITES_PER_IP: integer('KLUI_ANON_WRITES_PER_IP', 10, 1, 100_000),
    KLUI_ANON_JOINS_PER_IP: integer('KLUI_ANON_JOINS_PER_IP', 20, 1, 100_000),
    KLUI_DIGEST_LLM_URL: url('KLUI_DIGEST_LLM_URL', null),
    KLUI_DIGEST_LLM_KEY: text('KLUI_DIGEST_LLM_KEY', null),
    KLUI_RETENTION_EVENTS_DAYS: integer('KLUI_RETENTION_EVENTS_DAYS', 365, 1, 3650),
    KLUI_OPENAPI: boolean('KLUI_OPENAPI', envName === 'production' ? false : true),
    KLUI_DEMO_RESET: boolean('KLUI_DEMO_RESET', false),
    KLUI_LOG_LEVEL: oneOf('KLUI_LOG_LEVEL', LOG_LEVELS, 'info'),
    KLUI_RATE_LIMIT: oneOf(
      'KLUI_RATE_LIMIT',
      ['on', 'off'] as const,
      envName === 'production' ? 'on' : 'off',
    ),
    KLUI_RATE_LIMIT_WRITES: integer('KLUI_RATE_LIMIT_WRITES', 120, 1, 100_000),
    KLUI_RATE_LIMIT_READS: integer('KLUI_RATE_LIMIT_READS', 600, 1, 100_000),
  };

  problems.push(...productionProblems(env));
  // A captcha that is on but unverifiable would accept every token: boot is the
  // only place to catch that (D-46).
  if (env.KLUI_CAPTCHA_ENABLED && env.KLUI_CAPTCHA_URL === null) {
    problems.push({
      variable: 'KLUI_CAPTCHA_URL',
      expected: EXAMPLES.KLUI_CAPTCHA_URL ?? 'https://cap.example.com',
      problem:
        'required when KLUI_CAPTCHA_ENABLED is true: a captcha nobody can verify is not a captcha',
    });
  }

  if (problems.length > 0) {
    return { ok: false, problems, message: formatProblems(problems) };
  }
  return { ok: true, env };
}

/**
 * Production refuses anything a self-hoster cannot verify from the outside:
 * a public URL, and https unless the origin is loopback (docs/security.md §8).
 */
function productionProblems(env: Env): EnvProblem[] {
  if (env.KLUI_ENV !== 'production') return [];
  const problems: EnvProblem[] = [];
  if (env.KLUI_PUBLIC_URL === null) {
    problems.push({
      variable: 'KLUI_PUBLIC_URL',
      expected: EXAMPLES.KLUI_PUBLIC_URL ?? '',
      problem: 'required in production: links, Open Graph and OIDC redirects are absolute',
    });
  } else if (
    !env.KLUI_PUBLIC_URL.startsWith('https://') &&
    !isLoopbackOrigin(env.KLUI_PUBLIC_URL)
  ) {
    problems.push({
      variable: 'KLUI_PUBLIC_URL',
      expected: 'an https:// URL',
      problem:
        'production requires https: secure cookies and HSTS depend on it (a loopback origin is the only exception, for the local quickstart)',
    });
  }
  // Secret *presence* is not an env-shape problem: a secret may be generated on
  // first boot and persisted in KLUI_SECRETS_DIR (D-41). lib/secrets.ts owns
  // that decision and fails closed when the directory cannot be written.
  return problems;
}

/**
 * `http://localhost` is the only non-https origin accepted in production: a
 * browser treats it as a secure context, which is what the quickstart needs and
 * what a public deployment must never rely on.
 */
export function isLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:') return false;
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  } catch {
    return false;
  }
}

/** Secure cookies only when the public origin is https (a loopback http origin cannot set them). */
export function isSecureOrigin(env: Env): boolean {
  return env.KLUI_PUBLIC_URL !== null && env.KLUI_PUBLIC_URL.startsWith('https://');
}

export function formatProblems(problems: EnvProblem[]): string {
  const lines = problems.map(
    (problem) =>
      `  ${problem.variable}\n    expected  ${problem.expected}\n    problem   ${problem.problem}`,
  );
  const count = problems.length;
  const noun = count === 1 ? 'problem' : 'problems';
  return `Klui cannot start: ${count} configuration ${noun}.\n\n${lines.join('\n')}\n\nSee docs/deployment.md §3 for the full list.`;
}

/** Env for the test suite: no secrets required, no production checks. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    KLUI_ENV: 'test',
    KLUI_PORT: 0,
    KLUI_PUBLIC_URL: null,
    DATABASE_URL: 'postgresql://klui:klui@127.0.0.1:5432/klui_test',
    KLUI_SESSION_SECRET: 'test-session-secret-that-is-long-enough',
    KLUI_TOKEN_PEPPER: 'test-token-pepper-value',
    KLUI_ENCRYPTION_KEY: 'a2x1aS10ZXN0LWVuY3J5cHRpb24ta2V5LTMyLWJ5dGU=',
    KLUI_SECRETS_DIR: '/tmp/klui-secrets',
    KLUI_TRUSTED_PROXY_HOPS: 0,
    KLUI_REGISTRATION_OPEN: true,
    KLUI_TOTP_POLICY: 'available',
    KLUI_SMTP_HOST: null,
    KLUI_SMTP_PORT: 587,
    KLUI_SMTP_USER: null,
    KLUI_SMTP_PASS: null,
    KLUI_SMTP_FROM: null,
    KLUI_ANALYTICS_URL: null,
    KLUI_METRICS_ENABLED: false,
    KLUI_METRICS_TOKEN: null,
    KLUI_CAPTCHA_ENABLED: false,
    KLUI_CAPTCHA_URL: null,
    KLUI_CAPTCHA_SECRET: null,
    KLUI_CAPTCHA_THRESHOLD: 3,
    KLUI_ANON_WRITES_PER_BOARD: 30,
    KLUI_ANON_WRITES_PER_IP: 10,
    KLUI_ANON_JOINS_PER_IP: 20,
    KLUI_DIGEST_LLM_URL: null,
    KLUI_DIGEST_LLM_KEY: null,
    KLUI_RETENTION_EVENTS_DAYS: 365,
    KLUI_OPENAPI: false,
    KLUI_DEMO_RESET: false,
    KLUI_LOG_LEVEL: 'silent',
    KLUI_RATE_LIMIT: 'off',
    KLUI_RATE_LIMIT_WRITES: 120,
    KLUI_RATE_LIMIT_READS: 600,
    ...overrides,
  };
}
