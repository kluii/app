// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor } from '../auth/request.js';
import { AppError, boardNotFound, fromZod } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { RANK_STEP } from '../lib/ranks.js';
import { recordEvent } from '../lib/events.js';
import { commitEvent } from '../realtime/events.js';
import {
  assertAllowed,
  humanBoardPath,
  loadBoardFor,
  resolvePublicBoard,
  toBoardDto,
  toPolicy,
  uniqueSlug,
  slugify,
  linkSuffix,
  boardUrl,
} from './service.js';
import { can } from '../lib/authz.js';
import {
  createBoardSchema,
  patchBoardSchema,
  rotateSuffixSchema,
  sharePolicyConflict,
} from '../contracts/boards.js';
import { toBoardMembers } from '../boards/members.js';
import { boardStateFor } from './state.js';
import { conflictIfStale } from '../lib/concurrency.js';

export function registerBoardRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  app.get('/api/v1/boards', async (request) => {
    const actor = requireActor(request);
    const db = database();
    const userId = actor.kind === 'user' || actor.kind === 'agent' ? actor.userId : null;
    if (!userId) return { items: [] };

    const memberships = await db.boardMember.findMany({
      where: { user_id: userId },
      include: { board: { include: { owner: { select: { id: true, username: true } } } } },
      orderBy: { board: { updated_at: 'desc' } },
    });
    return {
      items: memberships.map((row) => ({
        ...toBoardDto(row.board, context.env.KLUI_PUBLIC_URL),
        role: row.role,
      })),
    };
  });

  app.post('/api/v1/boards', async (request, reply) => {
    const actor = requireActor(request);
    if (actor.kind !== 'user' && actor.kind !== 'agent') {
      throw new AppError('forbidden', {
        message: 'Only an account can create a board.',
        hint: 'Sign in, or ask a member for a link.',
      });
    }
    const parsed = createBoardSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const input = parsed.data;
    const db = database();

    const board = await db.$transaction(async (tx) => {
      const slug = await uniqueSlug(tx, actor.userId, slugify(input.name));
      const visibility = input.visibility ?? 'private';
      const created = await tx.board.create({
        data: {
          id: newId('brd'),
          owner_id: actor.userId,
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
        data: { id: newId('bmb'), board_id: created.id, user_id: actor.userId, role: 'owner' },
      });
      const template = input.template ?? 'classic';
      if (template === 'classic') {
        const names = ['To do', 'Doing', 'Done'];
        for (const [index, name] of names.entries()) {
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
    return reply.code(201).send(toBoardDto(board, context.env.KLUI_PUBLIC_URL));
  });

  app.get('/api/v1/boards/:id', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const loaded = await loadBoardFor(database(), actor, id, 'board.read');
    assertAllowed(loaded.decision);
    return toBoardDto(loaded.board, context.env.KLUI_PUBLIC_URL);
  });

  app.patch('/api/v1/boards/:id', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = patchBoardSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const input = parsed.data;
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'board.update');
    assertAllowed(loaded.decision);

    conflictIfStale(
      loaded.board.updated_at,
      input.expected_updated_at,
      toBoardDto(loaded.board, context.env.KLUI_PUBLIC_URL),
    );

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
        where: { id },
        data,
        include: { owner: { select: { id: true, username: true } } },
      });
      if (changes.slug) {
        await tx.boardSlugReservation.create({
          data: {
            id: newId('bsr'),
            board_id: id,
            slug: String(changes.slug[0]),
            redirect_slug: updated.slug,
            reserved_until: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          },
        });
      }
      if (Object.keys(changes).length > 0) {
        await recordEvent(tx, {
          boardId: id,
          actor,
          type: 'board.updated',
          payload: { board_id: id, changes },
        });
      }
      return updated;
    });

    return toBoardDto(board, context.env.KLUI_PUBLIC_URL);
  });

  app.delete('/api/v1/boards/:id', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { confirm?: boolean };
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'board.delete');
    assertAllowed(loaded.decision);
    if (body.confirm !== true) {
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
        tx.column.count({ where: { board_id: id } }),
        tx.card.count({ where: { board_id: id } }),
        tx.comment.count({ where: { board: { id } } }),
      ]);
      const payload = {
        board_id: id,
        name: loaded.board.name,
        slug: loaded.board.slug,
        owner: loaded.board.owner?.username ?? null,
        counts: { columns, cards, comments },
      };
      await recordEvent(tx, { boardId: id, actor, type: 'board.deleted', payload });
      await recordEvent(tx, { boardId: null, actor, type: 'board.deleted', payload });
      await tx.board.delete({ where: { id } });
    });
    commitEvent(context.hub, {
      boardId: id,
      type: 'board.deleted',
      entity: 'board',
      action: 'deleted',
      payload: { board_id: id },
      actorLabel: actor.kind,
    });
    return reply.code(204).send();
  });

  app.get('/api/v1/boards/:id/state', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();
    const body = await boardStateFor(db, actor, id, context.env.KLUI_PUBLIC_URL);
    reply.header('cache-control', 'no-store');
    return body;
  });

  app.get('/api/v1/boards/:id/members', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'board.read');
    assertAllowed(loaded.decision);
    return { items: await toBoardMembers(db, id) };
  });

  /**
   * The human URL for a board. It answers `301` to `/<owner>/<slug>` only for an
   * actor who can read the board: this route used to hand an anonymous caller
   * the real id of a private board (a 301 to `/api/v1/boards/brd_…`), which is
   * board enumeration and a broken redirect at once (PROMPT.md §3.4).
   */
  app.get('/api/v1/users/:username/boards/:slug', async (request, reply) => {
    const db = database();
    const { username, slug } = request.params as { username: string; slug: string };

    // No credential is not a 401 on a public URL: an anonymous caller gets the
    // same 404 an unknown slug gets, so the route cannot be used to enumerate.
    const actor = request.actor;
    if (!actor) throw boardNotFound();

    const target = await resolvePublicBoard(db, username, slug);
    if (!target) throw boardNotFound();

    const loaded = await loadBoardFor(db, actor, target.id, 'board.read');
    assertAllowed(loaded.decision);

    return reply.redirect(humanBoardPath(loaded.board), 301);
  });

  /**
   * K3-01: a new suffix, and the old URL is a 404 on the next request — not a
   * redirect, because a redirect would confirm the board exists.
   */
  app.post('/api/v1/boards/:id/link-suffix/rotate', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = rotateSuffixSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'board.update');
    assertAllowed(loaded.decision);
    if (loaded.board.visibility !== 'link') {
      throw new AppError('validation_failed', {
        message: 'Only a link board has a readable suffix.',
        hint: 'Set visibility to link first; a private or public board is addressed by its slug alone.',
        details: [
          {
            path: 'visibility',
            code: 'custom',
            message: 'expected link',
          },
        ],
      });
    }

    const previous = loaded.board.link_suffix;
    const board = await db.$transaction(async (tx) => {
      let next = linkSuffix();
      for (let attempt = 0; attempt < 20 && next === previous; attempt += 1) next = linkSuffix();
      const updated = await tx.board.update({
        where: { id },
        data: { link_suffix: next },
        include: { owner: { select: { id: true, username: true } } },
      });
      await recordEvent(tx, {
        boardId: id,
        actor,
        type: 'board.updated',
        payload: { board_id: id, changes: { link_suffix: [previous, next] } },
      });
      return updated;
    });
    commitEvent(context.hub, {
      boardId: id,
      type: 'board.updated',
      entity: 'board',
      action: 'updated',
      payload: { board_id: id },
      actorLabel: actor.kind,
    });
    return toBoardDto(board, context.env.KLUI_PUBLIC_URL);
  });

  /**
   * The public face of a board for a visitor with no credential: enough to
   * decide whether to ask for a display name, and nothing that is content
   * (K3-03). A private board is a 404, like everywhere else.
   */
  app.get('/api/v1/boards/:id/public', async (request, reply) => {
    const db = database();
    const { id } = request.params as { id: string };
    const board = await db.board.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        owner_id: true,
        visibility: true,
        anon_write: true,
        link_role: true,
        closed_at: true,
      },
    });
    if (!board) throw boardNotFound();
    const anonymous = { kind: 'anon', boardId: id, label: 'visitor', anonId: 'visitor' } as const;
    if (!can(anonymous, 'board.read', toPolicy(board), null).allow) throw boardNotFound();
    reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex');
    return {
      id: board.id,
      name: board.name,
      visibility: board.visibility,
      anon_write: board.anon_write,
      accepts_anon: board.anon_write !== 'off',
    };
  });

  /**
   * The SPA equivalent of opening a board URL: the route resolves the segment
   * through the same `can()` and hands back the id-addressed board. A URL never
   * grants anything by itself, and a failure is the standard 404 (K3-01).
   */
  app.get('/api/v1/users/:username/boards/:segment/resolve', async (request) => {
    const db = database();
    const { username, segment } = request.params as { username: string; segment: string };
    const target = await resolvePublicBoard(db, username, segment);
    if (!target) throw boardNotFound();

    // A readable URL is a way in only when the board takes anonymous writes: a
    // stranger holding the suffix is exactly the visitor K3-03 is for. Without
    // that, the id is not handed out and the page stays a 404.
    const visitor =
      request.actor ??
      ({ kind: 'anon', boardId: target.id, label: 'visitor', anonId: 'visitor' } as const);
    const loaded = await loadBoardFor(db, visitor, target.id, 'board.read');
    assertAllowed(loaded.decision);
    if (!request.actor && loaded.board.anon_write === 'off') throw boardNotFound();
    return {
      board_id: loaded.board.id,
      url: humanBoardPath(loaded.board),
      accepts_anon: loaded.board.anon_write !== 'off',
    };
  });

  /**
   * The public half of a profile: what the SPA route and the prerendered page
   * both read. Public boards only — a `link` board's URL is its credential.
   */
  app.get('/api/v1/users/:username/boards', async (request) => {
    const db = database();
    const { username } = request.params as { username: string };
    const user = await db.user.findUnique({
      where: { username: username.toLowerCase() },
      select: { id: true, username: true },
    });
    if (!user) {
      throw new AppError('not_found', { message: 'Not found.', hint: null });
    }
    const boards = await db.board.findMany({
      where: { owner_id: user.id, visibility: 'public', closed_at: null },
      orderBy: [{ updated_at: 'desc' }, { id: 'asc' }],
      include: { owner: { select: { id: true, username: true } } },
    });
    return {
      owner: { username: user.username },
      items: boards.map((board) => ({
        id: board.id,
        name: board.name,
        slug: board.slug,
        url: boardUrl(context.env.KLUI_PUBLIC_URL, board),
        updated_at: board.updated_at.toISOString(),
      })),
    };
  });

  app.get('/api/v1/boards/:id/tag-colors', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'board.read');
    assertAllowed(loaded.decision);
    const rows = await db.boardTagColor.findMany({ where: { board_id: id } });
    return Object.fromEntries(rows.map((row) => [row.tag, row.color]));
  });

  app.put('/api/v1/boards/:id/tag-colors', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const db = database();
    const loaded = await loadBoardFor(db, actor, id, 'board.update');
    assertAllowed(loaded.decision);
    const body = (request.body ?? {}) as Record<string, string>;
    const entries = Object.entries(body).filter(
      ([, color]) => typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color),
    );
    await db.$transaction(async (tx) => {
      await tx.boardTagColor.deleteMany({ where: { board_id: id } });
      for (const [tag, color] of entries) {
        await tx.boardTagColor.create({
          data: { id: newId('btc'), board_id: id, tag: tag.toLowerCase(), color },
        });
      }
      await recordEvent(tx, {
        boardId: id,
        actor,
        type: 'board.updated',
        payload: { board_id: id, changes: { tag_colors: [null, entries.length] } },
      });
    });
    return Object.fromEntries(entries);
  });
}
