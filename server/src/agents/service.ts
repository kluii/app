// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Agent keys (docs/features/agents.md, K4-01).
 *
 * A key is a credential, not an identifier: `kb_` + 32 base62, shown once, stored
 * as `sha256(raw + pepper)`, revocable with no cache. Its scope is part of the
 * `Actor`, so `can()` rejects a foreign board before it computes anything.
 */
import type { Db } from '../db.js';
import type { Actor } from '../lib/authz.js';
import { AppError } from '../lib/errors.js';
import { base62, newId } from '../lib/ids.js';
import { hashToken } from '../lib/hash.js';
import { recordEvent } from '../lib/events.js';
import { assertAllowed, loadBoardFor } from '../boards/service.js';

export const KEY_PREFIX = 'kb_';
export const DEFAULT_EXPIRY_DAYS = 90;

export type AgentKeyDto = {
  id: string;
  name: string;
  scope: 'board' | 'user';
  board_id: string | null;
  board_name: string | null;
  role: string | null;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type CreatedAgentKey = AgentKeyDto & { key: string };

export function newAgentKeyRaw(): string {
  return `${KEY_PREFIX}${base62(32)}`;
}

export function agentKeyHash(raw: string, pepper: string): string {
  return hashToken(raw, pepper);
}

export function isAgentKey(raw: string): boolean {
  return raw.startsWith(KEY_PREFIX);
}

export async function createAgentKey(
  db: Db,
  input: {
    actor: Extract<Actor, { kind: 'user' }>;
    pepper: string;
    name: string;
    scope: 'board' | 'user';
    boardId?: string;
    expiresInDays?: number;
  },
): Promise<CreatedAgentKey> {
  let role: string | null = null;
  let boardName: string | null = null;
  if (input.scope === 'board') {
    if (input.boardId === undefined) {
      throw new AppError('validation_failed', {
        message: 'A board-scoped key needs board_id.',
        hint: 'Pass board_id, or issue a user-scoped key.',
      });
    }
    const loaded = await loadBoardFor(db, input.actor, input.boardId, 'agent_key.create');
    assertAllowed(loaded.decision);
    role = loaded.membership?.role ?? null;
    boardName = loaded.board.name;
  }

  const raw = newAgentKeyRaw();
  const days = input.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const id = newId('ake');

  const row = await db.$transaction(async (tx) => {
    const created = await tx.agentKey.create({
      data: {
        id,
        user_id: input.actor.userId,
        board_id: input.scope === 'board' ? (input.boardId ?? null) : null,
        name: input.name,
        key_hash: agentKeyHash(raw, input.pepper),
        scope: input.scope,
        expires_at: expiresAt,
      },
    });
    await recordEvent(tx, {
      boardId: input.scope === 'board' ? (input.boardId ?? null) : null,
      actor: input.actor,
      type: 'agent_key.created',
      payload: {
        key_id: created.id,
        name: created.name,
        scope: created.scope,
        ...(created.board_id === null ? {} : { board_id: created.board_id }),
      },
    });
    return created;
  });

  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    board_id: row.board_id,
    board_name: boardName,
    role,
    expires_at: row.expires_at.toISOString(),
    last_used_at: null,
    revoked_at: null,
    created_at: row.created_at.toISOString(),
    key: raw,
  };
}

export async function listAgentKeys(db: Db, userId: string): Promise<{ items: AgentKeyDto[] }> {
  const rows = await db.agentKey.findMany({
    where: { user_id: userId },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    include: { board: { select: { id: true, name: true } } },
  });
  const boardIds = rows.map((row) => row.board_id).filter((id): id is string => id !== null);
  const memberships =
    boardIds.length === 0
      ? []
      : await db.boardMember.findMany({
          where: { user_id: userId, board_id: { in: boardIds } },
          select: { board_id: true, role: true },
        });
  const roleByBoard = new Map(memberships.map((row) => [row.board_id, row.role]));

  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      scope: row.scope,
      board_id: row.board_id,
      board_name: row.board?.name ?? null,
      role: row.board_id === null ? null : (roleByBoard.get(row.board_id) ?? null),
      expires_at: row.expires_at.toISOString(),
      last_used_at: row.last_used_at?.toISOString() ?? null,
      revoked_at: row.revoked_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
    })),
  };
}

export async function revokeAgentKey(
  db: Db,
  actor: Extract<Actor, { kind: 'user' }>,
  id: string,
): Promise<void> {
  const row = await db.agentKey.findFirst({ where: { id, user_id: actor.userId } });
  if (!row) throw new AppError('agent_key_not_found');
  if (row.revoked_at !== null) return;
  await db.$transaction(async (tx) => {
    await tx.agentKey.update({ where: { id }, data: { revoked_at: new Date() } });
    await recordEvent(tx, {
      boardId: row.board_id,
      actor,
      type: 'agent_key.revoked',
      payload: {
        key_id: row.id,
        name: row.name,
        scope: row.scope,
        ...(row.board_id === null ? {} : { board_id: row.board_id }),
      },
    });
  });
}

export type AgentKeyTest =
  | { ok: true; board: { id: string; name: string } | null; role: string | null; key: string }
  | { ok: false; reason: 'revoked' | 'expired' | 'key_mismatch' | 'board_not_found' | 'forbidden' };

/**
 * A real answer, not a green check: the row is read, the presented key is
 * compared when one is given, and the reach is computed through `can()` with the
 * same actor `resolveActor` would build.
 */
export async function testAgentKey(
  db: Db,
  input: { userId: string; pepper: string; id: string; presented?: string },
): Promise<AgentKeyTest> {
  const row = await db.agentKey.findFirst({ where: { id: input.id, user_id: input.userId } });
  if (!row) throw new AppError('agent_key_not_found');
  if (
    input.presented !== undefined &&
    agentKeyHash(input.presented, input.pepper) !== row.key_hash
  ) {
    return { ok: false, reason: 'key_mismatch' };
  }
  if (row.revoked_at !== null) return { ok: false, reason: 'revoked' };
  if (row.expires_at.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  if (row.board_id === null) {
    // A user-scoped key reaches every board its owner belongs to; the panel only
    // needs to know the key is alive, and the role is per board by definition.
    return { ok: true, board: null, role: null, key: row.name };
  }

  const board = await db.board.findUnique({ where: { id: row.board_id } });
  if (!board) return { ok: false, reason: 'board_not_found' };
  const loaded = await loadBoardFor(
    db,
    { kind: 'agent', userId: row.user_id, scope: 'board', boardId: row.board_id },
    row.board_id,
    'board.read',
  );
  if (!loaded.decision.allow) {
    return loaded.decision.reason === 'not_found'
      ? { ok: false, reason: 'board_not_found' }
      : { ok: false, reason: 'forbidden' };
  }
  return {
    ok: true,
    board: { id: board.id, name: board.name },
    role: loaded.membership?.role ?? null,
    key: row.name,
  };
}
