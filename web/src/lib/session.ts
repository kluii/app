// SPDX-License-Identifier: AGPL-3.0-only
import { queryClient, queryKeys } from './query-client';
import { api, ApiError } from '../api/client';
import type { Me } from '../api/types';

/** The session is the one query the router guards on; a 401 is an answer, not an error. */
export async function loadMe(): Promise<Me | null> {
  try {
    return await queryClient.fetchQuery({
      queryKey: queryKeys.me,
      queryFn: api.me,
      retry: false,
      staleTime: 30_000,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function signedIn(me: Me | null): me is Me {
  return me !== null;
}
