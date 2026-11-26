// SPDX-License-Identifier: AGPL-3.0-only
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { useEffect, useRef, useState } from 'react';
import type { Card } from '../../api/types';

export type MoveRequest = {
  cardId: string;
  column: string;
  before: string | null;
  after: string | null;
};

type CardData = { type: 'card'; cardId: string; columnId: string };

function isCardData(value: Record<string, unknown>): value is CardData {
  return value.type === 'card' && typeof value.cardId === 'string';
}

/**
 * Nested drop targets both receive `onDrop`: a card sits inside a column, so
 * without this guard one gesture writes twice and the second write (the append)
 * wins. Only the innermost target acts.
 */
function isInnermost(dropTargets: { element: Element }[], element: Element): boolean {
  return dropTargets[0]?.element === element;
}

/**
 * The stored neighbours for a drop, not the rendered ones (K2-05): a filter can
 * hide the card between two others, and sending the filtered neighbours would
 * silently move the card past them.
 */
export function neighboursFor(input: {
  cards: Card[];
  cardId: string;
  columnId: string;
  targetCardId: string | null;
  below: boolean;
}): { before: string | null; after: string | null } {
  const stored = input.cards
    .filter((card) => card.column_id === input.columnId && card.id !== input.cardId)
    .sort((left, right) => Number(left.position) - Number(right.position));

  if (input.targetCardId === null) {
    const last = stored[stored.length - 1];
    return { before: last?.id ?? null, after: null };
  }

  const index = stored.findIndex((card) => card.id === input.targetCardId);
  if (index === -1) {
    const last = stored[stored.length - 1];
    return { before: last?.id ?? null, after: null };
  }

  if (input.below) {
    return { before: stored[index]?.id ?? null, after: stored[index + 1]?.id ?? null };
  }
  return { before: stored[index - 1]?.id ?? null, after: stored[index]?.id ?? null };
}

/** The DOM half a pointer is over: the upper half drops above, the lower half below. */
export function isBelowHalf(element: Element, clientY: number): boolean {
  const rect = element.getBoundingClientRect();
  return clientY > rect.top + rect.height / 2;
}

/**
 * A card is both a draggable and a drop target: the gaps between cards are only
 * a visual line, never a droppable band (PROMPT.md §10.4).
 */
export function useCardDnd(input: {
  card: Card;
  cards: Card[];
  canWrite: boolean;
  onMove: (request: MoveRequest) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const droppedAt = useRef(0);
  const [dragging, setDragging] = useState(false);
  const latest = useRef(input);
  latest.current = input;

  useEffect(() => {
    const element = ref.current;
    if (!element || !input.canWrite) return undefined;

    return combine(
      draggable({
        element,
        getInitialData: () => ({
          type: 'card',
          cardId: input.card.id,
          columnId: input.card.column_id,
        }),
        onDragStart: () => setDragging(true),
        onDrop: () => {
          setDragging(false);
          droppedAt.current = Date.now();
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          isCardData(source.data) && source.data.cardId !== latest.current.card.id,
        getData: () => ({ type: 'card-target', cardId: latest.current.card.id }),
        getIsSticky: () => true,
        onDrop: ({ source, location }) => {
          if (!isInnermost(location.current.dropTargets, element)) return;
          const data = source.data;
          if (!isCardData(data)) return;
          latest.current.onMove({
            cardId: data.cardId,
            column: latest.current.card.column_id,
            ...neighboursFor({
              cards: latest.current.cards,
              cardId: data.cardId,
              columnId: latest.current.card.column_id,
              targetCardId: latest.current.card.id,
              below: isBelowHalf(element, location.current.input.clientY),
            }),
          });
        },
      }),
    );
  }, [input.card.id, input.card.column_id, input.canWrite]);

  /**
   * A drop ends with a click on the card that was dragged. pragmatic-drag-and-drop
   * does not cancel it, so the click that follows a drop is swallowed here
   * (PROMPT.md §10.3) instead of opening the modal.
   */
  function consumeDragClick(): boolean {
    return Date.now() - droppedAt.current < 300;
  }

  return { ref, dragging, consumeDragClick };
}

/** The column body: the drop target for "empty space" and for an empty column. */
export function useColumnDroppable(input: {
  columnId: string;
  cards: Card[];
  canWrite: boolean;
  onMove: (request: MoveRequest) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(input);
  latest.current = input;

  useEffect(() => {
    const element = ref.current;
    if (!element || !input.canWrite) return undefined;
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => isCardData(source.data),
      getData: () => ({ type: 'column-target', columnId: latest.current.columnId }),
      getIsSticky: () => false,
      onDrop: ({ source, location }) => {
        if (!isInnermost(location.current.dropTargets, element)) return;
        const data = source.data;
        if (!isCardData(data)) return;
        latest.current.onMove({
          cardId: data.cardId,
          column: latest.current.columnId,
          ...neighboursFor({
            cards: latest.current.cards,
            cardId: data.cardId,
            columnId: latest.current.columnId,
            targetCardId: null,
            below: true,
          }),
        });
      },
    });
  }, [input.columnId, input.canWrite]);

  return { ref };
}
