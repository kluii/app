// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Card routes: parse, apply the anonymous-visitor policy, then call the service.
 *
 * Every write below runs through `cards/service.ts`, which is also what `/mcp`
 * calls. What lives here is only what a browser-facing actor can reach: the
 * anonymous write budget, the moderated pending queue, and the fields a visitor
 * may change on their own card. An MCP credential is never anonymous.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Db } from '../db.js';
import { requireActor } from '../auth/request.js';
import { AppError, fromZod } from '../lib/errors.js';
import { assertAllowed, loadBoardFor } from '../boards/service.js';
import { guardAnonWrite } from '../anon/limits.js';
import { createPendingCard } from './service.js';
import {
  bulkCreateCards,
  createCard,
  deleteCard,
  moveCard,
  readCard,
  updateCard,
} from './service.js';
import {
  bulkCreateSchema,
  createCardSchema,
  moveCardSchema,
  updateCardSchema,
} from '../contracts/cards.js';

export function registerCardRoutes(app: FastifyInstance, context: AppContext): void {
  const database = (): Db => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  app.post('/api/v1/boards/:id/cards', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = createCardSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const db = database();

    // Anonymous writes are the only writes without an accountable actor, so they
    // carry both an address budget and a per-board cap (K3-07).
    if (actor.kind === 'anon') {
      const loaded = await loadBoardFor(db, actor, id, 'card.create');
      assertAllowed(loaded.decision);
      await guardAnonWrite(request, reply, context.env, db, id, parsed.data.cap_token);
      // A moderated board accepts the write and shows it to nobody until an owner
      // approves it: no card, no event, one pending row (K3-03 → K3-04).
      if (loaded.board.anon_write === 'moderated') {
        const pending = await createPendingCard(db, {
          boardId: id,
          columnId: parsed.data.column,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          dueAt: parsed.data.due_at ? new Date(parsed.data.due_at) : null,
          tags: parsed.data.tags,
          label: actor.label,
          anonId: actor.anonId,
        });
        return reply.code(202).send({
          status: 'pending',
          id: pending.id,
          board_id: id,
          title: pending.title,
        });
      }
    }
    const card = await createCard({ db, actor, hub: context.hub }, id, parsed.data);
    return reply.code(201).send(card);
  });

  app.post('/api/v1/boards/:id/cards/bulk', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = bulkCreateSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const db = database();

    if (actor.kind === 'anon') {
      const loaded = await loadBoardFor(db, actor, id, 'card.create');
      assertAllowed(loaded.decision);
      await guardAnonWrite(request, reply, context.env, db, id, parsed.data.cap_token);
    }
    const result = await bulkCreateCards({ db, actor, hub: context.hub }, id, parsed.data);
    return reply.code(201).send(result);
  });

  app.get('/api/v1/cards/:id', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    return readCard(database(), actor, id);
  });

  app.patch('/api/v1/cards/:id', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const parsed = updateCardSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const input = parsed.data;
    const db = database();

    // "Edit a card they created" is title, description and done — never an
    // assignment, a due date or a tag (docs/permissions.md §4.3). A field sent
    // back unchanged is not a change: the editor posts the whole form.
    if (actor.kind === 'anon') {
      const card = await db.card.findUnique({ where: { id }, include: { tags: true } });
      if (!card) throw new AppError('card_not_found');
      const loaded = await loadBoardFor(
        db,
        actor,
        card.board_id,
        input.done === true ? 'card.complete' : 'card.update',
        { isOwnCard: card.anon_actor_id === actor.anonId },
      );
      assertAllowed(loaded.decision);

      const tagsChanged =
        input.tags !== undefined &&
        JSON.stringify(input.tags.map((tag) => tag.name).sort()) !==
          JSON.stringify(card.tags.map((tag) => tag.name).sort());
      const dueChanged =
        input.due_at !== undefined &&
        (input.due_at === null ? null : new Date(input.due_at).getTime()) !==
          (card.due_at?.getTime() ?? null);
      const forbidden = [
        input.assignee !== undefined && (input.assignee ?? null) !== card.assignee_id
          ? 'assignee'
          : null,
        input.assignee_label !== undefined && input.assignee_label !== card.assignee_label
          ? 'assignee_label'
          : null,
        dueChanged ? 'due_at' : null,
        tagsChanged ? 'tags' : null,
      ].filter((field): field is string => field !== null);
      if (forbidden.length > 0) {
        throw new AppError('forbidden', {
          message: 'An anonymous visitor can only change the title, the description and done.',
          hint: 'Ask a member to make the change, or sign in.',
          details: forbidden.map((key) => ({
            path: key,
            code: 'custom',
            message: 'not available to an anonymous actor',
          })),
        });
      }
    }

    return updateCard({ db, actor, hub: context.hub }, id, input);
  });

  app.delete('/api/v1/cards/:id', async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    await deleteCard({ db: database(), actor, hub: context.hub }, id);
    return reply.code(204).send();
  });

  /**
   * `{column, before, after}` only. A body carrying `index`, `position` or
   * `order` is rejected on purpose: accepting it would reintroduce the bug the
   * neighbour API exists to prevent (docs/api.md §6.1).
   */
  app.post('/api/v1/cards/:id/move', async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const rawBody = request.body as Record<string, unknown> | undefined;
    if (rawBody && ['index', 'position', 'order'].some((key) => key in rawBody)) {
      throw new AppError('unknown_field', {
        message: 'The move endpoint takes neighbours, never an index.',
        hint: 'Send {"column":"col_…","before":"crd_…"|null,"after":"crd_…"|null}.',
        details: [{ path: 'index', code: 'unrecognized_keys', message: 'not accepted' }],
      });
    }
    const parsed = moveCardSchema.safeParse(request.body);
    if (!parsed.success) throw fromZod(parsed.error);
    return moveCard({ db: database(), actor, hub: context.hub }, id, parsed.data);
  });
}
