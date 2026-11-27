// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The moderation queue (docs/features/links-and-anonymous.md §5).
 *
 * A moderated write lands in `pending_cards` and nowhere else. Approval is the
 * only path from there to a card: it copies the row, keeps the author's label,
 * and records who approved it. Expiry is seven days, by the sweeper, and the
 * author is never notified — they have no account to notify.
 */
import type { Prisma } from '@prisma/client';
import type { Db } from '../db.js';
import type { Actor } from '../lib/authz.js';
import { newId } from '../lib/ids.js';
import { recordEvent, recordSystemEvent, type Tx } from '../lib/events.js';
import { createTagRows, lockColumnForAppend, nextAppendPosition } from '../cards/service.js';

export type PendingRow = Prisma.PendingCardGetPayload<Record<string, never>>;

export function toPendingDto(row: PendingRow): Record<string, unknown> {
  return {
    id: row.id,
    column_id: row.column_id,
    title: row.title,
    description: row.description,
    tags: row.tags,
    due_at: row.due_at ? row.due_at.toISOString() : null,
    actor_label: row.actor_label,
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
  };
}

export async function approvePendingCard(
  db: Db,
  input: { boardId: string; pendingId: string; actor: Actor; approverLabel: string },
): Promise<{ cardId: string } | null> {
  const pending = await db.pendingCard.findFirst({
    where: { id: input.pendingId, board_id: input.boardId },
  });
  if (!pending) return null;

  const cardId = newId('crd');
  await db.$transaction(async (tx) => {
    await lockColumnForAppend(tx, pending.column_id);
    const position = await nextAppendPosition(tx, pending.column_id);
    await tx.card.create({
      data: {
        id: cardId,
        board_id: input.boardId,
        column_id: pending.column_id,
        title: pending.title,
        description: pending.description,
        due_at: pending.due_at,
        position,
        actor_label: pending.actor_label,
        anon_actor_id: pending.anon_actor_id,
      },
    });
    const tags = (pending.tags ?? []) as { name: string; color?: string | null }[];
    if (tags.length > 0) await createTagRows(tx, cardId, tags);
    await tx.pendingCard.delete({ where: { id: pending.id } });
    await recordEvent(tx, {
      boardId: input.boardId,
      actor: input.actor,
      type: 'pending.approved',
      payload: {
        board_id: input.boardId,
        pending_id: pending.id,
        card_id: cardId,
        column_id: pending.column_id,
        title: pending.title,
        actor_label: pending.actor_label,
        approved_by: input.approverLabel,
      },
    });
  });
  return { cardId };
}

export async function rejectPendingCard(
  db: Db,
  input: { boardId: string; pendingId: string; actor: Actor; approverLabel: string },
): Promise<boolean> {
  const pending = await db.pendingCard.findFirst({
    where: { id: input.pendingId, board_id: input.boardId },
    select: { id: true, title: true },
  });
  if (!pending) return false;
  await db.$transaction(async (tx) => {
    await tx.pendingCard.delete({ where: { id: pending.id } });
    await recordEvent(tx, {
      boardId: input.boardId,
      actor: input.actor,
      type: 'pending.rejected',
      payload: {
        board_id: input.boardId,
        pending_id: pending.id,
        title: pending.title,
        rejected_by: input.approverLabel,
      },
    });
  });
  return true;
}

/** One instance-wide sweep; a Postgres advisory lock keeps two instances apart. */
export async function sweepExpiredPendingCards(db: Db, now: Date = new Date()): Promise<number> {
  return db.$transaction(async (tx: Tx) => {
    const locked = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext('klui:pending-sweeper')) AS locked
    `;
    if (locked[0]?.locked !== true) return 0;

    const expired = await tx.pendingCard.findMany({
      where: { expires_at: { lte: now } },
      select: { id: true, board_id: true, title: true },
      orderBy: { id: 'asc' },
    });
    for (const row of expired) {
      await tx.pendingCard.delete({ where: { id: row.id } });
      await recordSystemEvent(tx, {
        boardId: row.board_id,
        type: 'pending.expired',
        payload: { board_id: row.board_id, pending_id: row.id, title: row.title },
      });
    }
    return expired.length;
  });
}
