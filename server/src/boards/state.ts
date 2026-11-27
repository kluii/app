// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One round trip paints a board (docs/api.md §2, `BoardState`).
 *
 * Extracted from the REST route so `/mcp` `get_board` answers with the same
 * document: two builders would drift, and an agent that reads a different board
 * than the human sees is a bug nobody reports.
 */
import type { Db } from '../db.js';
import type { Actor } from '../lib/authz.js';
import { can } from '../lib/authz.js';
import type { BoardStateDto, CallerDto } from '../contracts/dto.js';
import { toCardDto, toColumnDto, boardTagColors } from '../cards/service.js';
import { assertAllowed, loadBoardFor, toBoardDto, toPolicy } from './service.js';
import { toBoardMembers } from './members.js';

export async function boardStateFor(
  db: Db,
  actor: Actor,
  boardId: string,
  publicUrl: string | null,
): Promise<BoardStateDto> {
  const loaded = await loadBoardFor(db, actor, boardId, 'board.read');
  assertAllowed(loaded.decision);

  const [columns, cards, tagColors, members, pendingCount] = await Promise.all([
    db.column.findMany({ where: { board_id: boardId }, orderBy: { position: 'asc' } }),
    db.card.findMany({
      where: { board_id: boardId },
      include: { tags: true },
      orderBy: [{ column_id: 'asc' }, { position: 'asc' }],
    }),
    boardTagColors(db, boardId),
    toBoardMembers(db, boardId),
    db.pendingCard.count({ where: { board_id: boardId } }),
  ]);

  const assigneeIds = cards
    .map((card) => card.assignee_id)
    .filter((value): value is string => value !== null);
  const assignees =
    assigneeIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, username: true },
        })
      : [];
  const assigneeById = new Map(assignees.map((user) => [user.id, user]));

  const policy = toPolicy(loaded.board);
  // `label` is how the client recognises its own rows — its own comments, its
  // own name in the feed — so an account caller gets its username, which is the
  // shape docs/api.md §2 shows (`"label":"will"`).
  const self =
    actor.kind === 'user' || actor.kind === 'agent'
      ? await db.user.findUnique({ where: { id: actor.userId }, select: { username: true } })
      : null;
  const caller: CallerDto = {
    actor_kind: actor.kind,
    role: loaded.membership ? loaded.membership.role : null,
    label:
      actor.kind === 'anon' ? actor.label : actor.kind === 'link' ? 'link' : (self?.username ?? ''),
    can_write: can(actor, 'card.create', policy, loaded.membership).allow,
    can_delete_card: can(actor, 'card.delete', policy, loaded.membership).allow,
    can_move_card: can(actor, 'card.move', policy, loaded.membership).allow,
    can_comment: can(actor, 'comment.create', policy, loaded.membership).allow,
    can_manage_columns: can(actor, 'column.create', policy, loaded.membership).allow,
    can_manage_members: can(actor, 'member.invite', policy, loaded.membership).allow,
    can_manage: can(actor, 'board.update', policy, loaded.membership).allow,
    can_moderate: can(actor, 'moderation.decide', policy, loaded.membership).allow,
    can_export: can(actor, 'board.export', policy, loaded.membership).allow,
    can_import: can(actor, 'board.import', policy, loaded.membership).allow,
    can_close: can(actor, 'board.close', policy, loaded.membership).allow,
  };

  return {
    board: toBoardDto(loaded.board, publicUrl),
    columns: columns.map(toColumnDto),
    cards: cards.map((card) =>
      toCardDto(
        card,
        card.assignee_id ? (assigneeById.get(card.assignee_id) ?? null) : null,
        tagColors,
        actor,
      ),
    ),
    members,
    caller,
    pending_count: caller.can_moderate ? pendingCount : 0,
  };
}
