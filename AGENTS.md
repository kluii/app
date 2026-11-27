# AGENTS.md

Working agreement for any agent or human making a change in this repository.

---

## 1. What this repository is

Klui is a kanban board for small teams and short projects, in one TypeScript
monorepo: a React single-page app (Vite, TanStack Router and Query, Tailwind fed
by the tokens in `web/src/styles/tokens.css`), a Fastify API, PostgreSQL through
Prisma, an MCP endpoint that lets agents work on a board with their own scoped
keys, an SSE stream that keeps a board live, and Open Graph images rendered
server-side. The licence is AGPL-3.0-only, no feature sits behind a licence key,
and the compose file is the supported way to self-host it. A board ends when its
owner closes it, once, or deletes it outright.

---

## 2. Read before changing anything

| You are changing | Read first |
|---|---|
| Anything a user sees | `DESIGN.md` — the visual system, and the file that owns each rule |
| A route or a wire shape | `docs/api.md` |
| An MCP tool | `docs/mcp.md` |
| A route that answers a request | `docs/permissions.md` |
| A decision that looks arbitrary | `docs/decisions.md` |
| A feature | `docs/features/<topic>.md` |
| The tests, or how to run them | `docs/testing.md` |

`DESIGN.md` is a reference, not an essay: it cites the file that owns each rule
(`web/src/styles/tokens.css`, `web/test/contrast.test.ts`) rather than restating
values a component could drift from. If a document and a token disagree, the
token is what ships and the document is the bug.

---

## 3. Conventions

- Branches are cut from `dev` and named for the change: `feat/<topic>`,
  `fix/<topic>`, `docs/<topic>`. Never a wave, a ticket or a worker index.
- Conventional commits in small units, each revertable alone: `feat:`, `fix:`,
  `doc:`, `refactor:`, `chore:`, with a scope when it helps (`feat(web): …`).
  One mega-commit at the end is rejected even when the gate is green.
- Nothing merges without a pull request. Only `dev` reaches `main`, and only
  with the owner's explicit approval for that release.
- Every commit is signed off (`git commit -s`).
- Set the identity before the first commit —
  `git config --local user.name "Wyliam"` and
  `git config --local user.email "82271052+WyliGr@users.noreply.github.com"` —
  and check that `git config --local user.email` prints something. An empty
  value means you inherited someone else's identity.

---

## 4. The gate

```bash
npm run format:check && npm run typecheck && npm run lint && npm run build && npm test
npm run test:e2e        # when a screen changed
```

Run it yourself, on the code you are about to push; never push so that CI can
find out for you. A gate that passes only with `--no-verify`, a skipped test or
a narrowed assertion is a failed gate. The dev loop (`npm ci`, `npm run dev`,
compose) is in `README.md`.

Ports on the shared host: 8080 is the app, 8123 is the e2e server, 8000 belongs
to something else. Probe with `ss -ltnp` before assuming a port is free.

---

## 5. Rules that have cost a review round

1. No colour literal outside `web/src/styles/tokens.css`. A new value is a token
   added there, never an arbitrary value at the call site.
2. No user-facing string outside `t()`, with a key in **both** catalogues:
   `web/src/i18n/{en,fr}.json` and `server/src/i18n/{en,fr}.json`. The i18n test
   fails on a key the catalogues do not have, in either package; a key added to
   one catalogue only is a blank label for half the readers.
3. The app carries no footer.
4. A board is written by its members. A share link is read-only, and an
   anonymous visitor reads — whatever a stored policy row says.
5. Never weaken a contrast or contract test to make a change pass. If a change
   genuinely moves a measured value, move the value and say so in the report.

---

## 6. Reporting

End a task with what you changed, the gate output pasted literally, and what is
still open. A claim without a pasted line is not a result.
