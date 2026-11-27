// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Board reads and writes. Every route loads the board, calls `can()` and only
 * then touches content; the 404 decision happens in `can()` (ADR-0002).
 */
import type { Prisma } from '@prisma/client';
import type { Db } from '../db.js';
import {
  can,
  canCreateBoard,
  type Action,
  type Actor,
  type BoardPolicy,
  type DecisionContext,
  type MemberRole,
  type Membership,
} from '../lib/authz.js';
import { AppError, boardNotFound } from '../lib/errors.js';
import { slugRedirect, usernameRedirect } from '../auth/profile.js';
import { base62, newId } from '../lib/ids.js';
import { RANK_STEP } from '../lib/ranks.js';
import { recordEvent } from '../lib/events.js';
import { conflictIfStale } from '../lib/concurrency.js';
import { commitEvent, type Hub } from '../realtime/events.js';
import type { BoardDto } from '../contracts/dto.js';
import {
  sharePolicyConflict,
  type CreateBoardInput,
  type PatchBoardInput,
} from '../contracts/boards.js';

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

export type BoardListDto = BoardDto & { role: MemberRole };

/**
 * The boards an actor may read, and the one place that answers it
 * (docs/api.md §3, docs/mcp.md §3).
 *
 * `GET /boards` and `list_boards` used to answer differently: the route read
 * every membership row for the account while the tool filtered each row through
 * `can()`, so a board-scoped key listed its owner's other boards and then got a
 * 404 from the board's own route. The filter below is `can()` — the structural
 * scope rule lives there and is not restated here.
 *
 * A link or an anonymous visitor has no membership to read: an empty list, not
 * a refusal.
 */
export async function listBoardsFor(
  db: Db,
  actor: Actor,
  publicUrl: string | null,
): Promise<{ items: BoardListDto[] }> {
  if (actor.kind !== 'user' && actor.kind !== 'agent') return { items: [] };
  const memberships = await db.boardMember.findMany({
    where: { user_id: actor.userId },
    include: { board: { include: { owner: { select: { id: true, username: true } } } } },
    orderBy: [{ board: { updated_at: 'desc' } }, { board_id: 'asc' }],
  });
  const items = memberships
    .filter(
      (membership) =>
        can(actor, 'board.read', toPolicy(membership.board), { role: membership.role }).allow,
    )
    .map((membership) => ({ ...toBoardDto(membership.board, publicUrl), role: membership.role }));
  return { items };
}

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
  publicUrl: string | null,
  board: {
    slug: string;
    visibility: string;
    link_suffix: string | null;
    owner: { username: string };
  },
): string {
  const suffix = board.visibility === 'link' && board.link_suffix ? `-${board.link_suffix}` : '';
  // Without a configured origin the path is still correct, just relative.
  return `${(publicUrl ?? '').replace(/\/$/, '')}/${board.owner.username}/${board.slug}${suffix}`;
}

/** `slug-ab12` → `{ base: 'slug', suffix: 'ab12' }`; anything else keeps the segment. */
export function splitLinkSuffix(segment: string): { base: string; suffix: string | null } {
  const match = /^(.*)-([a-z0-9]{4})$/.exec(segment);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return { base: segment, suffix: null };
  }
  return { base: match[1], suffix: match[2] };
}

/**
 * The URL a human types, never an API path: `/<owner>/<slug>` for a private or
 * public board, `/<owner>/<slug>-<suffix>` for a link board.
 */
export function humanBoardPath(board: {
  owner: { username: string };
  slug: string;
  visibility: string;
  link_suffix: string | null;
}): string {
  const suffix = board.visibility === 'link' && board.link_suffix ? `-${board.link_suffix}` : '';
  return `/${board.owner.username}/${board.slug}${suffix}`;
}

/**
 * Resolves a public URL segment to a board id **without deciding anything**: the
 * caller still runs `can()`. A suffix that does not match, or a bare slug on a
 * link board, is simply not a board — the old suffix must `404` after rotation.
 *
 * The exact slug is tried **before** splitting off a suffix: `board-under-test`
 * ends in four letters and used to be read as board `board-under` + suffix
 * `test`, which 404'd a public board whose name happened to end in a word.
 *
 * Renames are followed here so a 90-day reservation redirects, but the redirect
 * is only emitted after the readability check (PROMPT.md §3.4).
 */
export async function resolvePublicBoard(
  db: Db,
  username: string,
  segment: string,
): Promise<{ id: string; suffix: string | null } | null> {
  let owner = username.toLowerCase();
  let wanted = segment;

  const find = (slug: string, byOwner: string) =>
    db.board.findFirst({
      where: { slug, owner: { username: byOwner } },
      select: { id: true, visibility: true, link_suffix: true },
    });

  // Two hops is enough: a rename of the account and one of the board.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const exact = await find(wanted, owner);
    if (exact) {
      // A link board is never addressed by its bare slug; a private or public
      // board is never addressed with a suffix.
      return exact.visibility === 'link' ? null : { id: exact.id, suffix: null };
    }

    const { base, suffix } = splitLinkSuffix(wanted);
    if (suffix !== null) {
      const board = await find(base, owner);
      if (board) {
        if (board.visibility !== 'link' || suffix !== board.link_suffix) return null;
        return { id: board.id, suffix };
      }
    }

    // Renames inside their 90-day reservation redirect, after the caller has
    // checked readability of the target (PROMPT.md §3.4).
    const renamedOwner = await usernameRedirect(db, owner);
    const nextOwner = renamedOwner !== null && renamedOwner !== owner ? renamedOwner : owner;
    const renamedSlug =
      (await slugRedirect(db, nextOwner, base)) ?? (await slugRedirect(db, nextOwner, wanted));
    const changedOwner = nextOwner !== owner;
    const changedSlug = renamedSlug !== null && renamedSlug !== wanted;
    if (!changedOwner && !changedSlug) return null;
    owner = nextOwner;
    wanted = renamedSlug ?? wanted;
  }
  return null;
}

export const CLASSIC_COLUMNS = ['To do', 'Doing', 'Done'];

/**
 * The three board writes, extracted from the routes so `/mcp` and REST run the
 * same function: same `can()`, same transaction, same event, same DTO. A second
 * implementation inside `mcp/` would be a bug even when it passed its test.
 */
export type BoardWrite = {
  db: Db;
  actor: Actor;
  publicUrl: string | null;
  hub?: Hub;
};

export async function createBoard(context: BoardWrite, input: CreateBoardInput): Promise<BoardDto> {
  const { db, actor } = context;
  const decision = canCreateBoard(actor);
  if (!decision.allow) {
    throw new AppError('forbidden', {
      message:
        actor.kind === 'agent'
          ? 'A board-scoped agent key cannot create a new board.'
          : 'Only an account can create a board.',
      hint:
        actor.kind === 'agent'
          ? 'Use a user-scoped agent key or a user session to create a board.'
          : 'Sign in, or ask a member for a link.',
    });
  }
  if (actor.kind !== 'user' && actor.kind !== 'agent') {
    throw new AppError('forbidden');
  }
  const userId = actor.userId;

  const board = await db.$transaction(async (tx) => {
    const slug = await uniqueSlug(tx, userId, slugify(input.name));
    const visibility = input.visibility ?? 'private';
    const created = await tx.board.create({
      data: {
        id: newId('brd'),
        owner_id: userId,
        name: input.name,
        slug,
        visibility,
        link_role: 'none',
        anon_write: 'off',
        link_suffix: visibility === 'link' ? linkSuffix() : null,
      },
      include: { owner: { select: { id: true, username: true } } },
    });
    await tx.boardMember.create({
      data: { id: newId('bmb'), board_id: created.id, user_id: userId, role: 'owner' },
    });
    if ((input.template ?? 'classic') === 'classic') {
      for (const [index, name] of CLASSIC_COLUMNS.entries()) {
        await tx.column.create({
          data: {
            id: newId('col'),
            board_id: created.id,
            name,
            position: (index + 1) * RANK_STEP,
          },
        });
      }
    }
    await recordEvent(tx, {
      boardId: created.id,
      actor,
      type: 'board.created',
      payload: { board_id: created.id, name: created.name, visibility: created.visibility },
    });
    return created;
  });

  commitEvent(context.hub, {
    boardId: board.id,
    type: 'board.created',
    entity: 'board',
    action: 'created',
    payload: { board_id: board.id },
    actorLabel: actor.kind,
  });
  return toBoardDto(board, context.publicUrl);
}

export async function updateBoard(
  context: BoardWrite,
  boardId: string,
  input: PatchBoardInput,
): Promise<BoardDto> {
  const { db, actor, publicUrl } = context;
  const loaded = await loadBoardFor(db, actor, boardId, 'board.update');
  assertAllowed(loaded.decision);

  conflictIfStale(
    loaded.board.updated_at,
    input.expected_updated_at,
    toBoardDto(loaded.board, publicUrl),
  );

  // A board is written by its members. Two policies are retired, and the API
  // refuses to set them again: a link is read-only, and no one writes without an
  // account. Existing rows keep their stored value; only new writes are refused.
  if (input.anon_write !== undefined && input.anon_write !== 'off') {
    const message = 'anonymous writes are no longer available';
    throw new AppError('validation_failed', {
      message,
      hint: 'Send anon_write: "off". A board is written by its members.',
      details: [{ path: 'anon_write', code: 'custom', message }],
    });
  }
  if (input.link_role === 'edit') {
    const message = 'a share link is read-only';
    throw new AppError('validation_failed', {
      message,
      hint: 'Send link_role: "read" or "none". A share link never grants a write.',
      details: [{ path: 'link_role', code: 'custom', message }],
    });
  }

  // The rule is about the state the request produces, not the payload it
  // carries: `{link_role}` alone has no `visibility` to check against.
  // `visibility: 'private'` coerces both fields in the same request, so the
  // requested values are what count here.
  const nextVisibility = input.visibility ?? loaded.board.visibility;
  const nextLinkRole =
    input.link_role ?? (input.visibility === 'private' ? 'none' : loaded.board.link_role);
  const nextAnonWrite =
    input.anon_write ?? (input.visibility === 'private' ? 'off' : loaded.board.anon_write);
  const conflict = sharePolicyConflict({
    visibility: nextVisibility,
    link_role: nextLinkRole,
    anon_write: nextAnonWrite,
  });
  if (conflict) {
    throw new AppError('validation_failed', {
      message: conflict.message,
      hint: 'A private board has no share policy. Change visibility in the same request.',
      details: [{ path: conflict.field, code: 'custom', message: conflict.message }],
    });
  }

  const changes: Record<string, [unknown, unknown]> = {};
  const data: Record<string, unknown> = {};

  if (input.name !== undefined && input.name !== loaded.board.name) {
    changes.name = [loaded.board.name, input.name];
    data.name = input.name;
  }
  if (input.slug !== undefined && input.slug !== loaded.board.slug) {
    changes.slug = [loaded.board.slug, input.slug];
    data.slug = input.slug;
  }
  if (input.visibility !== undefined && input.visibility !== loaded.board.visibility) {
    changes.visibility = [loaded.board.visibility, input.visibility];
    data.visibility = input.visibility;
    if (input.visibility === 'private') {
      data.link_role = 'none';
      data.anon_write = 'off';
      data.link_suffix = null;
    }
    if (input.visibility === 'link' && !loaded.board.link_suffix) {
      data.link_suffix = linkSuffix();
    }
    if (input.visibility === 'public') {
      data.link_suffix = null;
    }
  }
  if (input.link_role !== undefined && input.link_role !== loaded.board.link_role) {
    changes.link_role = [loaded.board.link_role, input.link_role];
    data.link_role = input.link_role;
  }
  if (input.anon_write !== undefined && input.anon_write !== loaded.board.anon_write) {
    changes.anon_write = [loaded.board.anon_write, input.anon_write];
    data.anon_write = input.anon_write;
  }

  const board = await db.$transaction(async (tx) => {
    if (Object.keys(data).length === 0) return loaded.board;
    const updated = await tx.board.update({
      where: { id: boardId },
      data,
      include: { owner: { select: { id: true, username: true } } },
    });
    if (changes.slug) {
      await tx.boardSlugReservation.create({
        data: {
          id: newId('bsr'),
          board_id: boardId,
          slug: String(changes.slug[0]),
          redirect_slug: updated.slug,
          reserved_until: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        },
      });
    }
    if (Object.keys(changes).length > 0) {
      await recordEvent(tx, {
        boardId,
        actor,
        type: 'board.updated',
        payload: { board_id: boardId, changes },
      });
    }
    return updated;
  });

  return toBoardDto(board, context.publicUrl);
}

export async function deleteBoard(
  context: BoardWrite,
  boardId: string,
  confirm: boolean,
): Promise<void> {
  const { db, actor } = context;
  const loaded = await loadBoardFor(db, actor, boardId, 'board.delete');
  assertAllowed(loaded.decision);
  if (confirm !== true) {
    throw new AppError('validation_failed', {
      message: 'Deleting a board requires confirmation.',
      hint: 'Send {"confirm": true} after the user has seen what will be deleted.',
      details: [{ path: 'confirm', code: 'invalid_literal', message: 'expected true' }],
    });
  }
  // D-23 and D-54: the one mutation that destroys the audit trail records it
  // itself. Counts are read and both events written inside the same
  // transaction as the delete, so a failure leaves neither a deletion nor a
  // record of one. The board-scoped row is what the SSE payload describes and
  // it dies with the cascade; the instance-scoped row is the durable record.
  await db.$transaction(async (tx) => {
    const [columns, cards, comments] = await Promise.all([
      tx.column.count({ where: { board_id: boardId } }),
      tx.card.count({ where: { board_id: boardId } }),
      tx.comment.count({ where: { board: { id: boardId } } }),
    ]);
    const payload = {
      board_id: boardId,
      name: loaded.board.name,
      slug: loaded.board.slug,
      owner: loaded.board.owner?.username ?? null,
      counts: { columns, cards, comments },
    };
    await recordEvent(tx, { boardId, actor, type: 'board.deleted', payload });
    await recordEvent(tx, { boardId: null, actor, type: 'board.deleted', payload });
    await tx.board.delete({ where: { id: boardId } });
  });
  commitEvent(context.hub, {
    boardId,
    type: 'board.deleted',
    entity: 'board',
    action: 'deleted',
    payload: { board_id: boardId },
    actorLabel: actor.kind,
  });
}
