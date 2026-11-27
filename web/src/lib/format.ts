// SPDX-License-Identifier: AGPL-3.0-only
import { getLocale } from '../i18n';

/**
 * `12 Mar` in the reader's locale: a board date is a label, never a timestamp.
 * The locale is the UI language, not `undefined`: switching to French has to
 * switch the month names with it.
 */
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }).format(
    new Date(value),
  );
}

/**
 * The machine day of a timestamp (`2026-11-26`), never a localised sentence:
 * a key's created and expiry dates are facts, and the catalog supplies the
 * words around them (docs/mcp.md §7).
 */
export function formatDay(value: string): string {
  return value.slice(0, 10);
}

export type RelativeUnit = 'justNow' | 'minute' | 'minutes' | 'hour' | 'hours' | 'day' | 'days';

/**
 * "last used …" needs a unit and a count, not a sentence: the copy lives in
 * `settings.agents.when.*`, in both languages, and this only picks one.
 */
export function relativeUnit(
  value: string,
  now: number = Date.now(),
): { unit: RelativeUnit; count: number } {
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  if (seconds < 60) return { unit: 'justNow', count: 0 };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { unit: minutes === 1 ? 'minute' : 'minutes', count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: hours === 1 ? 'hour' : 'hours', count: hours };
  const days = Math.floor(hours / 24);
  return { unit: days === 1 ? 'day' : 'days', count: days };
}
