// SPDX-License-Identifier: AGPL-3.0-only
import { Check } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type { Card } from '../../api/types';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import { TagChip } from './tag-chip';
import { useCardDnd, type MoveRequest } from './use-card-dnd';

/**
 * `--card`, 1 px `--border`, radius 4, padding 12. The tick renders only when
 * the card is done (DESIGN.md §7): no empty checkbox on every card.
 */
export function CardRow({
  card,
  cards,
  canWrite,
  readOnly,
  lifted,
  onOpen,
  onMove,
  onKeyDown,
}: {
  card: Card;
  cards: Card[];
  canWrite: boolean;
  readOnly: boolean;
  lifted: boolean;
  onOpen: () => void;
  onMove: (request: MoveRequest) => void;
  onKeyDown: (card: Card, event: KeyboardEvent<HTMLButtonElement>) => boolean;
}) {
  const due = card.due_at ? formatDue(card.due_at) : null;
  const { ref, dragging, consumeDragClick } = useCardDnd({ card, cards, canWrite, onMove });

  return (
    <li>
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
        aria-describedby={canWrite ? `card-move-hint-${card.id}` : undefined}
        className={cn(
          'group flex w-full flex-col gap-2 rounded-sm border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-border-strong',
          lifted && 'outline-2 outline-dashed outline-offset-2 outline-focus',
          dragging && 'opacity-40',
        )}
      >
        <span className="flex items-start gap-1.5">
          {card.done ? (
            <span
              className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-ink text-primary-foreground"
              aria-label={t('board.card.done')}
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
        {canWrite ? (
          <span id={`card-move-hint-${card.id}`} className="sr-only">
            {t('board.drag.hint')}
          </span>
        ) : null}
        {readOnly ? null : <span className="sr-only">{t('board.card.menu')}</span>}
      </button>
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
