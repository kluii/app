// SPDX-License-Identifier: AGPL-3.0-only
import { Check } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type { Card, Column } from '../../api/types';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { CardMenu } from './card-menu';
import { TagChip } from './tag-chip';
import { useCardDnd, type MoveRequest } from './use-card-dnd';

/**
 * `--card`, 1 px `--border`, radius 4, padding 12 (DESIGN.md §7). The done tick
 * renders only on a done card — never an empty checkbox on every card — and it
 * is a real control only on a board the actor can write to; a reader sees the
 * static mark.
 *
 * The row itself is a button covering the card, because a card cannot nest
 * buttons: the tick and the menu sit above it instead of inside it.
 */
export function CardRow({
  card,
  cards,
  columns,
  canWrite,
  lifted,
  onOpen,
  onMove,
  onMoveTo,
  onDelete,
  onToggleDone,
  onKeyDown,
}: {
  card: Card;
  cards: Card[];
  columns: Column[];
  canWrite: boolean;
  lifted: boolean;
  onOpen: () => void;
  onMove: (request: MoveRequest) => void;
  onMoveTo: (columnId: string) => void;
  onDelete: () => void;
  onToggleDone: () => void;
  onKeyDown: (card: Card, event: KeyboardEvent<HTMLButtonElement>) => boolean;
}) {
  const due = card.due_at ? formatDue(card.due_at) : null;
  const { ref, dragging, consumeDragClick } = useCardDnd({ card, cards, canWrite, onMove });

  return (
    <li
      className={cn(
        'group relative',
        lifted && 'rounded-sm outline-2 outline-dashed outline-focus outline-offset-2',
      )}
    >
      <div
        className={cn(
          'flex w-full flex-col gap-2 rounded-sm border border-border bg-card px-3 py-2.5',
          'transition-colors group-hover:border-border-strong',
          dragging && 'opacity-40',
        )}
      >
        <span className="flex items-start gap-1.5">
          {card.done ? (
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-ink text-primary-foreground"
            >
              <Check size={12} strokeWidth={2.5} />
            </span>
          ) : null}
          <span
            data-testid="card-title"
            className={
              card.done
                ? 'line-clamp-3 text-body-sm font-medium text-ink-subtle line-through'
                : 'line-clamp-3 text-body-sm font-medium text-ink'
            }
          >
            {card.title}
          </span>
        </span>

        {card.tags.length > 0 || due || card.assignee || card.assignee_label ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {card.tags.map((tag) => (
              <TagChip key={tag.name} tag={tag} />
            ))}
            {due ? (
              <span className="font-mono text-mono-sm text-ink-subtle" title={card.due_at ?? ''}>
                {due}
              </span>
            ) : null}
            {card.assignee ? (
              <span className="font-mono text-mono-sm text-ink-subtle">
                {card.assignee.username}
              </span>
            ) : card.assignee_label ? (
              <span className="font-mono text-mono-sm text-ink-subtle">{card.assignee_label}</span>
            ) : null}
          </span>
        ) : null}
      </div>

      {/* The card opens from anywhere on the row; the tick and the menu stop
          propagation on pointerdown so they never arm a drag (PROMPT.md §10.3). */}
      <button
        ref={ref}
        type="button"
        onClick={() => {
          if (consumeDragClick()) return;
          onOpen();
        }}
        onKeyDown={(event) => {
          if (onKeyDown(card, event)) event.stopPropagation();
        }}
        data-testid={`card-${card.id}`}
        data-dragging={dragging ? 'true' : undefined}
        aria-label={t('board.card.openNamed', { title: card.title })}
        aria-describedby={canWrite ? `card-move-hint-${card.id}` : undefined}
        className="absolute inset-0 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {canWrite ? (
          <span id={`card-move-hint-${card.id}`} className="sr-only">
            {t('board.drag.hint')}
          </span>
        ) : null}
      </button>

      <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5">
        {card.done && canWrite ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t('board.card.reopen')}
            data-testid={`card-reopen-${card.id}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onToggleDone}
          >
            <Check aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        ) : null}
        <CardMenu
          card={card}
          columns={columns}
          canWrite={canWrite}
          onOpen={onOpen}
          onMove={onMoveTo}
          onDelete={onDelete}
        />
      </div>
    </li>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `28 Nov`, in the browser's locale-agnostic short form the design asks for. */
function formatDue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''}`;
}
