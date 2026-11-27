// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The server's message catalogue (K5-07, docs/features/i18n.md §2).
 *
 * The web has had `en`/`fr` since K2-03. The server had English literals: the
 * error envelope's `message`, the validation hint, the reset mail, the
 * unsubscribe page. They are keys now, in the same two languages, checked by the
 * same parity rules — see `test/i18n.test.ts`, which reads both catalogues and
 * fails on a key that exists in one language and not the other.
 *
 * Two rules that are not obvious:
 *
 * - The *log* stays English. `AppError.message` is the English sentence and
 *   never changes with the request, so a log line or a request id can be read
 *   the same way every time; only the wire envelope is translated.
 * - A missing key falls back to English, then to the key itself. A reader must
 *   never see `error.something` and a translator must never ship a blank.
 */
import en from './en.json' with { type: 'json' };
import fr from './fr.json' with { type: 'json' };

export type Locale = 'en' | 'fr';

export const CATALOGS: Record<Locale, Record<string, string>> = { en, fr };

export const LOCALES: Locale[] = ['en', 'fr'];

/**
 * `fr-CH, fr;q=0.9, en;q=0.8` → `fr`. The first tag the catalogue covers wins;
 * anything else, including no header, is English (docs/api.md §1).
 */
export function localeOf(header: string | string[] | undefined): Locale {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  for (const part of raw.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';
    if (tag.startsWith('fr')) return 'fr';
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

/** `{name}` interpolation, English fallback, then the fallback text the caller named. */
export function translate(
  locale: Locale,
  key: string,
  params: Record<string, string | number> = {},
  fallback?: string,
): string {
  const template = CATALOGS[locale][key] ?? CATALOGS.en[key] ?? fallback;
  if (template === undefined) return key;
  return template.replace(/\{(\w+)\}/gu, (_match, name: string) =>
    String(params[name] ?? `{${name}}`),
  );
}
