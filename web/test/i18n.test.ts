// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import fr from '../src/i18n/fr.json';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Every TypeScript source under `web/src`, at any depth. */
function sources(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .map((entry) => join(directory, entry))
    .filter((path) => ['.ts', '.tsx'].includes(extname(path)));
}

/**
 * `t('key')` and `t("key")` only. A template literal is dynamic by design and
 * cannot be checked here; a call site that passes a variable is invisible too,
 * which is why the sanity check below exists.
 */
function referencedKeys() {
  return sources(SRC).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(/\bt\(\s*(?:'([^'\n]+)'|"([^"\n]+)")/g)].map((match) => ({
      file: relative(SRC, file),
      key: match[1] ?? match[2] ?? '',
    }));
  });
}

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

/**
 * Parity between the two files is not enough: a key that neither of them has
 * renders as its own name in the interface, and `t()` cannot tell anyone
 * (i18n.md §3). This walks the call sites instead of trusting the catalogs.
 */
describe('every key a component asks for', () => {
  const references = referencedKeys();

  it('exists in both catalogs', () => {
    const missing = references
      .filter(({ key }) => !(key in en) || !(key in fr))
      .map(({ file, key }) => `${file}: ${key}`);
    expect(missing).toEqual([]);
  });

  it('is found at all, so the extractor itself is checked', () => {
    expect(new Set(references.map(({ key }) => key)).size).toBeGreaterThanOrEqual(300);
  });
});
