// SPDX-License-Identifier: AGPL-3.0-only
import { AppError } from './errors.js';

/**
 * `expected_updated_at` mismatch answers 409 with the current row (D-28): silent
 * last-write-wins loses a teammate's paragraph with no trace.
 */
export function conflictIfStale(current: Date, expected: string | undefined, row: unknown): void {
  if (!expected) return;
  if (current.getTime() === new Date(expected).getTime()) return;
  throw new AppError('conflict', {
    message: 'This item changed while you were editing.',
    hint: 'Reload to see the current version.',
    current: row,
  });
}
