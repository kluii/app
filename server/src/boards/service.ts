// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Board reads and writes. Every route loads the board, calls `can()` and only
 * then touches content; the 404 decision happens in `can()` (ADR-0002).
 */
import type { Prisma } from '@prisma/client';
import type { Db } from '../db.js';
import {
  can,
  type Action,
  type Actor,
  type BoardPolicy,
  type DecisionContext,
  type MemberRole,
  type Membership,
} from '../lib/authz.js';
import { AppError, boardNotFound } from '../lib/errors.js';
import { base62 } from '../lib/ids.js';
import type { BoardDto } from '../contracts/dto.js';

type Tx = Prisma.TransactionClient;

/** Decision mapped to the documented status and code (docs/permissions.md §5). */
export function assertAllowed(decision: ReturnType<typeof can>): void {
  if (decision.allow) return;
  if (decision.reason === 'not_found') throw boardNotFound();
  throw new AppError(decision.code === 'board_closed' ? 'board_closed' : 'forbidden', {
    message:
      decision.code === 'board_closed'
        ? 'This board is closed.'
        : 'You do not have permission to do that.',
    hint:
      decision.code === 'board_closed'
        ? 'The board is readable; the export is the escape hatch.'
        : null,
  });
}

export type LoadedBoard = {
  board: Prisma.BoardGetPayload<{ include: { owner: { select: { id: true; username: true } } } }>;
  membership: Membership;
  policy: BoardPolicy;
  actor: Actor;
  decision: ReturnType<typeof can>;
};

export async function loadBoardFor(
  db: Db,
  actor: Actor,
  boardId: string,
  action: Action,
  context: DecisionContext = {},
): Promise<LoadedBoard> {
  const board = await db.board.findUnique({
    where: { id: boardId },
    include: { owner: { select: { id: true, username: true } } },
  });
  if (!board) throw boardNotFound();

  const policy = toPolicy(board);
  const membership = await membershipFor(db, actor, board.id);
  const decision = can(actor, action, policy, membership, context);
  return { board, membership, policy, actor, decision };
}

export function toPolicy(board: {
  id: string;
  owner_id: string;
  visibility: string;
  link_role: string;
  anon_write: string;
  closed_at: Date | null;
}): BoardPolicy {
  return {
    id: board.id,
    ownerId: board.owner_id,
    visibility: board.visibility as BoardPolicy['visibility'],
    linkRole: board.link_role as BoardPolicy['linkRole'],
    anonWrite: board.anon_write as BoardPolicy['anonWrite'],
    closedAt: board.closed_at,
  };
}

export async function membershipFor(db: Db, actor: Actor, boardId: string): Promise<Membership> {
  if (actor.kind !== 'user' && actor.kind !== 'agent') return null;
  const row = await db.boardMember.findUnique({
    where: { board_id_user_id: { board_id: boardId, user_id: actor.userId } },
  });
  return row ? { role: row.role as MemberRole } : null;
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 40);
  return base.length >= 3 ? base : `board-${base62(4).toLowerCase()}`.slice(0, 40);
}

export async function uniqueSlug(tx: Tx | Db, ownerId: string, wanted: string): Promise<string> {
  let candidate = wanted;
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const existing = await tx.board.findFirst({
      where: { owner_id: ownerId, slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${wanted.slice(0, 36)}-${attempt}`;
  }
  return `${wanted.slice(0, 30)}-${base62(6).toLowerCase()}`;
}

export function linkSuffix(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(base62(4).toLowerCase())
    .map((char) => alphabet[alphabet.indexOf(char) >= 0 ? alphabet.indexOf(char) : 0])
    .join('');
}

export function toBoardDto(
  board: {
    id: string;
    name: string;
    slug: string;
    visibility: string;
    link_role: string;
    anon_write: string;
    link_suffix: string | null;
    closed_at: Date | null;
    created_at: Date;
    updated_at: Date;
    owner: { id: string; username: string };
  },
  publicUrl: string | null,
): BoardDto {
  return {
    id: board.id,
    name: board.name,
    slug: board.slug,
    visibility: board.visibility as BoardDto['visibility'],
    link_role: board.link_role as BoardDto['link_role'],
    anon_write: board.anon_write as BoardDto['anon_write'],
    link_suffix: board.link_suffix,
    url: publicUrl ? boardUrl(publicUrl, board) : null,
    owner: { id: board.owner.id, username: board.owner.username },
    closed_at: board.closed_at ? board.closed_at.toISOString() : null,
    created_at: board.created_at.toISOString(),
    updated_at: board.updated_at.toISOString(),
  };
}

export function boardUrl(
  publicUrl: string,
  board: {
    slug: string;
    visibility: string;
    link_suffix: string | null;
    owner: { username: string };
  },
): string {
  const suffix = board.visibility === 'link' && board.link_suffix ? `-${board.link_suffix}` : '';
  return `${publicUrl.replace(/\/$/, '')}/${board.owner.username}/${board.slug}${suffix}`;
}

export const CLASSIC_COLUMNS = ['To do', 'Doing', 'Done'];
