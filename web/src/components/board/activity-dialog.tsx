// SPDX-License-Identifier: AGPL-3.0-only
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { EventDto } from '../../api/types';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';

/** Activity is a projection of the event log, newest first, cursor paginated. */
export function ActivityDialog({
  boardId,
  open,
  onClose,
}: {
  boardId: string;
  open: boolean;
  onClose: () => void;
}) {
  const activity = useInfiniteQuery({
    queryKey: queryKeys.activity(boardId),
    queryFn: ({ pageParam }) => api.activity(boardId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: open,
  });

  const events = activity.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Dialog open={open} onClose={onClose} title={t('board.activity.title')}>
      {activity.isPending ? (
        <p className="text-body-sm text-ink-subtle">{t('common.label.loading')}</p>
      ) : events.length === 0 ? (
        <p className="text-body-sm text-ink-subtle">{t('board.activity.empty')}</p>
      ) : (
        <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {events.map((event) => (
            <li key={event.id} className="flex items-baseline justify-between gap-3">
              <span className="text-body-sm text-ink-muted">{describe(event)}</span>
              <time
                className="shrink-0 font-mono text-mono-sm text-ink-subtle"
                dateTime={event.created_at}
              >
                {formatTime(event.created_at)}
              </time>
            </li>
          ))}
        </ul>
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
