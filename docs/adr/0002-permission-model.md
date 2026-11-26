# ADR-0002 — One permission function

## Status

`accepted`

Date: 2026-11-26. Deciders: Wyliam, Hermes.

## Context

Four kinds of actor reach a board: an account, an agent key, a write-link
holder, and an anonymous visitor. Roles are layered (owner / admin / editor /
viewer) and visibility is independent of role. Every one of REST, MCP, SSE
subscriptions, HTML responses, export and moderation needs the same answer, and
a single wrong cell is either a privilege escalation or a leak. v1 answered this
question in several places; the answers drifted.

## Decision

`can(actor, action, board, membership?)` in `server/src/lib/authz.ts` is the only
place a permission is decided. It returns `{allow: true}` or
`{allow: false, reason: 'not_found' | 'forbidden'}`; the route renders `404` for
`not_found` and `403` for `forbidden`. No other module compares a user id to an
owner id, reads `membership.role` to pick a status, or filters a board query by
owner. A lint rule fails the build on `X.ownerId ===` outside `authz.ts`.

The actor union is `user | agent | link | anon`. An agent is a distinct kind so
that a board-scoped key is *structurally* incapable of addressing another board.
Readability is resolved before role, so a non-member never learns whether a board
is closed. `private` forces `link_role: none` and `anon_write: off` in the same
transaction, backed by a schema constraint.

Two roles are deliberately narrow: a `viewer` writes nothing, including
comments; a link holder with `edit` creates, edits, moves and completes cards but
cannot delete, reshape the board or export it. An instance admin has no board
content access at all.

## Consequences

- One file to read to answer "who can do this", one table to audit, one
  exhaustive test (`server/test/authz-matrix.test.ts`) that enumerates
  visibility × link role × anon policy × role × actor kind × action.
- Every new action needs a column in that test in the same commit, or the gate
  fails.
- Routes carry a small ceremony: load the board, call `can()`, then act. A route
  that forgets the call is caught by the route-table test.
- A `403` can only be produced for an actor who already read the board; the
  unreadable case is byte-identical to a missing row.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Per-route role checks | The matrix becomes N implementations, and the 404 rule decays into 403 oracles. |
| Postgres row-level security | Correct in theory, unusable for the agent case (scope is an actor property, not a row property) and invisible to the MCP layer. |
| A permission table in the database | Editable at runtime by an operator, which turns a security decision into data drift. |
| CASL / casbin | A second DSL over the same table, plus a dependency that ships to the browser or must be duplicated server-side. |
