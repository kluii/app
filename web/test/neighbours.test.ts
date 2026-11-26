// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-05, the client half: a drop under an active filter must name the *stored*
 * neighbours. The rendered list hides cards, and sending the rendered neighbours
 * silently moves the card past the ones the filter hid.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../src/api/types';
import { neighboursFor } from '../src/components/board/use-card-dnd';

function card(id: string, position: number, columnId = 'col_todo'): Card {
  return {
    id,
    column_id: columnId,
    title: id,
    description: null,
    assignee: null,
    assignee_label: null,
    due_at: null,
    done: false,
    position: String(position),
    tags: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

const a = card('crd_a', 1024);
const b = card('crd_b', 2048);
const c = card('crd_c', 3072);
const d = card('crd_d', 4096);
const stored = [a, b, c, d];

describe('drag neighbours', () => {
  it('drops above a card by naming the stored card above it, even when a filter hides one', () => {
    // The filtered render shows a, c, d: the card above c is a. The stored
    // neighbour is b, and b is what the move must name.
    const neighbours = neighboursFor({
      cards: stored,
      cardId: 'crd_x',
      columnId: 'col_todo',
      targetCardId: 'crd_c',
      below: false,
    });
    expect(neighbours).toEqual({ before: 'crd_b', after: 'crd_c' });
  });

  it('drops below a card by naming the stored card under it, even when a filter hides one', () => {
    const neighbours = neighboursFor({
      cards: stored,
      cardId: 'crd_x',
      columnId: 'col_todo',
      targetCardId: 'crd_a',
      below: true,
    });
    expect(neighbours).toEqual({ before: 'crd_a', after: 'crd_b' });
  });

  it('names no neighbour above the first card and none below the last', () => {
    expect(
      neighboursFor({
        cards: stored,
        cardId: 'crd_x',
        columnId: 'col_todo',
        targetCardId: 'crd_a',
        below: false,
      }),
    ).toEqual({ before: null, after: 'crd_a' });

    expect(
      neighboursFor({
        cards: stored,
        cardId: 'crd_x',
        columnId: 'col_todo',
        targetCardId: 'crd_d',
        below: true,
      }),
    ).toEqual({ before: 'crd_d', after: null });
  });

  it('appends when the drop is on empty space, and when the target no longer exists', () => {
    expect(
      neighboursFor({
        cards: stored,
        cardId: 'crd_x',
        columnId: 'col_todo',
        targetCardId: null,
        below: true,
      }),
    ).toEqual({ before: 'crd_d', after: null });

    expect(
      neighboursFor({
        cards: stored,
        cardId: 'crd_x',
        columnId: 'col_todo',
        targetCardId: 'crd_gone',
        below: false,
      }),
    ).toEqual({ before: 'crd_d', after: null });
  });

  it('never names the moving card as its own neighbour', () => {
    // Moving c between a and b: the stored list already contains c, and naming
    // it as `after` would ask the server to rank the card against itself.
    expect(
      neighboursFor({
        cards: stored,
        cardId: 'crd_c',
        columnId: 'col_todo',
        targetCardId: 'crd_b',
        below: false,
      }),
    ).toEqual({ before: 'crd_a', after: 'crd_b' });
  });

  it('ignores cards of another column and orders by stored position, not array order', () => {
    const shuffled = [d, card('crd_other', 1536, 'col_doing'), b, a, c];
    expect(
      neighboursFor({
        cards: shuffled,
        cardId: 'crd_x',
        columnId: 'col_todo',
        targetCardId: 'crd_d',
        below: false,
      }),
    ).toEqual({ before: 'crd_c', after: 'crd_d' });
  });
});
