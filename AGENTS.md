# AGENTS.md

Working agreement for any agent (or human) making a change in this repository. Read `PROMPT.md`, then `ROADMAP.md`, then `DESIGN.md`, then the documents in `docs/` that your task names.

If you read only this file, you can still make a correct change. That is the test this file has to pass.

---

## 1. Run it

```bash
# prerequisites: Node LTS (see .nvmrc), Docker, npm
npm ci

# development (two processes, two ports)
npm run dev -w server      # API on :8080
npm run dev -w web         # Vite on :5173

# production-like, everything in one process
npm run build
npm run start              # serves API + built SPA on :8080

# full stack with the database
docker compose up -d
```

The dev server needs a `server/.env` with at least `DATABASE_URL` and `KLUI_SESSION_SECRET`. Copy `.env.example`; never commit `.env`.

Ports in use on the shared host: 8000 belongs to another service, 8080 is the app, 8123 is the e2e server. Probe with `ss -ltnp` before assuming a port is free.

## 2. Gates (all of them, before every push)

```bash
npm run format:check        # prettier, tracked files only
npm run typecheck           # tsc --noEmit, both workspaces
npm run lint                # eslint + no-any + no-hex + no-literal-string
npm test                    # vitest (web + server)
npm run build
npm run test:e2e            # Playwright against the built server on :8123
```

A gate that passes only with `--no-verify`, a skipped test, or a narrowed assertion is a failed gate. Run the gate yourself; never push to let CI find out.

## 3. Branch and commit

- `main` is production. Nothing lands there except a merge from `dev`, and only with explicit human approval for that release.
- `dev` is integration. Everything arrives by PR from a task branch.
- Task branches from `dev`: `feat/<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>`. The topic describes the change; never a wave or ticket number.
- Conventional commits: `feat:`, `fix:`, `doc:`, `wip:`, `refactor:`, with a scope when useful (`feat(web): …`). The commit type is `doc:` while the branch prefix is `docs/` — that asymmetry is intentional.
- Small commits, each revertable alone. One mega-commit at the end is rejected even when the gate is green.
- Every commit is signed off (`git commit -s`).
- **Set the identity before the first commit:**
  - GitHub: `git config user.name "Wyliam" && git config user.email "82271052+WyliGr@users.noreply.github.com"`
  - Forgejo personal: `git config user.name "Hermes" && git config user.email "hermes@wyliam.fr"`
  - Verify: `git config --local user.email` must print something. Empty means you inherited the wrong identity.

## 4. Non-negotiables

1. No colour literal outside `web/src/styles/tokens.css`.
2. No emoji in the UI. Stroke icons only, one family.
3. `can()` in `server/src/lib/authz.ts` is the only permission decision. No ad-hoc checks.
4. Unreadable is `404`, never `403`. `403` only for an actor who can already read.
5. Moves take `{column, before, after}`, never an index.
6. Every mutation writes one event, in the same transaction.
7. Tokens are hashed at rest and shown once.
8. Every mutation merges by server id in the client.
9. No `any` in `src/`; Zod schemas are the source of shape truth.
10. Never edit a shipped migration.
11. Never report a number you did not measure.

## 5. Traps (each has shipped as a real bug)

1. An SSE echo can arrive before the POST response — merge by id, disable submit while in flight.
2. "It only drops at the end" is an API problem first: if the endpoint cannot express a position, pointer tuning will not fix it.
3. Listeners on the whole card, not a handle; the done tick stops propagation on `pointerdown`.
4. Cards are the drop targets; gaps are a visual line only.
5. Never prefix a group container's test id with the same stem as its items.
6. A failed write patches only the touched card, never a whole-state snapshot.
7. A static-file plugin snapshots assets at boot: restart the server after a web build.
8. A token in a URL is a credential: hashed, revocable, `noindex`, never logged.
9. `items-stretch` stretches a sparse column to its tallest sibling — use `items-start`.
10. Apply the theme before React mounts.
11. A stale Prisma client fakes a type error: run `prisma generate` inside `server/` after every schema change.
12. Deploy proof is data preservation: identical row counts, migrations finished, secret mtimes unchanged.
13. A shared Postgres across test files produces random false reds: `fileParallelism: false` or a schema per file.
14. `networkidle` never fires on a board (SSE). Wait for a selector.
15. A drag probe that drops above the first card proves nothing. Aim at the middle of a populated column and reload.

## 6. Where things live

| You are changing | Files |
|---|---|
| A permission | `server/src/lib/authz.ts`, `docs/permissions.md`, the matrix test |
| A route | `server/src/<domain>/routes.ts`, `server/src/contracts/*`, `docs/api.md`, the contract test |
| A tool | `server/src/mcp/tools/*`, `docs/mcp.md`, the parity test |
| A table | `server/prisma/schema.prisma` + a new migration + `docs/architecture.md` §3 |
| A token | `docs/permissions.md` §4.2 and `docs/security.md` §3 |
| A colour or a size | `web/src/styles/tokens.css` and `DESIGN.md`, never a component |
| A string | `web/src/i18n/en.json` + `fr.json`, never a JSX literal |
| A decision | `docs/decisions.md` + an ADR in `docs/adr/` |

## 7. Reporting

End every task with the shape in `PROMPT.md` §9: task, branch, commits, gate with pasted lines, deviations, next. Write the wave's `docs/verify/k<wave>.md` before the wave closes. A claim without a pasted log line is not a result.

## 8. Product rules that survive any refactor

- Footer on every page: `Made with <3 by Wyliam`, linking to https://wyliam.dev.
- Copy is honest: no "unhackable", no "bot-proof", no comparison that is false. Every number displayed must be greppable in the code.
- The product's differentiator is the combination: account-free participation + bring-your-own agents + a project that ends + self-hosting with nothing behind a licence key. Do not weaken one of the four to ship another.
