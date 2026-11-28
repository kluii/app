// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-10, the client half: merge by server id, and a stream that reconnects with
 * its own cursor and backoff.
 */
import { describe, expect, it, vi } from 'vitest';
import { cardIdOf, envelopeOf, mergeCard, dropCard } from '../src/data/boards';
import { backoffDelay, connectBoardStream, streamUrl } from '../src/data/live';
import { mergeById, sameIds } from '../src/data/merge';
import type { BoardState, Card } from '../src/api/types';

function card(id: string, title = id): Card {
  return {
    id,
    column_id: 'col_a',
    title,
    description: null,
    assignee: null,
    assignee_label: null,
    actor_label: null,
    mine: false,
    due_at: null,
    done: false,
    position: '1024',
    tags: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('merge by server id', () => {
  it('replaces an entity that is already there instead of appending it', () => {
    const current = [card('crd_a'), card('crd_b', 'old title')];
    const merged = mergeById(current, [card('crd_b', 'new title')]);
    expect(merged).toHaveLength(2);
    expect(merged.map((row) => row.title)).toEqual(['crd_a', 'new title']);
  });

  it('appends what is genuinely new, and keeps the incoming order', () => {
    const merged = mergeById([card('crd_a')], [card('crd_b'), card('crd_c')]);
    expect(merged.map((row) => row.id)).toEqual(['crd_a', 'crd_b', 'crd_c']);
    expect(sameIds(merged, [card('crd_a'), card('crd_b'), card('crd_c')])).toBe(true);
  });

  it('is idempotent: the same echo twice is still one row', () => {
    const once = mergeById([], [card('crd_a')]);
    const twice = mergeById(once, [card('crd_a')]);
    expect(twice).toHaveLength(1);
  });
});

describe('a board state under a frame', () => {
  const state: BoardState = {
    board: {
      id: 'brd_a',
      name: 'Board',
      description: null,
      icon: null,
      slug: 'board',
      visibility: 'private',
      link_role: 'none',
      anon_write: 'off',
      link_suffix: null,
      url: null,
      owner: { id: 'usr_a', username: 'ana' },
      closed_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    columns: [],
    cards: [card('crd_a')],
    members: [],
    caller: {
      actor_kind: 'user',
      role: 'owner',
      label: 'ana',
      can_write: true,
      can_delete_card: true,
      can_move_card: true,
      can_comment: true,
      can_manage: true,
      can_manage_columns: true,
      can_manage_members: true,
      can_moderate: true,
      can_export: true,
      can_import: true,
      can_close: true,
    },
    pending_count: 0,
  };

  it('merges a fetched card without touching the rest of the board', () => {
    const next = mergeCard(state, card('crd_a', 'renamed'));
    expect(next.cards).toHaveLength(1);
    expect(next.cards[0]?.title).toBe('renamed');
    expect(next.board).toBe(state.board);
  });

  it('drops a deleted card and reads the card id out of the envelope', () => {
    expect(dropCard(state, 'crd_a').cards).toEqual([]);
    expect(cardIdOf(envelopeOf({ payload: { card_id: 'crd_b' } }))).toBe('crd_b');
    expect(cardIdOf(envelopeOf({ payload: {} }))).toBeNull();
    expect(cardIdOf(envelopeOf(null))).toBeNull();
  });
});

describe('the stream client', () => {
  it('builds the url with the cursor, because EventSource cannot set a header', () => {
    expect(streamUrl(['brd_a'], null)).toBe('/api/v1/stream?board=brd_a');
    expect(streamUrl(['brd_a', 'brd_b'], '42')).toBe(
      '/api/v1/stream?board=brd_a&board=brd_b&last_event_id=42',
    );
  });

  it('backs off 1, 2, 4 … 30 s with jitter and a cap', () => {
    for (const [attempt, base] of [1000, 2000, 4000, 8000, 16000, 30000, 30000].entries()) {
      const delay = backoffDelay(attempt);
      expect(delay).toBeGreaterThanOrEqual(base * 0.8 - 1);
      expect(delay).toBeLessThanOrEqual(base * 1.2 + 1);
    }
  });

  it('reconnects with the last event id it saw and reports the status', async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    const listeners = new Map<string, ((event: Event) => void)[]>();
    const factory = (url: string) => {
      urls.push(url);
      const source = {
        addEventListener: (type: string, listener: (event: Event) => void) => {
          listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        },
        close: () => undefined,
      };
      return source;
    };
    const statuses: string[] = [];
    const handle = connectBoardStream({
      boardIds: ['brd_a'],
      factory,
      onStatus: (status) => statuses.push(status),
      onEvent: () => undefined,
      onReconnect: () => undefined,
    });

    listeners.get('open')?.forEach((listener) => listener(new Event('open')));
    // One frame carries the cursor the reconnect must send back.
    const message = new Event('message') as Event & { data: string; lastEventId: string };
    message.data = JSON.stringify({ payload: { card_id: 'crd_a' } });
    message.lastEventId = '777';
    listeners.get('card.created')?.forEach((listener) => listener(message));

    listeners.get('error')?.forEach((listener) => listener(new Event('error')));
    await vi.advanceTimersByTimeAsync(1500);

    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('last_event_id=777');
    expect(statuses).toContain('open');
    expect(statuses).toContain('closed');
    handle.close();
    vi.useRealTimers();
  });
});
