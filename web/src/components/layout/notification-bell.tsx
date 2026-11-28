// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Header notification bell (docs/features/digest.md §1, K5-04).
 *
 * Polls `/api/v1/me/notifications` every 15 seconds while signed in; never
 * piggybacks on a board SSE stream because notifications are account-scoped.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { NotificationItem } from '../../api/types';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';

const POLL_MS = 15_000;

function notificationLabel(item: NotificationItem): string {
  const title = typeof item.payload.title === 'string' ? item.payload.title : '';
  const excerpt = typeof item.payload.body_excerpt === 'string' ? item.payload.body_excerpt : '';
  const boardName = typeof item.payload.board_name === 'string' ? item.payload.board_name : '';
  const kindKey = `notifications.kind.${item.kind}`;
  switch (item.kind) {
    case 'assignment':
      return title ? t('notifications.item.assignment', { title }) : t(kindKey);
    case 'mention':
      return excerpt ? t('notifications.item.mention', { excerpt }) : t(kindKey);
    case 'due_soon':
      return title ? t('notifications.item.dueSoon', { title }) : t(kindKey);
    case 'moderation_pending':
      return title ? t('notifications.item.moderationPending', { title }) : t(kindKey);
    case 'invitation':
      return boardName ? t('notifications.item.invitation', { board: boardName }) : t(kindKey);
    case 'board_closed':
      return boardName ? t('notifications.item.boardClosed', { board: boardName }) : t(kindKey);
    default:
      return item.kind;
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: api.notifications,
    refetchInterval: POLL_MS,
    staleTime: 10_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const unread = query.data?.unread_count ?? 0;
  const items = query.data?.items ?? [];

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t('notifications.bellLabel')}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="notification-bell"
        className="relative"
      >
        <Bell size={16} strokeWidth={1.5} />
        {unread > 0 ? (
          <span
            data-testid="notification-unread-badge"
            className="absolute -right-0.5 -top-0.5 h-4 min-w-4 rounded-key bg-primary px-1 text-center font-mono text-mono-sm leading-4 tabular-nums text-primary-foreground"
          >
            {unread > 99 ? '99+' : String(unread)}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-label={t('notifications.title')}
          className="reveal-menu absolute right-0 top-11 z-50 w-80 rounded-sm border border-border-strong bg-surface-raised shadow-[var(--shadow-overlay)]"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-label font-medium text-ink">{t('notifications.title')}</span>
            {unread > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                {t('notifications.markAllRead')}
              </Button>
            ) : null}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-body-sm text-ink-muted">
                {t('notifications.empty')}
              </p>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-start justify-between gap-2 px-3 py-2 text-body-sm ${
                    item.read_at === null ? 'bg-surface-2' : ''
                  }`}
                >
                  <p className={item.read_at === null ? 'text-ink' : 'text-ink-muted'}>
                    {notificationLabel(item)}
                  </p>
                  {item.read_at === null ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => markRead.mutate(item.id)}
                      disabled={markRead.isPending}
                      aria-label={t('notifications.markRead')}
                      title={t('notifications.markRead')}
                    >
                      <Check size={14} strokeWidth={1.5} />
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
