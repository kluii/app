# HTTP API

Base path `/api/v1`. OpenAPI 3.1 is generated from the Zod schemas in `server/src/contracts/`; the web client is generated from that document. If the document and the code disagree, the code is wrong and the document is the target.

---

## 1. Conventions

**Auth.** `Authorization: Bearer <session-token | kb_agent_key>` or the session cookie. A bearer credential wins over a cookie when both are present. Cookie-authenticated state-changing requests require the CSRF double-submit header (`X-Klui-CSRF`) matching the `klui_csrf` cookie.

**Content type.** `application/json; charset=utf-8` for every body. Import accepts `application/json` and `multipart/form-data` only in `POST /boards/:id/import` (a file field named `file`). Anything else → `415 unsupported_media_type`.

**Headers.**

| Header | Direction | Meaning |
|---|---|---|
| `X-Request-Id` | both | Accepted if `[A-Za-z0-9-]{8,64}`, else generated; echoed and logged. |
| `ETag` / `If-None-Match` | response / request | Only on `GET /boards/:id/state`; `304` when unchanged. |
| `Retry-After` | response | Seconds, on `429` and `503`. |
| `X-Klui-CSRF` | request | Double-submit token on cookie-auth writes. |

**Status codes.** `200` read/update, `201` create, `202` accepted (close-out generation, import), `204` delete, `304` not modified, `400` validation, `401` unauthenticated, `403` forbidden (readable board only), `404` not found **including unreadable**, `409` conflict, `413` payload too large, `415` media type, `429` rate limited, `500` internal, `503` dependency unavailable.

**Error body, always:**

```json
{"error":{"code":"validation_failed","message":"The request body is invalid.","hint":"Fix the fields listed in details.",
          "details":[{"path":"title","code":"too_small","message":"String must contain at least 1 character(s)"}]}}
```

`hint` is `null` when there is nothing useful to say; it is never absent. `details` exists only for `400` and `409`. Internal errors never include a stack trace; they carry the request id.

**Pagination.** Cursor only, never offset. `?limit=<1..100>&cursor=<opaque>`. The response is `{"items":[…],"next_cursor":"<opaque|null>"}`. Cursors are opaque base64url of `(created_at, id)` and must not be parsed by clients.

**Concurrency.** Every writable resource accepts `expected_updated_at` (ISO 8601, the value the client last saw). Mismatch → `409` with `{"error":{"code":"conflict","message":"…","hint":"Reload to see the current version.","current":{…}}}`. Omitting it means "last write wins", which is allowed only for actions that are inherently idempotent (`set_card_done`, `DELETE`).

**Idempotency.** `POST` create endpoints accept an optional `Idempotency-Key` header (max 64 chars, scoped per actor per route, 24 h). A replay returns the original response with `200` instead of `201`. Agents are expected to use it for retries.

**Rate limits.** Sliding window in memory per process (a restart forgives), `429` + `Retry-After`, body `{"error":{"code":"rate_limited"|"too_many_attempts",…}}`.

| Bucket | Limit | Enforced |
|---|---|---|---|
| Session writes | 120 / minute per user, per IP while signed out | yes, `KLUI_RATE_LIMIT_WRITES` |
| Session reads | 600 / minute per user, per IP while signed out | yes, `KLUI_RATE_LIMIT_READS` |
| Login attempts | 5 / 15 min per account, 20 / hour per IP | yes |
| Signup | 5 / hour per IP | yes |
| Anonymous writes per board | 30 / hour, `KLUI_ANON_WRITES_PER_BOARD` | yes |
| Anonymous writes per address | 10 / hour, `KLUI_ANON_WRITES_PER_IP` | yes |
| Anonymous joins per address | 20 / hour, `KLUI_ANON_JOINS_PER_IP` | yes |
| Agent key writes | 60 / minute | with the agent surface (K4) |
| Agent key reads | 600 / minute | with the agent surface (K4) |
| Import | 3 / hour per board | yes |
| Export | 10 / hour per board | yes |

The session buckets are one bucket per user across every route, not one per endpoint: a route added tomorrow is covered without being remembered. `GET /healthz` and the SSE stream are never counted. The login bucket counts failed attempts and is cleared by a successful one, so four typos then the right password is not a lockout. `KLUI_RATE_LIMIT=off` disables the session buckets and is the default outside production; the credential, join and anonymous-write buckets are separate and stay on, because a test suite that signs up fifty times from one address is not a production login storm.

The anonymous buckets are keyed on `request.ip`, which only honours `X-Forwarded-For` up to `KLUI_TRUSTED_PROXY_HOPS` proxies. With the default of `0` a spoofed header buys nothing; behind one proxy set `1` and the header's client address is used.

**Captcha.** `KLUI_CAPTCHA_ENABLED=true` turns on Cap for anonymous writes only, past `KLUI_CAPTCHA_THRESHOLD` writes from one address in the current hour (default 3). The write then needs `cap_token` in the body; without it the answer is `400 captcha_required`, with a token the instance could not verify it is `400 captcha_failed`, and when the Cap instance is unreachable it is `503 service_unavailable` — a captcha that cannot be checked never lets the write through. Klui posts `{token}` to `{KLUI_CAPTCHA_URL}/siteverify` with `Authorization: Bearer ${KLUI_CAPTCHA_SECRET}` and expects `{"success": true}`. Off by default, and no request leaves the instance while it is off.

**Versioning.** The path carries the major version. Additive fields are not a breaking change; removing or renaming one is, and requires a new path version plus a deprecation window documented in the changelog.

---

## 2. Objects

```jsonc
// Board
{ "id":"brd_…", "name":"Retro S2", "slug":"retro-s2", "visibility":"link",
  "link_role":"edit", "anon_write":"off", "link_suffix":"k3f9",
  "url":"https://host/will/retro-s2-k3f9",
  "owner":{"id":"usr_…","username":"will"},
  "closed_at":null,
  "created_at":"2026-11-26T09:00:00.000Z", "updated_at":"2026-11-26T09:00:00.000Z" }

// BoardState (one round trip paints the board)
{ "board": { … },
  "columns":[{"id":"col_…","name":"To Do","position":"1024"}],
  "cards":[{"id":"crd_…","column_id":"col_…","title":"Wire the digest","description":null,
            "assignee":{"id":"usr_…","username":"will"},"assignee_label":null,
            "due_at":null,"done":false,"position":"1024",
            "tags":[{"name":"api","color":"#8B5CF6"}],
            "created_at":"…","updated_at":"…"}],
  "members":[{"user_id":"usr_…","username":"will","role":"owner"}],
  "caller":{"actor_kind":"user","role":"owner","label":"will",
            "can_write":true,"can_manage":true,"can_moderate":false,
            "can_delete_card":true,"can_move_card":true,"can_comment":true,
            "can_manage_columns":true,"can_manage_members":true,
            "can_export":true,"can_import":true,"can_close":true},
  "pending_count":0 }

// Event
{ "id":"evt_…","type":"card.moved","actor_kind":"user","actor_label":"will",
  "payload":{"card_id":"crd_…","from_column":"col_a","to_column":"col_b","before":null,"after":"crd_…"},
  "created_at":"…" }
```

Ids are prefixed opaque strings (`brd_`, `col_`, `crd_`, `cmt_`, `evt_`, `usr_`, `key_`), 26 chars total, URL-safe. They are not UUIDs and clients must treat them as opaque.

Positions are serialized as **strings** (`"1024"`, `"1536"`) because they are `Decimal`. A client that parses them as floats will eventually round two cards onto the same rank.

---

## 3. Accounts

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/signup` | `{email, username, password, invite_token?}`. `201` + session cookie. `409` if the username is taken (case-insensitive) — the only endpoint allowed to reveal that a username exists, because the user chose it. |
| `POST` | `/auth/login` | `{email_or_username, password, totp?, recovery_code?}`. Same body and timing for unknown account and wrong password. If TOTP is required and absent → `401 totp_required` with no other information. `recovery_code` is the second way through the same gate: a code works once, and sending both fields answers `400 validation_failed`. |
| `POST` | `/auth/logout` | Revokes the current session. `204`. |
| `POST` | `/auth/logout-all` | Revokes every session of the actor. `204`. |
| `POST` | `/auth/totp/enroll` | `201` `{secret, otpauth_url, recovery_codes[]}` — the **only** time these are returned. |
| `POST` | `/auth/totp/verify` | `{code}` confirms enrollment; `200` on success, `400 invalid_code`. |
| `POST` | `/auth/totp/disable` | `{password, code}`; invalidates remaining recovery codes. |
| `POST` | `/auth/recovery-codes` | `{password}` regenerates; returns the new set once and invalidates the old. |
| `POST` | `/auth/reset/request` | `{email}`. Always `202`, whether or not the account exists. `503 email_not_configured` when SMTP is unset (fail closed, never a fake success). |
| `POST` | `/auth/reset/confirm` | `{token, password}`. Single-use; revokes every session on success. |
| `POST` | `/admin/users/:id/reset` | Instance admin only. `201` `{url, expires_at}`: a one-time link for out-of-band delivery, the documented path when SMTP is unset. The link is a credential and is never logged. |
| `GET` | `/auth/oidc/providers` | Public list of enabled OIDC providers (`{items:[{slug, name}]}`); empty when none are enabled. |
| `GET` | `/auth/oidc/:provider/start` | `302` to the provider; `state`, `nonce` and PKCE (S256) in a signed `httpOnly` cookie. |
| `GET` | `/auth/oidc/:provider/callback` | Creates or links, then `302` to `/boards` (or `/settings?oidc=linked`). Never auto-links an existing local account by email (`409` / link prompt). |
| `POST` | `/auth/oidc/:provider/link` | Explicit link for an already-signed-in user (`200 {url}`). |
| `GET` | `/me/oidc` | `{items:[{id, provider, provider_account_id, created_at}]}` linked to the caller. |
| `DELETE` | `/me/oidc/:provider` | `204`; unlinks that OIDC provider from the caller. |
| `GET` | `/me` | `{id, email, username, display_name, totp_enabled, is_instance_admin, created_at}`. |
| `PATCH` | `/me` | `{username?, display_name?, email?}`. Username change reserves the old value 90 days. |
| `POST` | `/me/password` | `{current_password, new_password}`. `204`; rotates the current session and revokes all other sessions (D-16). |
| `POST` | `/me/rotate` | `204`; revokes the current session and issues a new one in the same response, so a stolen cookie stops following the account. |
| `GET` | `/me/sessions` | `[{id, ip, user_agent, created_at, last_seen_at, current:bool}]`. |
| `DELETE` | `/me/sessions/:id` | `204`; deleting the current session logs out immediately. |
| `DELETE` | `/me` | `{password, confirm:true}`. Documented cascade; anonymises authored comments. |

---

## 3b. Instance administration

Every route here requires `is_instance_admin`. That role is operational: it
never grants board content. An admin who is not a board member gets the same
`404` as a stranger, and the authz matrix asserts it.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/admin/users` | `{items:[{id, username, email, is_instance_admin, created_at, banned, banned_until}], next_cursor}`, 50 per page, newest last, `?q=` filters on username or email. |
| `POST` | `/admin/users/:id/ban` | `{confirm:true, reason?, expires_at?}` → `201 {banned_until}`. Revokes every session of the target. An instance admin cannot be banned (`403`). |
| `DELETE` | `/admin/users/:id/ban` | `204`; lifts every active ban for that account. |
| `GET` | `/admin/bans` | `{items:[{id, subject, subject_kind:"user"|"ip", reason, expires_at, created_at}]}`: every active ban, both kinds, newest first, 100 maximum. |
| `POST` | `/admin/bans/ip` | `{ip, confirm:true, reason?, expires_at?}` → `201 {banned_until}`. `400` for an address that is not IPv4/IPv6. |
| `DELETE` | `/admin/bans/ip/:ip` | `204`; lifts every ban on that address. `404` when it was not banned. |
| `GET` | `/admin/oidc/providers` | `{items:[…]}` OIDC provider settings without `client_secret` (returns `has_secret: true`). |
| `POST` | `/admin/oidc/providers` | `{slug, name, issuer_url, client_id, client_secret, scopes?, enabled?}` → `201`. Off by default; secret sealed with AES-256-GCM. |
| `PATCH` | `/admin/oidc/providers/:slug` | Updates OIDC provider settings or toggles `enabled`. |
| `DELETE` | `/admin/oidc/providers/:slug` | `204`; deletes the provider configuration. |
| `POST` | `/admin/oidc/providers/:slug/test` | Performs live OIDC discovery (`/.well-known/openid-configuration`) and answers `200 {ok:true, issuer, authorization_endpoint, token_endpoint}` or `{ok:false, error}`. |
| `GET` | `/branding` | Public instance branding (`{instance_name, tab_title, logo_url, favicon_url, accent_color, accent_foreground}`). Defaults flow through the same fields. |
| `PATCH` | `/admin/branding` | Instance admin only. Updates `instance_name`, `tab_title`, `accent_color` (validated for WCAG AA contrast; fails with the measured ratio in the message) or clears `logo_url`/`favicon_url`. |
| `POST` | `/admin/branding/logo` | Instance admin only. Multipart upload (`file`, PNG or SVG ≤ 256 KB and ≤ 512×512; `?kind=favicon` sets the favicon). |

A user ban is enforced before authorization: the credential stops resolving, so
the next request is `401` and the next login answers `403 banned`. An address
ban is enforced on the anonymous paths — joining a board and writing a card —
and answers `403 banned` there; it never applies to an account signed in from
the same address. Both take effect on the next request, with no restart.

## 4. Boards

| Method | Path | Notes |
|---|---|---|
| `GET` | `/boards` | Boards the actor can read, `{items:[…]}`, newest activity first. Includes role. Closed boards are listed with `closed_at` set (there is no archive, D-53). |
| `POST` | `/boards` | `{name, visibility?, template?}`. `201` + Board. Default visibility `private`. A template seeds columns (`classic`: To Do / Doing / Done; `blank`: none). |
| `GET` | `/boards/:id` | Board without content. `404` if unreadable. |
| `PATCH` | `/boards/:id` | `{name?, slug?, visibility?, link_role?, anon_write?, expected_updated_at?}`. Changing to `private` forces `link_role:none` and `anon_write:off` in the same transaction. Changing to `link` generates a suffix if absent. |
| `DELETE` | `/boards/:id` | `{confirm:true}` in the body. `204`. Owner only. |
| `GET` | `/boards/:id/state` | `BoardState`. `ETag` supported. |
| `GET` | `/boards/:id/search` | `?q&assignee&tags=<csv>&done&column&limit&cursor`. Server-side equivalent of the filter panel and of the MCP `search_cards` tool; returns `{items:[Card], next_cursor, truncated}`. Same `can()` gate as `state`. |
| `GET` | `/boards/:id/activity` | `?limit&cursor&actor_kind=user|agent|anon&type=<csv>`. `{items:[Event],next_cursor}`. |
| `GET` | `/boards/:id/export.json` | `klui.export/v2`, `Content-Disposition: attachment`. |
| `GET` | `/boards/:id/export.md` | Markdown per `docs/features/import-export.md`. |
| `POST` | `/boards/:id/import` | `{format:"v2"|"v1"|"trello", data:<parsed json>}` or multipart `file` (one part named `file`, 5 MB; the format is read from the file, `?format=` overrides it). `202` with `{job_id, status, replayed, result}`; `import.progress` over SSE, `import.completed` in the event log. Idempotent on `(board_id, source_hash)`: the second call returns the first job with `replayed: true`. All-or-nothing: one invalid card writes nothing. `400 unsupported_schema` for a file that is none of the three, `413 payload_too_large` past a limit. |
| `POST` | `/boards/:id/close` | `{confirm:true, note?}`. Generates the summary, sets `closed_at`. `409` if already closed. Irreversible. |
| `GET` | `/boards/:id/summary` | The stored close-out summary (JSON). `404` until closed. |
| `GET` | `/boards/:id/summary.md` | The same summary as Markdown (`text/markdown`). `404` until closed. |
| `POST` | `/boards/:id/anon` | `{label}` (2–32 characters, trimmed). `200 {board_id, label, actor_kind:"anon"}` and a signed `klui_anon` cookie (12 h). `404` for a private board, `403` when `anon_write` is `off`. No account is created. |
| `GET` | `/boards/:id/public` | The board's name, visibility and `anon_write` for a credential-less visitor, plus `accepts_anon`. `404` unless an anonymous actor could read the board. |
| `GET` | `/boards/:id/members` | `[{user_id, username, role, joined_at}]`. |
| `POST` | `/boards/:id/members` | `{username, role:\"admin\"|\"editor\"|\"viewer\"}`. `201`. Owner/admin. `404` for an unknown username, `409` when the account is already a member. `owner` is not an accepted role here: ownership moves through `/transfer`. |
| `PATCH` | `/boards/:id/members/:userId` | `{role, expected_updated_at?}`. Cannot demote the last owner. |
| `DELETE` | `/boards/:id/members/:userId` | `204`. Cannot remove the owner; an admin cannot remove another admin. |
| `POST` | `/boards/:id/transfer` | `{user_id, confirm:true}`. Owner only; one transaction that demotes the old owner to admin, promotes the target, and updates `board.owner_id`. `400` when the target is not a member, `409` when it is already the owner. A partial unique index (`board_members_one_owner_per_board`) refuses two owners at any instant. |
| `GET` | `/boards/:id/pending` | `{items:[{id, column_id, title, description, tags, due_at, actor_label, created_at, expires_at}]}`. Owner/admin only (`moderation.list`). |
| `POST` | `/boards/:id/pending/:pendingId/approve` | `{confirm?:true}` not required. `201 {card_id}`: the card is created in the pending row's column, keeps `actor_label`, and the queue row is deleted in the same transaction. `404` if it is gone. |
| `POST` | `/boards/:id/pending/:pendingId/reject` | `204`, nothing created. Both verbs are `moderation.decide`. |
| `GET` | `/boards/:id/tag-colors` | `{ "api": "#8B5CF6", "web": "#2563EB" }` — the board-level defaults. |
| `PUT` | `/boards/:id/tag-colors` | Replaces the map. Keys are normalised tag names; values are `#RRGGBB`. Owner/admin only (it is a board setting; an editor can still colour a tag on a card, which is a card write). |

**URL semantics.** `private` and `public` boards answer on `/<username>/<slug>`; `link` boards on `/<username>/<slug>-<suffix>`. The API is id-based, so a URL never grants anything by itself. The segment is resolved **exact slug first, suffix second**: a board named "Board under test" keeps `board-under-test`, and its last four letters are not read as a suffix.

| Method | Path | Contract |
|---|---|---|
| `GET` | `/users/:username/boards/:slug` | Resolves a public URL to the page. `301` to `/<owner>/<slug>` (or the suffixed URL for a `link` board) **only for an actor who can read the board**; anything else, including a bare slug on a link board, a suffix that does not match, and a credential-less request, answers the same `404` an unknown slug answers. Renames inside their 90-day reservation redirect too, but only after that readability check. |
| `GET` | `/users/:username/boards/:segment/resolve` | What the SPA calls when a human opens `/<username>/<segment>`. `{board_id, url}` for an actor who can read the board, the same `404` otherwise. No cookie, no resolution: this is not a public read. |
| `GET` | `/users/:username/boards` | `{owner:{username}, items:[{id,name,slug,url,updated_at}]}` — **public** boards of that account, newest first. `404` for an unknown username. Never lists a `link` or `private` board. |

**HTML responses and crawlers.** `GET /<username>` is server-rendered inside `#root` (the SPA replaces it on mount): a crawler reads the public boards, a human gets the product page. `GET /<username>/<segment>` is the SPA shell with a computed `<head>`: `noindex` (meta **and** `X-Robots-Tag`) for a `link` board and for any board the caller cannot read, canonical URL and `og:*` for a `public` board. `/robots.txt` disallows `/api/`, `/l/` and `/mcp`, and names `/sitemap.xml`; the sitemap lists public boards and the profiles that own them, and nothing else. Every `/api/*` response carries `X-Robots-Tag: noindex`.

---

## 5. Links

| Method | Path | Notes |
|---|---|---|
| `GET` | `/boards/:id/links` | `[{id, role, label, created_at, last_used_at, revoked_at}]`. Never the token. |
| `POST` | `/boards/:id/links` | `{role:"read"|"edit", label?}`. `201` `{id, role, url:"https://host/l/<token>", token}` — token shown **once**, never retrievable again. `400 validation_failed` naming `link_role` when the board's `link_role` is `none`: a token that could never read is not minted. |
| `DELETE` | `/boards/:id/links/:linkId` | `204`; the URL answers `404` immediately after. |
| `POST` | `/boards/:id/link-suffix/rotate` | `{confirm:true}` → new suffix, old URL `404`s. |

`/l/<token>` is a server-rendered route: it resolves the link, sets a signed `klui_link` cookie holding `linkId.boardId` (httpOnly, `SameSite=Lax`, 30 days), and `302`s to the board with the link actor active. The row is re-read on every request, so revoking a link ends the next call with no session refresh; a revoked or unknown token answers the `404` page, never a redirect. The route is `noindex` and never appears in a log with the token intact.

---

## 6. Columns and cards

| Method | Path | Notes |
|---|---|---|
| `POST` | `/boards/:id/columns` | `{name, position?}` where `position` is `{before?, after?}` (column ids) or omitted (append). |
| `PATCH` | `/columns/:id` | `{name?, position?, expected_updated_at?}`. |
| `DELETE` | `/columns/:id` | `409 column_not_empty` unless `{move_cards_to:"<column id>"}` or `{delete_cards:true}`. |
| `POST` | `/boards/:id/cards` | `{column, title, description?, assignee?, due_at?, tags?, done?, cap_token?}`. `column` is a column id, not a name. `cap_token` is only read for an anonymous actor past the captcha threshold. |
| `POST` | `/boards/:id/cards/bulk` | `{column, items:[…]}` max 200; one transaction; returns `{created:[Card]}`. Partial failure rolls back everything. `column` must belong to this board, or `404 column_not_found` and no card is written. An anonymous actor on a `moderated` board gets `202 {status:"pending", board_id, items:[{id,title}…]}` instead: one queue row per item, in one transaction, no card and no event. |
| `GET` | `/cards/:id` | Card + `comments_count`. |
| `PATCH` | `/cards/:id` | Any of `{title, description, assignee, assignee_label, due_at, tags, done, expected_updated_at}`. |
| `DELETE` | `/cards/:id` | `204`. |
| `POST` | `/cards/:id/move` | See §6.1. |
| `GET` | `/cards/:id/comments` | `{items:[Comment],next_cursor}`. |
| `POST` | `/cards/:id/comments` | `{body}`. Users with `editor+` only. `403` for link/anon actors (never `404`: they can read the card). |
| `PATCH` | `/comments/:id` | `{body}`. Author only; sets `edited_at`. |
| `DELETE` | `/comments/:id` | Author, or owner/admin for moderation. |

**Anonymous actors.** `POST /boards/:id/cards` as an anonymous actor answers `201` on `anon_write: open` (the card carries `actor_label` and `mine: true` for its author) and `202 {status:"pending", id, title}` on `moderated` — no card, no event, one `PendingCard`. `POST /boards/:id/cards/bulk` takes the same branch: `201 {created}` on `open`, `202 {status:"pending", items:[{id,title}…]}` on `moderated`, one queue row per item in one transaction. `off` answers `403` on both. `PATCH /cards/:id` accepts only changes to `title`, `description` and `done`, and only on a card whose `anon_actor_id` is the caller's; anything else is `403` naming the field. `DELETE`, `move` and comments are always `403` for an anonymous actor.

**Card field rules.** `title` 1–200 chars, trimmed, no newline. `description` ≤ 10 000 chars, markdown subset (no raw HTML, no images). `tags` ≤ 8 entries, each `{name, color?}`; `name` is 1–24 chars `[a-z0-9-]`, normalised lowercase, deduplicated; `color` is `#RRGGBB` or omitted (omitted → the board default, else the neutral chip). A bare string in the `tags` array is accepted on input as shorthand for `{name}`; responses always emit objects. `due_at` ISO date or datetime, stored UTC. `assignee` is a member user id; `assignee_label` is a display name (v1 import, anonymous creation) — setting both is a `400`. `done` is a boolean on the card; toggling it records `card.completed` / `card.reopened`.

### 6.1 `POST /cards/:id/move`

```json
{ "column": "col_target", "before": "crd_above_or_null", "after": "crd_below_or_null",
  "expected_updated_at": "2026-11-26T09:00:00.000Z" }
```

- `before` / `after` are card ids **the client actually rendered**. Both may be `null` (empty column or empty space).
- The server resolves them **against the stored column**, not against any client list, ranks between their stored positions, renumbers the column when the gap is exhausted, and **appends** when a named neighbour no longer exists or is not in the target column.
- `expected_updated_at` is optional and honoured like every other write: a stale value answers `409` with the current card and the card does not move. Two people dragging the same card therefore cannot silently overwrite each other (D-28).
- A body containing `index`, `position` or `order` is rejected with `400 unknown_field` and a hint naming the accepted shape. This rejection is deliberate: accepting it would reintroduce the bug.
- Response: `{card, column_id, position}`. The client uses the returned `position` to reconcile its optimistic placement.

### 6.2 Card state and realtime ordering

Every mutation response is also published to the board's SSE subscribers. **An echo can arrive before the HTTP response to the same mutation.** Clients merge by id, never append: a create handler that appends will duplicate the card under a slow link. The same rule applies to columns, comments and pending cards.

---

## 7. Agents and operations

| Method | Path | Notes |
|---|---|---|
| `POST` | `/agent-keys` | `{name, scope:"board"\|"user", board_id?, expires_in_days?}` (default 90, 1..365; `board_id` is required for `board` and refused for `user`). `201` `{id, key, name, scope, board_id, board_name, role, expires_at, last_used_at, revoked_at, created_at}` — `key` (`kb_` + 32 base62) appears in this response and nowhere else. A session issues keys; a key that tries answers `403`. |
| `GET` | `/agent-keys` | `{items:[…]}` without `key` or `key_hash`: id, name, scope, board, role, created, last used, expires, revoked. |
| `DELETE` | `/agent-keys/:id` | `204`; effective on the next request (`401 invalid_credential`). Idempotent on an already-revoked key. |
| `POST` | `/agent-keys/:id/test` | `{key?}` → `200 {ok:true, via:"mcp"\|"inline", board, role, key}` or `{ok:false, via, reason:"revoked"\|"expired"\|"key_mismatch"\|"key_required"\|"board_not_found"\|"forbidden"\|"unreachable"\|"mcp_error"}`. With `KLUI_PUBLIC_URL` set the server calls its own `/mcp` (`initialize` then `tools/call whoami`, plus `list_boards` for a board-scoped key) with the presented key, so an unreachable endpoint or a `-32603` is a refusal; `key_required` means the key was not presented and a hash cannot authenticate. `via:"inline"` is the in-process fallback for an instance with no public URL. |
| `GET` | `/me/digest` | `{enabled, hour, timezone, channels:{webhook,email,rss}, last_sent_at, last_result, rss_url?, unsubscribe_url?}`. `last_result` is `"sent"`, `"empty"`, or `null` before the first run. `rss_url` and `unsubscribe_url` appear only in the response that minted them: both tokens are hashed at rest and cannot be read back. |
| `PATCH` | `/me/digest` | `{enabled?, hour? (0..23), timezone? (an IANA zone: `Mars/Olympus` and `+01:00` both answer `400 validation_failed`), webhook? (https or `null`), email?, rss?: "rotate"|"disable"}`. `rss:"rotate"` mints a new RSS token and a new unsubscribe token; `"disable"` drops the RSS hash. Writes one `digest.updated` event. |
| `POST` | `/me/digest/test` | Builds the digest from the account's real events and cards, then delivers it to the configured channel: `{sent:true, sections, bytes}`. An empty digest sends nothing and answers `{sent:false, reason:"empty"}`; no channel configured is `400`; an email-only account with SMTP unset is `503 email_not_configured`. |
| `GET` | `/me/digest/rss/:token` | `application/rss+xml`, `X-Robots-Tag: noindex`. One item: the last digest actually delivered, so nothing is invented for a reader. `404` before the first send, after `rss:"disable"`, and for a token a rotation replaced. No session: the token is the credential. |
| `GET` | `/me/digest/unsubscribe/:token` | `text/html`, `X-Robots-Tag: noindex`, sets `enabled:false` and deletes nothing. No session and no CSRF: the point of the link is that it works from a mail client after the session is gone. `404` for an unknown token. |
| `GET` | `/me/notifications` | `{items:[{id, kind, event_id, payload, read_at, created_at}], unread_count}`. Account-scoped, newest first, polled by the header bell every 15 s. |
| `POST` | `/me/notifications/:id/read` | `204`; marks one notification read. `404` if not owned by the caller. |
| `POST` | `/me/notifications/read-all` | `204`; marks every unread notification for the caller as read. |
| `GET` | `/me/notifications/prefs` | `{muted_kinds, webhook_url, failures}`. Per-type mute list and optional Discord/Slack webhook. |
| `PATCH` | `/me/notifications/prefs` | `{muted_kinds?, webhook_url?}` (`webhook_url` must be `https://` or `null`). Resets failure count when changing webhook. |
| `GET` | `/healthz` | `{"status":"ok","version":"<package version>","db":"up"}`; `503` with `db:"down"` otherwise. No auth. |
| `GET` | `/metrics` | Off by default (`404`). When enabled: loopback or `Authorization: Bearer $KLUI_METRICS_TOKEN`. |
| `POST` | `/mcp` | See `docs/mcp.md`. |
| `GET` | `/api/v1/stream` | SSE. `?board=<id>` (repeatable). Auth as usual. |
| `GET` | `/llms.txt` | Plain text; describes the MCP endpoint and the tool list. |

---

## 8. Events catalogue

`payload` keys are part of the contract: the digest, the activity feed and the close-out summary read them.

| Type | Payload |
|---|---|
| `board.created` | `{board_id, name, visibility}` |
| `board.updated` | `{board_id, changes:{field: [old, new]}}` |
| `board.closed` | `{board_id, summary_id}` |
| `board.deleted` | `{board_id, name, slug, owner, counts:{columns, cards, comments}}` — written twice in the delete transaction: once board-scoped (dies with the cascade, carries the SSE payload) and once with `board_id: null`, which is the durable record (D-54) |
| `member.added` | `{board_id, user_id, role}` |
| `member.updated` | `{board_id, user_id, from, to}` |
| `member.removed` | `{board_id, user_id}` |
| `column.created` / `column.updated` / `column.deleted` | `{board_id, column_id, name?, from?, to?}` |
| `card.created` | `{board_id, card_id, column_id, title}` |
| `card.updated` | `{board_id, card_id, column_id, title, changes:{field: [old, new]}}` |
| `card.moved` | `{board_id, card_id, title, from_column, to_column, to_column_name, before, after}` |
| `card.completed` / `card.reopened` | `{board_id, card_id, column_id, title}` |
| `card.deleted` | `{board_id, card_id, column_id, title}` |
| `comment.created` / `comment.updated` / `comment.deleted` | `{board_id, card_id, comment_id, body_excerpt}` — `deleted` keeps the excerpt so the digest can say what was removed |
| `link.created` / `link.revoked` | `{board_id, link_id, role}` |
| `pending.created` | `{board_id, pending_id, title}` — written **only** when a write is moderated; a moderated write itself writes nothing |
| `pending.approved` / `pending.rejected` | `{board_id, pending_id, card_id?, title, actor_label, approved_by}` — one event per decision, actor is the approver |
| `pending.expired` | `{board_id, pending_id, title}` — written by the sweeper with `actor_kind: system` |
| `agent_key.created` / `agent_key.revoked` | `{key_id, name, scope, board_id?}` |
| `digest.updated` | `{changes:[field, …]}` — `board_id: null`: the digest is an account setting, and the log says it moved |
| `import.completed` | `{board_id, format, columns, cards, comments}` |

`changes[field]` uses `[old, new]` with `null` for absence. `body_excerpt` is at most 120 characters and is the only place comment text is duplicated into the event log — it exists so the digest can say what happened without a join, and it is stripped on export.

---

## 9. OpenAPI generation

**Nothing in this section is built.** `KLUI_OPENAPI` is declared in `env.ts` and read by nothing; there is no `/api/v1/openapi.json` route, no generated client and no golden-pair contract test. This is the agreed shape of the work, kept so the shape is not re-litigated, and `server/test/api-docs.test.ts` holds §3–§7 to the routes that exist.

- One Zod schema per request and response, exported from `contracts/`. Routes reference them; no route declares an inline shape.
- `@fastify/swagger` generates the document at boot; `GET /api/v1/openapi.json` serves it (auth: any authenticated actor; `404` when `KLUI_ENV=production` and `KLUI_OPENAPI=false`).
- The web client (`web/src/api/client.ts`) is generated with `openapi-typescript` into a committed file; regenerating it is part of the build, and a CI step fails when the committed file is stale.
- A contract test asserts a golden request/response pair per endpoint, including every documented error shape. The 404-not-403 rule is one of them.

---

## Not yet served

The tables above are the contract. A row that is documented and answered by
nobody yet is listed here, so the difference is a claim with an owner instead of
a gap a reader discovers with a 404. `server/test/api-docs.test.ts` fails when
one of them starts being served (then it moves up into its section). The table
is empty: every path this file documents is answered by the server today.

| Method | Path | Serves it |
|---|---|---|
