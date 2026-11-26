// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api, ApiError } from '../../api/client';
import type { BoardState, Caller, Card, Column } from '../../api/types';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { Input } from '../ui/input';
import { ActivityDialog } from './activity-dialog';
import { CardDialog } from './card-dialog';
import { CardRow } from './card-row';

type Composer =
  { kind: 'closed' } | { kind: 'create'; columnId: string } | { kind: 'edit'; card: Card };

/**
 * Board > column > card, nothing else (DESIGN.md §5). Columns size to their
 * content and align to the top of the rail; the rail scrolls horizontally, the
 * page does not.
 */
export function BoardView({ boardId }: { boardId: string }) {
  const [composer, setComposer] = useState<Composer>({ kind: 'closed' });
  const [activityOpen, setActivityOpen] = useState(false);

  const state = useQuery({
    queryKey: queryKeys.board(boardId),
    queryFn: () => api.boardState(boardId),
    // Polling stands in for the SSE subscription until it lands (K2-06).
    refetchInterval: 20_000,
    retry: false,
  });

  if (state.isPending) {
    return <p className="px-6 py-8 text-body-sm text-ink-subtle">{t('common.label.loading')}</p>;
  }

  if (state.isError) {
    const status = state.error instanceof ApiError ? state.error.status : 0;
    if (status === 404 || status === 403) return <Unreadable />;
    return (
      <div className="px-6 py-8">
        <p className="text-body-sm text-ink-muted">{t('common.error.generic')}</p>
        <Button className="mt-3" size="sm" variant="ghost" onClick={() => void state.refetch()}>
          {t('common.action.retry')}
        </Button>
      </div>
    );
  }

  return (
    <BoardFrame
      boardState={state.data}
      onOpenCard={(card) => setComposer({ kind: 'edit', card })}
      onAddCard={(columnId) => setComposer({ kind: 'create', columnId })}
      onOpenActivity={() => setActivityOpen(true)}
    >
      <CardDialog
        boardId={boardId}
        columns={state.data.columns}
        mode={composer.kind === 'closed' ? null : composer.kind}
        card={composer.kind === 'edit' ? composer.card : null}
        columnId={composer.kind === 'create' ? composer.columnId : null}
        onClose={() => setComposer({ kind: 'closed' })}
      />
      <ActivityDialog
        boardId={boardId}
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
      />
    </BoardFrame>
  );
}

function Unreadable() {
  return (
    <div className="mx-auto flex min-h-96 max-w-96 flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-h2">{t('board.error.title')}</h1>
      <p className="text-body-sm text-ink-muted">{t('board.error.notFound')}</p>
      <Link to="/boards" className="mt-2 text-body-sm text-ink underline-offset-4 hover:underline">
        {t('notFound.action')}
      </Link>
    </div>
  );
}

function BoardFrame({
  boardState,
  onOpenCard,
  onAddCard,
  onOpenActivity,
  children,
}: {
  boardState: BoardState;
  onOpenCard: (card: Card) => void;
  onAddCard: (columnId: string) => void;
  onOpenActivity: () => void;
  children?: ReactNode;
}) {
  const { board, columns, cards, caller } = boardState;
  const cardsByColumn = new Map<string, Card[]>();
  for (const column of columns) cardsByColumn.set(column.id, []);
  for (const card of cards) cardsByColumn.get(card.column_id)?.push(card);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="truncate text-h1 text-ink">{board.name}</h1>
          <span className="font-mono text-mono-sm text-ink-subtle">
            {board.owner.username}/{board.slug}
          </span>
          <Chip>{callerLabel(caller)}</Chip>
        </div>
        <Button size="sm" variant="secondary" onClick={onOpenActivity}>
          {t('board.activity.title')}
        </Button>
      </div>

      {columns.length === 0 ? (
        <div className="px-4 py-6">
          <ColumnRail boardId={board.id} canWrite={caller.can_write} className="border-none p-0" />
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto">
          <div className="flex items-start gap-4 px-4 py-4">
            {columns.map((column) => (
              <ColumnSection
                key={column.id}
                column={column}
                cards={cardsByColumn.get(column.id) ?? []}
                caller={caller}
                onOpenCard={onOpenCard}
                onAddCard={onAddCard}
              />
            ))}
            {caller.can_write ? <AddColumn boardId={board.id} /> : null}
          </div>
        </div>
      )}

      {children}
    </div>
  );
}

function ColumnRail({
  boardId,
  canWrite,
  className,
}: {
  boardId: string;
  canWrite: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex flex-col items-center gap-2 rounded-md border border-border px-6 py-10 text-center">
        <h2 className="text-h2">{t('board.empty.noColumns')}</h2>
        <p className="max-w-72 text-body-sm text-ink-muted">{t('board.empty.noColumnsBody')}</p>
        {canWrite ? <AddColumn boardId={boardId} /> : null}
      </div>
    </div>
  );
}

function ColumnSection({
  column,
  cards,
  caller,
  onOpenCard,
  onAddCard,
}: {
  column: Column;
  cards: Card[];
  caller: Caller;
  onOpenCard: (card: Card) => void;
  onAddCard: (columnId: string) => void;
}) {
  return (
    <section
      className="flex w-column shrink-0 flex-col gap-2 rounded-md bg-column p-2"
      data-testid={`column-${column.id}`}
    >
      <header className="flex items-center justify-between px-1 py-1">
        <h2 className="truncate text-label font-medium text-ink-muted">{column.name}</h2>
        <span className="font-mono text-mono-sm text-ink-subtle">{cards.length}</span>
      </header>

      {cards.length === 0 ? (
        <p className="px-1 pb-1 text-body-sm text-ink-subtle">{t('board.column.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map((card) => (
            <CardRow
              key={card.id}
              card={card}
              readOnly={!caller.can_write}
              onOpen={() => onOpenCard(card)}
            />
          ))}
        </ul>
      )}

      {caller.can_write ? (
        <button
          type="button"
          onClick={() => onAddCard(column.id)}
          className="flex h-8 items-center gap-1.5 rounded-sm px-1 text-label text-ink-subtle transition-colors hover:text-ink"
        >
          <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
          {t('board.card.add')}
        </button>
      ) : null}
    </section>
  );
}

function AddColumn({ boardId }: { boardId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.createColumn(boardId, { name: name.trim() }),
    onSuccess: () => {
      setName('');
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-column shrink-0 items-center gap-1.5 rounded-sm border border-dashed border-border px-2 text-label text-ink-subtle transition-colors hover:border-border-strong hover:text-ink"
      >
        <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
        {t('board.column.add')}
      </button>
    );
  }

  return (
    <form
      className="flex w-column shrink-0 flex-col gap-2 rounded-md bg-column p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() !== '' && !create.isPending) create.mutate();
      }}
    >
      <Input
        autoFocus
        aria-label={t('board.column.new')}
        maxLength={64}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      <div className="flex items-center gap-1.5">
        <Button type="submit" size="sm" variant="primary" loading={create.isPending}>
          {t('common.action.create')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('common.action.cancel')}
        </Button>
      </div>
    </form>
  );
}

function callerLabel(caller: Caller): string {
  if (caller.role === 'owner') return t('board.role.owner');
  if (caller.role === 'admin') return t('board.role.admin');
  if (caller.role === 'editor') return t('board.role.editor');
  if (caller.role === 'viewer') return t('board.role.viewer');
  if (caller.actor_kind === 'link') {
    return caller.can_write ? t('board.role.linkEdit') : t('board.role.linkRead');
  }
  if (caller.actor_kind === 'anon') return t('board.role.anon');
  return t('board.role.viewer');
}
