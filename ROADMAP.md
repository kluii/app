# Klui 2.0 — Roadmap

> Sequencing document for the `klui` application repository. Read `PROMPT.md` first, then this file, then `DESIGN.md` and `docs/`.
>
> One task at a time, in order. A task starts only when every task it depends on has its exit criteria green **and recorded** in `docs/verify/<wave>.md`. A task that cannot meet its exit criteria is not "mostly done": it is open, and the next task does not start.

---

## How to use this file

- **IDs** are `K<wave>-<nn>`. Use them in branch names only as a suffix if it helps you (`feat/board-drag-neighbours`, never `feat/K2-04`).
- **Size** is a relative effort marker, not a calendar promise: `S` ≤ half a day, `M` 1–3 days, `L` 3–6 days, `XL` > a week. The wave estimates are the brief's, kept for planning only.
- **Exit** is the check a stranger can run. "Implement X" is not an exit criterion; "X returns Y and the test named Z proves it" is.
- **Gate** is the subset of the full gate that must be green for that task (the full gate runs at every wave close).
- A task with `dep:` empty can start as soon as its wave opens.

**Status legend:** `[ ]` todo · `[~]` in progress · `[x]` done and verified · `[!]` blocked (reason written in the verify file)

---

## Wave map

```
K0 Foundation        skeleton, CI, schema v1, compose, ADRs
 └─ K1 Identity      auth, sessions, can(), boards CRUD, minimal UI
     └─ K2 Board     design system, DnD, cards, comments, activity, export, close-out
         └─ K3 Links participation model, anon write, moderation, member UI
             └─ K4 Agents  keys, MCP, parity, setup panel
                 └─ K5 Release polish, branding, digest, i18n, a11y, 2.0.0
```

K3's **schema** must land inside K1, not K3. The permission model is the product's spine and every table references it; a migration that adds `link_role`, `anon_write` and moderation tables in wave 3 means rewriting wave 1's authorization tests. Build the tables early, gate the UI late.

K5 is not "the leftovers": the cut line below says which K5 items are 2.0 and which may slip to 2.1 without ceremony.

---

## K0 — Foundation (est. 1 week)

**Goal:** an empty-but-honest project: it boots, it migrates, it answers `/healthz`, CI runs for real, and the irreversible decisions are written down.

**Wave exit:** on a clean machine, `docker compose up -d` yields `{"status":"ok","version":"0.1.0","db":"up"}`; CI exists **and a run is observable** with the log line pasted into `docs/verify/k0.md`.

- [ ] **K0-01 — Repository bootstrap** `S` · dep: —
  `LICENSE` (AGPL-3.0 full text, both repos), SPDX header `AGPL-3.0-only` in every source file, `README.md` (three paragraphs: what it is, how to run it, where the docs are; no badges, no roadmap), `.gitignore`, `.editorconfig`, `.nvmrc`, `.prettierrc`, `.prettierignore`.
  **Exit:** `grep -rl "SPDX-License-Identifier" --include="*.ts" --include="*.tsx" src server/src web/src | wc -l` equals the number of source files; `npx prettier --check` on tracked files is clean.

- [ ] **K0-02 — Workspaces and scripts** `S` · dep: K0-01
  Root `package.json` with npm workspaces `web` and `server`; `dev`, `build`, `typecheck`, `lint`, `format:check`, `test` scripts that work from the root and from each workspace.
  **Exit:** `npm ci && npm run typecheck` succeeds on a fresh clone with the stub workspaces.

- [ ] **K0-03 — Server skeleton** `M` · dep: K0-02
  `server/src/server.ts` (plugins, graceful shutdown, request id), `app.ts` (route registration), `env.ts` (Zod-validated env, fails closed with **one** error listing every missing variable), `db.ts`, `lib/errors.ts` (`AppError` with code/status/hint and the `{error:{code,message,hint}}` serializer), `lib/logger.ts` (no PII, correlation id).
  **Exit:** booting with a missing `DATABASE_URL` exits non-zero and prints every missing variable in one message; `GET /healthz` returns the contract shape; a thrown `AppError` serializes to the documented envelope.

- [ ] **K0-04 — Prisma schema v1 and boot migrations** `M` · dep: K0-03
  Every model from `docs/architecture.md` §Data model, including the participation columns (`visibility`, `link_role`, `anon_write`, `link_suffix`, `BoardLink`, `PendingCard`, `AgentKey`) and the anonymous-attribution columns. First migration committed.
  **Exit:** `prisma migrate deploy` on an empty database creates the schema; `prisma migrate deploy` a second time is a no-op; the boot gate (K0-06) replays it on a database with rows.

- [ ] **K0-05 — Container and compose** `M` · dep: K0-04
  Multi-stage `Dockerfile` (build web + server, runtime `npm ci --omit=dev`), `compose.yaml` (app + `postgres:16`, volume `klui_pgdata` — do not rename), `.env.example` with every variable from `docs/deployment.md`, entrypoint `prisma migrate deploy && node server/dist/server.js`.
  **Exit:** `docker compose up -d` on a clean machine answers `/healthz` with `db:"up"`; restarting the stack preserves data; `docker compose down && up -d` re-runs migrations idempotently.

- [ ] **K0-06 — Boot gate** `S` · dep: K0-05
  A test that seeds a database, boots the server, runs migrations, and compares row counts before and after.
  **Exit:** the test prints identical counts for every table; it fails when a migration drops a column with data.

- [ ] **K0-07 — CI, observed** `M` · dep: K0-02
  Workflow on every push to every branch: install, `prettier --check` on tracked files, `tsc --noEmit`, lint, unit tests. Cache npm. Upload the run log on failure.
  **Exit:** a run exists for a real push, its log shows each step passing, and the run URL plus one log line are pasted in `docs/verify/k0.md`. A workflow that exists but never executed is not CI.

- [ ] **K0-08 — ADRs and working agreement** `M` · dep: —
  `docs/adr/0001-stack.md` (licence, DCO, exact resolved versions), `0002-permission-model.md`, `0003-url-scheme.md`, `0004-anonymous-writes.md`, `0005-digest-determinism.md`, `0006-no-ssr.md`. `AGENTS.md` with install/run, gate commands, branch and commit convention, the non-negotiables, and the traps.
  ADR ids 0007–0020 are already reserved by `docs/decisions.md`; write each one at the wave that implements it (0011 tag colours at K2-14, 0012 close-out and no-expiry at K2-12).
  **Exit:** each ADR follows context/decision/consequences/alternatives; ADR-0001 lists the exact version of `@tanstack/db`, `@tanstack/react-hotkeys` and `pragmatic-drag-and-drop` as installed.

- [ ] **K0-09 — Documentation skeleton** `S` · dep: K0-08
  `docs/architecture.md`, `api.md`, `mcp.md`, `permissions.md`, `security.md`, `deployment.md`, `testing.md`, `decisions.md`, `features/`, `verify/` — present, indexed, and kept current as the code changes. Docs are deliverables, not souvenirs.
  **Exit:** every document in the read order of `PROMPT.md` exists and opens.

---

## K1 — Identity, authorization and the first board (est. 3–4 weeks)

**Goal:** accounts that work, a session that behaves, and one permission function that cannot be bypassed. Two people, two private boards, mutual `404`.

**Wave exit:** two accounts each create a private board and each receives `404` on the other's — proven by a REST test and by a browser journey; the full authz matrix is green; every endpoint in `docs/api.md` §Accounts and §Boards (except links and close-out) is implemented against golden contract tests.

- [ ] **K1-01 — Schema completion** `M` · dep: K0-04
  Final pre-2.0 schema: sessions, TOTP, recovery codes, OIDC accounts, instance settings, board members, board links, columns, cards, tags, comments, events, pending cards, agent keys, digest prefs, notifications. One migration.
  **Exit:** `prisma migrate deploy` from empty is clean; the boot gate re-run keeps counts identical; `prisma generate` inside `server/` leaves `tsc` green.

- [ ] **K1-02 — Password authentication** `M` · dep: K1-01
  `POST /auth/signup`, `/auth/login`, `/auth/logout`. `argon2id`, min 12 chars, breached-password check at signup, per-account and per-IP throttling, constant-time responses, no user enumeration on login or reset.
  **Exit:** contract tests for success and every failure shape; a login with a wrong password and a login against a non-existent account return the same body and take comparable time (measured, not asserted by eye).

- [ ] **K1-03 — Sessions** `M` · dep: K1-02
  Server-side sessions, rotating ids, `httpOnly` + `SameSite=Lax` + `Secure`, CSRF double-submit on state-changing requests, `POST /auth/logout-all`, `GET /me/sessions`, `DELETE /me/sessions/:id`.
  **Exit:** a stolen pre-rotation cookie is rejected after rotation; revoking one session leaves the others valid; a POST without the CSRF token answers `403` with code `csrf_failed`.

- [ ] **K1-04 — TOTP and recovery codes** `L` · dep: K1-03
  Enroll, verify, disable; policy `available` (default) | `required` | `disabled`; recovery codes shown once, hashed, single-use, regenerable (regeneration invalidates the old set).
  **Exit:** a `required` instance refuses a password-only login with code `totp_required`; a used recovery code is rejected on second use; disabling TOTP invalidates the remaining codes.

- [ ] **K1-05 — Password reset, fail-closed** `M` · dep: K1-02
  Single-use hashed tokens, anti-enumeration responses, session invalidation on reset. Without SMTP configured the endpoint answers `503` with a documented admin path — it never pretends to send.
  **Exit:** with no SMTP, request answers `503 email_not_configured`; with a fake transport, the token is single-use; a successful reset invalidates every existing session.

- [ ] **K1-06 — Instance bootstrap and settings** `S` · dep: K1-02
  First account becomes instance admin; `InstanceSettings` row created at boot; `KLUI_REGISTRATION_OPEN` respected; admin can list users and ban/unban.
  **Exit:** on an empty database the first signup is admin; the second is not; registration closed answers `403 registration_closed`.

- [ ] **K1-07 — `can()` and the matrix** `L` · dep: K1-01
  `Actor` union (`user` | `link` | `anon`), `Action` enum, `can()` in `server/src/lib/authz.ts`, exhaustive table test over visibility × link role × anon policy × member role × actor kind, including every deny cell, both for board-level and card-level actions.
  **Exit:** the matrix test enumerates at least 4 visibilities-policies × 4 roles × 3 actor kinds × every action, asserts every cell, and fails when a single `allow` is flipped.

- [ ] **K1-08 — Usernames, slugs, reserved list** `S` · dep: K1-01
  One validation module used by REST, MCP and the UI; `server/src/lib/reserved.ts`; uniqueness case-insensitive; rename reserves the old value for 90 days and `301`s to the new one.
  **Exit:** a table test covers each rule including leading/trailing hyphen, uppercase, reserved word, duplicate with different case; the UI form and the API return the same error code for the same input.

- [ ] **K1-09 — Boards CRUD with 404 semantics** `L` · dep: K1-07
  `GET/POST /boards`, `GET/PATCH/DELETE /boards/:id`, `GET /boards/:id/state`, `GET /boards/:id/members` (list only in this wave), `visibility` default `private`, `expected_updated_at` on PATCH and DELETE.
  **Exit:** a non-member GET answers `404` with body identical to a non-existent board; `PATCH` with a stale `expected_updated_at` answers `409` + current row; deleting a board requires `confirm: true`.

- [ ] **K1-10 — Columns, cards, ranks** `L` · dep: K1-09
  Column and card routes; fractional `Decimal` positions; `insertBetween(prev, next)` with renumber-on-gap-exhaustion; tags as `{name, color?}` with the board default map; due date; assignee label vs assignee user; `POST /cards/:id/move` with `{column, before, after}`.
  **Exit:** unit tests for rank insertion at head, tail, middle, and between adjacent ranks (renumber path); a move naming neighbours that were deleted appends instead of failing; a move with an index is rejected by the schema.

- [ ] **K1-11 — Event log helper** `M` · dep: K1-10
  One `recordEvent()` called by every mutation; `GET /boards/:id/activity` with cursor pagination, newest first, grouped by day in the client.
  **Exit:** every mutating route test asserts an event row with the right `type`, `actor_kind` and payload keys; deleting a card does not delete its events.

- [ ] **K1-12 — Minimal web shell** `L` · dep: K1-09
  Auth pages (sign in, sign up, TOTP, reset), app shell, boards index, board read view with columns and cards (no drag yet), 404 page, account menu with sign out, theme bootstrap.
  **Exit:** a Playwright journey signs up, creates a board, adds a column and a card, reloads, and sees them; a second account gets the same page for another user's board as for a URL that never existed.

---

## K2 — The board (est. 5–6 weeks)

**Goal:** the board is the product. It must feel physical, stay correct under concurrent edits, and survive 10 000 events.

**Wave exit:** the drag journey (middle of a populated column, reload, order persists) passes three consecutive CI runs; keyboard drag works; the board is usable at 390 px; export → import round-trip is byte-identical modulo timestamps.

- [ ] **K2-01 — Tokens and theme** `M` · dep: K1-12
  `web/src/styles/tokens.css` with both sets, the Tailwind mapping, the pre-React inline bootstrap, and a computed-contrast test that parses both sets and measures text against **every** surface.
  **Exit:** the contrast test fails when one token is moved below 4.5:1 against any surface; a light-theme reload shows no dark flash (recorded as a Playwright screenshot pair).

- [ ] **K2-02 — UI primitives** `L` · dep: K2-01
  shadcn copy-ins in `web/src/components/ui/`: button, input, textarea, select, checkbox, dialog, popover, dropdown-menu, tooltip, toast, badge/chip, **tag chip (tinted, coloured)**, table row, separator. Restyled to `DESIGN.md` once, in the component.
  **Exit:** every primitive has a states story (default, hover, active, focus-visible, disabled, loading, error) exercised in one page; axe passes on that page.

- [ ] **K2-03 — Board shell and filters** `L` · dep: K2-02
  Board header (name, visibility chip, role chip, action row), filter trigger opening a labelled panel (Assignee / Tag / Text), multi-select tag chips, active-filter chips, `{shown} of {total} cards`, empty-column explanation.
  **Exit:** with two filters active the panel shows the correct counts; removing a chip restores the count; an empty column says why it is empty.

- [ ] **K2-04 — Drag and drop** `XL` · dep: K2-03
  Pragmatic DnD, cards as the drop targets, `card:<id>` droppable ids, upper/lower half mapping, empty column space appends, placeholder in place, fixed-width overlay ghost, one in-flight move per card, click guarded by the dragging flag.
  **Exit:** a card dropped into the middle of a populated column lands between the two cards it was dropped between; the same drop across columns; dropping on empty space appends; a drop does not open the card modal.

- [ ] **K2-05 — Move planning and renumbering** `M` · dep: K2-04
  Server-side plan from `before`/`after` against the **stored** column, renumber on gap exhaustion, append when neighbours vanished, `expected_updated_at` respected.
  **Exit:** property-style tests over 200 randomised orders never produce a duplicate or out-of-order position; a move under an active client filter uses stored neighbours, not the filtered render.

- [ ] **K2-06 — Keyboard drag** `M` · dep: K2-04
  `Space` lift, arrows move, `Space` drop, `Esc` cancel, announcements ("card X, moved to column Y, position 3 of 7"), focus restored to the card after drop.
  **Exit:** a keyboard-only Playwright journey reorders a card and the order persists after reload; the live region announces each step.

- [ ] **K2-07 — Card read and edit modals** `L` · dep: K2-02
  `CardDisplayModal` (read-first: title, description, tags, assignee, due date, comments; single write is the done tick) and `CardEditorModal` (form, explicit Save, reached by Edit). Creation modal separate from both.
  **Exit:** opening a card never puts the cursor in an input; `Esc` closes without saving; unsaved edits prompt before discarding.

- [ ] **K2-08 — Done flag** `S` · dep: K2-07
  `done` belongs to the card; tick renders only when checked; strikethrough title; travels REST, MCP, export, and survives `expected_updated_at`.
  **Exit:** a done card stays in its column; the markdown export renders `- [x]`; a read-only board renders a static mark, not a disabled checkbox.

- [x] **K2-09 — Comments and activity** `L` · dep: K2-11
  Comments (account-only) with composer and edit marker; activity feed grouped by day, filterable by actor kind (human / agent / anonymous label), linking to the card, cursor paginated.
  **Exit:** 10 000 seeded events load in pages without a full-table scan (query plan checked); an anonymous actor has no comment affordance and the API answers `403`/`404` per the matrix.

- [ ] **K2-10 — Realtime** `L` · dep: K2-08
  `GET /api/v1/stream` SSE hub, event envelope, heartbeat, reconnect with `Last-Event-ID`, client merge by id, per-card rollback on failure.
  **Exit:** the race test (echo injected before the POST resolves) yields exactly one DOM node; a killed connection reconnects and converges without duplicates.

- [x] **K2-11 — Export and import** `L` · dep: K1-10
  `GET /boards/:id/export.json` and `.md`, `POST /boards/:id/import` accepting `klui.export/v2`, `klui.export/v1` (Appendix A of the brief) and Trello JSON, deterministic ordering, stable ids.
  **Exit:** round-trip export → import into an empty database → export is byte-identical modulo timestamps; a real v1 fixture imported twice produces the same board twice; Trello import sets `done:false` deliberately.

- [x] **K2-12 — Close-out** `M` · dep: K2-11
  `POST /boards/:id/close` freezes the board read-only and generates the summary (done / remaining / who did what / dates / span) from `events`, rendered as a page and exportable as markdown.
  **Exit:** closing twice answers `409`; a closed board refuses writes with `403 board_closed` but stays readable; the markdown summary contains every done card exactly once.

- [x] **K2-13 — Responsive board** `M` · dep: K2-06
  390 px layout: horizontal column scroll with snap, sticky column headers, 40 px coarse-pointer targets, modal as a sheet under 640 px.
  **Exit:** the drag journey passes at 390 × 844; no horizontal page scroll outside the board rail; axe passes at both widths.

- [x] **K2-14 — Tag colours** `M` · dep: K2-02
  Twelve-swatch palette plus a hex field in the tag editor; `CardTag.color` written by `PATCH /cards/:id`; board defaults via `PUT /boards/:id/tag-colors`; neutral fallback; "apply to all cards using this tag" as an explicit second action.
  **Exit:** a white tag in dark and a black tag in light both keep `--ink` ≥ 4.5:1 (the test recomputes the mix from the CSS values); a v1 import restores `tag_colors` as board defaults; the same tag renders consistently on every card until a card override is set.

- [ ] **K2-15 — Accessibility close** `M` · dep: K2-13
  Focus order, focus traps in modals, skip link, landmarks, `aria-live` for mutations, reduced motion, visible focus in both themes.
  **Exit:** axe reports zero violations on every route; a keyboard-only journey reaches and operates every control on the board.

---

## K3 — Participation (est. 1–2 weeks)

**Goal:** the wedge. A stranger with a link can work without an account, and an owner can still sleep.

**Wave exit:** the authz matrix is complete and green; an anonymous visitor can add a card to an open board and cannot comment, delete or move; a moderated write is invisible until approved.

- [ ] **K3-01 — Visibility and suffixes** `M` · dep: K1-07
  `private` | `link` | `public` enforced end to end; 4-char base32 suffix generated, stored, regenerable; old suffix `404`s after rotation; canonical URL per visibility; `noindex` on `link` and on every credentialed URL.
  **Exit:** a `link` board with the wrong suffix answers `404`; rotating the suffix invalidates the previous URL; a `public` board is listed on the owner profile and indexed.

- [ ] **K3-02 — Link tokens** `M` · dep: K3-01
  `POST /boards/:id/links` (role, optional label), `DELETE /boards/:id/links/:linkId`, token `≥22` base62, stored as `sha256`, shown once, `last_used_at` tracked, `/l/<token>` resolves to an actor.
  **Exit:** the raw token appears nowhere after creation (grep the DB); revoking answers `404` on the next request; a `none` link role cannot read.

- [ ] **K3-03 — Anonymous actors** `L` · dep: K3-02
  Display-name gate (2–32 chars, client-only, per board), signed anon cookie (12 h), `actor_label` on events and cards, limits from `docs/permissions.md`, `anon_write` off/open/moderated.
  **Exit:** an anon can create a card and mark it done; cannot comment, delete, or move; a second anon cannot edit the first one's card; `private` forces anon off.

- [ ] **K3-04 — Moderation queue** `L` · dep: K3-03
  `pending_cards` with approve/reject, owner/admin only, 7-day expiry job, queue UI with count badge.
  **Exit:** a moderated write creates no card and no public event; approving creates the card with the anon label preserved; an expired pending card is purged by the sweeper and the test proves it.

- [ ] **K3-05 — Member management** `M` · dep: K1-09
  Invite by username, role change, removal, owner transfer (exactly one owner enforced by a constraint, not by convention), member list UI.
  **Exit:** demoting the only owner is rejected; transferring ownership leaves one owner and one admin action in the event log; a removed member loses access on the next request, without a session refresh.

- [ ] **K3-06 — Link settings UI** `M` · dep: K3-02
  Visibility control, link role select, anon policy, copy link, rotate suffix, create/revoke write links with the token shown once and a warning.
  **Exit:** the panel never displays a token it cannot show again (a reload shows "created", not the token); rotating requires confirmation.

- [ ] **K3-07 — Abuse controls** `M` · dep: K3-03
  Per-IP, per-session, per-key token buckets; per-board hourly cap for anonymous writes; `KLUI_TRUSTED_PROXY_HOPS` parsing; bans table with TTL and admin view; Cap captcha behind a threshold, off by default.
  **Exit:** the anon cap answers `429` with `Retry-After`; a spoofed `X-Forwarded-For` from an untrusted hop is ignored (test with two hop configurations); a ban blocks the next request without a deploy.

- [ ] **K3-08 — Shared-board affordances** `S` · dep: K3-03
  Link-mode chip ("You can edit" / "Read-only link"), empty states keyed to the visitor's real powers, no dead controls, moderation banner for owners.
  **Exit:** a read-only visitor sees no edit affordance at all (not a disabled one); the owner sees the pending count in the header.

---

## K4 — Agents (est. 2–3 weeks)

**Goal:** an agent, given only the panel's config block, reads a board and creates a card in under a minute.

**Wave exit:** that sentence is true on two clients; every MCP tool has an app equivalent and vice versa; the parity suite runs through a real MCP SDK client.

- [ ] **K4-01 — Agent keys** `M` · dep: K3-01
  `POST/GET/DELETE /agent-keys`, `POST /agent-keys/:id/test`; `kb_` prefix, `sha256` at rest, shown once, scope (`board` | `user`), expiry, revoke, `last_used_at`, rate limit per key.
  **Exit:** a board-scoped key cannot read another board even when its owner is an instance admin (test); a revoked key answers `401` on the next call; the raw key never appears in logs (grep the log fixture).

- [ ] **K4-02 — MCP transport** `M` · dep: K4-01
  `POST /mcp`, stateless JSON-RPC 2.0, `Accept: application/json, text/event-stream`, `initialize`, `tools/list`, `tools/call`, `notifications/*` tolerated, error envelope with parameter name, expected type and one working example.
  **Exit:** a raw `curl` initialize + tools/list returns all 21 tools; an unknown tool answers `-32601`; a bad argument answers `-32602` naming the parameter and an example.

- [ ] **K4-03 — MCP: boards** `M` · dep: K4-02
  `list_boards`, `get_board`, `create_board`, `update_board`, `delete_board` (`confirm: true`). Same `can()` as REST.

- [ ] **K4-04 — MCP: columns and cards** `L` · dep: K4-03
  `create_column`, `update_column`, `delete_column`, `create_card`, `bulk_create_cards`, `get_card`, `update_card`, `move_card`, `set_card_done`, `delete_card`.

- [ ] **K4-05 — MCP: reading and export** `M` · dep: K4-04
  `list_comments`, `create_comment`, `search_cards`, `get_activity`, `export_board`, `whoami`.

- [ ] **K4-06 — Parity suite** `M` · dep: K4-05
  A table mapping every MCP tool to its REST equivalent; tests drive the real MCP SDK client, not a hand-rolled JSON body; argument names asserted literally against `docs/mcp.md`.
  **Exit:** renaming one argument in the server fails the test with the tool and parameter named; adding a REST route without a tool fails the parity table.

- [ ] **K4-07 — Setup panel** `M` · dep: K4-06
  Per-client config blocks (Claude, ChatGPT, Mistral, Gemini as first-class; OpenCode, Pi, Hermes as custom skill/prompt), copy button, "test connection" that performs a real `whoami`, and a plain-language explanation of scope.
  **Exit:** a fresh human pastes the block into a client and sees the board; the test connection reports the actual board and role it reached.

- [ ] **K4-08 — Agent-facing docs** `S` · dep: K4-06
  `/llms.txt`, `docs/mcp.md` generated from the tool schemas (or verified against them in CI), a skill package for non-mainstream clients, and `.md` variants of the docs pages that live in this repo.

---

## K5 — Release (est. 3–4 weeks)

**Goal:** 2.0.0 on a stranger's machine in five minutes, with the polish that makes it feel finished rather than shipped early.

**Wave exit:** every line of `PROMPT.md` §12 is verified and pasted into `docs/verify/k5.md`; `docker compose up -d` from the published image works on a clean machine.

- [ ] **K5-01 — Branding admin** `M` · dep: K2-01
  `instance_name`, logo (SVG/PNG ≤512×512), `accent_color`, `tab_title`, favicon. Accent validated at save time: compute the readable foreground and **reject** accents failing AA against the surfaces they land on.
  **Exit:** saving `#FFFF00` as accent is rejected with the measured ratio in the message; defaults are served through the same variables (no special "unbranded" code path).

- [ ] **K5-02 — Analytics, gated** `S` · dep: —
  Snippet injected at request time from `KLUI_ANALYTICS_URL`; unset emits no script tag and no request.
  **Exit:** a test asserts zero outbound requests with the variable unset, and exactly one script tag with it set.

- [ ] **K5-03 — Metrics** `S` · dep: —
  `/metrics` off unless `KLUI_METRICS_ENABLED=true`, then loopback-bound or bearer-protected.
  **Exit:** `404` when off; `401` without the token when on; `200` with it.

- [ ] **K5-04 — Notifications** `M` · dep: K2-10
  Assignment, mention, due-soon, moderation pending, invitation. In-app bell with unread count + webhook (Discord/Slack-compatible JSON). Per-type mute. Deduplicated by event id.
  **Exit:** the same event delivered twice notifies once; an unconfigured webhook logs a single failed delivery, not a retry storm.

- [ ] **K5-05 — Deterministic digest** `L` · dep: K2-09
  Sections in order (Done / In progress / Overdue / Assigned to you / Next top-3), built from `events` since the account's previous send, per-account hour + IANA timezone, channels webhook/email/RSS, empty digest sends nothing, unsubscribe token in the footer working without sign-in.
  **Exit:** golden test on a fixed event log; a digest with no content performs zero sends (asserted); the RSS token is hashed at rest and `noindex`.

- [ ] **K5-06 — Optional LLM layer** `S` · dep: K5-05
  `KLUI_DIGEST_LLM_URL` + `KLUI_DIGEST_LLM_KEY`; unset means nothing leaves the instance. Set means the model rewrites the already-computed payload, never decides content, length-capped, silent fallback to deterministic text on any failure.
  **Exit:** with the URL unset, a test asserts no outbound call; with a fake endpoint returning garbage, the deterministic text is sent.

- [ ] **K5-07 — i18n** `L` · dep: K2-03
  Every user-facing string keyed from the first component, catalogs `en` (source) and `fr`, server strings (errors, emails, digest) through the same catalogs, `glossary.md`, a lint rule for literal strings.
  **Exit:** the lint rule fails on a raw string in a component; switching to `fr` changes every visible string with no missing key (a test scans both catalogs for key parity).

- [ ] **K5-08 — Account and sessions UI** `M` · dep: K1-03
  Profile, password change, TOTP management, recovery codes, active sessions with revoke, digest preferences, delete account (with the documented cascade).
  **Exit:** revoking the current session signs out immediately; account deletion removes the user's memberships and anonymises their comments per `docs/security.md`.

- [ ] **K5-09 — SSO behind a flag** `L` · dep: K1-03
  OIDC provider framework: discovery, claim mapping, stable `provider_account_id`, admin UI with "test this provider", secrets encrypted at rest, per-provider enable flags, explicit account linking (never auto-link by email), break-glass local admin.
  **Exit:** a provider with a broken discovery URL shows a readable error in the admin UI and does not lock the instance out; an existing local account with the same email is not auto-linked.

- [ ] **K5-10 — Release 2.0.0** `M` · dep: K5-01…K5-09
  Version bump in both `package.json` files, CHANGELOG, tags, multi-arch image published from CI, docs updated, `docs/verify/k5.md` complete.

---

## Cut line

**2.0 must ship:** K0, K1, K2, K3, K4, plus K5-02 (analytics gate), K5-05 (deterministic digest), K5-07 (i18n infrastructure with EN + FR catalogs), K5-10.

**May slip to 2.1 without ceremony:** K5-01 branding, K5-03 metrics, K5-04 notifications (in-app only may ship), K5-06 LLM digest, K5-08 part of the account UI, K5-09 SSO.

**Kill criteria — decide at the stated moment, not after:**

| Trigger | Decision |
|---|---|
| TanStack DB uncomfortable at the end of K2 | Keep Router + Query, rewrite `web/src/data/` against a plain store. The adapter boundary must make this a one-directory change. |
| Pragmatic DnD cannot deliver keyboard parity by the end of K2 | Fall back to `@dnd-kit/core` 6.3.1, record ADR, keep the move API unchanged. |
| SSO not green by the end of K1 | Flag off, ship K2 anyway, 2.0.1 adds it. |
| Moderation queue needs more than a week | Ship `open` + `off` only in 2.0, `moderated` in 2.1, and say so in the release notes. |

---

## Wave close protocol

At the end of every wave:

1. Run the full gate from a clean `npm ci`.
2. Walk the wave's user journey in a browser against the **built** server, not the dev server.
3. Write `docs/verify/k<wave>.md`: one section per exit criterion, each with the command, the trimmed real output, and the verdict.
4. Re-read `docs/decisions.md` and add anything you decided during the wave that a future reader would otherwise have to guess.
5. Report in the shape defined in `PROMPT.md` §9.
6. Do not start the next wave on a red gate or an unwritten verify file.
