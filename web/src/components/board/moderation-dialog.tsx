// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The moderation queue (K3-04): what a moderated board swallowed, and the two
 * decisions an owner or admin can take. Approval is the only path a pending
 * write has to becoming a card, so this is the screen that makes `moderated`
 * usable rather than a black hole.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import type { Column, PendingCard } from '../../api/types';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';

export function ModerationButton({ boardId, count }: { boardId: string; count: number }) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        data-testid="open-moderation"
      >
        {t('board.moderation.waiting', { count })}
      </Button>
      <ModerationDialog boardId={boardId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function ModerationDialog({
  boardId,
  open,
  onClose,
}: {
  boardId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const pending = useQuery({
    queryKey: queryKeys.pending(boardId),
    queryFn: () => api.pending(boardId),
    enabled: open,
  });
  const board = useQuery({
    queryKey: queryKeys.board(boardId),
    queryFn: () => api.boardState(boardId),
    enabled: open,
  });
  const decide = useMutation({
    mutationFn: async (input: { id: string; action: 'approve' | 'reject' }): Promise<void> => {
      if (input.action === 'approve') await api.approvePending(boardId, input.id);
      else await api.rejectPending(boardId, input.id);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.pending(boardId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) }),
      ]);
    },
  });

  const items: PendingCard[] = pending.data?.items ?? [];
  const columns: Column[] = board.data?.columns ?? [];

  return (
    <Dialog open={open} onClose={onClose} title={t('board.moderation.title')}>
      {pending.isPending ? (
        <p className="text-body-sm text-ink-subtle">{t('common.label.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-body-sm text-ink-muted">{t('board.moderation.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-label text-ink">{item.title}</p>
                <span className="font-mono text-mono-sm text-ink-subtle">
                  {columns.find((column) => column.id === item.column_id)?.name ?? ''}
                </span>
              </div>
              <p className="text-body-sm text-ink-muted">
                {t('board.moderation.author', { label: item.actor_label })}
              </p>
              <div className="mt-1 flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  loading={decide.isPending}
                  onClick={() => decide.mutate({ id: item.id, action: 'approve' })}
                >
                  {t('board.moderation.approve')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={decide.isPending}
                  onClick={() => decide.mutate({ id: item.id, action: 'reject' })}
                >
                  {t('board.moderation.reject')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
