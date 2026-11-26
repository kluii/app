// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The authz matrix (docs/permissions.md §6).
 *
 * Every cell of visibility × link role × anon policy × member role × actor kind ×
 * action is asserted, including every deny. The expectation is written here from
 * the table in `docs/permissions.md`, not imported from `authz.ts`: a test that
 * reuses the implementation's opinion documents it instead of gating it.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  can,
  type Action,
  type Actor,
  type AnonWrite,
  type BoardPolicy,
  type LinkRole,
  type MemberRole,
  type Visibility,
} from '../src/lib/authz.js';

type Expected = 'allow' | 'not_found' | 'forbidden' | 'board_closed';

const VISIBILITIES: Visibility[] = ['private', 'link', 'public'];
const LINK_ROLES: LinkRole[] = ['read', 'edit', 'none'];
const ANON_POLICIES: AnonWrite[] = ['off', 'open', 'moderated'];
const MEMBER_ROLES: (MemberRole | null)[] = ['owner', 'admin', 'editor', 'viewer', null];

const READERS = ['board.read', 'board.summary', 'board.export'] as const;

const OWNER_ONLY: Action[] = ['board.delete', 'member.transfer'];
const ADMIN_UP: Action[] = [
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
  'agent_key.create',
];
const EDITOR_UP: Action[] = [
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
];
const LINK_EDIT: Action[] = ['card.create', 'card.update', 'card.move', 'card.complete'];

function board(overrides: Partial<BoardPolicy> = {}): BoardPolicy {
  return {
    id: 'brd_matrix000000000000001',
    ownerId: 'usr_owner00000000000000001',
    visibility: 'private',
    linkRole: 'none',
    anonWrite: 'off',
    closedAt: null,
    ...overrides,
  };
}

function memberExpected(
  role: MemberRole,
  action: Action,
  isAuthor: boolean,
  isAgent: boolean,
): Expected {
  if (isAgent && action === 'agent_key.create') return 'forbidden';
  const reads = (READERS as readonly string[]).includes(action);
  if (reads) return 'allow';

  switch (role) {
    case 'owner':
      return 'allow';
    case 'admin':
      return OWNER_ONLY.includes(action) ? 'forbidden' : 'allow';
    case 'editor':
      if (ADMIN_UP.includes(action)) return 'forbidden';
      if (!EDITOR_UP.includes(action)) return 'forbidden';
      if (action === 'comment.update' || action === 'comment.delete') {
        return isAuthor ? 'allow' : 'forbidden';
      }
      return 'allow';
    case 'viewer':
      return 'forbidden';
  }
}

function expectedFor(input: {
  actor: Actor;
  action: Action;
  policy: BoardPolicy;
  role: MemberRole | null;
  isAuthor: boolean;
  isOwnCard: boolean;
}): Expected {
  const { actor, action, policy, role, isAuthor, isOwnCard } = input;

  if (actor.kind === 'agent' && actor.scope === 'board' && actor.boardId !== policy.id) {
    return 'not_found';
  }
  if ((actor.kind === 'link' || actor.kind === 'anon') && actor.boardId !== policy.id) {
    return 'not_found';
  }

  const shared = policy.visibility !== 'private' && policy.linkRole !== 'none';
  const readable =
    actor.kind === 'user' || actor.kind === 'agent'
      ? role !== null
      : actor.kind === 'link'
        ? shared
        : policy.visibility === 'public' || shared;
  if (!readable) return 'not_found';

  const isRead = (READERS as readonly string[]).includes(action);
  if (policy.closedAt !== null && !isRead) return 'board_closed';

  switch (actor.kind) {
    case 'user':
    case 'agent':
      if (role === null) return 'not_found';
      return memberExpected(role, action, isAuthor, actor.kind === 'agent');
    case 'link': {
      if (action === 'board.read' || action === 'board.summary') return 'allow';
      if (actor.role === 'edit' && LINK_EDIT.includes(action)) return 'allow';
      return 'forbidden';
    }
    case 'anon': {
      if (action === 'board.read' || action === 'board.summary') return 'allow';
      if (policy.anonWrite === 'off') return 'forbidden';
      if (action === 'card.create') return 'allow';
      if (policy.anonWrite === 'open' && (action === 'card.update' || action === 'card.complete')) {
        return isOwnCard ? 'allow' : 'forbidden';
      }
      return 'forbidden';
    }
  }
}

function actors(policy: BoardPolicy): Actor[] {
  return [
    { kind: 'user', userId: 'usr_actor00000000000000001' },
    { kind: 'agent', userId: 'usr_actor00000000000000001', scope: 'user' },
    { kind: 'agent', userId: 'usr_actor00000000000000001', scope: 'board', boardId: policy.id },
    {
      kind: 'agent',
      userId: 'usr_actor00000000000000001',
      scope: 'board',
      boardId: 'brd_other00000000000000001',
    },
    { kind: 'link', boardId: policy.id, role: 'read', linkId: 'lnk_matrix000000000000001' },
    { kind: 'link', boardId: policy.id, role: 'edit', linkId: 'lnk_matrix000000000000002' },
    {
      kind: 'anon',
      boardId: policy.id,
      label: 'Sam',
      anonId: 'anon-matrix',
    },
  ];
}

describe('the authorization matrix', () => {
  it('asserts every cell, including every deny', () => {
    let cells = 0;
    for (const visibility of VISIBILITIES) {
      for (const linkRole of LINK_ROLES) {
        for (const anonWrite of ANON_POLICIES) {
          for (const closedAt of [null, new Date('2026-11-26T10:00:00.000Z')]) {
            const policy = board({ visibility, linkRole, anonWrite, closedAt });
            for (const role of MEMBER_ROLES) {
              for (const actor of actors(policy)) {
                for (const action of ACTIONS) {
                  for (const isAuthor of [false, true]) {
                    for (const isOwnCard of [false, true]) {
                      const expected = expectedFor({
                        actor,
                        action,
                        policy,
                        role,
                        isAuthor,
                        isOwnCard,
                      });
                      const decision = can(actor, action, policy, role ? { role } : null, {
                        isAuthor,
                        isOwnCard,
                      });
                      const actual: Expected = decision.allow
                        ? 'allow'
                        : decision.code === 'board_closed'
                          ? 'board_closed'
                          : decision.reason;
                      cells += 1;
                      expect(
                        actual,
                        `${visibility}/${linkRole}/${anonWrite}/${role ?? 'non-member'}/${actor.kind}${
                          actor.kind === 'agent' ? `:${actor.scope}` : ''
                        }/${action}/author=${isAuthor}/own=${isOwnCard}/closed=${closedAt !== null}`,
                      ).toBe(expected);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    // 3 visibilities × 3 link roles × 3 anon policies × 2 board states (open/closed)
    // × 5 member roles (including non-member) × 7 actors × 28 actions × 2 author
    // × 2 own-card = 211 680 cells.
    expect(cells).toBe(211680);
  });

  it('makes private + a readable link role impossible to exercise: links get 404', () => {
    const policy = board({ visibility: 'private', linkRole: 'edit', anonWrite: 'open' });
    for (const actor of [
      { kind: 'link' as const, boardId: policy.id, role: 'edit' as const, linkId: 'lnk_x' },
      { kind: 'anon' as const, boardId: policy.id, label: 'Sam', anonId: 'anon-x' },
    ]) {
      const decision = can(actor, 'board.read', policy);
      expect(decision).toEqual({
        allow: false,
        reason: 'not_found',
        code: 'board_not_found',
      });
    }
  });

  it('gives a board-scoped agent key of an instance admin no access to another board', () => {
    const other = board({ id: 'brd_other00000000000000001' });
    const decision = can(
      {
        kind: 'agent',
        userId: 'usr_admin00000000000000001',
        scope: 'board',
        boardId: 'brd_matrix000000000000001',
      },
      'board.read',
      other,
      { role: 'owner' },
    );
    expect(decision).toEqual({ allow: false, reason: 'not_found', code: 'board_not_found' });
  });

  it('refuses a viewer every write, comments included', () => {
    const policy = board();
    for (const action of EDITOR_UP) {
      const decision = can({ kind: 'user', userId: 'usr_viewer0000000000000001' }, action, policy, {
        role: 'viewer',
      });
      expect(decision.allow, action).toBe(false);
    }
  });

  it('lets a link editor move and complete work but never delete or export it', () => {
    const policy = board({ visibility: 'link', linkRole: 'edit' });
    const actor: Actor = { kind: 'link', boardId: policy.id, role: 'edit', linkId: 'lnk_edit' };
    expect(can(actor, 'card.move', policy).allow).toBe(true);
    expect(can(actor, 'card.complete', policy).allow).toBe(true);
    expect(can(actor, 'card.delete', policy).allow).toBe(false);
    expect(can(actor, 'board.export', policy).allow).toBe(false);
    expect(can(actor, 'column.create', policy).allow).toBe(false);
  });

  it('keeps a closed board readable and refuses every write with board_closed, owner included', () => {
    const policy = board({ closedAt: new Date('2026-11-26T10:00:00.000Z') });
    const owner: Actor = { kind: 'user', userId: 'usr_owner00000000000000001' };
    expect(can(owner, 'board.read', policy, { role: 'owner' }).allow).toBe(true);
    expect(can(owner, 'board.export', policy, { role: 'owner' }).allow).toBe(true);
    expect(can(owner, 'card.create', policy, { role: 'owner' })).toEqual({
      allow: false,
      reason: 'forbidden',
      code: 'board_closed',
    });
  });

  it('denies an agent the right to mint another key', () => {
    const policy = board();
    const decision = can(
      { kind: 'agent', userId: 'usr_owner00000000000000001', scope: 'board', boardId: policy.id },
      'agent_key.create',
      policy,
      { role: 'owner' },
    );
    expect(decision.allow).toBe(false);
  });

  it('lets an anonymous actor edit only the card it created', () => {
    const policy = board({ visibility: 'link', linkRole: 'edit', anonWrite: 'open' });
    const actor: Actor = { kind: 'anon', boardId: policy.id, label: 'Sam', anonId: 'anon-1' };
    expect(can(actor, 'card.update', policy, null, { isOwnCard: true }).allow).toBe(true);
    expect(can(actor, 'card.update', policy, null, { isOwnCard: false }).allow).toBe(false);
    expect(can(actor, 'card.move', policy, null, { isOwnCard: true }).allow).toBe(false);
    expect(can(actor, 'comment.create', policy, null, { isOwnCard: true }).allow).toBe(false);
    expect(can(actor, 'card.delete', policy, null, { isOwnCard: true }).allow).toBe(false);
  });
});
