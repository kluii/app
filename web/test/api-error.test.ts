// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client';
import { failureMessage } from '../src/lib/api-error';
import en from '../src/i18n/en.json';

const generic = en['common.error.generic'];

function refused(status: number, body: { code: string; message: string; hint: string | null }) {
  return new ApiError(status, body);
}

/**
 * K4 — the UI shows the server's answer (docs/api.md §1).
 *
 * The client used to render "Something went wrong. Try again." for every 4xx
 * while the body carried `{code, message, hint}`. The rule is one function:
 * a 4xx is the server's message and hint, and the generic copy is kept for a
 * network failure and a 5xx, where the server did not explain anything.
 */
describe('a failed call, rendered', () => {
  it('shows the message and the hint of a 4xx', () => {
    const error = refused(409, {
      code: 'conflict',
      message: 'That name is taken.',
      hint: 'Pick another name, or open the board that already uses it.',
    });
    expect(failureMessage(error)).toBe(
      'That name is taken. Pick another name, or open the board that already uses it.',
    );
  });

  it('shows the message alone when there is no hint', () => {
    const error = refused(403, {
      code: 'forbidden',
      message: 'Only the owner can delete this board.',
      hint: null,
    });
    expect(failureMessage(error)).toBe('Only the owner can delete this board.');
  });

  it('keeps the generic copy for a 5xx', () => {
    const error = refused(500, {
      code: 'internal',
      message: 'Something failed on our side.',
      hint: 'Try again in a moment.',
    });
    expect(failureMessage(error)).toBe(generic);
  });

  it('keeps the generic copy for a body the client could not parse', () => {
    // `request()` invents this one for a 4xx without an error envelope.
    const error = refused(400, { code: 'internal', message: 'The request failed.', hint: null });
    expect(failureMessage(error)).toBe(generic);
  });

  it('keeps the generic copy for a network failure', () => {
    expect(failureMessage(new TypeError('Failed to fetch'))).toBe(generic);
    expect(failureMessage(undefined)).toBe(generic);
  });
});
