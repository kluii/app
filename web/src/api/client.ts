// SPDX-License-Identifier: AGPL-3.0-only
import type { Board, BoardState, Card, Column, EventDto, Me, Page } from './types';

/**
 * The one place the SPA talks to the API. `credentials: 'same-origin'` carries
 * the session cookie; every state-changing cookie request sends the CSRF
 * double-submit header from `klui_csrf`.
 */
export type ApiErrorBody = {
  code: string;
  message: string;
  hint: string | null;
  details?: { path: string; code: string; message: string }[];
  current?: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint: string | null;
  readonly details: ApiErrorBody['details'];

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.hint = body.hint;
    this.details = body.details;
  }
}

function csrfToken(): string | null {
  const match = /(?:^|;\s*)klui_csrf=([^;]+)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const csrf = csrfToken();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (csrf) headers['x-klui-csrf'] = csrf;

  const response = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text === '' ? null : JSON.parse(text);

  if (!response.ok) {
    const envelope = parsed as { error?: ApiErrorBody } | null;
    const error = envelope?.error ?? {
      code: 'internal',
      message: 'The request failed.',
      hint: null,
    };
    throw new ApiError(response.status, error);
  }
  return parsed as T;
}

async function requestFile<T>(path: string, file: File): Promise<T> {
  const csrf = csrfToken();
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`/api/v1${path}`, {
    method: 'POST',
    // No content-type: the browser must set the multipart boundary itself.
    headers: { accept: 'application/json', ...(csrf ? { 'x-klui-csrf': csrf } : {}) },
    credentials: 'same-origin',
    body: form,
  });
  const text = await response.text();
  const parsed: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    const envelope = parsed as { error?: ApiErrorBody } | null;
    throw new ApiError(
      response.status,
      envelope?.error ?? { code: 'internal', message: 'The request failed.', hint: null },
    );
  }
  return parsed as T;
}

export type ImportResult = {
  columns: number;
  cards: number;
  comments: number;
  created_columns: number;
  dropped: Record<string, number>;
  warnings: string[];
};

export const api = {
  me: () => request<Me>('GET', '/me'),
  login: (input: {
    email_or_username: string;
    password: string;
    totp?: string;
    recovery_code?: string;
  }) => request<Me>('POST', '/auth/login', input),
  signup: (input: { email: string; username: string; password: string }) =>
    request<Me>('POST', '/auth/signup', input),
  logout: () => request<void>('POST', '/auth/logout'),

  requestPasswordReset: (email: string) =>
    request<{ status: 'accepted' }>('POST', '/auth/reset/request', { email }),
  confirmPasswordReset: (input: { token: string; password: string }) =>
    request<{ status: 'reset' }>('POST', '/auth/reset/confirm', input),

  enrollTotp: () =>
    request<{ secret: string; otpauth_url: string; recovery_codes: string[] }>(
      'POST',
      '/auth/totp/enroll',
    ),
  verifyTotp: (code: string) => request<{ enabled: true }>('POST', '/auth/totp/verify', { code }),
  disableTotp: (input: { password: string; code: string }) =>
    request<{ enabled: false }>('POST', '/auth/totp/disable', input),
  regenerateRecoveryCodes: (password: string) =>
    request<{ recovery_codes: string[] }>('POST', '/auth/recovery-codes', { password }),

  boards: () => request<{ items: Board[] }>('GET', '/boards'),
  createBoard: (input: { name: string; template?: 'classic' | 'blank' }) =>
    request<Board>('POST', '/boards', input),
  boardState: (boardId: string) => request<BoardState>('GET', `/boards/${boardId}/state`),
  card: (cardId: string) => request<Card>('GET', `/cards/${cardId}`),
  activity: (boardId: string, cursor?: string) =>
    request<Page<EventDto>>(
      'GET',
      `/boards/${boardId}/activity?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),

  createColumn: (boardId: string, input: { name: string }) =>
    request<Column>('POST', `/boards/${boardId}/columns`, input),
  createCard: (boardId: string, input: { column: string; title: string; description?: string }) =>
    request<Card>('POST', `/boards/${boardId}/cards`, input),
  updateCard: (cardId: string, input: Record<string, unknown>) =>
    request<Card>('PATCH', `/cards/${cardId}`, input),
  deleteCard: (cardId: string) => request<void>('DELETE', `/cards/${cardId}`),
  importBoard: (boardId: string, file: File) =>
    requestFile<{ job_id: string; status: string; replayed: boolean; result: ImportResult }>(
      `/boards/${boardId}/import`,
      file,
    ),

  moveCard: (
    cardId: string,
    input: { column: string; before?: string | null; after?: string | null },
  ) =>
    request<{ card: Card; column_id: string; position: string }>(
      'POST',
      `/cards/${cardId}/move`,
      input,
    ),
};
