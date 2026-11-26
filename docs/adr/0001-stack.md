# ADR-0001 — Stack, licence and dependency pins

## Status

`accepted`

Date: 2026-11-26. Deciders: Wyliam (product owner), Hermes (implementation agent).

## Context

Klui 2.0 is one repository that must build from a clean clone on a stranger's
machine, serve a React SPA, an authenticated REST API, an MCP endpoint, an SSE
stream and server-rendered Open Graph images from one Node process, and keep
working for years with agents, not humans, reading the code. Licence: the
product promises self-hosting with nothing behind a key, so the licence must make
a relicensing impossible.

The versions below are the ones actually installed and locked in
`package-lock.json` at the time of writing. A version stated here without a lock
entry is a wish, not a decision.

## Decision

Runtime **Node 26** (`.nvmrc`: `26`; `engines.node >= 26`), which is the LTS line
at the time of the decision. TypeScript **5.9.3** with `strict`,
`noUncheckedIndexedAccess` and `verbatimModuleSyntax`, in both workspaces.

| Layer | Package | Installed |
|---|---|---|
| API | `fastify` | 5.12.8 |
| API plugins | `@fastify/cookie` · `@fastify/helmet` · `@fastify/rate-limit` · `@fastify/static` · `@fastify/swagger` | 11.1.5 · 13.2.0 · 11.3.0 · 11.0.0 · 9.9.5 |
| Validation | `zod` | 4.6.7 |
| Data | `prisma` / `@prisma/client` | 6.19.3 / 6.19.3 |
| Password hashing | `@node-rs/argon2` | 2.2.2 |
| TOTP | `otplib` | 13.6.0 |
| Client | `react` / `react-dom` | 19.3.1 / 19.3.1 |
| Routing | `@tanstack/react-router` | 1.170.46 |
| Server state | `@tanstack/react-query` | 5.108.4 |
| Optimistic store | `@tanstack/db` | **1.0.0-rc.1.5** (exact pin) |
| Shortcuts | `@tanstack/react-hotkeys` | **0.27.5** (exact pin) |
| Drag and drop | `@atlaskit/pragmatic-drag-and-drop` | **4.0.0** (exact pin) |
| Build | `vite` | 8.4.0 |
| CSS | `tailwindcss` + `@tailwindcss/vite` | 4.3.5 |
| Icons | `lucide-react` | 1.81.0 |
| Tests | `vitest` / `@playwright/test` | 5.1.2 / 1.65.1 |

Licence **AGPL-3.0-only**, full text in `LICENSE`, SPDX identifier in every source
file, DCO sign-off on every commit (`git commit -s`), no CLA. No feature is gated
by a licence key in any instance (D-03).

Three additions beyond the brief's list, each earning its place:

- `@node-rs/argon2` instead of `argon2`: same algorithm and parameters
  (argon2id), prebuilt native bindings, so the Alpine image needs no compiler.
- `clsx`, `tailwind-merge`, `class-variance-authority`: the three helpers a
  shadcn copy-in needs to keep variants inside the component (DESIGN.md §7).
- `lucide-react`: the one icon family DESIGN.md §10 names; stroke 1.5,
  `currentColor`, tree-shaken to the icons used.

## Consequences

- Node 26 is pinned in `.nvmrc`, `engines` and the two Docker stages; a future
  bump touches those three places and this table.
- TypeScript stays on 5.x until `typescript-eslint` supports the 7.x compiler;
  the lint gate is worth more than the compiler's speed.
- Prisma stays on 6.x: 7 moves the datasource URL out of `schema.prisma` into
  `prisma.config.ts` and requires a driver adapter, and 8 is a release candidate.
  Migrating is a separate task with its own ADR.
- Every dependency that ships to the browser is listed here. A new one requires a
  line in this table and a sentence saying what it replaces.
- `npm install` on npm 11.20+ needs the `allowScripts` pins in `package.json`
  (prisma, esbuild) or the build tools never run their install steps.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Node 22 LTS | Older LTS than the installed platform; no feature here needs the older line, and picking it would mean testing a runtime nobody runs. |
| Express + a validation layer | Slower, and the OpenAPI-from-Zod requirement (D-31) is native in Fastify. |
| Drizzle instead of Prisma | Would be fine, but every migration in the roadmap, the boot gate and the data model are written against Prisma's migrate; switching now buys little. |
| `argon2` (node-gyp) | Needs a toolchain in the image and rebuilds on every platform. |
| MIT licence | Would let a future owner close the hosted product without publishing changes (D-02). |
