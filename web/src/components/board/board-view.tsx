// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../../api/client';
import type { BoardState, Caller, Card, Column } from '../../api/types';
import { t } from '../../i18n';
import { applyCardFrame, cardIdOf, envelopeOf, dropCard, isCardEvent } from '../../data/boards';
import { connectBoardStream, type LiveStatus } from '../../data/live';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { Input } from '../ui/input';
import { ActivityDialog } from './activity-dialog';
import { BoardDataDialog } from './board-data-dialog';
import { CloseBoardDialog } from './close-board-dialog';
import { ActiveFilters, BoardFilters, NO_FILTERS, matches, type Filters } from './board-filters';
import { CardCreateModal } from './card-create-modal';
import { CardDisplayModal, cardFromState } from './card-display-modal';
import { CardEditorModal } from './card-editor-modal';
import { CardRow } from './card-row';
import { useColumnDroppable, type MoveRequest } from './use-card-dnd';
import { useKeyboardDrag } from './use-keyboard-drag';
import { useToggleDone } from './use-toggle-done';

type Composer =
  | { kind: 'closed' }
  | { kind: 'create'; columnId: string }
  | { kind: 'read'; cardId: string }
  | { kind: 'edit'; cardId: string };

/**
 * Board > column > card, nothing else (DESIGN.md §5). Columns size to their
 * content and align to the top of the rail; the rail scrolls horizontally, the
 * page does not.
 */
export function BoardView({ boardId }: { boardId: string }) {
  const [composer, setComposer] = useState<Composer>({ kind: 'closed' });
  const [activityOpen, setActivityOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [announcement, setAnnouncement] = useState('');
  const queryClient = useQueryClient();

  // While the stream is down the board stays usable: a 15 s poll is the
  // fallback, and an open stream means no polling at all
  // (docs/features/realtime.md §2.3).
  const [live, setLive] = useState<LiveStatus>('connecting');

  const state = useQuery({
    queryKey: queryKeys.board(boardId),
    queryFn: () => api.boardState(boardId),
    refetchInterval: live === 'open' ? false : 15_000,
    retry: false,
  });

  useEffect(() => {
    const handle = connectBoardStream({
      boardIds: [boardId],
      onStatus: setLive,
      onReconnect: () => {
        // Replay closes small gaps; it is not a substitute for the truth.
        void queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
      },
      onEvent: (event) => {
        const envelope = envelopeOf(event.data);
        if (event.type === 'resync' || event.type === 'board.closed') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
          return;
        }
        const cardId = cardIdOf(envelope);
        if (isCardEvent(event.type) && cardId !== null) {
          if (event.type === 'card.deleted') {
            queryClient.setQueryData<BoardState>(queryKeys.board(boardId), (previous) =>
              previous === undefined ? previous : dropCard(previous, cardId),
            );
            return;
          }
          void applyCardFrame({ queryClient, boardId, cardId });
          return;
        }
        void queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
      },
    });
    return () => handle.close();
  }, [boardId, queryClient]);

  const move = useMutation({
    mutationFn: (request: MoveRequest) =>
      api.moveCard(request.cardId, {
        column: request.column,
        before: request.before,
        after: request.after,
      }),
    // A move is confirmed by the server's answer: the refetch is the truth.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
    },
    onError: async () => {
      setAnnouncement('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
    },
  });

  const toggleDone = useToggleDone(boardId);

  const removeCard = useMutation({
    mutationFn: (cardId: string) => api.deleteCard(cardId),
    onSuccess: async () => {
      setComposer({ kind: 'closed' });
      await queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
    },
  });

  // One in-flight move per card (PROMPT.md §10.1): a second drop computed from
  // a stale position would write the same card twice.
  const inFlight = useRef(new Set<string>());
  const requestMove = (request: MoveRequest): void => {
    if (inFlight.current.has(request.cardId)) return;
    inFlight.current.add(request.cardId);
    move.mutate(request, {
      onSettled: () => {
        inFlight.current.delete(request.cardId);
      },
    });
  };

  const keyboard = useKeyboardDrag({
    cards: state.data?.cards ?? [],
    columns: state.data?.columns ?? [],
    onMove: requestMove,
    announce: setAnnouncement,
    messages: {
      lifted: (input) =>
        t('board.drag.lifted', {
          card: input.card,
          column: input.column,
          index: input.index,
          total: input.total,
        }),
      position: (input) =>
        t('board.drag.position', {
          card: input.card,
          column: input.column,
          index: input.index,
          total: input.total,
        }),
      moved: (input) =>
        t('board.drag.moved', {
          card: input.card,
          column: input.column,
          index: input.index,
          total: input.total,
        }),
    },
    describeCard: (card) => card.title,
    describeColumn: (column) => column.name,
  });

  const composerCard =
    composer.kind === 'read' || composer.kind === 'edit'
      ? cardFromState(state.data, composer.cardId)
      : null;
  const createColumn =
    composer.kind === 'create'
      ? (state.data?.columns.find((column) => column.id === composer.columnId) ?? null)
      : null;

  if (state.isPending) {
    return <p className="px-6 py-8 text-body-sm text-ink-subtle">{t('common.label.loading')}</p>;
  }

  if (state.isError) {
    const status = state.error instanceof ApiError ? state.error.status : 0;
    if (status === 404 || status === 403) return <Unreadable />;
    // No credential at all: a board URL is not a way in without one.
    if (status === 401) return <NoCredential />;
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
      filters={filters}
      onFiltersChange={setFilters}
      onOpenCard={(card) => setComposer({ kind: 'read', cardId: card.id })}
      onAddCard={(columnId) => setComposer({ kind: 'create', columnId })}
      onOpenActivity={() => setActivityOpen(true)}
      onOpenData={() => setDataOpen(true)}
      onOpenClose={() => setCloseOpen(true)}
      live={live}
      onMove={requestMove}
      onMoveTo={(cardId, columnId) =>
        requestMove({ cardId, column: columnId, before: null, after: null })
      }
      onDeleteCard={(cardId) => removeCard.mutate(cardId)}
      onToggleDone={(card) => toggleDone.mutate({ cardId: card.id, done: !card.done })}
      keyboard={keyboard}
      announcement={announcement}
    >
      {composerCard ? (
        composer.kind === 'read' ? (
          <CardDisplayModal
            boardId={boardId}
            card={composerCard}
            caller={state.data.caller}
            onEdit={() => setComposer({ kind: 'edit', cardId: composerCard.id })}
            onClose={() => setComposer({ kind: 'closed' })}
          />
        ) : (
          <CardEditorModal
            boardId={boardId}
            card={composerCard}
            onSaved={() => setComposer({ kind: 'read', cardId: composerCard.id })}
            onClose={() => setComposer({ kind: 'read', cardId: composerCard.id })}
          />
        )
      ) : null}
      {createColumn ? (
        <CardCreateModal
          boardId={boardId}
          column={createColumn}
          onClose={() => setComposer({ kind: 'closed' })}
        />
      ) : null}
      <BoardDataDialog boardId={boardId} open={dataOpen} onClose={() => setDataOpen(false)} />
      <CloseBoardDialog
        boardId={boardId}
        boardName={state.data.board.name}
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        onClosed={() => {
          setCloseOpen(false);
          void queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
        }}
      />
      <ActivityDialog
        boardId={boardId}
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        onOpenCard={(cardId) => {
          setActivityOpen(false);
          setComposer({ kind: 'read', cardId });
        }}
      />
    </BoardFrame>
  );
}

function NoCredential() {
  return (
    <div className="mx-auto flex min-h-96 max-w-96 flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-h2">{t('board.error.title')}</h1>
      <p className="text-body-sm text-ink-muted">{t('board.error.needCredential')}</p>
      <Link to="/login" className="mt-2 text-body-sm text-ink underline-offset-4 hover:underline">
        {t('common.action.signIn')}
      </Link>
    </div>
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
  filters,
  onFiltersChange,
  onOpenCard,
  onAddCard,
  onOpenActivity,
  onOpenData,
  onOpenClose,
  live,
  onMove,
  onMoveTo,
  onDeleteCard,
  onToggleDone,
  keyboard,
  announcement,
  children,
}: {
  boardState: BoardState;
  filters: Filters;
  onFiltersChange: (next: Filters) => void;
  onOpenCard: (card: Card) => void;
  onAddCard: (columnId: string) => void;
  onOpenActivity: () => void;
  onOpenData: () => void;
  onOpenClose: () => void;
  live: LiveStatus;
  onMove: (request: MoveRequest) => void;
  onMoveTo: (cardId: string, columnId: string) => void;
  onDeleteCard: (cardId: string) => void;
  onToggleDone: (card: Card) => void;
  keyboard: ReturnType<typeof useKeyboardDrag>;
  announcement: string;
  children?: ReactNode;
}) {
  const { board, columns, cards, caller, members } = boardState;
  const visible = cards.filter((card) => matches(card, filters));
  const cardsByColumn = new Map<string, Card[]>();
  for (const column of columns) cardsByColumn.set(column.id, []);
  for (const card of visible) cardsByColumn.get(card.column_id)?.push(card);
  const filtering = visible.length !== cards.length;

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
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{t(`board.visibility.${board.visibility}`)}</Chip>
          {board.closed_at === null ? null : (
            <span data-testid="board-closed-chip">
              <Chip>{t('board.closed.chip')}</Chip>
            </span>
          )}
          {live === 'closed' ? (
            <span className="font-mono text-mono-sm text-ink-subtle" data-testid="board-live">
              {t('common.label.reconnecting')}
            </span>
          ) : null}
          <BoardFilters
            filters={filters}
            onChange={onFiltersChange}
            cards={cards}
            members={members}
            shown={visible.length}
          />
          <Button size="sm" variant="secondary" onClick={onOpenActivity}>
            {t('board.activity.title')}
          </Button>
          <Button size="sm" variant="secondary" onClick={onOpenData} data-testid="open-board-data">
            {t('board.data.open')}
          </Button>
          {board.closed_at === null ? (
            caller.can_close && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onOpenClose}
                data-testid="open-close-board"
              >
                {t('board.close.open')}
              </Button>
            )
          ) : (
            <Link
              className="inline-flex h-8 items-center rounded-sm border border-border bg-surface-2 px-3 text-body-sm text-ink hover:bg-surface-muted"
              to="/boards/$boardId/summary"
              params={{ boardId: board.id }}
              data-testid="open-board-summary"
            >
              {t('board.summary.open')}
            </Link>
          )}
        </div>
      </div>

      <ActiveFilters filters={filters} onChange={onFiltersChange} />

      {columns.length === 0 ? (
        <div className="px-4 py-6">
          <ColumnRail boardId={board.id} canWrite={caller.can_write} className="border-none p-0" />
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto" data-testid="board-scroll">
          <div className="board-rail flex items-start gap-4 px-4 py-4">
            {columns.map((column) => (
              <ColumnSection
                key={column.id}
                column={column}
                cards={cardsByColumn.get(column.id) ?? []}
                allCards={cards}
                caller={caller}
                filtering={filtering}
                onOpenCard={onOpenCard}
                onAddCard={onAddCard}
                onMove={onMove}
                onMoveTo={(cardId, columnId) => onMoveTo(cardId, columnId)}
                onDeleteCard={onDeleteCard}
                onToggleDone={onToggleDone}
                columns={columns}
                keyboard={keyboard}
              />
            ))}
            {caller.can_write ? <AddColumn boardId={board.id} /> : null}
          </div>
        </div>
      )}

      <p aria-live="polite" className="sr-only" data-testid="drag-announcement">
        {announcement}
      </p>

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
  allCards,
  caller,
  filtering,
  onOpenCard,
  onAddCard,
  onMove,
  onMoveTo,
  onDeleteCard,
  onToggleDone,
  columns,
  keyboard,
}: {
  column: Column;
  cards: Card[];
  allCards: Card[];
  caller: Caller;
  filtering: boolean;
  onOpenCard: (card: Card) => void;
  onAddCard: (columnId: string) => void;
  onMove: (request: MoveRequest) => void;
  onMoveTo: (cardId: string, columnId: string) => void;
  onDeleteCard: (cardId: string) => void;
  onToggleDone: (card: Card) => void;
  columns: Column[];
  keyboard: ReturnType<typeof useKeyboardDrag>;
}) {
  const droppable = useColumnDroppable({
    columnId: column.id,
    cards: allCards,
    canWrite: caller.can_write,
    onMove,
  });

  return (
    <section
      ref={droppable.ref}
      className="board-column flex w-column shrink-0 flex-col gap-2 rounded-md bg-column p-2"
      data-testid={`column-${column.id}`}
    >
      <header className="flex items-center justify-between px-1 py-1">
        <h2 className="truncate text-label font-medium text-ink-muted">{column.name}</h2>
        <span className="font-mono text-mono-sm text-ink-subtle">{cards.length}</span>
      </header>

      {cards.length === 0 ? (
        <p className="px-1 pb-1 text-body-sm text-ink-subtle">
          {filtering ? t('board.column.emptyFiltered') : t('board.column.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map((card) => (
            <CardRow
              key={card.id}
              card={card}
              cards={allCards}
              columns={columns}
              canWrite={caller.can_write}
              lifted={keyboard.drag?.cardId === card.id}
              onOpen={() => onOpenCard(card)}
              onMove={onMove}
              onMoveTo={(columnId) => onMoveTo(card.id, columnId)}
              onDelete={() => onDeleteCard(card.id)}
              onToggleDone={() => onToggleDone(card)}
              onKeyDown={keyboard.onKeyDown}
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
