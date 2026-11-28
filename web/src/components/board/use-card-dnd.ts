// SPDX-License-Identifier: AGPL-3.0-only
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/utils/set-custom-native-drag-preview';
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
 * The card-shaped thing that follows the pointer.
 *
 * It is built with `createElement`, not rendered through React: the native drag
 * image has to exist synchronously inside `onGenerateDragPreview`, and a portal
 * is not ready then. Classes come from tokens.css, so the ghost is the same
 * card the reader picked up: 272 px, 8 px radius, one hairline, the overlay
 * shadow, and 1.5° of tilt so it reads as lifted rather than duplicated.
 */
function buildDragPreview(container: HTMLElement, card: Card): void {
  const ghost = document.createElement('div');
  ghost.className =
    'w-card rounded-sm border border-border-strong bg-card p-3 text-ink shadow-[var(--shadow-overlay)] rotate-[1.5deg]';

  const title = document.createElement('p');
  title.className = 'line-clamp-3 text-body text-ink';
  title.textContent = card.title;
  ghost.appendChild(title);

  const tags = card.tags.slice(0, 2);
  if (tags.length > 0) {
    const row = document.createElement('div');
    row.className = 'mt-2 flex flex-wrap items-center gap-1';
    for (const tag of tags) {
      const chip = document.createElement('span');
      chip.textContent = tag.name;
      if (tag.color === null) {
        chip.className =
          'inline-flex h-5 items-center rounded-full border border-border bg-surface-2 px-2 font-mono text-mono-sm text-ink-muted';
      } else {
        chip.className =
          'tag-chip inline-flex h-5 items-center gap-1 rounded-full px-2 font-mono text-mono-sm';
        chip.style.setProperty('--tag', tag.color);
      }
      row.appendChild(chip);
    }
    ghost.appendChild(row);
  }

  container.appendChild(ghost);
}

/**
 * A card is both a draggable and a drop target: the gaps between cards are only
 * a visual line, never a droppable band
 * (docs/features/board-interaction.md §1.2).
 */
export function useCardDnd(input: {
  card: Card;
  cards: Card[];
  canWrite: boolean;
  onMove: (request: MoveRequest) => void;
  /** Where the insertion line belongs for this card: above it, or below it. */
  onHover?: (below: boolean) => void;
  onHoverEnd?: () => void;
  /** The card landed: the board animates it once. */
  onSettle?: (cardId: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const droppedAt = useRef(0);
  const [dragging, setDragging] = useState(false);
  const latest = useRef(input);
  latest.current = input;

  useEffect(() => {
    const element = ref.current;
    if (!element || !input.canWrite) return undefined;

    const endDrag = (): void => {
      setDragging(false);
      document.body.classList.remove('is-dragging');
      droppedAt.current = Date.now();
    };

    return combine(
      draggable({
        element,
        getInitialData: () => ({
          type: 'card',
          cardId: input.card.id,
          columnId: input.card.column_id,
        }),
        onGenerateDragPreview: ({ nativeSetDragImage }) => {
          if (nativeSetDragImage === null) return;
          setCustomNativeDragPreview({
            nativeSetDragImage,
            render: ({ container }) => {
              const snapshot = latest.current.card;
              buildDragPreview(container, snapshot);
              return () => {
                container.replaceChildren();
              };
            },
          });
        },
        onDragStart: () => {
          setDragging(true);
          document.body.classList.add('is-dragging');
        },
        onDrop: ({ location }) => {
          endDrag();
          // A cancel ends the drag with no drop target; only a real landing
          // animates.
          if (location.current.dropTargets.length > 0) {
            latest.current.onSettle?.(latest.current.card.id);
          }
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          isCardData(source.data) && source.data.cardId !== latest.current.card.id,
        getData: () => ({ type: 'card-target', cardId: latest.current.card.id }),
        getIsSticky: () => true,
        onDrag: ({ location }) => {
          if (!isInnermost(location.current.dropTargets, element)) return;
          latest.current.onHover?.(isBelowHalf(element, location.current.input.clientY));
        },
        onDragLeave: () => latest.current.onHoverEnd?.(),
        onDrop: ({ source, location }) => {
          latest.current.onHoverEnd?.();
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
   * (docs/features/board-interaction.md §1.1, step 9) instead of opening the modal.
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
  /** The pointer is on empty column space: the line goes after the last card. */
  onHoverEndOfColumn?: () => void;
  onHoverEnd?: () => void;
  /** The column under the pointer lights up while a card is over it. */
  onActiveChange?: (active: boolean) => void;
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
      onDragEnter: () => latest.current.onActiveChange?.(true),
      onDrag: ({ location }) => {
        if (!isInnermost(location.current.dropTargets, element)) return;
        latest.current.onHoverEndOfColumn?.();
      },
      onDragLeave: () => {
        latest.current.onActiveChange?.(false);
        latest.current.onHoverEnd?.();
      },
      onDrop: ({ source, location }) => {
        latest.current.onActiveChange?.(false);
        latest.current.onHoverEnd?.();
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
