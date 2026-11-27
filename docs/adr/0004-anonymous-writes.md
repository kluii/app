# ADR-0004 — Anonymous participation

## Status

`superseded — 2026-11-27, see D-59 in docs/decisions.md`

Date: 2026-11-26. Deciders: Wyliam, Hermes.

## Context

The wedge of the product is a stranger who can contribute without an account.
That requires an identity strong enough to enforce "edit the card you just
created" and weak enough that nobody has to sign up. An IP cannot be trusted, and
a per-request random value cannot survive a reload.

## Decision

An anonymous actor is a signed cookie `klui_anon` (12 hours, `httpOnly`,
`SameSite=Lax`) carrying `{boardId, label, anonId}`, where `anonId` is 16 random
bytes stored on the cards the actor creates (`cards.anon_actor_id`). The display
name is 2–32 characters, chosen client-side, not unique, not reusable on another
board, and never a login.

An anonymous actor may create a card, edit a card created in the same session,
and mark it done. It may not comment, delete, move across columns, attach (there
are no attachments), change settings, export, or see anything a `read` link
holder cannot see.

`anon_write` is `off | open | moderated`. `off` shows no write affordance at all;
`open` writes directly; `moderated` writes a `PendingCard` that owner or admin
approves, is purged after 7 days, and creates no public event until approved.
A per-board anonymous write cap (30/hour by default) is the control that makes an
open board survivable.

## Consequences

- `cards.anon_actor_id` and `events.actor_anon_id` exist and are indexed.
- Two anonymous visitors can choose the same name; attribution in the UI says
  "someone calling themselves X" and hover reveals it is not an account.
- The moderation queue is a product surface, not an admin script.
- A card created anonymously and later edited by a member keeps the anonymous
  origin in the event log; the card row keeps the id, which is why deletion of
  the anon cookie does not orphan anything.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| A per-board "guest account" per visitor | That is an account: it needs a password reset path, an email, and a deletion story. |
| An IP-based identity | NAT collapses a team into one actor, and a mobile network rotates mid-session. |
| No anonymous identity at all (create-only) | "Edit the card I just created" is the minimum that makes the contribution useful. |
| Captcha as the primary control | A captcha is a bot filter, not a rate limit; it replaces nothing (D-46). |

## Superseded by

D-59 (2026-11-27): a board is written by its members. The `klui_anon` cookie
still identifies a reader and the columns stay for rows written before the
change, but an anonymous actor no longer writes a card, edits one or completes
one, and the per-board write cap guards nothing.
