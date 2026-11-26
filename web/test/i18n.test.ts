// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import fr from '../src/i18n/fr.json';

/**
 * The catalogs are deliverables, not decoration: a key that exists in one and
 * not the other ships as an empty label for half the readers (i18n.md §2).
 */
describe('the message catalogs', () => {
  it('hold exactly the same keys', () => {
    const enKeys = Object.keys(en).sort();
    const frKeys = Object.keys(fr).sort();
    expect(frKeys).toEqual(enKeys);
  });

  it('have no empty value in either language', () => {
    const empties = [...Object.entries(en), ...Object.entries(fr)]
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    expect(empties).toEqual([]);
  });

  it('use the same placeholders in both languages', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

    for (const key of Object.keys(en)) {
      expect({ key, fr: placeholders(fr[key as keyof typeof fr] ?? '') }).toEqual({
        key,
        fr: placeholders(en[key as keyof typeof en] ?? ''),
      });
    }
  });

  it('carry no emoji', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u;
    const offenders = [...Object.entries(en), ...Object.entries(fr)]
      .filter(([, value]) => emoji.test(value))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});
