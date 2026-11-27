// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SSE hub (D-29, docs/features/realtime.md).
 *
 * Publishing happens **after commit**, never inside it: an echo for a
 * rolled-back transaction is a phantom card the client keeps until reload.
 */
export type HubEvent = {
  id: string;
  boardId: string;
  type: string;
  entity: string;
  action: string;
  payload: Record<string, unknown>;
  actorLabel: string;
  at: string;
};

export type Subscriber = {
  boards: Set<string>;
  send: (event: HubEvent) => void;
  close: () => void;
};

/**
 * Replay is deliberately three-valued: `none` means "nothing to say", `events`
 * closes a small gap, and `resync` says the id is older than the buffer, so the
 * client must refetch instead of guessing (docs/features/realtime.md §1).
 */
export type ReplayResult =
  { kind: 'none' } | { kind: 'events'; events: HubEvent[] } | { kind: 'resync' };

export type Hub = {
  subscribe: (subscriber: Subscriber) => () => void;
  publish: (event: HubEvent) => void;
  replay: (boardId: string, lastEventId: string | null) => ReplayResult;
  size: () => number;
  /** Tell every open stream the process is going down, then forget it. */
  closeAll: () => void;
};

const RING_LIMIT = 1000;
const RING_WINDOW_MS = 5 * 60 * 1000;

export function createHub(): Hub {
  const subscribers = new Set<Subscriber>();
  const ring: HubEvent[] = [];
  let counter = 0;

  const nextId = (): string => {
    counter = (counter + 1) % 1_000_000;
    return `${String(Date.now()).padStart(16, '0')}${String(counter).padStart(6, '0')}`;
  };

  return {
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    publish(event) {
      const withId: HubEvent = { ...event, id: event.id || nextId() };
      ring.push(withId);
      const cutoff = Date.now() - RING_WINDOW_MS;
      while (ring.length > RING_LIMIT || (ring[0] && Date.parse(ring[0].at) < cutoff)) {
        ring.shift();
      }
      for (const subscriber of subscribers) {
        if (subscriber.boards.has(withId.boardId)) subscriber.send(withId);
      }
    },
    replay(boardId, lastEventId) {
      if (!lastEventId) return { kind: 'none' };
      const index = ring.findIndex((event) => event.id === lastEventId);
      if (index === -1) return { kind: 'resync' };
      return {
        kind: 'events',
        events: ring.slice(index + 1).filter((event) => event.boardId === boardId),
      };
    },
    size() {
      return subscribers.size;
    },
    closeAll() {
      for (const subscriber of subscribers) subscriber.close();
      subscribers.clear();
    },
  };
}

export function commitEvent(
  hub: Hub | undefined,
  input: {
    boardId: string;
    type: string;
    entity: string;
    action: string;
    payload: Record<string, unknown>;
    actorLabel: string;
  },
): void {
  if (!hub) return;
  hub.publish({ id: '', at: new Date().toISOString(), ...input });
}
