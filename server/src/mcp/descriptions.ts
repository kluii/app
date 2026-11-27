// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One line per tool, and the only copy that describes them.
 *
 * `tools/list` sends it to a client, and `/llms.txt` prints it for a human
 * deciding whether to wire an agent up. Two copies would drift, and the one a
 * markdown file carries is the one nobody re-reads (docs/mcp.md §8).
 */
import type { ToolName } from './schemas.js';

export const DESCRIPTIONS: Record<ToolName, string> = {
  list_boards: 'Boards the credential can read, newest activity first.',
  get_board: 'One round trip: board, columns, cards, members and caller role.',
  create_board: 'Create a board; templates are not exposed to agents.',
  update_board: 'Rename, re-slug or change visibility, link role and anonymous policy.',
  delete_board: 'Irreversible. Requires confirm:true.',
  create_column: 'Add a column, optionally between two neighbours.',
  update_column: 'Rename a column.',
  delete_column: 'Delete a column; cards must be moved or explicitly deleted with it.',
  create_card: 'Create one card. Use bulk_create_cards for more than five.',
  bulk_create_cards: 'Create up to 200 cards in one transaction; counts as one write.',
  get_card: 'Read one card with its tags, comments count and actor label.',
  update_card: 'Change a card; pass expected_updated_at for a card you did not just create.',
  move_card: 'Move a card using neighbours, never an index.',
  set_card_done: 'Mark a card done or reopen it.',
  delete_card: 'Delete a card.',
  list_comments: 'Comments on a card, oldest first.',
  create_comment: 'Add a comment to a card.',
  search_cards: 'Server-side filter; caps at 50 results.',
  get_activity: 'The event log for a board, newest first.',
  export_board: 'The board as klui.export/v2 JSON or Markdown, inline under 256 KB.',
  whoami: 'The account and scope behind this credential.',
};
