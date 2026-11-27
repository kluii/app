// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every mutation writes exactly one Event, in the same transaction (D-23).
 * Activity, digest and close-out read `events` and nothing else claims to know
 * what happened.
 */
import type { Prisma } from '@prisma/client';
import { newId } from './ids.js';
import type { Actor } from './authz.js';

export type EventTypeName =
  | 'board.created'
  | 'board.updated'
  | 'board.closed'
  | 'board.deleted'
  | 'member.added'
  | 'member.updated'
  | 'member.removed'
  | 'column.created'
  | 'column.updated'
  | 'column.deleted'
  | 'card.created'
  | 'card.updated'
  | 'card.moved'
  | 'card.completed'
  | 'card.reopened'
  | 'card.deleted'
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted'
  | 'link.created'
  | 'link.revoked'
  | 'pending.created'
  | 'pending.approved'
  | 'pending.rejected'
  | 'pending.expired'
  | 'agent_key.created'
  | 'agent_key.revoked'
  | 'import.completed'
  | 'security.login'
  | 'security.login_failed'
  | 'security.password_changed'
  | 'security.password_reset'
  | 'security.totp_enabled'
  | 'security.totp_disabled'
  | 'security.session_revoked'
  | 'security.user_banned'
  | 'security.user_unbanned'
  | 'security.profile_updated';

export type Tx = Prisma.TransactionClient;

export function toEnumName(type: EventTypeName): string {
  return type.replaceAll('.', '_');
}

export function actorFields(actor: Actor): {
  actor_kind: 'user' | 'link' | 'anon' | 'agent';
  actor_user_id: string | null;
  actor_label: string | null;
  actor_anon_id: string | null;
} {
  switch (actor.kind) {
    case 'user':
      return {
        actor_kind: 'user',
        actor_user_id: actor.userId,
        actor_label: null,
        actor_anon_id: null,
      };
    case 'agent':
      return {
        actor_kind: 'agent',
        actor_user_id: actor.userId,
        actor_label: null,
        actor_anon_id: null,
      };
    case 'link':
      return { actor_kind: 'link', actor_user_id: null, actor_label: null, actor_anon_id: null };
    case 'anon':
      return {
        actor_kind: 'anon',
        actor_user_id: null,
        actor_label: actor.label,
        actor_anon_id: actor.anonId,
      };
  }
}

export async function recordEvent(
  tx: Tx,
  input: {
    boardId: string | null;
    actor: Actor;
    type: EventTypeName;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
  },
): Promise<string> {
  const id = newId('evt');
  const fields = actorFields(input.actor);
  await tx.event.create({
    data: {
      id,
      board_id: input.boardId,
      type: toEnumName(input.type) as never,
      actor_kind: fields.actor_kind,
      actor_user_id: fields.actor_user_id,
      actor_label: fields.actor_label,
      actor_anon_id: fields.actor_anon_id,
      payload: input.payload as Prisma.InputJsonValue,
      idempotency_key: input.idempotencyKey ?? null,
    },
  });
  return id;
}

/**
 * A background job is an actor too (`actor_kind: system`). The sweeper deletes
 * rows nobody asked it to delete; the log must say so, and say it was not a
 * person (D-23).
 */
export async function recordSystemEvent(
  tx: Tx,
  input: { boardId: string; type: EventTypeName; payload: Record<string, unknown> },
): Promise<string> {
  const id = newId('evt');
  await tx.event.create({
    data: {
      id,
      board_id: input.boardId,
      type: toEnumName(input.type) as never,
      actor_kind: 'system',
      actor_user_id: null,
      actor_label: null,
      actor_anon_id: null,
      payload: input.payload as Prisma.InputJsonValue,
      idempotency_key: null,
    },
  });
  return id;
}
