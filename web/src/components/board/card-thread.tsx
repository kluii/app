// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The comment thread of one card (K2-09).
 *
 * Who may write is decided by the server (`comment.create`); the client only
 * decides whether to *offer* the composer. A link holder can write cards and
 * still cannot comment — `can_write` is not the test, the actor kind is
 * (docs/permissions.md §4.2). A viewer reads the thread and gets no composer.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type CommentDto } from '../../api/client';
import { failureMessage } from '../../lib/api-error';
import type { Caller } from '../../api/types';
import { getLocale, t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';

/** The server decides (`comment.create`); the client only reads its answer. */
function canComment(caller: Caller): boolean {
  return caller.can_comment;
}

function formatDay(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' }).format(new Date(iso));
}

export function CardThread({ cardId, caller }: { cardId: string; caller: Caller }) {
  const locale = getLocale();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  // The read panel opens with no input in it (K2-07): the composer appears only
  // when the reader asks for it.
  const [composing, setComposing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const thread = useQuery({
    queryKey: queryKeys.comments(cardId),
    queryFn: () => api.comments(cardId),
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.comments(cardId) });
  };

  const add = useMutation({
    mutationFn: (body: string) => api.addComment(cardId, body),
    onSuccess: () => {
      setDraft('');
      setComposing(false);
      setError(null);
      refresh();
    },
    onError: (cause) => setError(message(cause)),
  });

  const edit = useMutation({
    mutationFn: (input: { id: string; body: string }) => api.editComment(input.id, input.body),
    onSuccess: () => {
      setEditing(null);
      setEditDraft('');
      setError(null);
      refresh();
    },
    onError: (cause) => setError(message(cause)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteComment(id),
    onSuccess: () => refresh(),
    onError: (cause) => setError(message(cause)),
  });

  const items = thread.data?.items ?? [];
  const myLabel = caller.actor_kind === 'user' ? caller.label : null;

  return (
    <section className="mt-5 border-t border-border pt-4" data-testid="card-thread">
      <h3 className="text-h3">{t('board.comment.title')}</h3>
      {thread.isPending ? (
        <p className="mt-2 text-body-sm text-ink-subtle">{t('common.label.loading')}</p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-body-sm text-ink-subtle">{t('board.comment.empty')}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {items.map((comment) => (
            <li key={comment.id} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="text-body-sm font-medium text-ink">{authorOf(comment)}</span>
                <time
                  className="font-mono text-mono-sm text-ink-subtle"
                  dateTime={comment.created_at}
                >
                  {formatDay(comment.created_at, locale)}
                </time>
                {comment.edited_at ? (
                  <span className="font-mono text-mono-sm text-ink-subtle">
                    {t('board.comment.edited')}
                  </span>
                ) : null}
              </div>
              {editing === comment.id ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    className="min-h-16 w-full rounded-sm border border-border bg-surface p-2 text-body-sm text-ink"
                    value={editDraft}
                    onChange={(event) => setEditDraft(event.target.value)}
                    aria-label={t('board.comment.edit')}
                    data-testid="comment-edit-input"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      loading={edit.isPending}
                      onClick={() => edit.mutate({ id: comment.id, body: editDraft })}
                    >
                      {t('common.action.save')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      {t('common.action.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-body-sm text-ink-muted">{comment.body}</p>
              )}
              {myLabel !== null && comment.author.username === myLabel && editing !== comment.id ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid={`comment-edit-${comment.id}`}
                    onClick={() => {
                      setEditing(comment.id);
                      setEditDraft(comment.body);
                    }}
                  >
                    {t('board.comment.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid={`comment-delete-${comment.id}`}
                    onClick={() => remove.mutate(comment.id)}
                  >
                    {t('board.comment.delete')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canComment(caller) && !composing ? (
        <div className="mt-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setComposing(true)}
            data-testid="comment-open"
          >
            {t('board.comment.submit')}
          </Button>
        </div>
      ) : null}

      {canComment(caller) && composing ? (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            className="min-h-16 w-full rounded-sm border border-border bg-surface p-2 text-body-sm text-ink"
            placeholder={t('board.comment.placeholder')}
            aria-label={t('board.comment.placeholder')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            data-testid="comment-input"
          />
          <div>
            <Button
              size="sm"
              variant="secondary"
              disabled={draft.trim() === ''}
              loading={add.isPending}
              onClick={() => add.mutate(draft)}
              data-testid="comment-submit"
            >
              {t('board.comment.submit')}
            </Button>
          </div>
        </div>
      ) : null}

      {canComment(caller) && composing ? (
        <div className="mt-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setComposing(false);
              setDraft('');
            }}
          >
            {t('common.action.cancel')}
          </Button>
        </div>
      ) : null}

      {error !== null ? (
        <p className="mt-2 text-body-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function authorOf(comment: CommentDto): string {
  return comment.author.username ?? comment.author.label ?? comment.author.type;
}

function message(cause: unknown): string {
  return failureMessage(cause);
}
