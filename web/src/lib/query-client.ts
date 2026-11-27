// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient } from '@tanstack/react-query';

/** One client for the app; a failed read never blanks the last good board. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      staleTime: 5_000,
      refetchOnWindowFocus: true,
    },
  },
});

export const queryKeys = {
  me: ['me'] as const,
  boards: ['boards'] as const,
  board: (id: string) => ['board', id] as const,
  activity: (id: string, actorKind?: string) => ['activity', id, actorKind ?? 'all'] as const,
  comments: (cardId: string) => ['comments', cardId] as const,
  summary: (boardId: string) => ['summary', boardId] as const,
  profile: (username: string) => ['profile', username.toLowerCase()] as const,
  pending: (boardId: string) => ['pending', boardId] as const,
  members: (boardId: string) => ['members', boardId] as const,
  links: (boardId: string) => ['links', boardId] as const,
  /** Board-scoped, and deliberately not `board(id)`: a different shape per key. */
  tagColors: (boardId: string) => ['tag-colors', boardId] as const,
  agentKeys: ['agent-keys'] as const,
  oidcProviders: ['oidc-providers'] as const,
  linkedOidc: ['linked-oidc'] as const,
  adminOidcProviders: ['admin-oidc-providers'] as const,
  notifications: ['notifications'] as const,
  notificationPrefs: ['notification-prefs'] as const,
};
