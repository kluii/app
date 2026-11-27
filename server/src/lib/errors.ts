// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The only thrown type a service may raise (docs/architecture.md §6).
 * `toWire` is the single serializer for the documented envelope:
 * {"error":{"code","message","hint"}} — `hint` is null, never absent.
 */
import type { ZodError } from 'zod';

export type ErrorCode =
  | 'validation_failed'
  | 'unauthenticated'
  | 'invalid_credential'
  | 'forbidden'
  | 'forbidden_origin'
  | 'csrf_failed'
  | 'banned'
  | 'board_closed'
  | 'conflict'
  | 'already_closed'
  | 'not_found'
  | 'board_not_found'
  | 'card_not_found'
  | 'column_not_found'
  | 'comment_not_found'
  | 'link_not_found'
  | 'member_not_found'
  | 'pending_not_found'
  | 'agent_key_not_found'
  | 'column_not_empty'
  | 'registration_closed'
  | 'email_not_configured'
  | 'rate_limited'
  | 'too_many_attempts'
  | 'payload_too_large'
  | 'unsupported_schema'
  | 'unsupported_media_type'
  | 'unknown_field'
  | 'internal'
  | 'service_unavailable'
  | 'totp_required'
  | 'invalid_code'
  | 'not_implemented';

export type ValidationDetail = { path: string; code: string; message: string };

export type WireErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    hint: string | null;
    details?: ValidationDetail[];
    current?: unknown;
  };
};

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  invalid_credential: 401,
  totp_required: 401,
  invalid_code: 400,
  forbidden: 403,
  forbidden_origin: 403,
  csrf_failed: 403,
  banned: 403,
  board_closed: 403,
  registration_closed: 403,
  not_found: 404,
  board_not_found: 404,
  card_not_found: 404,
  column_not_found: 404,
  comment_not_found: 404,
  link_not_found: 404,
  member_not_found: 404,
  pending_not_found: 404,
  agent_key_not_found: 404,
  column_not_empty: 409,
  conflict: 409,
  already_closed: 409,
  payload_too_large: 413,
  unsupported_schema: 400,
  unsupported_media_type: 415,
  rate_limited: 429,
  too_many_attempts: 429,
  internal: 500,
  service_unavailable: 503,
  email_not_configured: 503,
  unknown_field: 400,
  not_implemented: 501,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly hint: string | null;
  readonly details: ValidationDetail[] | undefined;
  readonly current: unknown;

  constructor(
    code: ErrorCode,
    options: {
      message?: string;
      hint?: string | null;
      status?: number;
      details?: ValidationDetail[];
      current?: unknown;
    } = {},
  ) {
    super(options.message ?? defaultMessage(code));
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? STATUS_BY_CODE[code];
    this.hint = options.hint ?? null;
    this.details = options.details;
    this.current = options.current;
  }
}

export function defaultMessage(code: ErrorCode): string {
  switch (code) {
    case 'board_not_found':
      return 'Board not found.';
    case 'card_not_found':
      return 'Card not found.';
    case 'column_not_found':
      return 'Column not found.';
    case 'not_found':
      return 'Not found.';
    case 'unauthenticated':
      return 'Sign in to continue.';
    case 'invalid_credential':
      return 'This credential is not valid.';
    case 'forbidden':
      return 'You do not have permission to do that.';
    case 'csrf_failed':
      return 'The request could not be verified.';
    case 'already_closed':
      return 'This board is already closed.';
    case 'conflict':
      return 'This item changed while you were editing.';
    case 'validation_failed':
      return 'The request body is invalid.';
    case 'rate_limited':
      return 'Too many requests.';
    case 'too_many_attempts':
      return 'Too many attempts.';
    case 'column_not_empty':
      return 'The column still holds cards.';
    case 'board_closed':
      return 'This board is closed.';
    case 'payload_too_large':
      return 'The payload is too large.';
    case 'unsupported_schema':
      return 'The file is not a supported export.';
    case 'internal':
      return 'Something went wrong on our side.';
    default:
      return code.replaceAll('_', ' ');
  }
}

/** Maps a Zod failure onto the documented `details[]` shape. */
export function fromZod(error: ZodError): AppError {
  const details = error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
  return new AppError('validation_failed', {
    message: defaultMessage('validation_failed'),
    hint: 'Fix the fields listed in details.',
    details,
  });
}

export function toWire(
  error: AppError,
  requestId: string,
): { status: number; body: WireErrorBody } {
  const body: WireErrorBody = {
    error: {
      code: error.code,
      message:
        error.code === 'internal' ? `${error.message} (request ${requestId})` : error.message,
      hint: error.hint,
    },
  };
  if (error.details) {
    body.error.details = error.details;
  }
  if (error.current !== undefined) {
    body.error.current = error.current;
  }
  return { status: error.status, body };
}

/** A 404 for a resource the actor cannot read is byte-identical to a missing one (D-26). */
export function boardNotFound(): AppError {
  return new AppError('board_not_found');
}
