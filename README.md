# Klui

Klui is a kanban board for small teams and short projects. It is one TypeScript
monorepo: a React single-page app, a Fastify API, PostgreSQL through Prisma, an
MCP endpoint that lets agents work on a board with their own scoped keys, an SSE
stream that keeps the board live, and server-side rendering for Open Graph
previews. A board can be closed once, which freezes it and writes a summary from
the event log, and it can be exported as JSON that rebuilds it elsewhere. The
licence is AGPL-3.0-only, there is no licence key anywhere, and no feature is
held back from a self-hosted instance.

Run it with Docker:

```bash
cp .env.example .env
docker compose up -d
```

The app answers on `http://localhost:8080` and reports the release it is running
at `/healthz`. The first account created becomes the instance admin. To work on the source, `npm ci`, then `npm run dev` for the
API on `:8080` and Vite on `:5173`; `npm run build && npm run start` serves the
built SPA and the API from one process. The full gate is `npm run format:check`,
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

The working agreement is [AGENTS.md](AGENTS.md), the sequencing document is
[ROADMAP.md](ROADMAP.md), the visual system is [DESIGN.md](DESIGN.md), and the
API, MCP, permission, security and deployment contracts live in
[docs/](docs/). Decisions that are closed are recorded in
[docs/decisions.md](docs/decisions.md); a discussion that is not in an ADR does
not exist.
