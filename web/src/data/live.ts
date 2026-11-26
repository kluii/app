// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The board stream (docs/features/realtime.md §2.3).
 *
 * One `EventSource` per board view. The browser reconnects on its own, but it
 * cannot be trusted to keep our cursor or our backoff policy across a killed
 * connection, so this client owns the lifecycle: 1, 2, 4, 8, 16, 30 s with
 * ±20 % jitter, and it passes `last_event_id` itself because `EventSource`
 * cannot set a header.
 */
export type LiveStatus = 'connecting' | 'open' | 'closed';

export type StreamEvent = { type: string; data: unknown; lastEventId: string };

type Source = {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  close: () => void;
};

export type StreamFactory = (url: string) => Source;

export type StreamHandle = { close: () => void };

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export function backoffDelay(attempt: number): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 30000;
  const jitter = base * 0.2;
  return Math.round(base - jitter + Math.random() * jitter * 2);
}

export function streamUrl(boardIds: string[], lastEventId: string | null): string {
  const params = boardIds.map((id) => `board=${encodeURIComponent(id)}`);
  if (lastEventId) params.push(`last_event_id=${encodeURIComponent(lastEventId)}`);
  return `/api/v1/stream?${params.join('&')}`;
}

function parseFrame(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function connectBoardStream(input: {
  boardIds: string[];
  onEvent: (event: StreamEvent) => void;
  onStatus: (status: LiveStatus) => void;
  /** Every reconnect refetches: replay closes small gaps, it is not the truth. */
  onReconnect: () => void;
  factory?: StreamFactory;
}): StreamHandle {
  const factory: StreamFactory =
    input.factory ?? ((url) => new EventSource(url, { withCredentials: true }) as Source);

  let current: Source | null = null;
  let attempt = 0;
  let lastEventId: string | null = null;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let connected = false;

  const open = (): void => {
    if (closed) return;
    input.onStatus('connecting');
    const source = factory(streamUrl(input.boardIds, lastEventId));
    current = source;

    source.addEventListener('open', () => {
      attempt = 0;
      input.onStatus('open');
      if (connected) input.onReconnect();
      connected = true;
    });

    source.addEventListener('resync', () => {
      input.onEvent({ type: 'resync', data: null, lastEventId: lastEventId ?? '' });
    });

    for (const type of [
      'card.created',
      'card.updated',
      'card.moved',
      'card.deleted',
      'column.created',
      'column.updated',
      'column.deleted',
      'board.updated',
      'board.closed',
      'comment.created',
      'member.added',
      'member.updated',
      'member.removed',
      'import.progress',
      'pending.created',
    ]) {
      source.addEventListener(type, (raw) => {
        const message = raw as MessageEvent<string> & { lastEventId?: string };
        if (message.lastEventId) lastEventId = message.lastEventId;
        const data: unknown = parseFrame(message.data);
        input.onEvent({ type, data, lastEventId: lastEventId ?? '' });
      });
    }

    source.addEventListener('error', () => {
      // `EventSource` retries by itself, but a killed stream (a proxy, a
      // redeploy) needs our backoff and our cursor.
      source.close();
      if (current === source) current = null;
      if (closed) return;
      input.onStatus('closed');
      const delay = backoffDelay(attempt);
      attempt += 1;
      timer = setTimeout(open, delay);
    });
  };

  open();

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      current?.close();
      current = null;
      input.onStatus('closed');
    },
  };
}
