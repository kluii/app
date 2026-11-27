// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The digest, computed (ADR-0005, docs/features/digest.md §2).
 *
 * Pure on purpose: events and cards in, sections and text out. No clock beyond
 * the account's timezone, no I/O, no model. Two runs over the same input produce
 * the same bytes — that is what makes a golden test meaningful, and what lets the
 * optional LLM layer degrade to exactly this text.
 *
 * What each section reads:
 *
 * - Done and In progress read `events` since the account's previous send: what
 *   happened is the event log's question (D-23).
 * - Overdue, Assigned to you and Next read the open cards: they are about what
 *   *is* the case now, not about what changed.
 *
 * A card appears in at most one section; the first match wins, in that order.
 */
export type DigestCard = {
  id: string;
  boardId: string;
  boardName: string;
  columnName: string;
  title: string;
  done: boolean;
  dueAt: Date | null;
  assigneeId: string | null;
  assigneeLabel: string | null;
  /** Decimal as a string; ordering only. */
  position: string;
};

export type DigestEvent = {
  type: string;
  boardId: string | null;
  payload: Record<string, unknown>;
  actorLabel: string | null;
  createdAt: Date;
};

export type DigestInput = {
  userId: string;
  now: Date;
  timezone: string;
  /** The account's previous send; null means "everything we have". */
  since: Date | null;
  events: DigestEvent[];
  cards: DigestCard[];
};

export type DigestItem = { title: string; detail: string };
export type DigestSection = { key: string; title: string; items: DigestItem[] };

export type Digest = {
  empty: boolean;
  header: string;
  sections: DigestSection[];
  /** The message body: header, blank line, sections. Empty when `empty`. */
  text: string;
};

/** "Doing", "In progress", "WIP", "en cours" — the documented heuristic. */
const IN_PROGRESS = /doing|progress|en cours|wip/iu;

function dayIn(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(at);
}

function longDate(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: timezone,
  }).format(at);
}

function shortDate(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  }).format(at);
}

/** The hour a wall clock in `timezone` reads, 0..23. */
export function hourIn(timezone: string, at: Date): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).format(at);
  return Number(formatted);
}

/** Whether two instants fall on the same calendar day in `timezone`. */
export function sameDayIn(timezone: string, left: Date, right: Date): boolean {
  return dayIn(timezone, left) === dayIn(timezone, right);
}

/** A valid IANA zone name, checked by asking Intl to use it. */
export function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function cardTitleOf(event: DigestEvent): string | null {
  return stringOf(event.payload.title) ?? stringOf(event.payload.card_title);
}

function columnNameOf(event: DigestEvent): string | null {
  return stringOf(event.payload.column_name) ?? stringOf(event.payload.to_column_name);
}

function cardIdOf(event: DigestEvent): string | null {
  return stringOf(event.payload.card_id);
}

/** Deterministic: by title, then detail. "Next" keeps its own order. */
function sortItems(items: DigestItem[]): DigestItem[] {
  return [...items].sort(
    (left, right) =>
      left.title.localeCompare(right.title) || left.detail.localeCompare(right.detail),
  );
}

export function buildDigest(input: DigestInput): Digest {
  const { timezone, now, since, userId } = input;
  const cardsById = new Map(input.cards.map((card) => [card.id, card]));
  const boardNames = [...new Set(input.cards.map((card) => card.boardName))].sort();
  const multipleBoards = boardNames.length > 1;
  const seen = new Set<string>();

  /** `Board · Doing · Hermes`, with the board name only when it disambiguates. */
  const detailOf = (boardName: string | null, parts: (string | null)[]): string =>
    [multipleBoards ? boardName : null, ...parts]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · ');

  const inWindow = (event: DigestEvent): boolean =>
    since === null || event.createdAt.getTime() > since.getTime();

  // 1. Done — from the log, with who did it.
  const done: DigestItem[] = [];
  for (const event of input.events) {
    if (event.type !== 'card.completed' || !inWindow(event)) continue;
    const cardId = cardIdOf(event);
    const title = cardTitleOf(event);
    if (title === null) continue;
    if (cardId !== null) {
      if (seen.has(cardId)) continue;
      seen.add(cardId);
    }
    const card = cardId === null ? null : (cardsById.get(cardId) ?? null);
    done.push({ title, detail: detailOf(card?.boardName ?? null, [event.actorLabel]) });
  }

  // 2. In progress — moved into a "doing" column, or edited, since the last send.
  const inProgress: DigestItem[] = [];
  for (const event of input.events) {
    if (!inWindow(event) || event.type !== 'card.moved') continue;
    const column = columnNameOf(event);
    const cardId = cardIdOf(event);
    const title = cardTitleOf(event);
    if (column === null || !IN_PROGRESS.test(column) || title === null) continue;
    if (cardId !== null) {
      if (seen.has(cardId)) continue;
      seen.add(cardId);
    }
    const card = cardId === null ? null : (cardsById.get(cardId) ?? null);
    inProgress.push({
      title,
      detail: detailOf(card?.boardName ?? null, [event.actorLabel, column]),
    });
  }
  for (const event of input.events) {
    if (!inWindow(event) || event.type !== 'card.updated') continue;
    const cardId = cardIdOf(event);
    const title = cardTitleOf(event);
    if (title === null) continue;
    if (cardId !== null) {
      if (seen.has(cardId)) continue;
      seen.add(cardId);
    }
    const card = cardId === null ? null : (cardsById.get(cardId) ?? null);
    if (card?.done === true) continue;
    inProgress.push({ title, detail: detailOf(card?.boardName ?? null, [event.actorLabel]) });
  }

  // The rest read the open cards, never the log: due date, then column order.
  const open = input.cards
    .filter((card) => !card.done && !seen.has(card.id))
    .sort(
      (left, right) =>
        (left.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) -
          (right.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) ||
        Number(left.position) - Number(right.position) ||
        left.title.localeCompare(right.title),
    );

  // 3. Overdue — a due date in the past, still open.
  const overdue: DigestItem[] = [];
  for (const card of open) {
    if (card.dueAt === null || card.dueAt.getTime() >= now.getTime()) continue;
    seen.add(card.id);
    overdue.push({
      title: card.title,
      detail: detailOf(card.boardName, [`due ${shortDate(timezone, card.dueAt)}`]),
    });
  }

  // 4. Assigned to you — open, assigned to this account, not already listed.
  const assigned: DigestItem[] = [];
  for (const card of open) {
    if (seen.has(card.id) || card.assigneeId !== userId) continue;
    seen.add(card.id);
    assigned.push({
      title: card.title,
      detail: detailOf(card.boardName, [card.assigneeLabel, card.columnName]),
    });
  }

  // 5. Next — the three soonest, due date first, then column order.
  const next: DigestItem[] = [];
  for (const card of open) {
    if (next.length === 3 || seen.has(card.id)) continue;
    seen.add(card.id);
    next.push({
      title: card.title,
      detail: detailOf(card.boardName, [
        card.dueAt === null ? 'no due date' : shortDate(timezone, card.dueAt),
      ]),
    });
  }

  const sections: DigestSection[] = [
    { key: 'done', title: 'Done', items: sortItems(done) },
    { key: 'in_progress', title: 'In progress', items: sortItems(inProgress) },
    { key: 'overdue', title: 'Overdue', items: sortItems(overdue) },
    { key: 'assigned', title: 'Assigned to you', items: sortItems(assigned) },
    { key: 'next', title: 'Next', items: next },
  ].filter((section) => section.items.length > 0);

  const boards = boardNames.length === 0 ? 'no boards' : boardNames.join(', ');
  const header = `Klui · ${boards} — ${longDate(timezone, now)}`;
  const text =
    sections.length === 0
      ? ''
      : [header, ...sections.map((section) => renderSection(section))].join('\n\n');

  return { empty: sections.length === 0, header, sections, text };
}

function renderSection(section: DigestSection): string {
  const head =
    section.key === 'next' ? section.title : `${section.title} (${section.items.length})`;
  const lines = section.items.map((item, index) => {
    const suffix = item.detail === '' ? '' : ` — ${item.detail}`;
    return section.key === 'next'
      ? `${index + 1}. ${item.title}${suffix}`
      : `- ${item.title}${suffix}`;
  });
  return [head, ...lines].join('\n');
}
