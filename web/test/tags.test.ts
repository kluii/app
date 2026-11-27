// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-14 at the unit level: the palette the editor offers comes from tokens.css,
 * and the name rule is the one the server enforces (server/src/contracts uses
 * the same `[a-z0-9-]`, 1–24).
 */
import { describe, expect, it } from 'vitest';
import { TAG_HUES, isHex, normalizeTag } from '../src/lib/tag-palette';

describe('the tag palette', () => {
  it('names the twelve hues of DESIGN.md, in order', () => {
    expect(TAG_HUES).toHaveLength(12);
    expect([...TAG_HUES]).toEqual([
      'slate',
      'gray',
      'red',
      'orange',
      'amber',
      'lime',
      'green',
      'teal',
      'sky',
      'blue',
      'violet',
      'pink',
    ]);
  });

  it('normalises a name the way the server does', () => {
    expect(normalizeTag('  Web UI  ')).toBe('web-ui');
    expect(normalizeTag('API')).toBe('api');
    expect(normalizeTag('a--b')).toBe('a-b');
    expect(normalizeTag('---')).toBeNull();
    expect(normalizeTag('x'.repeat(40))).toHaveLength(24);
  });

  it('accepts only a six-digit hex', () => {
    expect(isHex('#8B5CF6')).toBe(true);
    expect(isHex('#8b5cf6')).toBe(true);
    expect(isHex('8B5CF6')).toBe(false);
    expect(isHex('#8B5CF')).toBe(false);
    expect(isHex('rgb(1,2,3)')).toBe(false);
  });
});
