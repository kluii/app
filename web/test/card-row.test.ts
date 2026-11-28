// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { snippet } from '../src/components/board/card-row';

/**
 * The card shows one line of its description: the first 120 characters, then an
 * ellipsis when there is more. Nothing else — no first word, no first sentence.
 */
describe('the description snippet on a card', () => {
  it('keeps a description that fits, entire', () => {
    expect(snippet('Short one')).toBe('Short one');
    expect(snippet('y'.repeat(120))).toBe('y'.repeat(120));
  });

  it('cuts at 120 characters and marks the cut', () => {
    expect(snippet('y'.repeat(121))).toBe(`${'y'.repeat(120)}…`);
    expect(snippet(`${'y'.repeat(130)} tail`)).toBe(`${'y'.repeat(120)}…`);
  });

  it('trims the space the cut landed on before the ellipsis', () => {
    expect(snippet(`${'y'.repeat(119)} ${'z'.repeat(10)}`)).toBe(`${'y'.repeat(119)}…`);
  });
});
