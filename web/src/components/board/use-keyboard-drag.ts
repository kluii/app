// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useState } from 'react';
import type { Card, Column } from '../../api/types';
import type { MoveRequest } from './use-card-dnd';

export type KeyboardDrag = { cardId: string; columnId: string; index: number } | null;

function orderOf(cards: Card[], columnId: string, exclude?: string): Card[] {
  return cards
    .filter((card) => card.column_id === columnId && card.id !== exclude)
    .sort((left, right) => Number(left.position) - Number(right.position));
}

/**
 * K2-06: Space lifts, arrows move, Space drops, Esc cancels. The insertion
 * index is computed against the *stored* column, so a filtered board moves a
 * card relative to the cards it cannot see, exactly like a pointer drop.
 */
export function useKeyboardDrag(input: {
  cards: Card[];
  columns: Column[];
  onMove: (request: MoveRequest) => void;
  announce: (message: string) => void;
  messages: {
    lifted: (input: { card: string; column: string; index: number; total: number }) => string;
    position: (input: { card: string; column: string; index: number; total: number }) => string;
    moved: (input: { card: string; column: string; index: number; total: number }) => string;
  };
  describeCard: (card: Card) => string;
  describeColumn: (column: Column) => string;
}) {
  const [drag, setDrag] = useState<KeyboardDrag>(null);

  const lift = useCallback(
    (card: Card) => {
      const order = orderOf(input.cards, card.column_id, card.id);
      // Lift at the card's current index, not at the end: the first press must
      // not move anything (K2-06).
      const stored = orderOf(input.cards, card.column_id);
      const index = Math.max(
        0,
        stored.findIndex((item) => item.id === card.id),
      );
      setDrag({ cardId: card.id, columnId: card.column_id, index });
      const column = input.columns.find((item) => item.id === card.column_id);
      input.announce(
        input.messages.lifted({
          card: input.describeCard(card),
          column: input.describeColumn(
            column ?? input.columns[0] ?? { id: '', name: '', position: '' },
          ),
          index: index + 1,
          total: order.length + 1,
        }),
      );
    },
    [input],
  );

  const drop = useCallback(() => {
    if (!drag) return;
    const order = orderOf(input.cards, drag.columnId, drag.cardId);
    const index = Math.min(drag.index, order.length);
    const before = order[index - 1]?.id ?? null;
    const after = order[index]?.id ?? null;
    input.onMove({ cardId: drag.cardId, column: drag.columnId, before, after });
    const card = input.cards.find((item) => item.id === drag.cardId);
    const column = input.columns.find((item) => item.id === drag.columnId);
    input.announce(
      input.messages.moved({
        card: card ? input.describeCard(card) : '',
        column: column ? input.describeColumn(column) : '',
        index: index + 1,
        total: order.length + 1,
      }),
    );
    setDrag(null);
  }, [drag, input]);

  const move = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (!drag) return;
      const order = orderOf(input.cards, drag.columnId, drag.cardId);
      const card = input.cards.find((item) => item.id === drag.cardId);
      const column = input.columns.find((item) => item.id === drag.columnId);

      if (direction === 'up' || direction === 'down') {
        const next = Math.max(
          0,
          Math.min(order.length, drag.index + (direction === 'up' ? -1 : 1)),
        );
        setDrag({ ...drag, index: next });
        if (card && column) {
          input.announce(
            input.messages.position({
              card: input.describeCard(card),
              column: input.describeColumn(column),
              index: next + 1,
              total: order.length + 1,
            }),
          );
        }
        return;
      }

      const currentIndex = input.columns.findIndex((item) => item.id === drag.columnId);
      const nextIndex = currentIndex + (direction === 'left' ? -1 : 1);
      const target = input.columns[nextIndex];
      if (!target) return;
      const targetOrder = orderOf(input.cards, target.id, drag.cardId);
      setDrag({ ...drag, columnId: target.id, index: targetOrder.length });
      if (card) {
        input.announce(
          input.messages.position({
            card: input.describeCard(card),
            column: input.describeColumn(target),
            index: targetOrder.length + 1,
            total: targetOrder.length + 1,
          }),
        );
      }
    },
    [drag, input],
  );

  const cancel = useCallback(() => {
    setDrag(null);
    input.announce('');
  }, [input]);

  /** The key handler a card's button needs. Returns true when it consumed the key. */
  const onKeyDown = useCallback(
    (card: Card, event: React.KeyboardEvent<HTMLButtonElement>): boolean => {
      const lifted = drag?.cardId === card.id;
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (!lifted) lift(card);
        else drop();
        return true;
      }
      if (!lifted) return false;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        move(event.key === 'ArrowUp' ? 'up' : 'down');
        return true;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        move(event.key === 'ArrowLeft' ? 'left' : 'right');
        return true;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
        return true;
      }
      return false;
    },
    [cancel, drag, drop, lift, move],
  );

  return { drag, onKeyDown };
}
