# ADR-0005 — The digest is computed, not generated

## Status

`accepted`

Date: 2026-11-26. Deciders: Wyliam, Hermes.

## Context

"Private when self-hosted" must be true with zero configuration. A digest whose
content is chosen by a model sends board content to a third party and produces
different output for the same events, which makes it untestable.

## Decision

The digest is deterministic and rule-based: sections in a fixed order (Done / In
progress / Overdue / Assigned to you / Next top-3), built only from `events`
since the account's previous send, in the account's IANA timezone at the
account's chosen hour. An empty digest sends nothing. The optional LLM layer
(`KLUI_DIGEST_LLM_URL`) only rewrites an already-computed payload, is off by
default, is length-capped, and falls back silently to the deterministic text on
any failure.

## Consequences

- A golden test over a fixed event log is meaningful, and a change in behaviour
  is visible in the diff.
- The builder is pure: events in, sections out, no clock beyond the account's
  timezone, no I/O.
- The LLM layer can degrade to nothing without changing the product.
- Content is bounded by what the event payloads carry; a digest cannot invent a
  sentence about work that did not happen.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Model-generated summaries by default | Sends board content off-instance, and two runs over the same events disagree. |
| A digest assembled from current card state | "What happened" and "what is" are different questions; the event log is the only honest source (D-23). |
| Sending an empty digest | Trains people to unsubscribe (D-38). |
