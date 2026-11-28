// SPDX-License-Identifier: AGPL-3.0-only
import { Calendar, Check, Undo2 } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type { Card, Column } from '../../api/types';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import { formatDate } from '../../lib/format';
import { atUsername } from '../../lib/username';
import { Button } from '../ui/button';
import { CardMenu } from './card-menu';
import { TagChip } from './tag-chip';
import { useCardDnd, type MoveRequest } from './use-card-dnd';

/**
 * The first 120 characters of a description, nothing more: the card is a fiche,
 * and the description is one line of it. A long one is cut before the ellipsis
 * so `word …` never reads as two spaces.
 */
export function snippet(description: string): string {
  const head = description.slice(0, 120);
  return description.length > 120 ? `${head.trimEnd()}…` : head;
}

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
  canMove,
  canDelete,
  canTick,
  lifted,
  settling,
  onOpen,
  onMove,
  onMoveTo,
  onDelete,
  onToggleDone,
  onKeyDown,
  onHover,
  onHoverEnd,
  onSettle,
}: {
  card: Card;
  cards: Card[];
  columns: Column[];
  canMove: boolean;
  canDelete: boolean;
  canTick: boolean;
  lifted: boolean;
  settling: boolean;
  onOpen: () => void;
  onMove: (request: MoveRequest) => void;
  onMoveTo: (columnId: string) => void;
  onDelete: () => void;
  onToggleDone: () => void;
  onKeyDown: (card: Card, event: KeyboardEvent<HTMLButtonElement>) => boolean;
  onHover: (below: boolean) => void;
  onHoverEnd: () => void;
  onSettle: (cardId: string) => void;
}) {
  const due = card.due_at ? formatDate(card.due_at) : null;
  // A member is an identity, so it carries its at sign; `assignee_label` is
  // whatever an anonymous author typed, and keeps saying exactly that.
  const assignee =
    card.assignee === null ? (card.assignee_label ?? null) : atUsername(card.assignee.username);
  const { ref, dragging, consumeDragClick } = useCardDnd({
    card,
    cards,
    canWrite: canMove,
    onMove,
    onHover,
    onHoverEnd,
    onSettle,
  });

  return (
    <li
      data-dragging={dragging ? 'true' : undefined}
      data-settling={settling ? 'true' : undefined}
      className={cn(
        'group relative rounded-key',
        lifted && 'rounded-key outline-2 outline-dashed outline-focus outline-offset-2',
      )}
    >
      <div
        className={cn(
          'flex w-full flex-col gap-2 rounded-key border border-border bg-card p-3',
          'transition-colors duration-[var(--dur-fast)] group-hover:border-border-strong',
          // Lifted by the keyboard, the card is printed on the plate in place
          // (brief §4.4): the scope re-points the card's tokens, so the title,
          // the tags and the date keep their contrast on `--plate`. Only one
          // card can be lifted at a time — never two plates on screen.
          lifted && 'card-plate text-plate-ink',
        )}
      >
        <span className="flex items-start gap-2">
          {card.done ? (
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-key bg-ink text-primary-foreground"
            >
              {/* The one glyph allowed a heavier stroke: a 12 px tick inside a
                  16 px filled pastille disappears at 1.5, and it is the only
                  filled icon in the app (DESIGN.md §10). */}
              <Check size={12} strokeWidth={2} />
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

        {/* The description's opening line, in the mono voice: content, so it is
            read, not hidden. One line, whatever the description does. */}
        {card.description ? (
          <p className="line-clamp-1 text-mono-sm text-ink-subtle">{snippet(card.description)}</p>
        ) : null}

        {card.tags.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {card.tags.map((tag) => (
              <TagChip key={tag.name} tag={tag} />
            ))}
          </span>
        ) : null}

        {due || assignee ? (
          <span className="flex h-4 items-center justify-between gap-2">
            {due ? (
              <span
                className="flex items-center gap-1 font-mono text-mono-sm tabular-nums text-ink-muted"
                title={card.due_at ?? ''}
              >
                <Calendar aria-hidden size={12} strokeWidth={1.5} />
                {due}
              </span>
            ) : null}
            {assignee ? (
              <span className="ml-auto max-w-24 truncate font-mono text-mono-sm text-ink-subtle">
                {assignee}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      {/* The card opens from anywhere on the row; the tick and the menu stop
          propagation on pointerdown so they never arm a drag
          (docs/features/board-interaction.md §1.6). The two controls sit in the
          top-right corner and appear on hover, on keyboard focus inside the
          card, and on a touch screen, where there is no hover. */}
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
        aria-label={t('board.card.openNamed', { title: card.title })}
        aria-describedby={canMove ? `card-move-hint-${card.id}` : undefined}
        className="absolute inset-0 cursor-pointer rounded-key focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {canMove ? (
          <span id={`card-move-hint-${card.id}`} className="sr-only">
            {t('board.drag.hint')}
          </span>
        ) : null}
      </button>

      <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 opacity-100 [@media(pointer:coarse)]:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        {/* One glyph, one meaning: the done card carries the filled tick at the
            left of its title, so reopening is an arrow, never a second check. */}
        {card.done && canTick ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t('board.card.reopen')}
            data-testid={`card-reopen-${card.id}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onToggleDone}
          >
            <Undo2 aria-hidden className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        ) : null}
        <CardMenu
          card={card}
          columns={columns}
          canMove={canMove}
          canDelete={canDelete}
          onOpen={onOpen}
          onMove={onMoveTo}
          onDelete={onDelete}
        />
      </div>
    </li>
  );
}
