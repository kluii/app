// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { Card } from '../src/api/types';
import {
  NO_FILTERS,
  assigneeKey,
  filterCount,
  matches,
} from '../src/components/board/board-filters';

function card(overrides: Partial<Card>): Card {
  return {
    id: 'crd_0000000000000000000000',
    column_id: 'col_0000000000000000000000',
    title: 'Card',
    description: null,
    assignee: null,
    assignee_label: null,
    actor_label: null,
    mine: false,
    due_at: null,
    done: false,
    position: '1000',
    tags: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('board filters', () => {
  const cards = [
    card({ title: 'Ship the release note', tags: [{ name: 'docs', color: null }] }),
    card({ title: 'Fix the drag bug', tags: [{ name: 'bug', color: null }] }),
    card({
      title: 'Review copy',
      description: 'the landing paragraph',
      tags: [{ name: 'docs', color: null }],
      assignee: { id: 'usr_0000000000000000000000', username: 'ana' },
    }),
    card({ title: 'Anonymous card', assignee_label: 'visitor' }),
  ];

  it('counts one chip per active filter', () => {
    expect(filterCount(NO_FILTERS)).toBe(0);
    expect(filterCount({ text: '  ', tags: [], assignees: [] })).toBe(0);
    expect(filterCount({ text: 'drag', tags: ['docs'], assignees: ['ana'] })).toBe(3);
  });

  it('matches text against the title and the description, case-insensitively', () => {
    const hits = (text: string) =>
      cards.filter((item) => matches(item, { ...NO_FILTERS, text })).map((item) => item.title);
    expect(hits('DRAG')).toEqual(['Fix the drag bug']);
    expect(hits('landing')).toEqual(['Review copy']);
    expect(hits('nothing')).toEqual([]);
  });

  it('matches any of the selected tags, not all of them', () => {
    const selected = cards.filter((item) =>
      matches(item, { ...NO_FILTERS, tags: ['docs', 'bug'] }),
    );
    expect(selected).toHaveLength(3);
  });

  it('matches an assignee by username or by label', () => {
    const anonymised = cards[3];
    if (!anonymised) throw new Error('the fixture lost its fourth card');
    expect(assigneeKey(anonymised)).toBe('visitor');
    const ana = cards.filter((item) => matches(item, { ...NO_FILTERS, assignees: ['ana'] }));
    expect(ana.map((item) => item.title)).toEqual(['Review copy']);
    const visitor = cards.filter((item) =>
      matches(item, { ...NO_FILTERS, assignees: ['visitor'] }),
    );
    expect(visitor.map((item) => item.title)).toEqual(['Anonymous card']);
  });

  it('keeps the stored order: a filter never reorders', () => {
    const docCards = cards.filter((item) => matches(item, { ...NO_FILTERS, tags: ['docs'] }));
    expect(docCards.map((item) => item.title)).toEqual(['Ship the release note', 'Review copy']);
  });
});
