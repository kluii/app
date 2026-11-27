// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RESERVED_MESSAGE,
  RESERVED_WORDS,
  SLUG_MAX,
  SLUG_MIN,
  SLUG_PATTERN,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_PATTERN,
  checkSlug,
  checkUsername,
} from '../src/lib/validation';

/**
 * The browser keeps a copy of two server modules so a form can answer without a
 * round trip. A copy that silently drifts is a bug the API catches only at
 * submit time, so the copy is checked against the originals here.
 *
 * The server files are read as text: importing across workspaces would drag
 * Prisma and argon2 into the browser test.
 */
function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

const authContract = read('../../server/src/contracts/auth.ts');
const reservedSource = read('../../server/src/lib/reserved.ts');

function numberConstant(name: string): number {
  const match = new RegExp(`export const ${name} = (\\d+);`).exec(authContract);
  if (!match?.[1]) throw new Error(`${name} not found in the server contract`);
  return Number(match[1]);
}

function patternConstant(name: string): string {
  const match = new RegExp(`export const ${name} = (/[^;]+/);`).exec(authContract);
  if (!match?.[1]) throw new Error(`${name} not found in the server contract`);
  return match[1];
}

describe('the browser copy of the naming rules', () => {
  it('uses the same lengths as the server', () => {
    expect(USERNAME_MIN).toBe(numberConstant('USERNAME_MIN'));
    expect(USERNAME_MAX).toBe(numberConstant('USERNAME_MAX'));
    expect(SLUG_MIN).toBe(numberConstant('SLUG_MIN'));
    expect(SLUG_MAX).toBe(numberConstant('SLUG_MAX'));
  });

  it('uses the same patterns as the server', () => {
    expect(String(USERNAME_PATTERN)).toBe(patternConstant('USERNAME_PATTERN'));
    expect(String(SLUG_PATTERN)).toBe(patternConstant('SLUG_PATTERN'));
  });

  it('reserves exactly the same words as the server', () => {
    const words = [...reservedSource.matchAll(/^\s*'([a-z0-9-]+)',$/gm)].map((match) => match[1]);
    expect(words.length).toBeGreaterThan(20);
    expect([...RESERVED_WORDS].sort()).toEqual([...new Set(words)].sort());
  });

  it('uses the same reserved message, because the client matches on it', () => {
    const server = /export const RESERVED_MESSAGE = '([^']+)';/.exec(reservedSource);
    expect(server?.[1]).toBe(RESERVED_MESSAGE);
  });

  it('answers the same problem for the same input', () => {
    expect(checkUsername('jo')).toBe('too_short');
    expect(checkUsername('-abc')).toBe('shape');
    expect(checkUsername('Admin')).toBe('shape');
    expect(checkUsername('admin')).toBe('reserved');
    expect(checkUsername('ana-maria')).toBeNull();
    expect(checkSlug('ab')).toBe('too_short');
    expect(checkSlug('login')).toBe('reserved');
    expect(checkSlug('sprint-42')).toBeNull();
  });
});
