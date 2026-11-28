// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A string reduced to what a reader types when they leave the accents out:
 * `Marché` and `marche` fold to the same key, whichever side carries the
 * accent. NFD splits a letter from its marks, and the mark is what goes.
 */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
