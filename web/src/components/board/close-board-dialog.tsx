// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Closing is irreversible in 2.0 (D-22), so the dialog says so in words, names
 * the board, and refuses until the box is ticked. The note is the only
 * human-authored string in the summary and is quoted there, not paraphrased.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import { failureMessage } from '../../lib/api-error';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';

export function CloseBoardDialog({
  boardId,
  boardName,
  open,
  onClose,
  onClosed,
}: {
  boardId: string;
  boardName: string;
  open: boolean;
  onClose: () => void;
  onClosed: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = useMutation({
    mutationFn: () => api.closeBoard(boardId, note.trim() === '' ? null : note.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.summary(boardId) });
      setConfirmed(false);
      setNote('');
      setError(null);
      onClosed();
    },
    onError: (cause) => setError(failureMessage(cause)),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('board.close.title')}
      description={t('board.close.body', { board: boardName })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.action.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!confirmed}
            loading={close.isPending}
            onClick={() => close.mutate()}
            data-testid="close-board-confirm"
          >
            {t('board.close.action')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-start gap-2 text-body-sm text-ink">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            data-testid="close-board-ack"
          />
          <span>{t('board.close.acknowledge')}</span>
        </label>
        <label className="flex flex-col gap-1 text-body-sm text-ink">
          <span className="text-ink-muted">{t('board.close.note')}</span>
          <textarea
            className="min-h-20 rounded-sm border border-border bg-surface p-2 text-body-sm text-ink"
            value={note}
            maxLength={2000}
            onChange={(event) => setNote(event.target.value)}
            data-testid="close-board-note"
          />
        </label>
        {error === null ? null : (
          <p className="text-body-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
