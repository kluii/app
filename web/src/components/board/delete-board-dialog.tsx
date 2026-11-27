// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deleting a board destroys it: the board, its columns, its cards and their
 * comments. That is a bigger promise than closing it, so the confirmation is
 * typed — an input that has to hold the board's exact name — rather than a
 * checkbox nobody reads.
 *
 * Closing a board still exists (`close-board-dialog.tsx`, the `/summary` route);
 * it simply stops being reachable from the board chrome.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { api } from '../../api/client';
import { failureMessage } from '../../lib/api-error';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { useToast } from '../ui/toast';

export function DeleteBoardDialog({
  boardId,
  boardName,
  open,
  onClose,
}: {
  boardId: string;
  boardName: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { notify } = useToast();
  const fieldId = useId();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: () => api.deleteBoard(boardId),
    onSuccess: async () => {
      notify(t('board.delete.done'));
      queryClient.removeQueries({ queryKey: queryKeys.board(boardId) });
      await navigate({ to: '/boards' });
    },
    onError: (cause) => {
      const message = failureMessage(cause);
      setError(message);
      notify(message, 'danger');
    },
  });

  const matches = typed === boardName;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('board.delete.title')}
      description={t('board.delete.body', { board: boardName })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.action.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={!matches}
            loading={remove.isPending}
            onClick={() => {
              setError(null);
              remove.mutate();
            }}
            data-testid="delete-board-confirm"
          >
            {t('board.delete.action')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (matches && !remove.isPending) remove.mutate();
        }}
      >
        <Field label={t('board.delete.inputLabel')} htmlFor={fieldId} hint={t('board.delete.hint')}>
          <Input
            id={fieldId}
            value={typed}
            autoFocus
            maxLength={80}
            onChange={(event) => setTyped(event.target.value)}
            data-testid="delete-board-name"
          />
        </Field>
        {error === null ? null : (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
