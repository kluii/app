// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The board collection and how a stream frame lands in it.
 *
 * A frame never appends: it is turned into the entity the server now holds, and
 * that entity is merged by id (docs/features/realtime.md §2.1). This is the
 * module that knows the shape of the cache — nothing outside `web/src/data/`
 * writes a board state directly.
 */
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { BoardState, Card } from '../api/types';
import { queryKeys } from '../lib/query-client';
import { mergeById } from './merge';

export type LiveEnvelope = {
  board_id?: string;
  entity?: string;
  action?: string;
  payload?: Record<string, unknown>;
};

export function envelopeOf(data: unknown): LiveEnvelope {
  return data !== null && typeof data === 'object' ? (data as LiveEnvelope) : {};
}

export function cardIdOf(envelope: LiveEnvelope): string | null {
  const id = envelope.payload?.['card_id'];
  return typeof id === 'string' ? id : null;
}

/** Types whose payload names a card, so the card can be fetched and merged. */
export function isCardEvent(type: string): boolean {
  return type.startsWith('card.');
}

export function mergeCard(state: BoardState, card: Card): BoardState {
  return { ...state, cards: mergeById(state.cards, [card]) };
}

export function dropCard(state: BoardState, cardId: string): BoardState {
  return { ...state, cards: state.cards.filter((card) => card.id !== cardId) };
}

/**
 * Applies one card frame: fetch the entity, merge it by id, ignore a card that
 * no longer exists. A full refetch is reserved for shapes the frame cannot
 * describe (a column, a membership, a board setting).
 */
export async function applyCardFrame(input: {
  queryClient: QueryClient;
  boardId: string;
  cardId: string;
}): Promise<void> {
  const key = queryKeys.board(input.boardId);
  try {
    const card = await api.card(input.cardId);
    input.queryClient.setQueryData<BoardState>(key, (state) =>
      state === undefined ? state : mergeCard(state, card),
    );
  } catch {
    // Gone, or no longer readable: the next state fetch is the truth.
    input.queryClient.setQueryData<BoardState>(key, (state) =>
      state === undefined ? state : dropCard(state, input.cardId),
    );
  }
}
