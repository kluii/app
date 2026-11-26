// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor } from '../auth/request.js';
import { AppError, fromZod } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { RANK_STEP } from '../lib/ranks.js';
import { recordEvent } from '../lib/events.js';
import { commitEvent } from '../realtime/events.js';
import {
  assertAllowed,
  loadBoardFor,
  toBoardDto,
  toPolicy,
  uniqueSlug,
  slugify,
  linkSuffix,
} from './service.js';
import { can } from '../lib/authz.js';
import { createBoardSchema, patchBoardSchema } from '../contracts/boards.js';
import type { BoardStateDto, CallerDto } from '../contracts/dto.js';
import { toCardDto, toColumnDto, boardTagColors } from '../cards/service.js';
import { toBoardMembers } from '../boards/members.js';
import { slugRedirect, usernameRedirect } from '../auth/profile.js';
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
    await db.board.delete({ where: { id } });
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
    const loaded = await loadBoardFor(db, actor, id, 'board.read');
    assertAllowed(loaded.decision);

    const [columns, cards, tagColors, members, pendingCount] = await Promise.all([
      db.column.findMany({ where: { board_id: id }, orderBy: { position: 'asc' } }),
      db.card.findMany({
        where: { board_id: id },
        include: { tags: true },
        orderBy: [{ column_id: 'asc' }, { position: 'asc' }],
      }),
      boardTagColors(db, id),
      toBoardMembers(db, id),
      db.pendingCard.count({ where: { board_id: id } }),
    ]);

    const assigneeIds = cards
      .map((card) => card.assignee_id)
      .filter((value): value is string => value !== null);
    const assignees =
      assigneeIds.length > 0
        ? await db.user.findMany({
            where: { id: { in: assigneeIds } },
            select: { id: true, username: true },
          })
        : [];
    const assigneeById = new Map(assignees.map((user) => [user.id, user]));

    const policy = toPolicy(loaded.board);
    const caller: CallerDto = {
      actor_kind: actor.kind,
      role: loaded.membership ? loaded.membership.role : null,
      label: actor.kind === 'anon' ? actor.label : actor.kind === 'link' ? 'link' : '',
      can_write: can(actor, 'card.create', policy, loaded.membership).allow,
      can_manage: can(actor, 'board.update', policy, loaded.membership).allow,
      can_moderate: can(actor, 'moderation.decide', policy, loaded.membership).allow,
    };

    const body: BoardStateDto = {
      board: toBoardDto(loaded.board, context.env.KLUI_PUBLIC_URL),
      columns: columns.map(toColumnDto),
      cards: cards.map((card) =>
        toCardDto(
          card,
          card.assignee_id ? (assigneeById.get(card.assignee_id) ?? null) : null,
          tagColors,
        ),
      ),
      members,
      caller,
      pending_count: caller.can_moderate ? pendingCount : 0,
    };
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

  // A username or slug that was renamed away redirects for 90 days, then the
  // name is free again (D-13). The 301 is the whole point: a shared link that
  // silently lands on a stranger's board is worse than a broken one.
  app.get('/api/v1/users/:username/boards/:slug', async (request, reply) => {
    const db = database();
    const { username, slug } = request.params as { username: string; slug: string };
    const owner = username.toLowerCase();
    const board = await db.board.findFirst({
      where: { slug, owner: { username: owner } },
      select: { id: true },
    });
    if (board) return reply.redirect(`/api/v1/boards/${board.id}`, 301);

    const renamedUser = await usernameRedirect(db, owner);
    if (renamedUser && renamedUser !== owner) {
      return reply.redirect(`/api/v1/users/${renamedUser}/boards/${slug}`, 301);
    }
    const renamedSlug = await slugRedirect(db, owner, slug);
    if (renamedSlug) {
      return reply.redirect(`/api/v1/users/${owner}/boards/${renamedSlug}`, 301);
    }
    return reply.code(404).send({
      error: { code: 'board_not_found', message: 'Board not found.', hint: null },
    });
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
