// SPDX-License-Identifier: AGPL-3.0-only
/** `12 Mar` in the reader's locale: a board date is a label, never a timestamp. */
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(
    new Date(value),
  );
}
