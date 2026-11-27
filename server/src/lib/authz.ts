// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The only place a permission is decided (docs/permissions.md, ADR-0002).
 *
 * Every route, MCP tool, SSE subscription, HTML response, export and moderation
 * action calls `can()` before touching board-scoped data. `reason: 'not_found'`
 * means the caller renders the standard 404; `reason: 'forbidden'` means the
 * actor can already read the board and is refused a write (403).
 */
import type { ErrorCode } from './errors.js';

export type ActorKind = 'user' | 'agent' | 'link' | 'anon';

export type Actor =
  | { kind: 'user'; userId: string }
  | { kind: 'agent'; userId: string; scope: 'board' | 'user'; boardId?: string }
  | { kind: 'link'; boardId: string; role: 'read' | 'edit'; linkId: string }
  | { kind: 'anon'; boardId: string; label: string; anonId: string };

export type Action =
  | 'board.read'
  | 'board.summary'
  | 'board.update'
  | 'board.delete'
  | 'board.close'
  | 'board.export'
  | 'board.import'
  | 'member.invite'
  | 'member.update'
  | 'member.remove'
  | 'member.transfer'
  | 'link.list'
  | 'link.create'
  | 'link.revoke'
  | 'moderation.list'
  | 'moderation.decide'
  | 'column.create'
  | 'column.update'
  | 'column.delete'
  | 'card.create'
  | 'card.update'
  | 'card.move'
  | 'card.complete'
  | 'card.delete'
  | 'comment.create'
  | 'comment.update'
  | 'comment.delete'
  | 'agent_key.create';

export const ACTIONS: readonly Action[] = [
  'board.read',
  'board.summary',
  'board.update',
  'board.delete',
  'board.close',
  'board.export',
  'board.import',
  'member.invite',
  'member.update',
  'member.remove',
  'member.transfer',
  'link.list',
  'link.create',
  'link.revoke',
  'moderation.list',
  'moderation.decide',
  'column.create',
  'column.update',
  'column.delete',
  'card.create',
  'card.update',
  'card.move',
  'card.complete',
  'card.delete',
  'comment.create',
  'comment.update',
  'comment.delete',
  'agent_key.create',
];

export type Visibility = 'private' | 'link' | 'public';
export type LinkRole = 'read' | 'edit' | 'none';
export type AnonWrite = 'off' | 'open' | 'moderated';
export type MemberRole = 'owner' | 'admin' | 'editor' | 'viewer';

/** The projection of a board that `can()` needs. Loading anything is the caller's job. */
export type BoardPolicy = {
  id: string;
  ownerId: string;
  visibility: Visibility;
  linkRole: LinkRole;
  anonWrite: AnonWrite;
  closedAt: Date | null;
};

export type Membership = { role: MemberRole } | null;

export type Decision =
  { allow: true } | { allow: false; reason: 'not_found' | 'forbidden'; code?: ErrorCode };

export type DecisionContext = {
  /** comment.update / comment.delete: the actor wrote this comment. */
  isAuthor?: boolean;
  /** card.update / card.complete: the anonymous actor created this card. */
  isOwnCard?: boolean;
};

const ALLOW: Decision = { allow: true };
const NOT_FOUND: Decision = { allow: false, reason: 'not_found', code: 'board_not_found' };
const FORBIDDEN: Decision = { allow: false, reason: 'forbidden', code: 'forbidden' };
const CLOSED: Decision = { allow: false, reason: 'forbidden', code: 'board_closed' };

/** Reads that survive a closed board (docs/permissions.md §3 step 4). */
const READ_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'board.read',
  'board.summary',
  'board.export',
]);

const MEMBER_RULES: Record<MemberRole, ReadonlySet<Action>> = {
  owner: new Set<Action>([
    ...READ_ACTIONS,
    'board.update',
    'board.delete',
    'board.close',
    'board.import',
    'member.invite',
    'member.update',
    'member.remove',
    'member.transfer',
    'link.list',
    'link.create',
    'link.revoke',
    'moderation.list',
    'moderation.decide',
    'column.create',
    'column.update',
    'column.delete',
    'card.create',
    'card.update',
    'card.move',
    'card.complete',
    'card.delete',
    'comment.create',
    'comment.update',
    'comment.delete',
    'agent_key.create',
  ]),
  admin: new Set<Action>([
    ...READ_ACTIONS,
    'board.update',
    'board.close',
    'board.import',
    'member.invite',
    'member.update',
    'member.remove',
    'link.list',
    'link.create',
    'link.revoke',
    'moderation.list',
    'moderation.decide',
    'column.create',
    'column.update',
    'column.delete',
    'card.create',
    'card.update',
    'card.move',
    'card.complete',
    'card.delete',
    'comment.create',
    'comment.update',
    'comment.delete',
    'agent_key.create',
  ]),
  editor: new Set<Action>([
    ...READ_ACTIONS,
    'column.create',
    'column.update',
    'column.delete',
    'card.create',
    'card.update',
    'card.move',
    'card.complete',
    'card.delete',
    'comment.create',
    'comment.update',
    'comment.delete',
  ]),
  viewer: new Set<Action>([...READ_ACTIONS]),
};

/** Actions whose allow depends on the object, not the role alone. */
const OBJECT_ACTIONS: ReadonlySet<Action> = new Set<Action>(['comment.update', 'comment.delete']);

export function can(
  actor: Actor,
  action: Action,
  board: BoardPolicy,
  membership: Membership = null,
  context: DecisionContext = {},
): Decision {
  // 1. Board scope is structural: a scoped credential cannot address another board.
  if (actor.kind === 'agent' && actor.scope === 'board' && actor.boardId !== board.id) {
    return NOT_FOUND;
  }
  if ((actor.kind === 'link' || actor.kind === 'anon') && actor.boardId !== board.id) {
    return NOT_FOUND;
  }

  // 2. Readability before role: a non-member never learns that a board is closed.
  if (!canRead(actor, board, membership)) {
    return NOT_FOUND;
  }

  // 3. A closed board allows reads, summary and export, and nothing else.
  if (board.closedAt !== null && !READ_ACTIONS.has(action)) {
    return CLOSED;
  }

  switch (actor.kind) {
    case 'user':
    case 'agent': {
      const deniedForAgents = actor.kind === 'agent' && action === 'agent_key.create';
      if (membership === null) return NOT_FOUND;
      if (deniedForAgents) return FORBIDDEN;
      return memberDecision(membership.role, action, context);
    }
    case 'link':
      return linkDecision(actor.role, action);
    case 'anon':
      return anonDecision(board.anonWrite, actor, action, context);
  }
}

function canRead(actor: Actor, board: BoardPolicy, membership: Membership): boolean {
  switch (actor.kind) {
    case 'user':
    case 'agent':
      return membership !== null;
    case 'link':
      // A readable slug grants reading only when the board is shared at all.
      return board.visibility !== 'private' && board.linkRole !== 'none';
    case 'anon':
      if (board.visibility === 'public') return true;
      return board.visibility === 'link' && board.linkRole !== 'none';
  }
}

function memberDecision(role: MemberRole, action: Action, context: DecisionContext): Decision {
  const rules = MEMBER_RULES[role];
  if (!rules.has(action)) return FORBIDDEN;
  if (OBJECT_ACTIONS.has(action)) {
    if (role === 'owner' || role === 'admin') return ALLOW;
    return context.isAuthor === true ? ALLOW : FORBIDDEN;
  }
  return ALLOW;
}

/**
 * A share link is read-only. The `edit` value is retired as a *capability* and
 * kept as a *literal*: rows written before the rule still say `edit`, and
 * rewriting them would be a migration for a word. Whatever the row says, the
 * link reads and does not write — the rule is "a board is written by its
 * members", and a link holder is not a member.
 */
function linkDecision(role: 'read' | 'edit', action: Action): Decision {
  void role;
  if (action === 'board.read' || action === 'board.summary') return ALLOW;
  return FORBIDDEN;
}

/**
 * Nobody writes without an account: an anonymous actor reads a shared board and
 * nothing more, whatever the stored `anon_write` says. The column survives for
 * compatibility — old rows keep their value, the API refuses to set a new one —
 * but it no longer grants anything, not even a comment.
 */
function anonDecision(
  policy: AnonWrite,
  actor: Extract<Actor, { kind: 'anon' }>,
  action: Action,
  context: DecisionContext,
): Decision {
  // Reading is allowed whatever the write policy: `off` removes the write
  // affordance, not the page (docs/permissions.md §4.3).
  void policy;
  void actor;
  void context;
  if (action === 'board.read' || action === 'board.summary') return ALLOW;
  return FORBIDDEN;
}

/**
 * Board creation has no existing board to pass to `can()`, so it lives beside
 * it here rather than as an ad-hoc check in a service or an MCP tool (D-58).
 * Only a signed-in user or a user-scoped agent key may open a new board; a
 * board-scoped key is bound to its single board and cannot mint a second.
 */
export function canCreateBoard(actor: Actor): Decision {
  if (actor.kind === 'user') return ALLOW;
  if (actor.kind === 'agent' && actor.scope === 'user') return ALLOW;
  return FORBIDDEN;
}

/** A closed board's write refusal carries its own code so the client can explain it. */
export function isClosedWrite(decision: Decision): boolean {
  return !decision.allow && decision.code === 'board_closed';
}
