# Changelog

Every version that shipped a migration, an environment change, or a change in the
HTTP or MCP surface. The format follows Keep a Changelog; the versions are the
`package.json` version, which is also what `/healthz` reports and what the image
is tagged with (D-42).

## 2.0.0 — 2026-11-27

The first release. Everything below is in the image tagged `2.0.0` for
`linux/amd64` and `linux/arm64`.

### Added

- **MCP endpoint** at `POST /mcp`, 21 tools over the boards and cards API, the
  same permission decisions as REST (`docs/mcp.md`). Read and write calls are
  charged to separate buckets, 600 and 60 per minute per key.
- **Agent keys** (`/agent-keys`): board-scoped or user-scoped, shown once, hashed
  at rest, revocable, `POST /agent-keys/:id/test` performs a real `initialize`
  and `tools/call whoami` against the instance's own endpoint.
- **Anonymous writes** per board (`anon_write: off | moderated | open`), with a
  moderation queue (`/boards/:id/pending`) and single and bulk creates obeying
  the same policy.
- **Board links** with a role, revocable, no session required.
- **Close-out summary** and **Markdown/JSON export and import**.
- **Server-side digest** (K5-05): computed from the event log since the account's
  previous send, per-account hour and IANA timezone, delivered by webhook, email
  or RSS, with a one-click unsubscribe that works without signing in.
- **i18n** (K5-07): `en` and `fr` catalogues on both sides of the wire. The
  server's error envelope, validation hint, reset mail and unsubscribe page are
  translated from the request's `Accept-Language`.
- **Analytics gate** (K5-02): `KLUI_ANALYTICS_URL` injects one script tag at
  request time and adds its origin to the CSP; unset emits nothing.

### Changed

- `GET /api/v1/boards` answers one list computed once, by the same function the
  MCP `list_boards` tool uses: a board-scoped agent key lists exactly its bound
  board (it used to list every board its owner belonged to).
- The web renders the server's `{message, hint}` for any 4xx with a known code
  instead of "Something went wrong. Try again.", which is now only for a network
  failure or a 5xx.
- The event log carries what a reader prints: `card.completed` and
  `card.reopened` include `title`, `card.moved` includes `title` and
  `to_column_name`, `card.updated` includes `title`.
- The runtime image copies only what the server executes: 793 MB → 757 MB, and
  it now carries both architectures' Prisma engines (`linux/amd64` and
  `linux/arm64`), which is 98 MB of that.
- `ROADMAP.md` reflects the verify files instead of the wave that wrote it.

### Schema

Two migrations, additive, both safe to run against a live 0.1.0 database:

- `20261127150000_add_digest_delivery` — `digest_prefs.unsubscribe_hash`,
  `last_digest`, `failures`.
- `20261127160000_add_digest_updated_event` — `EventType.digest_updated`.

`prisma migrate deploy` runs at container start, before the server. A failed
migration stops the container; the API never starts against a schema it does not
understand.

### Environment

No variable was renamed or removed. Three that existed and were read by nothing
are now consumed: `KLUI_ANALYTICS_URL` (K5-02), `KLUI_DIGEST_LLM_URL` (still
unused, 2.1) and `KLUI_OPENAPI` (still unused). `KLUI_VERSION` names the compose
image tag and defaults to this version.

### Upgrade from 0.1.0

1. Dump the database.
2. `docker compose pull` (or build) and `docker compose up -d --wait`.
3. `curl -fsS localhost:8080/healthz` must report `"version":"2.0.0"`.
4. Sign in once; the digest settings are at `GET /api/v1/me/digest` (there is no
   settings screen for them in 2.0 — that is K5-08, planned for 2.1).

### Rollback

Reverting the image is enough: both migrations are additive, and 0.1.0 ignores
the new columns and the new enum value. No data is rewritten, so a rollback
needs no restore.

### Known gaps in 2.0.0

Named here rather than discovered later. Each is tracked in `ROADMAP.md`.

- Branding (K5-01), Prometheus metrics (K5-03), in-app notifications (K5-04), the
  LLM digest layer (K5-06), the account settings UI (K5-08) and SSO (K5-09) are
  not in this release. They are scheduled for 2.1.
- The image is 757 MB, not the 300 MB the first plan named: 251 MB is the Node
  base, 176 MB is the Prisma toolchain `migrate deploy` runs and 98 MB is the
  second architecture's engines. The arithmetic is in `docs/deployment.md` §8.
- The `linux/arm64` image is built by CI and has never been executed: Prisma's
  schema parser fails under QEMU emulation (`get-dmmf wasm`, measured), so this
  workspace could not boot it. Real arm64 hardware was not available.
- The digest's email channel sends `text/plain` with no HTML part.
- `docs/api.md` §9 describes OpenAPI generation that is not built; §"Not yet
  served" lists every route that is documented and answered by nobody.
