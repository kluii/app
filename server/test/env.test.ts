// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';

describe('environment validation', () => {
  it('names every missing or malformed variable in one message', () => {
    const result = loadEnv({
      KLUI_ENV: 'production',
      KLUI_PORT: 'eighty',
      KLUI_SESSION_SECRET: 'short',
      KLUI_TOTP_POLICY: 'sometimes',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const variables = result.problems.map((problem) => problem.variable);
    expect(variables).toEqual(
      expect.arrayContaining([
        'DATABASE_URL',
        'KLUI_PORT',
        'KLUI_SESSION_SECRET',
        'KLUI_TOTP_POLICY',
        'KLUI_PUBLIC_URL',
        'KLUI_TOKEN_PEPPER',
        'KLUI_ENCRYPTION_KEY',
      ]),
    );
    expect(result.message).toContain('Klui cannot start:');
    for (const variable of variables) {
      expect(result.message).toContain(variable);
    }
    expect(result.message).toContain('expected');
    expect(result.message).toContain('problem');
  });

  it('accepts a development boot with only DATABASE_URL', () => {
    const result = loadEnv({ DATABASE_URL: 'postgresql://klui:klui@127.0.0.1:5432/klui' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.KLUI_ENV).toBe('development');
    expect(result.env.KLUI_PORT).toBe(8080);
    expect(result.env.KLUI_TOTP_POLICY).toBe('available');
    expect(result.env.KLUI_ANALYTICS_URL).toBeNull();
  });

  it('refuses production without https, secrets or a public URL', () => {
    const result = loadEnv({
      KLUI_ENV: 'production',
      DATABASE_URL: 'postgresql://klui:klui@db:5432/klui',
      KLUI_PUBLIC_URL: 'http://boards.example.com',
      KLUI_SESSION_SECRET: 'a'.repeat(40),
      KLUI_TOKEN_PEPPER: 'b'.repeat(32),
      KLUI_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toEqual([
      {
        variable: 'KLUI_PUBLIC_URL',
        expected: 'an https:// URL',
        problem: expect.stringContaining('https'),
      },
    ]);
  });
});
