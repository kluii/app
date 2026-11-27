// SPDX-License-Identifier: AGPL-3.0-only
import { ApiError } from '../api/client';
import { t } from '../i18n';

/**
 * What to show when a call fails (docs/api.md §1).
 *
 * Every 4xx carries `{code, message, hint}`, and the message is the answer the
 * person needs: "That name is taken.", "Only the owner can delete this board.",
 * "This board is closed." The SPA used to throw all of it away and print
 * "Something went wrong. Try again.", which is worse than useless when the
 * server explained the problem exactly.
 *
 * The generic copy survives for the two cases where there is nothing to show:
 * a network failure (no response at all) and a 5xx (the server could not
 * answer, and its `internal` text is not written for a reader). `internal` is
 * also the code `request()` invents for a body it could not parse, so it counts
 * as an unknown code here.
 *
 * The server's messages are English today; routing them through the catalogs is
 * K5-07. Showing the server's English is still a smaller lie than a translated
 * sentence that says nothing.
 */
export function failureMessage(cause: unknown): string {
  const generic = t('common.error.generic');
  if (!(cause instanceof ApiError)) return generic;
  if (cause.status >= 500 || cause.code === 'internal') return generic;
  return cause.hint === null ? cause.message : `${cause.message} ${cause.hint}`;
}
