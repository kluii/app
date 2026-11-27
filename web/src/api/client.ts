// SPDX-License-Identifier: AGPL-3.0-only
import type {
  AgentKey,
  AgentKeyTest,
  AnonWrite,
  Board,
  BoardLink,
  LinkRole,
  BoardState,
  Card,
  Column,
  CreatedAgentKey,
  EventDto,
  Me,
  Page,
  Member,
  MemberRole,
  PendingCard,
  PublicBoard,
  Visibility,
} from './types';

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

export type CommentDto = {
  id: string;
  card_id: string;
  body: string;
  author: { id: string | null; username: string | null; label: string | null; type: string };
  edited_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BoardSummary = {
  id: string;
  board: { name: string; owner: string };
  closed_at: string;
  first_event_at: string | null;
  last_event_at: string | null;
  span_days: number;
  counts: { cards: number; done: number; columns: number; members: number; agents: number };
  done: { title: string; assignee: string | null; date: string | null }[];
  remaining: { column: string; cards: { title: string; assignee: string | null }[] }[];
  people: { label: string; kind: 'user' | 'agent' | 'anon'; events: number }[];
  rhythm: string;
  rhythm_counts: number[];
  note: string | null;
};

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

  /**
   * Agent keys (docs/features/agents.md §1). The credential is in the 201 body
   * and nowhere else: no endpoint reads it back, so the panel renders it from
   * this response or not at all.
   */
  agentKeys: () => request<{ items: AgentKey[] }>('GET', '/agent-keys'),
  createAgentKey: (input: {
    name: string;
    scope: 'board' | 'user';
    board_id?: string;
    expires_in_days?: number;
  }) => request<CreatedAgentKey>('POST', '/agent-keys', input),
  revokeAgentKey: (id: string) => request<void>('DELETE', `/agent-keys/${encodeURIComponent(id)}`),
  /** `key` is optional: with it the server compares hashes, without it it probes the stored row. */
  testAgentKey: (id: string, key?: string) =>
    request<AgentKeyTest>(
      'POST',
      `/agent-keys/${encodeURIComponent(id)}/test`,
      key === undefined ? {} : { key },
    ),

  boards: () => request<{ items: Board[] }>('GET', '/boards'),
  userBoards: (username: string) =>
    request<{ owner: { username: string }; items: PublicBoard[] }>(
      'GET',
      `/users/${encodeURIComponent(username)}/boards`,
    ),
  resolveBoardUrl: (username: string, segment: string) =>
    request<{ board_id: string }>(
      'GET',
      `/users/${encodeURIComponent(username)}/boards/${encodeURIComponent(segment)}/resolve`,
    ),
  createBoard: (input: { name: string; template?: 'classic' | 'blank' }) =>
    request<Board>('POST', '/boards', input),
  boardState: (boardId: string) => request<BoardState>('GET', `/boards/${boardId}/state`),
  updateBoard: (
    boardId: string,
    input: {
      name?: string;
      slug?: string;
      visibility?: Visibility;
      link_role?: LinkRole;
      anon_write?: AnonWrite;
      expected_updated_at?: string;
    },
  ) => request<Board>('PATCH', `/boards/${boardId}`, input),
  /** Irreversible: the board, its columns, cards and comments go with it. */
  deleteBoard: (boardId: string) =>
    request<void>('DELETE', `/boards/${boardId}`, { confirm: true }),
  rotateSuffix: (boardId: string) =>
    request<Board>('POST', `/boards/${boardId}/link-suffix/rotate`, { confirm: true }),
  links: (boardId: string) => request<{ items: BoardLink[] }>('GET', `/boards/${boardId}/links`),
  createLink: (boardId: string, role: 'read' | 'edit', label?: string) =>
    request<BoardLink & { token: string; url: string }>('POST', `/boards/${boardId}/links`, {
      role,
      ...(label ? { label } : {}),
    }),
  revokeLink: (boardId: string, linkId: string) =>
    request<void>('DELETE', `/boards/${boardId}/links/${linkId}`),
  members: (boardId: string) => request<{ items: Member[] }>('GET', `/boards/${boardId}/members`),
  inviteMember: (boardId: string, username: string, role: MemberRole) =>
    request<Member>('POST', `/boards/${boardId}/members`, { username, role }),
  updateMember: (boardId: string, userId: string, role: MemberRole) =>
    request<Member>('PATCH', `/boards/${boardId}/members/${userId}`, { role }),
  removeMember: (boardId: string, userId: string) =>
    request<void>('DELETE', `/boards/${boardId}/members/${userId}`),
  transferBoard: (boardId: string, userId: string) =>
    request<Board>('POST', `/boards/${boardId}/transfer`, { user_id: userId, confirm: true }),
  pending: (boardId: string) =>
    request<{ items: PendingCard[] }>('GET', `/boards/${boardId}/pending`),
  approvePending: (boardId: string, pendingId: string) =>
    request<{ card_id: string }>('POST', `/boards/${boardId}/pending/${pendingId}/approve`, {}),
  rejectPending: (boardId: string, pendingId: string) =>
    request<void>('POST', `/boards/${boardId}/pending/${pendingId}/reject`, {}),
  boardPublic: (boardId: string) =>
    request<{
      id: string;
      name: string;
      visibility: Visibility;
      anon_write: AnonWrite;
      accepts_anon: boolean;
    }>('GET', `/boards/${boardId}/public`),
  joinBoard: (boardId: string, label: string) =>
    request<{ board_id: string; label: string; actor_kind: 'anon' }>(
      'POST',
      `/boards/${boardId}/anon`,
      { label },
    ),
  card: (cardId: string) => request<Card>('GET', `/cards/${cardId}`),
  activity: (boardId: string, cursor?: string, actorKind?: string) =>
    request<Page<EventDto>>(
      'GET',
      `/boards/${boardId}/activity?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${
        actorKind && actorKind !== 'all' ? `&actor_kind=${actorKind}` : ''
      }`,
    ),

  createColumn: (boardId: string, input: { name: string }) =>
    request<Column>('POST', `/boards/${boardId}/columns`, input),
  createCard: (
    boardId: string,
    input: {
      column: string;
      title: string;
      description?: string;
      tags?: { name: string; color?: string }[];
      due_at?: string;
      assignee?: string;
    },
  ) => request<Card>('POST', `/boards/${boardId}/cards`, input),
  updateCard: (cardId: string, input: Record<string, unknown>) =>
    request<Card>('PATCH', `/cards/${cardId}`, input),
  deleteCard: (cardId: string) => request<void>('DELETE', `/cards/${cardId}`),
  comments: (cardId: string, cursor?: string) =>
    request<{ items: CommentDto[]; next_cursor: string | null }>(
      'GET',
      `/cards/${cardId}/comments?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  addComment: (cardId: string, body: string) =>
    request<CommentDto>('POST', `/cards/${cardId}/comments`, { body }),
  editComment: (commentId: string, body: string) =>
    request<CommentDto>('PATCH', `/comments/${commentId}`, { body }),
  deleteComment: (commentId: string) => request<void>('DELETE', `/comments/${commentId}`),

  tagColors: (boardId: string) =>
    request<Record<string, string>>('GET', `/boards/${boardId}/tag-colors`),
  putTagColors: (boardId: string, colors: Record<string, string>) =>
    request<Record<string, string>>('PUT', `/boards/${boardId}/tag-colors`, colors),

  closeBoard: (boardId: string, note: string | null) =>
    request<BoardSummary>('POST', `/boards/${boardId}/close`, {
      confirm: true,
      ...(note === null || note.trim() === '' ? {} : { note }),
    }),
  summary: (boardId: string) => request<BoardSummary>('GET', `/boards/${boardId}/summary`),

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
