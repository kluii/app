// SPDX-License-Identifier: AGPL-3.0-only
import en from './en.json' with { type: 'json' };
import fr from './fr.json' with { type: 'json' };

export type Locale = 'en' | 'fr';

const CATALOGS: Record<Locale, Record<string, string>> = { en, fr };

/** The browser's language when the catalog covers it, English otherwise. */
function initialLocale(): Locale {
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('fr')
    ? 'fr'
    : 'en';
}

let locale: Locale = initialLocale();

export function setLocale(next: Locale): void {
  locale = next;
}

export function getLocale(): Locale {
  return locale;
}

/** `{name}` interpolation; a missing key falls back to English, never the raw key (i18n.md §3). */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const catalog = CATALOGS[locale];
  const fallback = CATALOGS.en;
  const template = catalog[key] ?? fallback[key];
  if (template === undefined) {
    return key;
  }
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    String(params[name] ?? `{${name}}`),
  );
}
