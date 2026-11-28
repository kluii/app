// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fold } from '../src/lib/fold';

/**
 * The board search folds both sides, so a reader who types without accents
 * finds a name that carries them — and the other way round.
 */
describe('a string folded for search', () => {
  it('drops the accents from either side', () => {
    expect(fold('Marché')).toBe('marche');
    expect(fold('marche')).toBe('marche');
    expect(fold('Déjà vu')).toBe('deja vu');
  });

  it('folds case as well, as a search box always did', () => {
    expect(fold('MARCHÉ')).toBe('marche');
  });

  it('leaves a string without marks alone', () => {
    expect(fold('Launch plan')).toBe('launch plan');
    expect(fold('')).toBe('');
  });
});
