// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api } from '../../api/client';
import type { Column } from '../../api/types';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Field } from '../ui/field';
import { Input, Textarea } from '../ui/input';
import { errorMessage } from './card-display-modal';

/**
 * Creation is its own modal (docs/features/board-interaction.md §2): the title
 * is focused because the actor arrived to type, `Cmd/Ctrl+Enter` saves and Esc
 * cancels. The column is preselected by the affordance that opened it.
 */
export function CardCreateModal({
  boardId,
  column,
  onClose,
}: {
  boardId: string;
  column: Column;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const ids = { title: useId(), description: useId() };
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.createCard(boardId, {
        column: column.id,
        title: title.trim(),
        ...(description.trim() === '' ? {} : { description }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.activity(boardId) });
      onClose();
    },
  });

  const submit = () => {
    if (title.trim() === '' || create.isPending) return;
    create.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('board.card.create')}
      description={t('board.card.createIn', { column: column.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.action.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={title.trim() === ''}
            onClick={submit}
          >
            {t('board.card.create')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
      >
        <Field label={t('board.card.title')} htmlFor={ids.title}>
          <Input
            id={ids.title}
            value={title}
            maxLength={200}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label={t('board.card.description')} htmlFor={ids.description}>
          <Textarea
            id={ids.description}
            value={description}
            maxLength={10_000}
            rows={4}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        {create.isError ? (
          <p role="alert" className="text-body-sm text-danger">
            {errorMessage(create.error)}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
