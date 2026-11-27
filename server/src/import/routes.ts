// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /boards/:id/import` (docs/api.md §1, docs/features/import-export.md §2).
 *
 * Synchronous, `202` and a job row: the work is small (5 MB, 5 000 cards) and a
 * background worker would add a process to a product that ships one container.
 * The job row is what makes the second call idempotent — the unique
 * `(board_id, kind, source_hash)` is the guard, not an in-memory set that dies
 * with the restart.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { requireActor } from '../auth/request.js';
import { assertAllowed, loadBoardFor } from '../boards/service.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { recordEvent } from '../lib/events.js';
import { commitEvent } from '../realtime/events.js';
import { credentialLimiter, IMPORT_PER_BOARD, importKey } from '../lib/ratelimit.js';
import {
  IMPORT_FORMATS,
  IMPORT_LIMITS,
  importRequestSchema,
  type ImportFormat,
} from '../contracts/import.js';
import { buildPlan } from './plan.js';
import { applyPlan } from './apply.js';

/** sha256 over a key-sorted serialisation: same content, same hash, whatever the whitespace. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** The idempotency key: content, not bytes, so a re-indented file is the same file. */
export function sourceHash(format: string, data: unknown): string {
  return createHash('sha256')
    .update(`${format}\n${stableJson(data)}`)
    .digest('hex');
}

/** The format of a bare file, when the client did not name one. */
function inferFormat(data: unknown): ImportFormat {
  if (typeof data === 'object' && data !== null) {
    const object = data as Record<string, unknown>;
    if (object.schema === 'klui.export/v2') return 'v2';
    if (Array.isArray(object.lists)) return 'trello';
    if (Array.isArray(object.columns)) return 'v1';
  }
  throw new AppError('unsupported_schema', {
    message: 'The file is not a klui.export/v2, klui.export/v1 or Trello export.',
    hint: 'Accepted schemas: klui.export/v2, klui.export/v1, Trello JSON.',
  });
}

function validation(message: string, hint: string | null): AppError {
  return new AppError('validation_failed', { message, hint });
}

export function registerImportRoutes(app: FastifyInstance, context: AppContext): void {
  const database = () => {
    if (!context.db) throw new Error('database is not available');
    return context.db;
  };

  app.post(
    '/api/v1/boards/:id/import',
    { bodyLimit: IMPORT_LIMITS.bytes },
    async (request, reply) => {
      const actor = requireActor(request);
      const { id } = request.params as { id: string };
      const db = database();
      const loaded = await loadBoardFor(db, actor, id, 'board.import');
      assertAllowed(loaded.decision);

      if (context.env.KLUI_RATE_LIMIT === 'on') {
        const spent = credentialLimiter.take(importKey(id), IMPORT_PER_BOARD);
        if (!spent.allowed) {
          throw new AppError('rate_limited', {
            message: 'Too many imports for this board.',
            hint: `Try again in ${spent.retryAfter} seconds.`,
          });
        }
      }

      const queryFormat = (request.query as { format?: string } | undefined)?.format;
      if (queryFormat !== undefined && !IMPORT_FORMATS.includes(queryFormat as ImportFormat)) {
        throw validation(
          'The requested import format is not supported.',
          `Accepted: ${IMPORT_FORMATS.join(', ')}.`,
        );
      }

      // `{format, data}` as documented, or a multipart `file` whose format is
      // read from the file itself.
      let format: ImportFormat;
      let data: unknown;
      if (request.isMultipart()) {
        const part = await request.file();
        if (!part) {
          throw validation(
            'The upload has no file.',
            'Send one part named `file` containing the JSON export.',
          );
        }
        const raw = await part.toBuffer();
        if (raw.byteLength > IMPORT_LIMITS.bytes) {
          throw new AppError('payload_too_large', {
            message: 'The import exceeds the size limit.',
            hint: `At most ${String(IMPORT_LIMITS.bytes)} bytes per file.`,
          });
        }
        try {
          data = JSON.parse(raw.toString('utf8'));
        } catch {
          throw validation(
            'The uploaded file is not JSON.',
            'Upload the .json export, not a screenshot or an archive.',
          );
        }
        format = queryFormat === undefined ? inferFormat(data) : (queryFormat as ImportFormat);
      } else {
        const parsed = importRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError('validation_failed', {
            message: 'The import request is invalid.',
            hint: 'Send {format:"v2"|"v1"|"trello", data:<the parsed file>}, or upload the file.',
            details: parsed.error.issues.map((entry) => ({
              path: entry.path.map(String).join('.'),
              code: entry.code,
              message: entry.message,
            })),
          });
        }
        format = parsed.data.format;
        data = parsed.data.data;
      }

      // Everything that can be rejected without touching a row happens here.
      const plan = buildPlan(format, data);
      const hash = sourceHash(format, data);

      const existing = await db.job.findUnique({
        where: { board_id_kind_source_hash: { board_id: id, kind: 'import', source_hash: hash } },
      });
      if (existing !== null) {
        if (existing.status === 'done') {
          return reply.code(202).send({
            job_id: existing.id,
            status: existing.status,
            replayed: true,
            result: existing.result,
          });
        }
        throw new AppError('conflict', {
          message: 'An import of this exact file is already recorded for this board.',
          hint: 'Wait for it to finish, or import a different file.',
        });
      }

      const jobId = newId('job');
      await db.job.create({
        data: { id: jobId, board_id: id, kind: 'import', status: 'running', source_hash: hash },
      });
      commitEvent(context.hub, {
        boardId: id,
        type: 'import.progress',
        entity: 'import',
        action: 'started',
        payload: { job_id: jobId, done: 0, total: plan.cards.length },
        actorLabel: actor.kind,
      });

      let result;
      try {
        result = await db.$transaction(async (tx) => {
          const applied = await applyPlan(tx, id, plan);
          await recordEvent(tx, {
            boardId: id,
            actor,
            type: 'import.completed',
            payload: {
              board_id: id,
              format,
              columns: applied.columns,
              cards: applied.cards,
              comments: applied.comments,
            },
          });
          await tx.job.update({
            where: { id: jobId },
            data: { status: 'done', result: applied as never },
          });
          return applied;
        });
      } catch (error) {
        await db.job.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            error: error instanceof AppError ? error.code : 'import_failed',
          },
        });
        throw error;
      }

      commitEvent(context.hub, {
        boardId: id,
        type: 'import.progress',
        entity: 'import',
        action: 'done',
        payload: { job_id: jobId, done: plan.cards.length, total: plan.cards.length },
        actorLabel: actor.kind,
      });

      return reply.code(202).send({ job_id: jobId, status: 'done', replayed: false, result });
    },
  );
}
