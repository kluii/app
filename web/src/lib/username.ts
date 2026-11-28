// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A username is an identity, so it is printed the way people write it: `@will`.
 * A display name never takes the at sign, and neither does a free label
 * (`assignee_label`, an anonymous author's own words) — those are prose, not
 * handles. The single implementation is what keeps `/person` and `@person` from
 * both appearing on the same screen.
 */
export function atUsername(username: string): string {
  return username.startsWith('@') ? username : `@${username}`;
}
