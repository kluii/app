# Links, visibility and anonymous participation

The wedge of the product, and the part with the most ways to go wrong. Three separate things must stay separate:

| | What it is | Secret? | Revocable? | Attributed? |
|---|---|---|---|---|
| Readable URL | `/will/retro-s2-k3f9` | No | No (rotating the suffix invalidates it) | No |
| Share link | `/l/<22+ base62>` | Yes | Yes | Label only, plus `last_used_at` |
| Account | Session | Yes | Yes | Yes |

**A readable slug grants reading. Never writing.** Any code that accepts a write authenticated by the readable URL is a defect.

---

## 1. Visibility

| Value | Read by | Indexed | Canonical URL |
|---|---|---|---|
| `private` (default) | members only | no | `/<username>/<slug>` |
| `link` | anyone with the URL | `noindex` | `/<username>/<slug>-<rand4>` |
| `public` | anyone | yes, listed on the owner profile | `/<username>/<slug>` |

- Suffix: 4 chars, lowercase base32 (`abcdefghijklmnopqrstuvwxyz234567` minus look-alikes), generated from a CSPRNG. 1 048 576 combinations per slug; the point is that enumeration is impossible in practice while the URL stays sayable.
- The suffix is regenerable from settings; the old URL answers `404` immediately (not a redirect — a redirect confirms the board exists).
- `private` forces `link_role: none` and `anon_write: off`. The API rejects the combination; the database has a check constraint.
- `public` boards appear on the owner's profile and in the sitemap; `link` boards never do.

## 2. Share links are read-only

`read` (the only writable value) | `none`, independent of visibility.

- `read`: read board, cards, comments, activity, members list (names only, no emails). Nothing else.
- `none`: members only; the board behaves as private for everyone else.
- `edit`: **retired.** The literal survives in the schema and in rows written before this rule, so old data does not break, and it grants nothing at all. The API refuses to set it (`400 validation_failed`, `a share link is read-only`).

The rule behind it: **a board is written by its members.** A link holder is a reader. Work that must be written arrives through an account (or an agent key issued by one); a share link can be forwarded to anyone, so it cannot be a write credential. The share dialog therefore offers no role selector — it says what a link is and nothing more.

## 3. Write links

- `POST /boards/:id/links` → `{id, role, label?, url, token}`. The token is `<22+ base62>`, returned **once**.
- Stored as `sha256(token)` (with `KLUI_TOKEN_PEPPER`), never in clear, never in a log, never in an event payload.
- `/l/<token>` resolves the link, sets a signed `klui_link` cookie holding `linkId.boardId` (`httpOnly`, `SameSite=Lax`, 30 days, `noindex`) and `302`s to the board with a `link` actor active. The cookie names a row, not the token: the row is re-read on every request, so revocation is effective immediately. One cookie covers every board the visitor holds a link for; `can()` still scopes each actor to its own board, and a second board answers `404`.
- A token is only minted when the board's `link_role` is not `none`. Minting a credential the board would ignore is a `400`, not a dead URL. A link is minted readable, always: there is no role to choose.
- Revoking sets `revoked_at`; the next request answers `404`. `last_used_at` updates at most once a minute (a write per request is a free amplification vector).
- Rotation = create a new link + revoke the old one. There is no "same token, new secret".
- The settings UI shows metadata forever and the token never again: "created 2026-11-26 · last used 3 min ago · revoke".

## 4. Anonymous participation

**Nobody writes without an account.** An anonymous visitor reads a shared board and nothing more: the display name below is how the page stays readable without a wall, not a way in.

Requirements: a display name, 2–32 characters, chosen client-side, stored per event and per card as `actor_label`. It is not an account: it grants nothing, is not unique, cannot be reused on another board, and cannot be used to sign in.

- **Session:** a signed cookie `klui_anon` (12 h) containing `{boardId, label, anonId}`. `anonId` is 16 random bytes, stored on the cards the actor creates (`cards.anon_actor_id`). It is the only thing that makes "edit the card I just created" enforceable without an account.
- **Can:** read the board, its cards, its comments and its activity — exactly what a link holder reads.
- **Cannot:** create, update, complete, move or delete a card; comment; change settings; export. The API answers `403 forbidden` for every one of them, whatever the board's stored policy says.
- `anon_write` is kept for compatibility only: existing rows keep `open` or `moderated` and it grants nothing, and the API refuses to set either again (`400 validation_failed`, `anonymous writes are no longer available`). Only `off` can still be written, and the daily caps that used to guard anonymous writes now guard nothing but the join gate.
- The name is remembered per board in the visitor's own browser (`localStorage`); the cookie carries it for the session, and nothing else stores it.
- A name collision between two anons is allowed and expected. Attribution is "someone calling themselves X", and the UI says so on hover.

## 5. Moderation

- The queue lists pending cards with board, column, title, description, author label, age. Owner/admin can approve (→ real card, anon label preserved, `pending.approved` event with the approver) or reject (`pending.rejected`, nothing created).
- 7-day expiry, purged by the sweeper every five minutes behind a Postgres advisory lock; the author is not notified (they have no account). The sweep records `pending.expired` with `actor_kind: system`, so a deletion nobody asked for is visible in the log.
- A moderation banner on the board for owner/admin: "3 cards waiting".
- Approving is the only path that creates a card from a pending row; there is no auto-approve after N minutes. Nothing can add a row to the queue any more (see §4), so it drains what a previous deployment wrote and then stays empty.

## 6. Abuse

- Per-board anonymous write cap (30/hour default) — the cap, not a captcha, is what makes an open board survivable.
- Per-IP and per-session buckets; a ban blocks the next request.
- Cap captcha is optional, off by default, triggered past a threshold, and explicitly **not** a security control.
- Every anonymous event carries `actor_kind: anon`, so the activity feed can be filtered and a raid is visible in one view.
- The owner can switch `anon_write` to `moderated` or `off` at any time; the change takes effect on the next request (no cache).

## 7. URL and SEO rules

- `link` boards, `/l/*`, RSS, OG images of link boards: `noindex` meta + `X-Robots-Tag: noindex`.
- OG cards are generated server-side from the board's real name and counts; they contain no card titles (a preview must not leak content into a chat unfurl beyond what the board itself shows).
- A bot that fetches `/b/<token>` style URLs must receive a real HTML document with OG tags, because unfurlers do not run JavaScript. That route is served by the server, not the SPA.
- A URL segment is resolved **exact slug first, then `slug-suffix`**. Splitting four trailing characters first made `board-under-test` resolve as board `board-under` with suffix `test`, which hid a public board whose name ended in a word.
- The owner profile (`/<username>`) is prerendered inside `#root` for crawlers and rendered by the SPA for humans; `/sitemap.xml` lists public boards and those profiles, `/robots.txt` disallows `/api/`, `/l/` and `/mcp`.
- Guessed URLs answer the standard 404 page, with the same timing shape as a real 404.

## 8. Acceptance

- A `link` board with a wrong suffix answers `404`, and so does the old suffix after rotation.
- A link holder sees no edit affordance (not a disabled one) and the API answers `403` for a write, including a board whose stored `link_role` is `edit`.
- An anonymous visitor can read and cannot write or comment; the same answer on every stored policy.
- `PATCH {anon_write: 'open'}` and `PATCH {link_role: 'edit'}` answer `400 validation_failed` with their own message.
- A row already in the queue is approved with the label preserved; no new row can be created.
- The raw link token appears in exactly one response, ever (grep the database and the logs).
