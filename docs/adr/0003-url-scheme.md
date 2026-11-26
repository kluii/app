# ADR-0003 — Board URLs, suffixes and reservations

## Status

`accepted`

Date: 2026-11-26. Deciders: Wyliam, Hermes.

## Context

A board is reachable by URL, and the URL carries three promises: it can be said
out loud, it can be shared with people who have no account, and sharing it does
not hand out write access. A guessed URL must not reveal that a board exists, and
a renamed board must not silently point at someone else's work.

## Decision

The readable URL is `/<username>/<slug>`. A `link`-visibility board appends a
4-character lowercase base32 suffix (`/<username>/<slug>-<rand4>`, 1 048 576
combinations per slug) so that enumeration is impractical while the URL stays
sayable; the suffix is regenerable and the previous URL answers `404`, never a
redirect. A `public` board is indexed and uses the clean slug. A `private` board
answers only to members.

A readable URL grants reading and never writing. Writing by link uses a separate
credential at `/l/<token>`: at least 22 base62 characters, stored as `sha256`
with the instance pepper, shown once, revocable, with `last_used_at` updated at
most once a minute.

Renames reserve the old username or slug for 90 days and answer `301` to the new
one. Usernames are globally unique and reserved names live in
`server/src/lib/reserved.ts`; a board slug is unique per owner.

## Consequences

- Three artefacts per board instead of one: the readable URL, the write token,
  the membership. They are separately revocable and separately attributed.
- Rotating a suffix invalidates every previously shared readable URL, which is
  the point; the owner confirms it.
- The 90-day reservation table grows monotonically; a sweeper deletes expired
  rows.
- `noindex` is required on every `link` board and every credentialed URL, in both
  the meta tag and `X-Robots-Tag`.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| A UUID-only URL | Unsayable and unsearchable; nobody shares `brd_01J…` in a chat. |
| A random suffix on every visibility | Makes `public` boards unindexable and adds noise to a URL that is already private by membership. |
| Redirect on suffix rotation | A redirect confirms that the board exists. |
| Making the readable URL write-capable | Any forwarded screenshot becomes a write credential, and there is nothing to revoke. |
