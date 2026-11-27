// SPDX-License-Identifier: AGPL-3.0-only
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import type { EventDto } from '../../api/types';
import { getLocale, t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';

const FILTERS = ['all', 'user', 'agent', 'anon'] as const;
type ActorFilter = (typeof FILTERS)[number];

/** A day heading rather than a timestamp on every row, which is most of the noise. */
function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function dayLabel(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${iso}T12:00:00.000Z`));
}

/** Activity is a projection of the event log, newest first, cursor paginated. */
export function ActivityDialog({
  boardId,
  open,
  onClose,
  onOpenCard,
}: {
  boardId: string;
  open: boolean;
  onClose: () => void;
  onOpenCard?: (cardId: string) => void;
}) {
  const [filter, setFilter] = useState<ActorFilter>('all');
  const locale = getLocale();
  const activity = useInfiniteQuery({
    // The filter is part of the key: a cached "everyone" page must never be
    // shown under an "agents only" heading.
    queryKey: queryKeys.activity(boardId, filter),
    queryFn: ({ pageParam }) => api.activity(boardId, pageParam, filter),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: open,
  });

  const events = activity.data?.pages.flatMap((page) => page.items) ?? [];
  const days: { key: string; events: EventDto[] }[] = [];
  for (const event of events) {
    const key = dayKey(event.created_at);
    const last = days[days.length - 1];
    if (last && last.key === key) last.events.push(event);
    else days.push({ key, events: [event] });
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('board.activity.title')}>
      <div
        className="mb-3 flex flex-wrap gap-1.5"
        role="group"
        aria-label={t('board.activity.filter.all')}
      >
        {FILTERS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? 'primary' : 'secondary'}
            onClick={() => setFilter(value)}
            data-testid={`activity-filter-${value}`}
            aria-pressed={filter === value}
          >
            {t(`board.activity.filter.${value}`)}
          </Button>
        ))}
      </div>
      {activity.isPending ? (
        <p className="text-body-sm text-ink-subtle">{t('common.label.loading')}</p>
      ) : events.length === 0 ? (
        <p className="text-body-sm text-ink-subtle" data-testid="activity-empty">
          {t('board.activity.empty')}
        </p>
      ) : (
        <div className="flex max-h-96 flex-col gap-3 overflow-y-auto" data-testid="activity-list">
          {days.map((day) => (
            <section key={day.key}>
              <h3 className="sticky top-0 bg-surface py-1 font-mono text-mono-sm text-ink-subtle">
                {dayLabel(day.key, locale)}
              </h3>
              <ul className="flex flex-col gap-2">
                {day.events.map((event) => {
                  const cardId = (event.payload as { card_id?: string }).card_id;
                  return (
                    <li key={event.id} className="flex items-baseline justify-between gap-3">
                      {onOpenCard && cardId ? (
                        <button
                          type="button"
                          className="min-w-0 truncate text-left text-body-sm text-ink-muted underline-offset-2 hover:underline"
                          onClick={() => onOpenCard(cardId)}
                          title={t('board.activity.openCard')}
                        >
                          {describe(event)}
                        </button>
                      ) : (
                        <span className="min-w-0 truncate text-body-sm text-ink-muted">
                          {describe(event)}
                        </span>
                      )}
                      <time
                        className="shrink-0 font-mono text-mono-sm text-ink-subtle"
                        dateTime={event.created_at}
                      >
                        {formatTime(event.created_at)}
                      </time>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {activity.hasNextPage ? (
        <div className="mt-3">
          <Button
            size="sm"
            variant="ghost"
            loading={activity.isFetchingNextPage}
            onClick={() => void activity.fetchNextPage()}
          >
            {t('board.activity.loadMore')}
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}

function describe(event: EventDto): string {
  const payload = event.payload as {
    title?: string;
    name?: string;
  };
  const actor = event.actor_label ?? (event.actor_kind === 'agent' ? 'agent' : 'someone');
  const key = `event.${event.type}`;
  const translated = t(key, { actor, title: payload.title ?? '', name: payload.name ?? '' });
  return translated === key ? `${actor} ${event.type}` : translated;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
