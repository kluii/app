// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { BoardState } from '../../api/types';
import { queryKeys } from '../../lib/query-client';

/**
 * Toggling done is one request and an optimistic paint (docs/features/
 * board-interaction.md §2). A failure patches the one card back — never a
 * whole-state snapshot, which would discard a teammate's concurrent update
 * (docs/features/board-interaction.md §1.4).
 */
export function useToggleDone(boardId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.board(boardId);

  const patchOne = (cardId: string, done: boolean) => {
    queryClient.setQueryData<BoardState>(key, (state) =>
      state === undefined
        ? state
        : {
            ...state,
            cards: state.cards.map((card) => (card.id === cardId ? { ...card, done } : card)),
          },
    );
  };

  return useMutation({
    mutationFn: (input: { cardId: string; done: boolean }) =>
      api.updateCard(input.cardId, { done: input.done }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      patchOne(input.cardId, input.done);
    },
    onError: (_error, input) => {
      patchOne(input.cardId, !input.done);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
