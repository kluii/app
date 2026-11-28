// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { Card, Member } from '../../api/types';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { atUsername } from '../../lib/username';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Field } from '../ui/field';
import { Input, Select, Textarea } from '../ui/input';
import { errorMessage } from './card-display-modal';
import { TagEditor, draftToTags, tagsToDraft, type TagDraft } from './tag-editor';

/**
 * The editor is a separate modal, reached from Edit (docs/features/
 * board-interaction.md §2). Save is explicit, Esc closes without saving, and a
 * dirty draft asks before it is thrown away. A `409` names the conflict and
 * offers the two honest ways out: reload the card, or overwrite it deliberately.
 *
 * A deadline and an assignee belong to the same write: the server stores a day
 * at noon UTC, and a member is sent as `assignee` (a user id), never as the
 * free `assignee_label` a v1 import left behind. Those two are exclusive in the
 * API, so a legacy label is only replaced when somebody is actually picked.
 */
export function CardEditorModal({
  boardId,
  card,
  members,
  boardTags,
  onClose,
  onSaved,
}: {
  boardId: string;
  card: Card;
  members: Member[];
  /** Every tag name the board already uses, for the editor's datalist. */
  boardTags: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const ids = {
    title: useId(),
    description: useId(),
    tags: useId(),
    due: useId(),
    assignee: useId(),
  };
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? '');
  const [tags, setTags] = useState<TagDraft[]>(tagsToDraft(card.tags));
  const [due, setDue] = useState(cardDue(card));
  const [assignee, setAssignee] = useState(card.assignee?.id ?? '');
  const [confirming, setConfirming] = useState(false);
  const [conflict, setConflict] = useState(false);

  // A different card reuses the modal: never carry a draft across.
  useEffect(() => {
    setTitle(card.title);
    setDescription(card.description ?? '');
    setTags(tagsToDraft(card.tags));
    setDue(cardDue(card));
    setAssignee(card.assignee?.id ?? '');
    setConfirming(false);
    setConflict(false);
  }, [card.id]);

  const dueChanged = due !== cardDue(card);
  const assigneeChanged = assignee !== (card.assignee?.id ?? '');
  const saved =
    card.title === title.trim() &&
    (card.description ?? '') === description &&
    JSON.stringify(card.tags) === JSON.stringify(draftToTags(tags)) &&
    !dueChanged &&
    !assigneeChanged;
  const dirty = !saved;

  const update = useMutation({
    mutationFn: (overwrite: boolean) =>
      api.updateCard(card.id, {
        title: title.trim(),
        description: description.trim() === '' ? null : description,
        tags: draftToTags(tags),
        // Only what moved: re-sending an untouched day would file an edit the
        // reader never made, and would overwrite a legacy label with nothing.
        ...(dueChanged ? { due_at: due === '' ? null : `${due}T12:00:00.000Z` } : {}),
        ...(assigneeChanged ? { assignee: assignee === '' ? null : assignee } : {}),
        ...(overwrite ? {} : { expected_updated_at: card.updated_at }),
      }),
    onSuccess: async () => {
      // "Use on every card with this tag" is the explicit second action: the
      // board default is written, and this card keeps the same value so nothing
      // changes under the reader.
      const wide = tags.filter((tag) => tag.boardWide && tag.color !== null);
      if (wide.length > 0) {
        const current = await api.tagColors(boardId);
        const next = { ...current };
        for (const tag of wide) next[tag.name] = tag.color ?? '';
        await api.putTagColors(
          boardId,
          Object.fromEntries(Object.entries(next).filter(([, color]) => color !== '')),
        );
      }
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

        <Field label={t('board.tags.title')} htmlFor={ids.tags}>
          <div id={ids.tags}>
            <TagEditor
              tags={tags}
              boardTags={boardTags}
              onChange={setTags}
              disabled={update.isPending}
            />
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('board.card.dueDate')} htmlFor={ids.due}>
            <Input
              id={ids.due}
              type="date"
              value={due}
              onChange={(event) => setDue(event.target.value)}
            />
          </Field>

          {/* Nobody is a real choice, and the first one: an empty select would
              read as "unset" when it means "unassigned". */}
          <Field
            label={t('board.card.assignee')}
            htmlFor={ids.assignee}
            hint={
              card.assignee_label && !assigneeChanged
                ? t('board.card.assigneeKept', { label: card.assignee_label })
                : undefined
            }
          >
            <Select
              id={ids.assignee}
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            >
              <option value="">{t('board.card.nobody')}</option>
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {atUsername(member.username)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {conflict ? (
          <div role="alert" className="flex flex-col gap-2 rounded-sm border border-danger p-3">
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

/** The machine day of a card's deadline (`2026-03-12`): what a date input speaks. */
function cardDue(card: Card): string {
  return card.due_at === null ? '' : card.due_at.slice(0, 10);
}
