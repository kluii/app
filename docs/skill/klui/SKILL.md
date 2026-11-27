---
name: klui-board
description: Read and change a Klui board through its MCP endpoint. Use when the task names a Klui board, a card, a column, or an export of a project.
---

# A Klui board, from an agent

Klui is a board where a project ends: a column of done cards is not the end, a
close-out is. You reach it over MCP, at `POST <instance>/mcp`, with an agent key
in `Authorization: Bearer kb_…`. The endpoint is stateless: every call carries
its own credential, and a revoked key stops on the next call.

## Read first, then write

1. `list_boards` — the boards this key can reach, with its role on each.
2. `get_board` — board, columns, cards, members and your role in one call.
   Never guess a board id from a URL you saw in a conversation; ask for it.
3. `get_card` before `update_card` on a card you did not just create. Pass the
   `updated_at` you read as `expected_updated_at`; a mismatch answers `-32003`
   with the current row, and you re-read instead of overwriting a paragraph a
   human wrote.

## Writing

- `create_card` takes `{board, column, title, description?, assignee?, due_at?,
  tags?}`. `assignee` is the **username** you read off the board, not an id.
- More than five cards: `bulk_create_cards`, one transaction and one write. The
  rate limit counts a write per call, not per card, so looping `create_card`
  fifty times is how a loop gets throttled (`-32004`, `retry_after_s`).
- `move_card` takes `{column, before, after}` — the ids of the cards that will
  sit above and below the new position, or `null`. There is no index, by
  design: an index from a filtered view is a bug.
- `set_card_done` is the done tick. It writes `card.completed` or
  `card.reopened`, which is what the activity feed and the close-out read.
- `update_card` and `set_card_done` return the card. Do not re-read to confirm.

## Finishing

- `search_cards` filters server-side; it caps at 50 and sets `truncated`.
- `get_activity` is the event log, newest first: what happened, who did it.
- `export_board` returns the board as `klui.export/v2` JSON or Markdown, the
  same bytes `GET /boards/:id/export.json|.md` serves. Over 256 KB it answers
  `-32006` with the REST URL to download instead.

## Errors are instructions

`-32602` names the parameter, the type it wanted and one working example.
`-32601` suggests the three closest tool names. `-32001` is "not found" and also
"not allowed" — for a board you cannot read, the two are deliberately the same
answer, so do not try to tell them apart. `-32002` is a refusal on a board you
can read. `-32004` carries `retry_after_s`.

## What you cannot do, and should say so

You cannot close a project, invite a member, move ownership, moderate a queue,
mint a share link or repaint a board's tag defaults. Those are human acts on the
same board. Say what you did, and what needs a person.
