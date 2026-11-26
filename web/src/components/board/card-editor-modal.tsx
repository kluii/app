// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { Card } from '../../api/types';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Field } from '../ui/field';
import { Input, Textarea } from '../ui/input';
import { errorMessage } from './card-display-modal';

/**
 * The editor is a separate modal, reached from Edit (docs/features/
 * board-interaction.md §2). Save is explicit, Esc closes without saving, and a
 * dirty draft asks before it is thrown away. A `409` names the conflict and
 * offers the two honest ways out: reload the card, or overwrite it deliberately.
 */
export function CardEditorModal({
  boardId,
  card,
  onClose,
  onSaved,
}: {
  boardId: string;
  card: Card;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const ids = { title: useId(), description: useId() };
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? '');
  const [confirming, setConfirming] = useState(false);
  const [conflict, setConflict] = useState(false);

  // A different card reuses the modal: never carry a draft across.
  useEffect(() => {
    setTitle(card.title);
    setDescription(card.description ?? '');
    setConfirming(false);
    setConflict(false);
  }, [card.id]);

  const saved = card.title === title.trim() && (card.description ?? '') === description;
  const dirty = !saved;

  const update = useMutation({
    mutationFn: (overwrite: boolean) =>
      api.updateCard(card.id, {
        title: title.trim(),
        description: description.trim() === '' ? null : description,
        ...(overwrite ? {} : { expected_updated_at: card.updated_at }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
      onSaved();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'conflict') setConflict(true);
    },
  });

  const requestClose = () => {
    if (dirty) setConfirming(true);
    else onClose();
  };

  if (confirming) {
    return (
      <Dialog
        open
        onClose={() => setConfirming(false)}
        title={t('board.card.unsaved')}
        description={t('board.card.unsavedBody')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('board.card.keepEditing')}
            </Button>
            <Button variant="danger" onClick={onClose}>
              {t('board.card.discard')}
            </Button>
          </>
        }
      >
        <p className="font-mono text-mono-sm text-ink-subtle">{card.title}</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={requestClose}
      title={t('board.card.edit')}
      footer={
        <>
          <Button variant="ghost" onClick={requestClose}>
            {t('common.action.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={update.isPending}
            disabled={title.trim() === '' || !dirty}
            onClick={() => update.mutate(false)}
          >
            {t('common.action.save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() !== '') update.mutate(false);
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            if (title.trim() !== '') update.mutate(false);
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
            rows={5}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        {conflict ? (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-sm border border-danger p-2.5"
          >
            <p className="text-body-sm text-ink">{t('board.card.conflict')}</p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
                  onClose();
                }}
              >
                {t('board.card.reload')}
              </Button>
              <Button variant="danger" size="sm" onClick={() => update.mutate(true)}>
                {t('board.card.overwrite')}
              </Button>
            </div>
          </div>
        ) : update.isError ? (
          <p role="alert" className="text-body-sm text-danger">
            {errorMessage(update.error)}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
