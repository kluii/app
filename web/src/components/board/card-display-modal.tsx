// SPDX-License-Identifier: AGPL-3.0-only
import { Check } from 'lucide-react';
import { ApiError } from '../../api/client';
import type { BoardState, Caller, Card } from '../../api/types';
import { t } from '../../i18n';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { CardThread } from './card-thread';
import { TagChip } from './tag-chip';
import { useToggleDone } from './use-toggle-done';

/**
 * Read first (docs/features/board-interaction.md §2). The panel contains no
 * input at all, so the platform dialog cannot focus one: the first focusable is
 * Close. The single write it offers is the done tick, and only on a board the
 * actor can write to.
 */
export function CardDisplayModal({
  boardId,
  card,
  caller,
  onEdit,
  onClose,
}: {
  boardId: string;
  card: Card;
  caller: Caller;
  onEdit: () => void;
  onClose: () => void;
}) {
  const done = useToggleDone(boardId);

  const assignee = card.assignee?.username ?? card.assignee_label;
  const due = card.due_at ? formatDate(card.due_at) : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={card.title}
      description={due ? t('board.card.dueOn', { date: due }) : undefined}
      footer={
        <>
          {caller.can_write ? (
            <Button
              variant="ghost"
              loading={done.isPending}
              onClick={() => done.mutate({ cardId: card.id, done: !card.done })}
            >
              {card.done ? t('board.card.reopen') : t('board.card.done')}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t('common.action.close')}
          </Button>
          {caller.can_write ? (
            <Button variant="primary" onClick={onEdit}>
              {t('common.action.edit')}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {card.done ? (
          <p className="flex items-center gap-1.5 text-body-sm text-ink-muted">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-ink text-primary-foreground">
              <Check aria-hidden className="h-3 w-3" strokeWidth={2} />
            </span>
            {t('board.card.done')}
          </p>
        ) : null}

        {card.description ? (
          <p className="whitespace-pre-wrap text-body text-ink">{card.description}</p>
        ) : (
          <p className="text-body text-ink-subtle">{t('board.card.noDescription')}</p>
        )}

        {card.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {card.tags.map((tag) => (
              <li key={tag.name}>
                <TagChip tag={tag} />
              </li>
            ))}
          </ul>
        ) : null}

        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-body-sm">
          <dt className="text-ink-muted">{t('board.card.assignee')}</dt>
          <dd className={assignee ? 'text-ink' : 'text-ink-subtle'}>
            {assignee ?? t('board.card.unassigned')}
          </dd>
          <dt className="text-ink-muted">{t('board.card.due')}</dt>
          <dd className={due ? 'font-mono text-ink' : 'text-ink-subtle'}>
            {due ?? t('board.card.noDue')}
          </dd>
          <dt className="text-ink-muted">{t('board.card.created')}</dt>
          <dd className="font-mono text-ink-subtle">{formatDate(card.created_at)}</dd>
        </dl>

        {done.isError ? (
          <p role="alert" className="text-body-sm text-danger">
            {errorMessage(done.error)}
          </p>
        ) : null}

        <CardThread cardId={card.id} caller={caller} />
      </div>
    </Dialog>
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'conflict') return t('board.card.conflict');
    if (error.code === 'board_closed') return t('board.card.boardClosed');
  }
  return t('common.error.generic');
}

/** `12 Mar` in the reader's locale: a board date is a label, never a timestamp. */
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(
    new Date(value),
  );
}

/** The board state a modal needs, or nothing while the first fetch is in flight. */
export function cardFromState(state: BoardState | undefined, cardId: string): Card | null {
  return state?.cards.find((card) => card.id === cardId) ?? null;
}
