// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { Card, Column } from '../../api/types';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Field } from '../ui/field';
import { Input, Textarea } from '../ui/input';

/**
 * One dialog for both jobs: create a card in a column, or read and edit an
 * existing one. Save is explicit; Esc closes without saving (K2-07 splits read
 * from edit; the fields are already the same shape).
 */
export function CardDialog({
  boardId,
  columns,
  mode,
  card,
  columnId,
  onClose,
}: {
  boardId: string;
  columns: Column[];
  mode: 'create' | 'edit' | null;
  card: Card | null;
  columnId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(card?.title ?? '');
    setDescription(card?.description ?? '');
    setError(null);
  }, [card, mode]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.activity(boardId) });
  };

  const create = useMutation({
    mutationFn: () =>
      api.createCard(boardId, {
        column: columnId ?? '',
        title: title.trim(),
        ...(description.trim() === '' ? {} : { description }),
      }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
    onError: (caught) => setError(messageFor(caught)),
  });

  const update = useMutation({
    mutationFn: () =>
      api.updateCard(card?.id ?? '', {
        title: title.trim(),
        description: description.trim() === '' ? null : description,
        expected_updated_at: card?.updated_at,
      }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
    onError: (caught) => setError(messageFor(caught)),
  });

  const toggleDone = useMutation({
    mutationFn: (done: boolean) => api.updateCard(card?.id ?? '', { done }),
    onSuccess: refresh,
    onError: (caught) => setError(messageFor(caught)),
  });

  const move = useMutation({
    mutationFn: (target: string) => api.moveCard(card?.id ?? '', { column: target }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
    onError: (caught) => setError(messageFor(caught)),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteCard(card?.id ?? ''),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
    onError: (caught) => setError(messageFor(caught)),
  });

  const pending =
    create.isPending ||
    update.isPending ||
    toggleDone.isPending ||
    move.isPending ||
    remove.isPending;

  return (
    <Dialog
      open={mode !== null}
      onClose={onClose}
      title={mode === 'create' ? t('board.card.create') : (card?.title ?? '')}
      footer={
        mode === 'create' ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('common.action.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={create.isPending}
              disabled={title.trim() === ''}
              onClick={() => create.mutate()}
            >
              {t('board.card.create')}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              className="mr-auto text-danger hover:text-danger"
              loading={remove.isPending}
              onClick={() => {
                if (card && window.confirm(t('board.card.deleteConfirm', { title: card.title }))) {
                  remove.mutate();
                }
              }}
            >
              {t('common.action.delete')}
            </Button>
            <Button
              variant="ghost"
              loading={toggleDone.isPending}
              onClick={() => toggleDone.mutate(!(card?.done ?? false))}
            >
              {card?.done ? t('board.card.reopen') : t('board.card.done')}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t('common.action.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={update.isPending}
              disabled={title.trim() === ''}
              onClick={() => update.mutate()}
            >
              {t('common.action.save')}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('board.card.title')} htmlFor="card-title" error={error}>
          <Input
            id="card-title"
            value={title}
            maxLength={200}
            autoFocus={mode === 'create'}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label={t('board.card.description')} htmlFor="card-description">
          <Textarea
            id="card-description"
            value={description}
            maxLength={10_000}
            rows={5}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        {mode === 'edit' ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {columns
              .filter((column) => column.id !== card?.column_id)
              .map((column) => (
                <Button
                  key={column.id}
                  size="sm"
                  variant="secondary"
                  loading={move.isPending && move.variables === column.id}
                  onClick={() => move.mutate(column.id)}
                >
                  {t('board.card.moveTo', { column: column.name })}
                </Button>
              ))}
          </div>
        ) : null}

        {pending ? <span className="sr-only">{t('common.label.loading')}</span> : null}
      </div>
    </Dialog>
  );
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'conflict') return error.message;
    if (error.code === 'board_closed') return t('board.error.notFound');
  }
  return t('common.error.generic');
}
