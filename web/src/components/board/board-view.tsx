// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Copy, Lock, Plus, Settings2 } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../../api/client';
import { failureMessage } from '../../lib/api-error';
import { cn } from '../../lib/cn';
import { useArrival } from '../../lib/entrance';
import type { Board, BoardState, Caller, Card, Column } from '../../api/types';
import { t } from '../../i18n';
import { applyCardFrame, cardIdOf, envelopeOf, dropCard, isCardEvent } from '../../data/boards';
import { connectBoardStream, type LiveStatus } from '../../data/live';
import { queryKeys } from '../../lib/query-client';
import { Button, buttonVariants } from '../ui/button';
import { DropdownItem, DropdownMenu, DropdownSeparator } from '../ui/dropdown-menu';
import { EmptySlot } from '../ui/empty-slot';
import { Input } from '../ui/input';
import { useToast } from '../ui/toast';
import { ActivityDialog } from './activity-dialog';
import { BoardDataDialog } from './board-data-dialog';
import { DeleteBoardDialog } from './delete-board-dialog';
import { ActiveFilters, BoardFilters, NO_FILTERS, matches, type Filters } from './board-filters';
import { CardCreateModal } from './card-create-modal';
import { CardDisplayModal, cardFromState } from './card-display-modal';
import { CardEditorModal } from './card-editor-modal';
import { CardRow } from './card-row';
import { MembersDialog } from './members-dialog';
import { ShareDialog } from './share-dialog';
import { ModerationDialog } from './moderation-dialog';
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
  const arrived = useArrival();
  const [composer, setComposer] = useState<Composer>({ kind: 'closed' });
  const [activityOpen, setActivityOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
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

  // The card that just landed keeps a 400 ms trace of the gesture, and only it:
  // a re-render of the whole board would read as a flash.
  const [settling, setSettling] = useState<string | null>(null);
  const settleTimer = useRef<number | null>(null);
  const markSettling = (cardId: string): void => {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    setSettling(cardId);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      setSettling(null);
    }, 400);
  };

  // One in-flight move per card (docs/features/board-interaction.md §1.1): a second drop computed from
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
    // No credential at all: a board URL is not a way in without one — unless
    // the board accepts a display name (K3-03).
    if (status === 401) return <AnonymousEntry boardId={boardId} />;
    return (
      <div className="px-6 py-8">
        <p className="text-body-sm text-ink-muted">{failureMessage(state.error)}</p>
        <Button className="mt-3" size="sm" variant="ghost" onClick={() => void state.refetch()}>
          {t('common.action.retry')}
        </Button>
      </div>
    );
  }

  return (
    <BoardFrame
      arrived={arrived}
      boardState={state.data}
      filters={filters}
      onFiltersChange={setFilters}
      onOpenCard={(card) => setComposer({ kind: 'read', cardId: card.id })}
      onAddCard={(columnId) => setComposer({ kind: 'create', columnId })}
      onOpenActivity={() => setActivityOpen(true)}
      onOpenData={() => setDataOpen(true)}
      onOpenMembers={() => setMembersOpen(true)}
      onOpenShare={() => setShareOpen(true)}
      onOpenModeration={() => setModerationOpen(true)}
      onOpenDelete={() => setDeleteOpen(true)}
      live={live}
      onMove={requestMove}
      onMoveTo={(cardId, columnId) =>
        requestMove({ cardId, column: columnId, before: null, after: null })
      }
      settlingCardId={settling}
      onSettle={markSettling}
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
          boardState={state.data}
          onClose={() => setComposer({ kind: 'closed' })}
        />
      ) : null}
      <BoardDataDialog
        boardId={boardId}
        canImport={state.data.caller.can_import}
        open={dataOpen}
        onClose={() => setDataOpen(false)}
      />
      {/* Delete replaces Close in the board chrome; the close-out feature itself
          still exists on /boards/:id/summary and is not deleted. */}
      <DeleteBoardDialog
        boardId={boardId}
        boardName={state.data.board.name}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
      />
      <MembersDialog
        boardState={state.data}
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
      />
      <ModerationDialog
        boardId={boardId}
        open={moderationOpen}
        onClose={() => setModerationOpen(false)}
      />
      {/* Mounted only while open: the created token lives in the panel's state,
          so closing it is what makes it unrecoverable (K3-06). */}
      {shareOpen ? (
        <ShareDialog boardState={state.data} open onClose={() => setShareOpen(false)} />
      ) : null}
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

/**
 * The name gate. On a read-only link board a stranger names themselves to open
 * it: the name is the read credential, and it is remembered per board in this
 * browser only (docs/features/links-and-anonymous.md §4).
 */
function AnonymousEntry({ boardId }: { boardId: string }) {
  const queryClient = useQueryClient();
  const info = useQuery({
    queryKey: ['board-public', boardId],
    queryFn: () => api.boardPublic(boardId),
    retry: false,
  });
  const storageKey = `klui-anon-${boardId}`;
  const [label, setLabel] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) ?? '';
    } catch {
      return '';
    }
  });
  const [error, setError] = useState<string | null>(null);
  const join = useMutation({
    mutationFn: () => api.joinBoard(boardId, label.trim()),
    onSuccess: async () => {
      try {
        window.localStorage.setItem(storageKey, label.trim());
      } catch {
        // A private window refuses storage; the session still works.
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
    },
    onError: (failure) => {
      setError(failureMessage(failure));
    },
  });

  if (info.isPending) {
    return <p className="px-6 py-8 text-body-sm text-ink-subtle">{t('common.label.loading')}</p>;
  }
  if (info.isError || !info.data.accepts_anon) return <NoCredential />;

  return (
    <div className="mx-auto flex min-h-96 w-full max-w-96 flex-col justify-center gap-3 px-6 py-8">
      <h1 className="font-display text-h2">{info.data.name}</h1>
      <p className="text-body-sm text-ink-muted">{t('board.anon.body')}</p>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (label.trim().length < 2) {
            setError(t('board.anon.hint'));
            return;
          }
          setError(null);
          join.mutate();
        }}
      >
        <label htmlFor="anon-label" className="text-label text-ink">
          {t('board.anon.label')}
        </label>
        <Input
          id="anon-label"
          value={label}
          maxLength={32}
          autoComplete="nickname"
          onChange={(event) => setLabel(event.target.value)}
        />
        <p className="text-body-sm text-ink-subtle">{t('board.anon.hint')}</p>
        {error ? (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          loading={join.isPending}
          className="mt-1 self-start"
        >
          {t('board.anon.submit')}
        </Button>
      </form>
    </div>
  );
}

function NoCredential() {
  return (
    <div className="mx-auto flex min-h-96 max-w-96 flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="font-display text-h2">{t('board.error.title')}</h1>
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
      <h1 className="font-display text-h2">{t('board.error.title')}</h1>
      <p className="text-body-sm text-ink-muted">{t('board.error.notFound')}</p>
      <Link to="/boards" className="mt-2 text-body-sm text-ink underline-offset-4 hover:underline">
        {t('notFound.action')}
      </Link>
    </div>
  );
}

function BoardFrame({
  arrived,
  boardState,
  filters,
  onFiltersChange,
  onOpenCard,
  onAddCard,
  onOpenActivity,
  onOpenData,
  onOpenMembers,
  onOpenShare,
  onOpenModeration,
  onOpenDelete,
  live,
  onMove,
  onMoveTo,
  onDeleteCard,
  onToggleDone,
  settlingCardId,
  onSettle,
  keyboard,
  announcement,
  children,
}: {
  arrived: boolean;
  boardState: BoardState;
  filters: Filters;
  onFiltersChange: (next: Filters) => void;
  onOpenCard: (card: Card) => void;
  onAddCard: (columnId: string) => void;
  onOpenActivity: () => void;
  onOpenData: () => void;
  onOpenMembers: () => void;
  onOpenShare: () => void;
  onOpenModeration: () => void;
  onOpenDelete: () => void;
  live: LiveStatus;
  onMove: (request: MoveRequest) => void;
  onMoveTo: (cardId: string, columnId: string) => void;
  onDeleteCard: (cardId: string) => void;
  onToggleDone: (card: Card) => void;
  settlingCardId: string | null;
  onSettle: (cardId: string) => void;
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
    <div className="flex h-full min-h-0 flex-col">
      {/* One 56 px bar: the name, then the meta 12 px away, then the filters,
          the card count and the settings. On a phone the same children stack
          on two rows — the grid in app.css places them. */}
      <header
        data-testid="board-bar"
        className="board-bar flex h-14 items-center justify-between gap-4 border-b border-border bg-canvas px-6"
      >
        <div className="board-bar-left flex min-w-0 flex-1 items-center gap-3">
          <div data-testid="board-bar-row1" className="board-bar-title min-w-0">
            <BoardName board={board} canRename={caller.can_manage} />
          </div>
          {/* Meta is a line of text, not a row of chips: mono, one `·`, the role
              first. `caller-chip` stays on the span that carries the role, which
              is what the shared-affordances test reads. */}
          <div
            data-testid="board-bar-row2"
            className="board-bar-meta flex min-w-0 items-center gap-3"
          >
            <p className="flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-mono-sm text-ink-muted">
              <span data-testid="caller-chip">{callerLabel(caller)}</span>
              <span aria-hidden="true">·</span>
              <span>{t(`board.visibility.${board.visibility}`)}</span>
            </p>
            {board.closed_at === null ? null : (
              <span
                data-testid="board-closed-chip"
                className="flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-mono-sm text-ink-muted"
              >
                <Lock aria-hidden size={12} strokeWidth={1.5} />
                {t('board.closed.chip')}
              </span>
            )}
            {live === 'closed' ? (
              <span
                className="shrink-0 whitespace-nowrap font-mono text-mono-sm text-ink-subtle"
                data-testid="board-live"
              >
                {t('common.label.reconnecting')}
              </span>
            ) : null}
            {board.closed_at === null ? null : (
              <Link
                to="/boards/$boardId/summary"
                params={{ boardId: board.id }}
                data-testid="open-board-summary"
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
              >
                {t('board.summary.open')}
              </Link>
            )}
          </div>
        </div>
        <div className="board-bar-right flex items-center gap-2">
          <div className="board-bar-filters flex items-center gap-2">
            <BoardFilters
              filters={filters}
              onChange={onFiltersChange}
              cards={cards}
              members={members}
              shown={visible.length}
            />
          </div>
          <div className="board-bar-settings">
            <BoardSettingsMenu
              boardState={boardState}
              onOpenShare={onOpenShare}
              onOpenMembers={onOpenMembers}
              onOpenActivity={onOpenActivity}
              onOpenData={onOpenData}
              onOpenModeration={onOpenModeration}
              onOpenDelete={onOpenDelete}
            />
          </div>
        </div>
      </header>

      <ActiveFilters filters={filters} onChange={onFiltersChange} />

      {columns.length === 0 ? (
        <div className="px-6 py-6">
          <ColumnRail boardId={board.id} canWrite={caller.can_manage_columns} />
        </div>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
          data-testid="board-scroll"
        >
          <div
            className={cn(
              'board-rail flex items-start gap-4 px-6 py-4',
              arrived && 'enter-stagger',
            )}
          >
            {columns.map((column) => (
              <ColumnSection
                key={column.id}
                column={column}
                cards={cardsByColumn.get(column.id) ?? []}
                allCards={cards}
                caller={caller}
                filtering={filtering}
                settlingCardId={settlingCardId}
                onSettle={onSettle}
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
            {caller.can_manage_columns ? <AddColumn boardId={board.id} /> : null}
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

function ColumnRail({ boardId, canWrite }: { boardId: string; canWrite: boolean }) {
  return (
    <EmptySlot
      className="w-column"
      title={t('board.empty.noColumns')}
      body={canWrite ? t('board.empty.noColumnsBody') : t('board.empty.noColumnsBodyReader')}
      action={canWrite ? <AddColumn boardId={boardId} className="w-full" /> : null}
    />
  );
}

/** Where the 2 px rule goes: above or below a card, or after the last one. */
type Hint = { cardId: string | null; below: boolean };

function InsertLine({ leaving }: { leaving: boolean }) {
  return (
    <li
      aria-hidden
      data-testid="insert-line"
      data-leaving={leaving ? 'true' : undefined}
      className="insert-line"
    />
  );
}

function ColumnSection({
  column,
  cards,
  allCards,
  caller,
  filtering,
  settlingCardId,
  onSettle,
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
  settlingCardId: string | null;
  onSettle: (cardId: string) => void;
  onOpenCard: (card: Card) => void;
  onAddCard: (columnId: string) => void;
  onMove: (request: MoveRequest) => void;
  onMoveTo: (cardId: string, columnId: string) => void;
  onDeleteCard: (cardId: string) => void;
  onToggleDone: (card: Card) => void;
  columns: Column[];
  keyboard: ReturnType<typeof useKeyboardDrag>;
}) {
  // One hint per column, lifted out of the rows: two cards cannot both own it,
  // and the rule has to be able to sit between them.
  const [hint, setHint] = useState<Hint | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [active, setActive] = useState(false);
  const hintRef = useRef<Hint | null>(null);
  const timer = useRef<number | null>(null);

  const showHint = (next: Hint | null): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setLeaving(false);
    hintRef.current = next;
    setHint(next);
  };

  // The line fades instead of vanishing: 120 ms, the same beat as a hover.
  const hideHint = (): void => {
    if (hintRef.current === null || timer.current !== null) return;
    setLeaving(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      hintRef.current = null;
      setHint(null);
      setLeaving(false);
    }, 120);
  };

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const droppable = useColumnDroppable({
    columnId: column.id,
    cards: allCards,
    canWrite: caller.can_move_card,
    onMove,
    onHoverEndOfColumn: () => showHint({ cardId: null, below: true }),
    onHoverEnd: hideHint,
    onActiveChange: setActive,
  });

  return (
    <section
      ref={droppable.ref}
      className="board-column flex w-column shrink-0 flex-col gap-2 rounded-sm border border-border bg-column p-2"
      data-testid={`column-${column.id}`}
      data-drop-active={active ? 'true' : undefined}
    >
      <header className="flex min-h-8 items-center justify-between px-2">
        <h2 className="line-clamp-2 text-label text-ink">{column.name}</h2>
        <span className="font-mono text-mono-sm tabular-nums text-ink-subtle">{cards.length}</span>
      </header>

      {cards.length === 0 && hint === null ? (
        <p className="px-2 pb-2 text-body-sm text-ink-subtle">
          {filtering
            ? t('board.column.emptyFiltered')
            : caller.can_write
              ? t('board.column.empty')
              : t('board.column.emptyReader')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map((card) => (
            <Fragment key={card.id}>
              {hint?.cardId === card.id && !hint.below ? <InsertLine leaving={leaving} /> : null}
              <CardRow
                card={card}
                cards={allCards}
                columns={columns}
                canMove={caller.can_move_card}
                canDelete={caller.can_delete_card}
                canTick={caller.can_write && (caller.actor_kind !== 'anon' || card.mine)}
                lifted={keyboard.drag?.cardId === card.id}
                settling={settlingCardId === card.id}
                onOpen={() => onOpenCard(card)}
                onMove={onMove}
                onMoveTo={(columnId) => onMoveTo(card.id, columnId)}
                onDelete={() => onDeleteCard(card.id)}
                onToggleDone={() => onToggleDone(card)}
                onKeyDown={keyboard.onKeyDown}
                onHover={(below) => showHint({ cardId: card.id, below })}
                onHoverEnd={hideHint}
                onSettle={onSettle}
              />
              {hint?.cardId === card.id && hint.below ? <InsertLine leaving={leaving} /> : null}
            </Fragment>
          ))}
          {hint !== null && hint.cardId === null ? <InsertLine leaving={leaving} /> : null}
        </ul>
      )}

      {caller.can_write ? (
        <button
          type="button"
          onClick={() => onAddCard(column.id)}
          className="flex h-8 w-full items-center gap-2 rounded-key px-2 text-label text-ink-subtle transition-colors duration-[var(--dur-fast)] hover:bg-surface-muted hover:text-ink"
        >
          <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
          {t('board.card.add')}
        </button>
      ) : null}
    </section>
  );
}

function AddColumn({ boardId, className }: { boardId: string; className?: string }) {
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
        className={cn(
          'flex h-10 w-column shrink-0 items-center gap-2 rounded-sm border border-dashed border-border-strong px-2 text-label text-ink-subtle transition-colors duration-[var(--dur-fast)] hover:border-ink-subtle hover:text-ink',
          className,
        )}
      >
        <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
        {t('board.column.add')}
      </button>
    );
  }

  return (
    <form
      className={cn(
        'flex w-column shrink-0 flex-col gap-2 rounded-sm border border-border bg-column p-2',
        className,
      )}
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
      <div className="flex items-center gap-2">
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

/**
 * The name is the headline and the way to change it: click it, type, Enter. Esc
 * restores and sends nothing, so does an empty or unchanged value, and the slug
 * is never sent — a rename must not move the board's URL.
 */
function BoardName({ board, canRename }: { board: Board; canRename: boolean }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(board.name);
  const cancelled = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);

  const rename = useMutation({
    mutationFn: (name: string) =>
      api.updateBoard(board.id, { name, expected_updated_at: board.updated_at }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.board(board.id) });
    },
    onError: (error) => {
      setDraft(board.name);
      notify(failureMessage(error), 'danger');
    },
  });

  const commit = (): void => {
    setEditing(false);
    const next = draft.trim();
    if (next === '' || next === board.name) {
      setDraft(board.name);
      return;
    }
    rename.mutate(next);
  };

  if (!canRename) {
    return <h1 className="truncate font-display text-h2 text-ink">{board.name}</h1>;
  }

  if (editing) {
    return (
      <input
        ref={input}
        value={draft}
        maxLength={80}
        aria-label={t('board.rename.label')}
        data-testid="board-name-input"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          // Esc removes the input; a blur that follows it must not save.
          if (cancelled.current) {
            cancelled.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelled.current = true;
            setDraft(board.name);
            setEditing(false);
          }
        }}
        className="w-full min-w-0 rounded-sm border border-control-border bg-surface-2 px-2 font-display text-h2 text-ink"
      />
    );
  }

  return (
    <h1 className="min-w-0">
      <button
        type="button"
        onClick={() => {
          setDraft(board.name);
          setEditing(true);
        }}
        title={t('board.rename.label')}
        aria-description={t('board.rename.label')}
        data-testid="board-name"
        className="block max-w-full truncate rounded-sm font-display text-h2 text-ink underline-offset-4 hover:underline hover:decoration-ink-subtle"
      >
        {board.name}
      </button>
    </h1>
  );
}

/**
 * One control for everything the row used to carry. The order is the order of
 * the menu; what a caller may not do is not rendered at all, because the server
 * would refuse it anyway and a disabled row explains nothing.
 */
function BoardSettingsMenu({
  boardState,
  onOpenShare,
  onOpenMembers,
  onOpenActivity,
  onOpenData,
  onOpenModeration,
  onOpenDelete,
}: {
  boardState: BoardState;
  onOpenShare: () => void;
  onOpenMembers: () => void;
  onOpenActivity: () => void;
  onOpenData: () => void;
  onOpenModeration: () => void;
  onOpenDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { notify } = useToast();
  const { board, caller, members, pending_count } = boardState;

  const copyLink = async (): Promise<void> => {
    const url = board.url ?? `${window.location.origin}/${board.owner.username}/${board.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      notify(t('board.link.copied'));
    } catch {
      notify(t('board.link.copyFailed'), 'danger');
    }
  };

  const then = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <DropdownMenu
      label={t('board.settings.label')}
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={(wiring) => (
        <Button
          {...wiring}
          variant="secondary"
          size="md"
          title={t('board.settings.label')}
          data-testid="open-board-settings"
        >
          <span className="relative inline-flex">
            <Settings2 aria-hidden className="h-4 w-4" strokeWidth={1.5} />
            {caller.can_moderate && pending_count > 0 ? (
              <span
                aria-hidden
                data-testid="moderation-badge"
                className="absolute -right-2 -top-2 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-key bg-danger px-0.5 font-mono text-mono-sm leading-none text-primary-foreground"
              >
                {pending_count}
              </span>
            ) : null}
          </span>
          <span className="hidden sm:inline">{t('board.settings.label')}</span>
        </Button>
      )}
    >
      <DropdownItem
        icon={<Copy aria-hidden className="h-4 w-4" strokeWidth={1.5} />}
        onSelect={() => void copyLink()}
        testId="copy-board-link"
      >
        {t('board.settings.copyLink')}
      </DropdownItem>
      {caller.can_manage ? (
        <DropdownItem onSelect={then(onOpenShare)} testId="open-share">
          {t('board.share.open')}
        </DropdownItem>
      ) : null}
      {caller.can_manage ? (
        <DropdownItem
          trailing={members.length}
          onSelect={then(onOpenMembers)}
          testId="open-members"
        >
          {t('board.members.open')}
        </DropdownItem>
      ) : null}
      <DropdownItem onSelect={then(onOpenActivity)} testId="open-activity">
        {t('board.activity.title')}
      </DropdownItem>
      {caller.can_export ? (
        <DropdownItem onSelect={then(onOpenData)} testId="open-board-data">
          {t('board.data.open')}
        </DropdownItem>
      ) : null}
      {caller.can_moderate ? (
        <DropdownItem
          trailing={pending_count > 0 ? pending_count : undefined}
          onSelect={then(onOpenModeration)}
          testId="open-moderation"
        >
          {t('board.settings.moderation')}
        </DropdownItem>
      ) : null}
      {caller.can_close ? (
        <>
          <DropdownSeparator />
          <DropdownItem tone="danger" onSelect={then(onOpenDelete)} testId="open-delete-board">
            {t('board.delete.open')}
          </DropdownItem>
        </>
      ) : null}
    </DropdownMenu>
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
