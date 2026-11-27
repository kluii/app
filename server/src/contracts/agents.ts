// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { idSchema } from './common.js';

/**
 * The one shape for issuing an agent key (docs/features/agents.md §1).
 *
 * Scope is structural: a board key names its board, a user key must not name
 * one. Accepting both and preferring the field would be a silent widening.
 */
export const createAgentKeySchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    scope: z.enum(['board', 'user']),
    board_id: idSchema('brd').optional(),
    expires_in_days: z.number().int().min(1).max(365).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scope === 'board' && value.board_id === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['board_id'],
        message: 'a board-scoped key needs board_id',
      });
    }
    if (value.scope === 'user' && value.board_id !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['board_id'],
        message: 'a user-scoped key covers every board its owner belongs to; drop board_id',
      });
    }
  });

export type CreateAgentKeyInput = z.infer<typeof createAgentKeySchema>;

/**
 * "Test connection" may present the key it is testing. It is optional because
 * the panel also probes a stored key by id, and the answer says what happened
 * rather than failing the request.
 */
export const testAgentKeySchema = z
  .object({ key: z.string().trim().min(1).max(64).optional() })
  .strict();
