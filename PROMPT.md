# Klui 2.0 — build brief

The operative brief for this repository. `AGENTS.md` is the working agreement,
`ROADMAP.md` the sequencing, `DESIGN.md` the visual system, `docs/` the contracts.
Read them in that order before the first commit.

## 0. Mission

Build **Klui 2.0**: a fast, uncluttered kanban for small teams and short projects
where AI agents are first-class participants. One Docker image, one compose file,
self-hostable, AGPL-3.0-only, no licence key anywhere, no feature held back from
self-hosters.

This repository is the **application**: React SPA, Fastify API, PostgreSQL, MCP
endpoint, SSE stream, server-side Open Graph rendering. It is **not** the landing
page, docs site, blog or marketing route: `klui-site` is a separate Astro
repository. The app answers `/` with a redirect (`/boards` when signed in,
`/login` otherwise) and ships no marketing copy.

Three things define the product; all three must work or the release is not Klui:

1. **Collaboration without an account** — a link holder joins a board with a
   display name.
2. **Bring-your-own agents** — a real MCP surface, per-board agent keys, a setup
   panel a human can copy from.
3. **The project has an end** — a close-out summary generated from the event log,
   and an export that rebuilds the board elsewhere.

## 1. Read order

`AGENTS.md` · `ROADMAP.md` · `DESIGN.md` · `docs/decisions.md` ·
`docs/architecture.md` · `docs/permissions.md` · `docs/api.md` · `docs/mcp.md` ·
`docs/security.md` · `docs/testing.md` · the `docs/features/` file for the task.

**Precedence when two documents disagree:** this file, then
`docs/decisions.md`, then `docs/api.md` and `docs/mcp.md` (contracts), then
`docs/permissions.md`, then `DESIGN.md` (visual), then `ROADMAP.md`
(sequencing), then judgement. A conflict that remains is recorded in
`docs/verify/<wave>.md` with both texts quoted, never resolved silently in code.

## 2. Skills

1. `wyliam-coding-convention` — branches, commits, PR rules; outranks every
   generic skill.
2. `unslop` (tasteskill v2, installed as `design-taste-frontend`) — anti-slop art
   direction; run its inspector on every screen. A floor, not a grade.
3. `shadcn` — components are copied into `web/src/components/ui/`, consume our
   tokens, and gain variants in the component, not at the call site.
4. `modern-web-guidance` — mandatory before dialogs, popovers, focus management,
   theming, forms or scroll behaviour.

Visual conflict rule: convention > `DESIGN.md` > `unslop`. Where `unslop` pushes
decoration, `DESIGN.md` wins; where it pushes structure, it wins.

## 3. Non-negotiables

1. No colour literal outside `web/src/styles/tokens.css`. A lint rule enforces it.
2. No emoji anywhere in the UI. Stroke icons only, one family.
3. `can()` in `server/src/lib/authz.ts` is the only permission decision. REST,
   MCP, SSE, HTML, export and moderation all call it.
4. Unreadable means non-existent: `404`. `401` only when a session is required and
   absent. `403` only for an actor who can already read the board.
5. The move API takes neighbours, never an index: `{column, before, after}`,
   resolved against the stored column, ranked between neighbours, renumbered on
   gap exhaustion, appended when the neighbours are gone.
6. Every mutation writes an `Event` through one helper.
7. Tokens are stored hashed and shown once: `argon2id` for passwords, `sha256`
   for opaque tokens. No token in a log.
8. Every mutation merges by server id in the client.
9. No `any` in `src/`; no non-null assertion without a comment naming the
   invariant; Zod schemas are the source of truth for shapes.
10. Never edit a shipped migration.
11. Never report a number you did not measure.
12. Never touch `main`.

## 4. Stack (decided — do not reopen)

Node LTS (exact major in `.nvmrc` and ADR-0001) · TypeScript `strict` · React +
TanStack Router + TanStack Query + TanStack DB + shadcn/ui + Tailwind, Vite, SPA
only · Fastify with Zod → OpenAPI 3.1 · PostgreSQL + Prisma, append-only
migrations · `@atlaskit/pragmatic-drag-and-drop` · Vitest, Playwright, axe · npm
workspaces (`web`, `server`).

Dependency rules: pin exact versions for `@tanstack/db`,
`@tanstack/react-hotkeys` and `pragmatic-drag-and-drop`, recorded in ADR-0001 ·
TanStack DB is reachable only from `web/src/data/` (one adapter module per
domain) · `@tanstack/react-hotkeys` only through `web/src/lib/hotkeys.ts` · no
CSS-in-JS runtime · a dependency that ships to the browser needs an ADR line · no
UI kit, animation library, icon pack beyond the named one, or state manager.

## 5. Repository layout

See `AGENTS.md` §6 and `docs/architecture.md` §2. Domain folders only; `lib/`
holds genuinely cross-domain primitives.

## 6. Contracts that must not be improvised

Identity (username 3–32 `[a-z0-9-]`, slug 3–40 unique per owner, reserved list,
renames reserved 90 days and `301`) · visibility `private|link|public` with a
regenerable 4-char suffix · link roles `read|edit|none` independent of
visibility, write by a separate `/l/<token>` (≥22 base62, `sha256`) · anonymous
write `off|open|moderated` with a client-chosen display name · roles
`owner|admin|editor|viewer`, instance admin never grants board content · API
`/api/v1`, error envelope `{"error":{"code","message","hint"}}`, every writable
resource accepts `expected_updated_at` and answers `409` with the current row ·
MCP `POST /mcp`, stateless JSON-RPC 2.0, the 21 tool names and arguments in
`docs/mcp.md` frozen, every tool has an app equivalent · tags carry a colour
(card override → board default → neutral), tint capped, label always `--ink` · no
board expiry and no archive · export `klui.export/v2`, deterministic, importers
for `v1` and Trello, byte-identical round trip modulo timestamps.

## 7. Design constraints

`DESIGN.md` is the source of truth. Dark is monochrome, light is white, two font
families (Inter, JetBrains Mono), radii 4 and 8 only, contrast measured in CI
against the surface a token sits on, theme applied by an inline bootstrap before
React mounts, reduced motion everywhere, density deliberate (32 px controls,
288 px columns, 16 px gutters), and the layout is the product.

## 8. How to work

One task at a time from `ROADMAP.md`, in order, on a branch from `dev`
(`feat/`, `fix/`, `chore/`, `docs/`, topic not ticket number). Identity is set
before the first commit. Failing test first where a test is meaningful; small
revertable commits; the full gate run locally before a push; `docs/verify/<wave>.md`
written with the command, the real trimmed output and a verdict for every exit
criterion. Do not open a PR unless asked. Never merge `main`.

Gate: `npm run format:check` · `typecheck` · `lint` · `test` · `build` ·
`npx playwright test` against the built server. A gate that only passes with
`--no-verify`, a skipped test, a narrowed assertion or an untracked exclusion is a
failed gate.

## 9. Reporting

```
TASK      K2-04 — pragmatic drag and drop
BRANCH    feat/board-drag-neighbours
COMMITS   6 (list)
GATE      format ok | typecheck ok | lint ok | web 42/42 | server 118/118 | e2e 5/5 | build ok
PROOF     <one pasted line per claim, trimmed>
DEVIATIONS <none | what, why, where recorded>
NEXT      <task id or "blocked: reason">
```

A done claim without a pasted log line is not done. A failing gate that cannot be
fixed is reported, not disabled. Silent deviation is the one unrecoverable
failure; a written deviation is a decision a human can accept.

## 10. Traps

The fifteen traps in `AGENTS.md` §5 are normative: echo before response, the move
API as an API problem, listeners on the whole card, cards as drop targets, group
test ids that prefix their items, per-entity rollback, a static plugin that
snapshots assets, a token in a URL, `items-stretch`, the theme before mount, a
stale Prisma client, deploy proof as data preservation, two workers on one
Postgres, `networkidle` on a board, and a drag probe aimed at the middle of a
populated column.

## 11. Stop conditions

Stop and ask, in writing, only for: a document conflict that changes a contract;
a decision the brief leaves open and `docs/decisions.md` cannot settle; a missing
external input (a real `klui.export/v1` file, SMTP, an OIDC provider, a
production dump); or a gate that cannot be green without changing a frozen
contract. Everything else is a decision to record in an ADR.

## 12. Definition of done for 2.0

- `docker compose up -d` from the published image, clean machine, working
  instance in under five minutes, no build from source.
- Two accounts, two private boards, mutual `404` — proven in REST and in the UI.
- A `link` board readable by a stranger and not enumerable; `/l/<token>` lets a
  stranger add a card with a display name and nothing else.
- A card dragged to the middle of a populated column stays there after reload,
  three CI runs in a row, keyboard included.
- An agent set up from the panel's config block alone reads a board and creates a
  card in under a minute, on two clients.
- Export → import into an empty instance is byte-identical modulo timestamps; a
  v1 export imports cleanly.
- `KLUI_ANALYTICS_URL` unset means zero outbound analytics requests, asserted by
  test; `/metrics` unreachable unless enabled and authenticated.
- The authz matrix and the contrast gate are green in CI, and the run is
  observable.
- Documentation in English and French, and one copy-pasteable quickstart.
