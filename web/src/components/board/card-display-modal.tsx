// SPDX-License-Identifier: AGPL-3.0-only
import { Check } from 'lucide-react';
import { useRef } from 'react';
import { ApiError } from '../../api/client';
import { failureMessage } from '../../lib/api-error';
import type { BoardState, Caller, Card } from '../../api/types';
import { t } from '../../i18n';
import { formatDate } from '../../lib/format';
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
  const closeRef = useRef<HTMLButtonElement>(null);

  const assignee = card.assignee?.username ?? card.assignee_label;
  const due = card.due_at ? formatDate(card.due_at) : null;

  return (
    <Dialog
      open
      onClose={onClose}
      initialFocus={closeRef}
      title={card.title}
      footer={
        <>
          {caller.can_write && (caller.actor_kind !== 'anon' || card.mine) ? (
            <Button
              variant="ghost"
              loading={done.isPending}
              onClick={() => done.mutate({ cardId: card.id, done: !card.done })}
            >
              {card.done ? t('board.card.reopen') : t('board.card.done')}
            </Button>
          ) : null}
          {/* Read first: the panel opens on the way out, never in the comment
              box, so a keyboard user is not dropped into a composer (K2-15). */}
          <Button ref={closeRef} variant="ghost" onClick={onClose}>
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
          <p className="flex items-center gap-2 text-body-sm text-ink-muted">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-ink text-primary-foreground">
              {/* The filled tick is the one icon that keeps a 2 stroke: at 12 px
                  inside a filled pastille, 1.5 disappears (card-row.tsx says
                  the same of the card's tick). */}
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
          <ul className="flex flex-wrap gap-1">
            {card.tags.map((tag) => (
              <li key={tag.name}>
                <TagChip tag={tag} />
              </li>
            ))}
          </ul>
        ) : null}

        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-body-sm">
          <dt className="text-ink-muted">{t('board.card.assignee')}</dt>
          <dd className={assignee ? 'text-ink' : 'text-ink-subtle'}>
            {assignee ?? t('board.card.unassigned')}
          </dd>
          <dt className="text-ink-muted">{t('board.card.due')}</dt>
          <dd className={due ? 'font-mono text-ink' : 'text-ink-subtle'}>
            {due ?? t('board.card.noDue')}
          </dd>
          <dt className="text-ink-muted">{t('board.card.created')}</dt>
          <dd className="font-mono text-ink-subtle">
            {/* The author rides the date it wrote: one fact, one line, no
                separate paragraph saying it again (brief §4.3). */}
            {formatDate(card.created_at)}
            {card.actor_label ? ` · ${t('board.card.by', { label: card.actor_label })}` : null}
          </dd>
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
  return failureMessage(error);
}

/** The board state a modal needs, or nothing while the first fetch is in flight. */
export function cardFromState(state: BoardState | undefined, cardId: string): Card | null {
  return state?.cards.find((card) => card.id === cardId) ?? null;
}
