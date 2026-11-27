// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rows written before the "a board is written by its members" rule (slice K of
 * the 2.0.2 pass): an `open` or `moderated` anonymous policy, or an `edit` link
 * role. The API refuses to set them now — 400 validation_failed — and keeps the
 * columns so old data does not break. A test that needs one writes the row the
 * way a migration leaves it: already there.
 */
import type { Db } from '../../src/db.js';

export type LegacyPolicy = {
  anonWrite?: 'open' | 'moderated';
  linkRole?: 'read' | 'edit';
};

export async function setLegacyPolicy(
  db: Db,
  boardId: string,
  policy: LegacyPolicy,
): Promise<void> {
  const sets: string[] = [];
  if (policy.anonWrite !== undefined) sets.push(`anon_write = '${policy.anonWrite}'`);
  if (policy.linkRole !== undefined) sets.push(`link_role = '${policy.linkRole}'`);
  if (sets.length === 0) return;
  await db.$executeRawUnsafe(`UPDATE boards SET ${sets.join(', ')} WHERE id = '${boardId}'`);
}

/** A row in the moderation queue, which no API call can create any more. */
export async function insertPendingCard(
  db: Db,
  input: {
    id: string;
    boardId: string;
    columnId: string;
    title: string;
    label: string;
    expiresInMs?: number;
  },
): Promise<void> {
  await db.pendingCard.create({
    data: {
      id: input.id,
      board_id: input.boardId,
      column_id: input.columnId,
      title: input.title,
      actor_label: input.label,
      anon_actor_id: 'anon-legacy0000000000000001',
      expires_at: new Date(Date.now() + (input.expiresInMs ?? 7 * 24 * 60 * 60 * 1000)),
    },
  });
}
