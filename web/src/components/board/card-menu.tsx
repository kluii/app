// SPDX-License-Identifier: AGPL-3.0-only
import { MoreHorizontal } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { Card, Column } from '../../api/types';
import { t } from '../../i18n';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Popover } from '../ui/popover';

/**
 * The menu is how a keyboard or touch user moves and deletes a card without a
 * drag (docs/features/board-interaction.md §2). Delete confirms with the card's
 * title, because the event log shows the title of what disappeared.
 */
export function CardMenu({
  card,
  columns,
  canMove,
  canDelete,
  onOpen,
  onMove,
  onDelete,
}: {
  card: Card;
  columns: Column[];
  canMove: boolean;
  canDelete: boolean;
  onOpen: () => void;
  onMove: (columnId: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const otherColumns = columns.filter((column) => column.id !== card.column_id);

  const item =
    'flex h-8 w-full items-center rounded-sm px-2 text-left text-body-sm hover:bg-surface-2';

  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        aria-label={t('board.card.menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
        data-testid={`card-menu-${card.id}`}
      >
        <MoreHorizontal aria-hidden className="h-4 w-4" strokeWidth={1.75} />
      </Button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        labelledBy={menuId}
        anchor={trigger}
        align="end"
        className="w-52 p-1"
      >
        <ul role="menu" id={menuId} aria-label={t('board.card.menu')}>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false);
                onOpen();
              }}
            >
              {t('board.card.open')}
            </button>
          </li>
          {canMove
            ? otherColumns.map((column) => (
                <li role="none" key={column.id}>
                  <button
                    type="button"
                    role="menuitem"
                    className={item}
                    onClick={() => {
                      setOpen(false);
                      onMove(column.id);
                    }}
                  >
                    {t('board.card.moveTo', { column: column.name })}
                  </button>
                </li>
              ))
            : null}
          {canDelete ? (
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className={`${item} text-danger`}
                onClick={() => {
                  setOpen(false);
                  setConfirming(true);
                }}
              >
                {t('common.action.delete')}
              </button>
            </li>
          ) : null}
        </ul>
      </Popover>

      {confirming ? (
        <Dialog
          open
          onClose={() => setConfirming(false)}
          title={t('board.card.delete')}
          description={t('board.card.deleteConfirm', { title: card.title })}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t('common.action.cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirming(false);
                  onDelete();
                }}
              >
                {t('common.action.delete')}
              </Button>
            </>
          }
        >
          <p className="text-body-sm text-ink-muted">{t('board.card.deleteBody')}</p>
        </Dialog>
      ) : null}
    </>
  );
}
