// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The comment shape (docs/api.md §2, §5) and the board a comment belongs to.
 *
 * A comment carries its author twice: `author_id` while the account exists and
 * `author_label` / `author_type` forever. A deleted account nulls the id and
 * leaves the label, so an old thread still reads as a conversation
 * (`DELETE /me` is documented as an anonymising cascade).
 */
import type { Comment } from '@prisma/client';
import type { Db } from '../db.js';

export type CommentDto = {
  id: string;
  card_id: string;
  body: string;
  author: { id: string | null; username: string | null; label: string | null; type: string };
  edited_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CommentWithAuthor = Comment & {
  author: { id: string; username: string } | null;
};

export function toCommentDto(comment: CommentWithAuthor): CommentDto {
  return {
    id: comment.id,
    card_id: comment.card_id,
    body: comment.body,
    author: {
      id: comment.author?.id ?? null,
      username: comment.author?.username ?? null,
      label: comment.author_label,
      type: comment.author_type,
    },
    edited_at: comment.edited_at === null ? null : comment.edited_at.toISOString(),
    created_at: comment.created_at.toISOString(),
    updated_at: comment.updated_at.toISOString(),
  };
}

/** Cursor pagination over `(created_at, id)`, ascending: a thread reads top down. */
export function commentCursor(comment: { created_at: Date; id: string }): string {
  return Buffer.from(`${comment.created_at.toISOString()}|${comment.id}`, 'utf8').toString(
    'base64url',
  );
}

export function parseCommentCursor(raw: string | undefined): { at: Date; id: string } | null {
  if (raw === undefined || raw === '') return null;
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.lastIndexOf('|');
  if (separator <= 0) return null;
  const at = new Date(decoded.slice(0, separator));
  if (Number.isNaN(at.getTime())) return null;
  return { at, id: decoded.slice(separator + 1) };
}

/** The label an event or a comment records for an actor that is not an account. */
export function actorLabelFor(actor: { kind: string; label?: string }): string {
  if (actor.kind === 'anon' && actor.label) return actor.label;
  if (actor.kind === 'link') return 'link';
  return actor.kind;
}

/** 120 characters of body, the only place comment text enters the event log. */
export function bodyExcerpt(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length <= 120 ? flat : `${flat.slice(0, 119)}…`;
}

export async function commentById(db: Db, id: string): Promise<CommentWithAuthor | null> {
  return db.comment.findUnique({
    where: { id },
    include: { author: { select: { id: true, username: true } } },
  });
}
