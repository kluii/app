# ADR-0006 — No SSR in the app, Open Graph from a template

## Status

`accepted`

Date: 2026-11-26. Deciders: Wyliam, Hermes.

## Context

The server owns a versioned REST API, an MCP JSON-RPC endpoint, a long-lived SSE
stream, per-key and per-IP rate limiting, cookie and CSRF policy, and Open Graph
images. Unfurlers do not run JavaScript, so a shared board link needs real HTML
with OG tags from the server. A server-function framework (Next, Remix, SvelteKit
adapter-node) reshapes exactly the surfaces agent clients depend on.

## Decision

The SPA is static: `@fastify/static` serves `web/dist` with a fallback to
`index.html`, `Cache-Control: no-store` on HTML, immutable hashed assets, and the
asset list snapshotted at boot — a rebuild requires a server restart. Open Graph
images are rendered server-side as SVG from a template and converted to PNG with
`resvg`, cached, and contain only the board's name and counts, never card
titles. HTML for a shared board (`/b/...`, `/l/...`) is a small server-rendered
document with the meta tags and a redirect into the SPA.

The application repository contains no marketing route, docs site or blog
(D-01): `/` redirects to `/boards` or `/login`.

## Consequences

- One process, one port, one image. No hydration mismatch class of bug, no
  second build target.
- Unfurls need the server-rendered route to stay correct; it is tested with a
  fetcher that sends the unfurler user agent.
- The OG template has its own palette (`server/src/og/palette.ts`) because it
  cannot read CSS variables; it duplicates the token values and a test asserts
  they match `tokens.css`.
- A stale bundle after a rebuild is a real failure mode (trap 7), mitigated by
  restarting the server after every web build and by `/healthz` reporting the
  version.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Next.js with SSR | Reshapes routing, cookies, SSE and the API surface; buys nothing this product needs. |
| A headless browser for OG images | A chromium dependency in the image for a rectangle with text. |
| Client-only OG (meta tags in index.html) | Unfurlers do not run JavaScript. |
| A hosted OG service | Board names would leave the instance. |
