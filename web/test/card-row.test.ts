// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { snippet } from '../src/components/board/card-row';

/**
 * The card shows one line of its description: the first 20 characters, then an
 * ellipsis when there is more. Nothing else — no first word, no first sentence.
 */
describe('the description snippet on a card', () => {
  it('keeps a description that fits, entire', () => {
    expect(snippet('Short one')).toBe('Short one');
    expect(snippet('Exactly twenty chars')).toBe('Exactly twenty chars');
  });

  it('cuts at 20 characters and marks the cut', () => {
    expect(snippet('A description that runs long')).toBe('A description that r…');
    expect(snippet('Exactly twenty one cha')).toBe('Exactly twenty one c…');
  });

  it('trims the space the cut landed on before the ellipsis', () => {
    expect(snippet('Proofread the legal notice')).toBe('Proofread the legal…');
  });
});
