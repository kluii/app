// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K5-05 — the golden test on a fixed event log (ADR-0005, digest.md §4).
 *
 * The digest is computed, so its content is a value that can be asserted byte
 * for byte. The log below is fixed: two cards done, two moved into Doing, one
 * moved elsewhere, one overdue, one assigned, three open. The expected text has
 * the shape docs/features/digest.md §2.6 documents: header, sections in order,
 * no greeting, no emoji.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDigest,
  hourIn,
  isTimezone,
  sameDayIn,
  type DigestCard,
  type DigestEvent,
  type DigestInput,
} from '../src/digest/build.js';

const NOW = new Date('2026-11-26T09:00:00Z');
const USER = 'usr_me';
const SINCE = new Date('2026-11-25T09:00:00Z');
const BOARD = { id: 'brd_retro', name: 'Retro S2' };
const OTHER = { id: 'brd_other', name: 'Launch' };

function card(overrides: Partial<DigestCard> & Pick<DigestCard, 'id' | 'title'>): DigestCard {
  return {
    boardId: BOARD.id,
    boardName: BOARD.name,
    columnName: 'To do',
    done: false,
    dueAt: null,
    assigneeId: null,
    assigneeLabel: null,
    position: '1024',
    ...overrides,
  };
}

function event(
  overrides: Partial<DigestEvent> & Pick<DigestEvent, 'type' | 'payload'>,
): DigestEvent {
  return {
    boardId: BOARD.id,
    actorLabel: 'Hermes',
    createdAt: new Date('2026-11-25T18:00:00Z'),
    ...overrides,
  };
}

const CARDS: DigestCard[] = [
  card({ id: 'crd_digest', title: 'Wire the digest', columnName: 'Done', done: true }),
  card({ id: 'crd_drop', title: 'Fix the drop index', columnName: 'Done', done: true }),
  card({
    id: 'crd_drag',
    title: 'Keyboard drag',
    columnName: 'Doing',
    assigneeId: USER,
    assigneeLabel: 'Will',
    position: '2048',
    dueAt: new Date('2026-11-28T12:00:00Z'),
  }),
  card({ id: 'crd_mod', title: 'Moderation queue', columnName: 'Doing', position: '4096' }),
  card({
    id: 'crd_close',
    title: 'Close-out summary',
    columnName: 'Doing',
    dueAt: new Date('2026-11-24T12:00:00Z'),
    position: '1024',
  }),
  // Open, assigned to the account, untouched this window: the Assigned section.
  card({
    id: 'crd_review',
    title: 'Review the copy',
    assigneeId: USER,
    assigneeLabel: 'Will',
    position: '3072',
  }),
  card({ id: 'crd_templates', title: 'Board templates', dueAt: new Date('2026-12-02T12:00:00Z') }),
  card({ id: 'crd_stale', title: 'Stale idea', dueAt: new Date('2027-01-05T12:00:00Z') }),
  card({ id: 'crd_house', title: 'Housekeeping', dueAt: new Date('2026-12-10T12:00:00Z') }),
];

const EVENTS: DigestEvent[] = [
  event({
    type: 'card.completed',
    actorLabel: 'Hermes',
    payload: { card_id: 'crd_digest', title: 'Wire the digest' },
  }),
  event({
    type: 'card.completed',
    actorLabel: 'Will',
    payload: { card_id: 'crd_drop', title: 'Fix the drop index' },
  }),
  event({
    type: 'card.moved',
    actorLabel: 'Will',
    payload: { card_id: 'crd_drag', title: 'Keyboard drag', column_name: 'Doing' },
  }),
  event({
    type: 'card.moved',
    actorLabel: 'Hermes',
    payload: { card_id: 'crd_mod', title: 'Moderation queue', column_name: 'Doing' },
  }),
  // Moved to a column that is not "doing": not an In progress line.
  event({
    type: 'card.moved',
    actorLabel: 'Will',
    payload: { card_id: 'crd_close', title: 'Close-out summary', column_name: 'Waiting' },
  }),
  // Outside the window: a digest is about the days since the previous send.
  event({
    type: 'card.completed',
    actorLabel: 'Will',
    createdAt: new Date('2026-11-20T10:00:00Z'),
    payload: { card_id: 'crd_old', title: 'Ancient work' },
  }),
];

const GOLDEN = [
  'Klui · Retro S2 — Thursday 26 November',
  '',
  'Done (2)',
  '- Fix the drop index — Will',
  '- Wire the digest — Hermes',
  '',
  'In progress (2)',
  '- Keyboard drag — Will · Doing',
  '- Moderation queue — Hermes · Doing',
  '',
  'Overdue (1)',
  '- Close-out summary — due 24 Nov',
  '',
  'Assigned to you (1)',
  '- Review the copy — Will · To do',
  '',
  'Next',
  '1. Board templates — 2 Dec',
  '2. Housekeeping — 10 Dec',
  '3. Stale idea — 5 Jan',
].join('\n');

function digest(overrides: Partial<DigestInput> = {}) {
  return buildDigest({
    userId: USER,
    now: NOW,
    timezone: 'Europe/Paris',
    since: SINCE,
    events: EVENTS,
    cards: CARDS,
    ...overrides,
  });
}

describe('the digest is computed, and the computation is the contract', () => {
  it('produces the golden text for a fixed log, byte for byte', () => {
    expect(digest().text).toBe(GOLDEN);
    // Same input, same bytes: the property the optional LLM layer decorates.
    expect(digest().text).toBe(GOLDEN);
  });

  it('puts a card in one section only, first match winning', () => {
    const placements = digest().sections.flatMap((section) =>
      section.items.map((item) => `${item.title} in ${section.key}`),
    );
    expect(placements.filter((entry) => entry.startsWith('Wire the digest'))).toEqual([
      'Wire the digest in done',
    ]);
    expect(placements).not.toContain('Keyboard drag in assigned');
    expect(placements).not.toContain('Keyboard drag in next');
  });

  it('moves the header, not the content, when the timezone changes', () => {
    const paris = digest();
    const tokyo = digest({ timezone: 'Asia/Tokyo' });
    const body = (text: string): string => text.slice(text.indexOf('\n\n') + 2);
    expect(body(tokyo.text)).toBe(body(paris.text));
    expect(paris.header).toBe('Klui · Retro S2 — Thursday 26 November');
    expect(hourIn('Europe/Paris', NOW)).toBe(10);
    expect(hourIn('Asia/Tokyo', NOW)).toBe(18);
  });

  it('sends nothing when every section is empty', () => {
    const empty = digest({ events: [], cards: [] });
    expect(empty.empty).toBe(true);
    expect(empty.sections).toEqual([]);
    expect(empty.text).toBe('');
  });

  it('names the board only when there is more than one', () => {
    const multi = digest({
      events: [],
      cards: [
        card({ id: 'crd_a', title: 'A', boardId: OTHER.id, boardName: OTHER.name }),
        card({ id: 'crd_b', title: 'B', boardId: BOARD.id, boardName: BOARD.name }),
      ],
    });
    expect(multi.header).toBe('Klui · Launch, Retro S2 — Thursday 26 November');
    expect(multi.sections.flatMap((section) => section.items.map((item) => item.detail))).toEqual([
      'Launch · no due date',
      'Retro S2 · no due date',
    ]);
  });

  it('knows a day and a zone', () => {
    expect(isTimezone('Europe/Paris')).toBe(true);
    expect(isTimezone('Mars/Olympus')).toBe(false);
    expect(sameDayIn('Europe/Paris', NOW, new Date('2026-11-25T23:30:00Z'))).toBe(true);
    expect(sameDayIn('Asia/Tokyo', NOW, new Date('2026-11-26T16:00:00Z'))).toBe(false);
  });
});
