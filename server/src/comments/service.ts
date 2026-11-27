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
import type { Actor } from '../lib/authz.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { recordEvent } from '../lib/events.js';
import { commitEvent, type Hub } from '../realtime/events.js';
import { assertAllowed, loadBoardFor } from '../boards/service.js';

/** The page cap docs/api.md §5 documents for a thread. */
const MAX_PAGE = 100;

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

/**
 * Reading and writing a thread, extracted from the routes so `/mcp` and REST
 * return the same page and write the same event. `board.read` gates the read;
 * `comment.create` the write, and no link or anonymous actor holds it — they
 * can read the board, so the answer is `403`, never `404`.
 */
export type CommentWrite = { db: Db; actor: Actor; hub?: Hub };

export async function listComments(
  context: CommentWrite,
  cardId: string,
  page: { limit: number; cursor: string | null },
): Promise<{ items: CommentDto[]; next_cursor: string | null }> {
  const { db, actor } = context;
  const card = await db.card.findUnique({ where: { id: cardId }, select: { id: true, board_id: true } });
  if (!card) throw new AppError('card_not_found');
  const loaded = await loadBoardFor(db, actor, card.board_id, 'board.read');
  assertAllowed(loaded.decision);

  const limit = Math.min(MAX_PAGE, Math.max(1, page.limit));
  const cursor = parseCommentCursor(page.cursor ?? undefined);
  const items = await db.comment.findMany({
    where: {
      card_id: cardId,
      ...(cursor === null
        ? {}
        : {
            OR: [
              { created_at: { gt: cursor.at } },
              { created_at: cursor.at, id: { gt: cursor.id } },
            ],
          }),
    },
    include: { author: { select: { id: true, username: true } } },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  });
  const rows = items.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    items: rows.map(toCommentDto),
    next_cursor: items.length > limit && last ? commentCursor(last) : null,
  };
}

export async function createComment(
  context: CommentWrite,
  cardId: string,
  body: string,
): Promise<CommentDto> {
  const { db, actor } = context;
  const card = await db.card.findUnique({ where: { id: cardId }, select: { id: true, board_id: true } });
  if (!card) throw new AppError('card_not_found');
  const loaded = await loadBoardFor(db, actor, card.board_id, 'comment.create');
  assertAllowed(loaded.decision);

  const authorId = actor.kind === 'user' || actor.kind === 'agent' ? actor.userId : null;
  const comment = await db.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: {
        id: newId('cmt'),
        board_id: card.board_id,
        card_id: card.id,
        author_id: authorId,
        author_type: actor.kind === 'agent' ? 'agent' : actor.kind === 'anon' ? 'anon' : 'user',
        author_label: actor.kind === 'user' || actor.kind === 'agent' ? null : 'link',
        body,
      },
      include: { author: { select: { id: true, username: true } } },
    });
    await recordEvent(tx, {
      boardId: card.board_id,
      actor,
      type: 'comment.created',
      payload: {
        board_id: card.board_id,
        card_id: card.id,
        comment_id: created.id,
        body_excerpt: bodyExcerpt(created.body),
      },
    });
    return created;
  });

  commitEvent(context.hub, {
    boardId: card.board_id,
    type: 'comment.created',
    entity: 'comment',
    action: 'created',
    payload: { comment: toCommentDto(comment) },
    actorLabel: actor.kind,
  });
  return toCommentDto(comment);
}
