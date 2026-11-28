// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api } from '../../api/client';
import type { BoardState, Column } from '../../api/types';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Field } from '../ui/field';
import { Input, Select, Textarea } from '../ui/input';
import { errorMessage } from './card-display-modal';
import { TagEditor, boardTagNames, draftToTags, type TagDraft } from './tag-editor';

/**
 * Creation is its own modal (docs/features/board-interaction.md §2): the title
 * is focused because the actor arrived to type, `Cmd/Ctrl+Enter` saves and Esc
 * cancels. The column is preselected by the affordance that opened it.
 *
 * A card can be born complete: the endpoint already accepts tags, a deadline and
 * an assignee, so asking for them later was a second trip for no reason. What is
 * left empty is not sent at all — no `undefined`, no empty string.
 */
export function CardCreateModal({
  boardId,
  column,
  boardState,
  onClose,
}: {
  boardId: string;
  column: Column;
  boardState: BoardState;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const ids = {
    title: useId(),
    description: useId(),
    due: useId(),
    assignee: useId(),
    tags: useId(),
  };
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState('');
  const [tags, setTags] = useState<TagDraft[]>([]);

  /**
   * A tag the board already uses everywhere carries its colour with it: the
   * board default is what the editor writes when "use on every card" is ticked,
   * and a new card should not be the one place it is missing.
   */
  const tagColors = useQuery({
    queryKey: queryKeys.tagColors(boardId),
    queryFn: () => api.tagColors(boardId),
    staleTime: 60_000,
  });

  const changeTags = (next: TagDraft[]): void => {
    const defaults = tagColors.data ?? {};
    setTags(
      next.map((tag) =>
        // The board default fills a tag the card did not have yet; a tag the
        // actor explicitly cleared ("None") keeps its `color: null`.
        tag.color === null &&
        defaults[tag.name] !== undefined &&
        !tags.some((existing) => existing.name === tag.name)
          ? { ...tag, color: defaults[tag.name] ?? null }
          : tag,
      ),
    );
  };

  const create = useMutation({
    mutationFn: () =>
      api.createCard(boardId, {
        column: column.id,
        title: title.trim(),
        ...(description.trim() === '' ? {} : { description }),
        ...(tags.length === 0 ? {} : { tags: draftToTags(tags) }),
        ...(due === '' ? {} : { due_at: new Date(`${due}T12:00:00`).toISOString() }),
        ...(assignee === '' ? {} : { assignee }),
      }),
    onSuccess: async () => {
      // "Use on every card with this tag" is the explicit second action: the
      // board default is written, exactly as the editor does it.
      const wide = tags.filter((tag) => tag.boardWide && tag.color !== null);
      if (wide.length > 0) {
        const current = await api.tagColors(boardId);
        const next = { ...current };
        for (const tag of wide) next[tag.name] = tag.color ?? '';
        await api.putTagColors(
          boardId,
          Object.fromEntries(Object.entries(next).filter(([, color]) => color !== '')),
        );
        await queryClient.invalidateQueries({ queryKey: queryKeys.tagColors(boardId) });
      }
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
            rows={3}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('board.card.due')} htmlFor={ids.due}>
            <Input
              id={ids.due}
              type="date"
              value={due}
              data-testid="card-create-due"
              onChange={(event) => setDue(event.target.value)}
            />
          </Field>
          <Field label={t('board.card.assignee')} htmlFor={ids.assignee}>
            <Select
              id={ids.assignee}
              value={assignee}
              data-testid="card-create-assignee"
              onChange={(event) => setAssignee(event.target.value)}
            >
              <option value="">{t('board.card.unassigned')}</option>
              {boardState.members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.username}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label={t('board.tags.title')} htmlFor={ids.tags}>
          <div id={ids.tags}>
            <TagEditor
              tags={tags}
              boardTags={boardTagNames(boardState.cards)}
              onChange={changeTags}
              disabled={create.isPending}
            />
          </div>
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
