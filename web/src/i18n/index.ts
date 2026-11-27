// SPDX-License-Identifier: AGPL-3.0-only
import en from './en.json' with { type: 'json' };
import fr from './fr.json' with { type: 'json' };

export type Locale = 'en' | 'fr';

const CATALOGS: Record<Locale, Record<string, string>> = { en, fr };
const STORAGE_KEY = 'klui-locale';

const LISTENERS = new Set<() => void>();

/** A stored choice wins; the first visit follows the browser, English otherwise. */
function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'fr') return stored;
  } catch {
    // a blocked storage falls back to the browser, never to an exception
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('fr')
    ? 'fr'
    : 'en';
}

let locale: Locale = initialLocale();

/**
 * The document language is part of the choice, not of a component's effect: a
 * screen reader decides how to pronounce the page from it, and a render pass is
 * not a place to write to the DOM.
 */
if (typeof document !== 'undefined') document.documentElement.lang = locale;

export function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // the session keeps the choice even when it cannot be remembered
  }
  for (const listener of LISTENERS) listener();
}

export function getLocale(): Locale {
  return locale;
}

/** `useSyncExternalStore` contract: a stable value per locale, and a way to hear about it. */
export function subscribe(listener: () => void): () => void {
  LISTENERS.add(listener);
  return () => {
    LISTENERS.delete(listener);
  };
}

export function getSnapshot(): Locale {
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
