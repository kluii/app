// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The close-out summary (docs/features/close-out.md).
 *
 * Derived from the event log and the cards as they stand at close, computed
 * once, stored on the board, and never regenerated on read: a summary that
 * changes when the retention job trims an old event is not a record of
 * anything.
 *
 * Two invariants the tests hold:
 *
 * - **Done and Remaining partition the cards.** Every card at close appears in
 *   exactly one section, and the counts add up to the board's card count.
 * - **No invented attribution.** An anonymous actor appears under their chosen
 *   label with `(anonymous)`, an agent is marked as one, and neither is
 *   promoted to a member.
 */
import type { Card, Column, Event, User } from '@prisma/client';
import { toEnumName } from '../lib/events.js';

export type SummaryPerson = {
  label: string;
  kind: 'user' | 'agent' | 'anon';
  events: number;
};

export type SummaryCard = {
  title: string;
  assignee: string | null;
  date: string | null;
};

export type CloseSummary = {
  id: string;
  board: { name: string; owner: string };
  closed_at: string;
  /** The first and last event of the board, ISO dates, or null on an empty board. */
  first_event_at: string | null;
  last_event_at: string | null;
  span_days: number;
  counts: {
    cards: number;
    done: number;
    columns: number;
    members: number;
    agents: number;
  };
  done: SummaryCard[];
  remaining: { column: string; cards: SummaryCard[] }[];
  people: SummaryPerson[];
  /** Events per week as block bars; empty when the board lived under a week. */
  rhythm: string;
  rhythm_counts: number[];
  note: string | null;
};

export type SummaryInput = {
  id: string;
  board: { name: string; owner: string; created_at: Date };
  closedAt: Date;
  note: string | null;
  columns: Column[];
  cards: (Card & { tags: { name: string }[] })[];
  events: Event[];
  users: Pick<User, 'id' | 'username'>[];
};

const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function day(iso: Date): string {
  return iso.toISOString();
}

function lastEvent(events: Event[], type: string, cardId: string): Event | null {
  let found: Event | null = null;
  for (const event of events) {
    if (toEnumName(event.type as never) !== type) continue;
    if ((event.payload as { card_id?: string }).card_id !== cardId) continue;
    if (found === null || event.created_at > found.created_at) found = event;
  }
  return found;
}

function peopleFrom(events: Event[], users: Map<string, string>): SummaryPerson[] {
  const counted = new Map<string, SummaryPerson>();
  for (const event of events) {
    let key: string;
    let label: string;
    let kind: SummaryPerson['kind'];
    if (event.actor_user_id !== null) {
      const username = users.get(event.actor_user_id) ?? 'former member';
      kind = event.actor_kind === 'agent' ? 'agent' : 'user';
      label = kind === 'agent' ? `${username} (agent)` : username;
      key = `${kind}:${event.actor_user_id}`;
    } else if (event.actor_kind === 'anon') {
      kind = 'anon';
      label = `${event.actor_label ?? 'anonymous'} (anonymous)`;
      key = `anon:${event.actor_anon_id ?? event.actor_label ?? 'anonymous'}`;
    } else if (event.actor_kind === 'link') {
      kind = 'anon';
      label = 'link (anonymous)';
      key = 'link';
    } else {
      continue;
    }
    const entry = counted.get(key) ?? { label, kind, events: 0 };
    entry.events += 1;
    counted.set(key, entry);
  }
  return [...counted.values()].sort(
    (left, right) => right.events - left.events || (left.label < right.label ? -1 : 1),
  );
}

/** Weekly buckets from the first event to the close, as bars normalised to the max. */
function rhythmFrom(events: Event[], closedAt: Date): { bars: string; counts: number[] } {
  if (events.length === 0) return { bars: '', counts: [] };
  const times = events.map((event) => event.created_at.getTime());
  const first = Math.min(...times);
  const spanDays = Math.max(0, (closedAt.getTime() - first) / 86_400_000);
  if (spanDays < 7) return { bars: '', counts: [] };

  const weeks = Math.ceil(spanDays / 7);
  const counts = Array.from({ length: weeks }, () => 0);
  for (const time of times) {
    const index = Math.min(weeks - 1, Math.floor((time - first) / (7 * 86_400_000)));
    counts[index] = (counts[index] ?? 0) + 1;
  }
  const max = Math.max(...counts, 1);
  const bars = counts
    .map(
      (count) =>
        BARS[Math.min(BARS.length - 1, Math.round((count / max) * (BARS.length - 1)))] ?? '▁',
    )
    .join('');
  return { bars, counts };
}

export function buildSummary(input: SummaryInput): CloseSummary {
  const users = new Map(input.users.map((user) => [user.id, user.username]));
  const columnName = new Map(input.columns.map((column) => [column.id, column.name]));
  const assigneeName = (card: Card): string | null =>
    card.assignee_id === null
      ? card.assignee_label
      : (users.get(card.assignee_id) ?? card.assignee_label ?? 'former member');

  const done: SummaryCard[] = [];
  const remainingByColumn = new Map<string, SummaryCard[]>();
  let doneCount = 0;
  for (const card of [...input.cards].sort((left, right) => {
    const columnOrder =
      (input.columns.findIndex((column) => column.id === left.column_id) ?? 0) -
      (input.columns.findIndex((column) => column.id === right.column_id) ?? 0);
    if (columnOrder !== 0) return columnOrder;
    return left.position.toString() < right.position.toString() ? -1 : 1;
  })) {
    if (card.done) {
      doneCount += 1;
      const completed = lastEvent(input.events, 'card.completed', card.id);
      done.push({
        title: card.title,
        assignee: assigneeName(card),
        date: day(completed?.created_at ?? card.created_at).slice(0, 10),
      });
      continue;
    }
    const list = remainingByColumn.get(card.column_id) ?? [];
    list.push({ title: card.title, assignee: assigneeName(card), date: null });
    remainingByColumn.set(card.column_id, list);
  }

  const first = input.events.reduce<Event | null>(
    (found, event) => (found === null || event.created_at < found.created_at ? event : found),
    null,
  );
  const last = input.events.reduce<Event | null>(
    (found, event) => (found === null || event.created_at > found.created_at ? event : found),
    null,
  );
  const people = peopleFrom(input.events, users);
  const rhythm = rhythmFrom(input.events, input.closedAt);
  const spanDays = Math.max(
    0,
    Math.round(
      ((last?.created_at ?? input.closedAt).getTime() -
        (first?.created_at ?? input.closedAt).getTime()) /
        86_400_000,
    ),
  );

  return {
    id: input.id,
    board: { name: input.board.name, owner: input.board.owner },
    closed_at: input.closedAt.toISOString(),
    first_event_at: first === null ? null : first.created_at.toISOString(),
    last_event_at: last === null ? null : last.created_at.toISOString(),
    span_days: spanDays,
    counts: {
      cards: input.cards.length,
      done: doneCount,
      columns: input.columns.length,
      members: new Set(input.users.map((user) => user.id)).size,
      agents: people.filter((person) => person.kind === 'agent').length,
    },
    done,
    remaining: [...remainingByColumn.entries()]
      .map(([columnId, cards]) => ({
        column: columnName.get(columnId) ?? 'Deleted column',
        cards,
      }))
      .sort((left, right) => (left.column < right.column ? -1 : 1)),
    people,
    rhythm: rhythm.bars,
    rhythm_counts: rhythm.counts,
    note: input.note,
  };
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

function longDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/** docs/features/close-out.md §3, byte-stable for a given summary. */
export function summaryToMarkdown(summary: CloseSummary): string {
  const lines: string[] = [];
  lines.push(`# ${summary.board.name} — closed ${longDate(summary.closed_at)}`);
  lines.push('');
  lines.push(
    `${String(summary.counts.done)} of ${String(summary.counts.cards)} cards done in ${String(summary.span_days)} days · ${String(summary.counts.columns)} columns · ${String(summary.counts.members)} members · ${String(summary.counts.agents)} agents`,
  );
  lines.push('');

  lines.push('## Done');
  if (summary.done.length === 0) lines.push('- Nothing was marked done.');
  for (const card of summary.done) {
    lines.push(
      `- ${card.title}${card.assignee === null ? '' : ` — ${card.assignee}`}${card.date === null ? '' : ` — ${formatDate(card.date)}`}`,
    );
  }
  lines.push('');

  lines.push('## Remaining');
  if (summary.remaining.length === 0) lines.push('- Nothing was left open.');
  for (const group of summary.remaining) {
    lines.push(`### ${group.column}`);
    for (const card of group.cards) {
      lines.push(`- ${card.title} — ${card.assignee ?? 'unassigned'}`);
    }
  }
  lines.push('');

  lines.push('## People');
  if (summary.people.length === 0) lines.push('- Nobody did anything yet.');
  for (const person of summary.people) {
    lines.push(`- ${person.label} — ${String(person.events)} events`);
  }
  lines.push('');

  if (summary.rhythm !== '') {
    lines.push('## Rhythm');
    lines.push('');
    lines.push(summary.rhythm);
    lines.push('');
  }

  if (summary.note !== null) {
    lines.push('## Note');
    lines.push(summary.note);
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
