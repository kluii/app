// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Write links: create, list, revoke, and the `/l/<token>` door.
 *
 * A token is a credential (D-33). It is shown in exactly one response, stored as
 * `sha256(token + pepper)`, never logged, and revocable; `/l/<token>` trades it
 * for a signed cookie so the token leaves the URL bar immediately.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor } from '../auth/request.js';
import { AppError, boardNotFound, fromZod } from '../lib/errors.js';
import { recordEvent } from '../lib/events.js';
import { commitEvent } from '../realtime/events.js';
import { loadBoardFor, assertAllowed, humanBoardPath } from '../boards/service.js';
import { createLinkSchema, linkTokenParam } from '../contracts/links.js';
import { hashLinkToken, linkToken, newLinkId, setLinkCookie, touchLink } from './service.js';

type LinkRow = {
  id: string;
  role: 'read' | 'edit';
  label: string | null;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
};

function toLinkDto(link: LinkRow): Record<string, unknown> {
  return {
    id: link.id,
    role: link.role,
    label: link.label,
    created_at: link.created_at.toISOString(),
    last_used_at: link.last_used_at ? link.last_used_at.toISOString() : null,
    revoked_at: link.revoked_at ? link.revoked_at.toISOString() : null,
  };
}

export function registerLinkRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  app.get('/api/v1/boards/:id/links', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'link.list');
    assertAllowed(loaded.decision);
    const links = await db.boardLink.findMany({
      where: { board_id: id },
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
    });
    return { items: links.map(toLinkDto) };
  });

  app.post('/api/v1/boards/:id/links', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = createLinkSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'link.create');
    assertAllowed(loaded.decision);
    // A token minted on a board whose `link_role` is `none` can never read:
    // refuse it here rather than hand out a dead credential.
    if (loaded.board.link_role === 'none') {
      throw new AppError('validation_failed', {
        message: 'This board does not accept link readers.',
        hint: 'Set link_role to read or edit on the board first.',
        details: [
          {
            path: 'link_role',
            code: 'custom',
            message: 'expected read or edit',
          },
        ],
      });
    }

    const token = linkToken();
    const linkId = newLinkId();
    const row = await db.$transaction(async (tx) => {
      const created = await tx.boardLink.create({
        data: {
          id: linkId,
          board_id: id,
          token_hash: hashLinkToken(token, context.secrets.tokenPepper),
          role: parsed.data.role,
          label: parsed.data.label ?? null,
        },
      });
      await recordEvent(tx, {
        boardId: id,
        actor,
        type: 'link.created',
        // The token is a credential: the event records that a link exists.
        payload: { board_id: id, link_id: created.id, role: created.role },
      });
      return created;
    });
    commitEvent(context.hub, {
      boardId: id,
      type: 'link.created',
      entity: 'link',
      action: 'created',
      payload: { board_id: id, link_id: row.id },
      actorLabel: actor.kind,
    });

    const origin = (context.env.KLUI_PUBLIC_URL ?? '').replace(/\/$/, '');
    return reply.code(201).send({
      ...toLinkDto(row),
      // The only time this value exists in a response (docs/api.md §5).
      token,
      url: `${origin}/l/${token}`,
    });
  });

  app.delete('/api/v1/boards/:id/links/:linkId', async (request, reply) => {
    const actor = requireActor(request);
    const { id, linkId } = request.params as { id: string; linkId: string };
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'link.revoke');
    assertAllowed(loaded.decision);

    const link = await db.boardLink.findFirst({
      where: { id: linkId, board_id: id },
      select: { id: true, revoked_at: true },
    });
    if (!link) throw new AppError('not_found', { message: 'Not found.', hint: null });
    if (link.revoked_at !== null) return reply.code(204).send();

    await db.$transaction(async (tx) => {
      await tx.boardLink.update({ where: { id: linkId }, data: { revoked_at: new Date() } });
      await recordEvent(tx, {
        boardId: id,
        actor,
        type: 'link.revoked',
        payload: { board_id: id, link_id: linkId },
      });
    });
    commitEvent(context.hub, {
      boardId: id,
      type: 'link.revoked',
      entity: 'link',
      action: 'revoked',
      payload: { board_id: id, link_id: linkId },
      actorLabel: actor.kind,
    });
    return reply.code(204).send();
  });

  /**
   * The door. A revoked, unknown or malformed token answers the standard 404 —
   * never a redirect, which would confirm that a board exists behind it.
   */
  app.get('/l/:token', async (request, reply) => {
    const parsed = linkTokenParam.safeParse(request.params);
    if (!parsed.success) throw fromZod(parsed.error);
    const db = database();
    const link = await db.boardLink.findUnique({
      where: { token_hash: hashLinkToken(parsed.data.token, context.secrets.tokenPepper) },
      select: { id: true, board_id: true, role: true, revoked_at: true },
    });
    if (!link || link.revoked_at !== null) throw boardNotFound();

    const board = await db.board.findUnique({
      where: { id: link.board_id },
      include: { owner: { select: { id: true, username: true } } },
    });
    if (!board) throw boardNotFound();

    setLinkCookie(reply, {
      linkId: link.id,
      boardId: link.board_id,
      secure: context.env.KLUI_ENV === 'production',
    });
    await touchLink(db, link.id);

    reply
      .header('cache-control', 'no-store')
      .header('x-robots-tag', 'noindex')
      .header('referrer-policy', 'no-referrer');
    return reply.redirect(humanBoardPath(board), 302);
  });
}
