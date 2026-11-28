// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { LayoutGrid, Search, SquareKanban, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { Board, BoardIcon } from '../api/types';
import { BoardTile } from '../components/boards/board-tile';
import { BOARD_ICONS, BoardIconGlyph } from '../components/boards/board-icon';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { EmptySlot } from '../components/ui/empty-slot';
import { Field } from '../components/ui/field';
import { Input, Select, Textarea } from '../components/ui/input';
import { t } from '../i18n';
import { failureMessage } from '../lib/api-error';
import { cn } from '../lib/cn';
import { useArrival } from '../lib/entrance';
import { useShortcuts } from '../lib/hotkeys';
import { queryClient, queryKeys } from '../lib/query-client';
import { useToast } from '../components/ui/toast';
import { authedRoute } from './authed';

export const boardsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/boards',
  component: BoardsPage,
});

/** One section's grid: the same four columns whatever the section (brief §4.1). */
const GRID =
  'mt-4 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

/**
 * A tile offers only the actions its reader can perform. Name, description and
 * icon are board settings, which a manager sets; deleting the board is the
 * owner's alone, and the API refuses anyone else.
 */
const canManage = (board: Board): boolean => board.role === 'owner' || board.role === 'admin';
const canDelete = (board: Board): boolean => board.role === 'owner';

function BoardsPage() {
  const navigate = useNavigate();
  const arrived = useArrival();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Board | null>(null);
  const [deleting, setDeleting] = useState<Board | null>(null);
  const [importing, setImporting] = useState(false);
  const boards = useQuery({ queryKey: queryKeys.boards, queryFn: api.boards });

  useShortcuts([{ key: 'n', handler: () => setCreating(true) }]);

  const items = boards.data?.items ?? [];
  // The overview counts the account, not the current filter.
  const ownedCount = items.filter((board) => board.role === 'owner').length;
  const needle = query.trim().toLowerCase();
  const visible =
    needle === ''
      ? items
      : items.filter(
          (board) =>
            board.name.toLowerCase().includes(needle) ||
            (board.description ?? '').toLowerCase().includes(needle),
        );
  const owned = visible.filter((board) => board.role === 'owner');
  const shared = visible.filter((board) => board.role !== 'owner');

  return (
    <div className="mx-auto w-full max-w-content px-6 py-8">
      {/* One row on a wide screen: title, then search, then the actions. Under
          768 px the search is full-width on its own row under the title, and
          the buttons stay on the title row. */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-h1">{t('boards.title')}</h1>
        <div className="relative order-3 w-full md:order-none md:w-60">
          <Search
            aria-hidden="true"
            size={16}
            strokeWidth={1.5}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
          />
          <Input
            className="pl-8"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('boards.search.placeholder')}
            aria-label={t('boards.search.placeholder')}
            data-testid="boards-search"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setImporting(true)}>
            <Upload aria-hidden="true" size={16} strokeWidth={1.5} />
            {t('boards.action.import')}
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t('boards.action.new')}
          </Button>
        </div>
      </div>

      {boards.isPending ? (
        <p className="mt-6 text-body-sm text-ink-subtle">{t('common.label.loading')}</p>
      ) : boards.isError ? (
        <div className="mt-6 flex items-center gap-3">
          <p className="text-body-sm text-ink-muted">{t('common.error.generic')}</p>
          <Button size="sm" variant="ghost" onClick={() => void boards.refetch()}>
            {t('common.action.retry')}
          </Button>
        </div>
      ) : (
        <>
          {/* The overview is a sentence made of numbers, not a dashboard: three
              figures, counted from the whole list, no cards and no icons. */}
          <dl className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <div className="flex items-baseline gap-2">
              <dt className="order-2 text-mono-sm text-ink-subtle">{t('boards.overview.total')}</dt>
              <dd className="order-1 font-display text-h2">{items.length}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="order-2 text-mono-sm text-ink-subtle">{t('boards.overview.mine')}</dt>
              <dd className="order-1 font-display text-h2">{ownedCount}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="order-2 text-mono-sm text-ink-subtle">
                {t('boards.overview.shared')}
              </dt>
              <dd className="order-1 font-display text-h2">{items.length - ownedCount}</dd>
            </div>
          </dl>
          {boards.data.items.length === 0 ? (
            <EmptySlot
              className="mt-6 w-column min-h-36"
              title={t('boards.empty.title')}
              body={t('boards.empty.body')}
            />
          ) : visible.length === 0 ? (
            <p className="mt-6 text-body-sm text-ink-muted">{t('boards.search.empty')}</p>
          ) : (
            <>
              {owned.length > 0 ? (
                <section className="mt-8">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-h3">{t('boards.section.mine')}</h2>
                    <span className="font-mono text-mono-sm text-ink-subtle">{owned.length}</span>
                  </div>
                  <ul className={cn(GRID, arrived && 'enter-stagger')}>
                    {owned.map((board) => (
                      <li key={board.id}>
                        <BoardTile
                          board={board}
                          onEdit={canManage(board) ? () => setEditing(board) : undefined}
                          onDelete={canDelete(board) ? () => setDeleting(board) : undefined}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {shared.length > 0 ? (
                <section className="mt-8">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-h3">{t('boards.section.shared')}</h2>
                    <span className="font-mono text-mono-sm text-ink-subtle">{shared.length}</span>
                  </div>
                  <ul className={cn(GRID, arrived && 'enter-stagger')}>
                    {shared.map((board) => (
                      <li key={board.id}>
                        <BoardTile
                          board={board}
                          onEdit={canManage(board) ? () => setEditing(board) : undefined}
                          onDelete={canDelete(board) ? () => setDeleting(board) : undefined}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </>
      )}

      <NewBoardDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(board) => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.boards });
          void navigate({ to: '/boards/$boardId', params: { boardId: board.id } });
        }}
      />

      {/* Mounted only while open: a closed dialog still owns its labels in the
          DOM, and `getByLabel('Board name')` must keep answering one field. */}
      {editing === null ? null : (
        <EditBoardDialog board={editing} onClose={() => setEditing(null)} />
      )}
      {deleting === null ? null : (
        <DeleteBoardDialog board={deleting} onClose={() => setDeleting(null)} />
      )}
      {importing ? <ImportBoardDialog onClose={() => setImporting(false)} /> : null}
    </div>
  );
}

function NewBoardDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (board: Board) => void;
}) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<'classic' | 'blank'>('classic');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setTemplate('classic');
      setError(null);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () => api.createBoard({ name: name.trim(), template }),
    onSuccess: (board) => {
      onCreated(board);
      onClose();
    },
    onError: () => setError(t('common.error.generic')),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('boards.action.new')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.action.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={name.trim() === ''}
            onClick={() => create.mutate()}
          >
            {t('boards.new.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('boards.new.name')} htmlFor="board-name" error={error}>
          <Input
            id="board-name"
            autoFocus
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={t('boards.new.template')} htmlFor="board-template">
          <Select
            id="board-template"
            value={template}
            onChange={(event) => setTemplate(event.target.value === 'blank' ? 'blank' : 'classic')}
          >
            <option value="classic">{t('boards.template.classic')}</option>
            <option value="blank">{t('boards.template.blank')}</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

/**
 * Rename, redescribe and re-icon a board from the list (brief §4.5). The save
 * carries `expected_updated_at`, so a board that changed underneath answers
 * 409 and the reader is told to reload rather than overwrite.
 */
function EditBoardDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description ?? '');
  const [icon, setIcon] = useState<BoardIcon | null>(board.icon);
  const [error, setError] = useState<string | null>(null);

  const trimmedDescription = description.trim() === '' ? null : description.trim();
  const dirty =
    name.trim() !== board.name || trimmedDescription !== board.description || icon !== board.icon;

  const save = useMutation({
    mutationFn: () =>
      api.updateBoard(board.id, {
        name: name.trim(),
        description: trimmedDescription,
        icon,
        expected_updated_at: board.updated_at,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.boards });
      onClose();
    },
    onError: (cause) => {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? t('boards.edit.conflict')
          : failureMessage(cause),
      );
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('boards.edit.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.action.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!dirty || name.trim() === ''}
            onClick={() => save.mutate()}
          >
            {t('common.action.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('boards.new.name')} htmlFor="edit-board-name" error={error}>
          <Input
            id="edit-board-name"
            autoFocus
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={t('boards.edit.description')} htmlFor="edit-board-description">
          <Textarea
            id="edit-board-description"
            maxLength={280}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <p className="mt-1 text-right font-mono text-mono-sm text-ink-subtle">
            {description.length}/280
          </p>
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-label font-medium text-ink-muted">{t('boards.edit.icon')}</span>
          <div className="flex flex-wrap gap-2">
            {BOARD_ICONS.map((iconName) => (
              <button
                key={iconName}
                type="button"
                aria-pressed={icon === iconName}
                aria-label={t('boards.edit.iconFor', { icon: iconName })}
                onClick={() => setIcon(iconName)}
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-sm border border-border text-ink-muted transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-ink',
                  icon === iconName &&
                    'bg-surface-muted text-ink shadow-[var(--shadow-active)] hover:bg-surface-muted',
                )}
              >
                <BoardIconGlyph name={iconName} size={20} />
              </button>
            ))}
            <button
              type="button"
              aria-pressed={icon === null}
              onClick={() => setIcon(null)}
              className={cn(
                'h-10 rounded-sm border border-border px-3 text-label font-medium text-ink-muted transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-ink',
                icon === null &&
                  'bg-surface-muted text-ink shadow-[var(--shadow-active)] hover:bg-surface-muted',
              )}
            >
              {t('boards.edit.iconNone')}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Delete a board from the list (brief §4.6): one confirmation naming the board,
 * and a `danger` action, because the board, its columns, its cards and their
 * comments go with it. The reader stays on `/boards`; only the list is
 * invalidated.
 */
function DeleteBoardDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const { notify } = useToast();
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: () => api.deleteBoard(board.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: queryKeys.board(board.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.boards });
      notify(t('board.delete.done'));
      onClose();
    },
    onError: (cause) => setError(failureMessage(cause)),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('boards.delete.title')}
      description={t('boards.delete.body', { board: board.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.action.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => {
              setError(null);
              remove.mutate();
            }}
          >
            {t('common.action.delete')}
          </Button>
        </>
      }
    >
      {error === null ? null : (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}

type ImportSource = 'klui' | 'trello';

/** The board a file import is named after: the file name without its extension. */
function boardNameFromFile(file: File): string {
  const stem = file.name.replace(/\.[^./\\]+$/, '').trim();
  return stem === '' ? t('boards.import.defaultName') : stem;
}

/**
 * Import a board (brief §4.7): pick a source, drop a `.json` file, and the app
 * creates a board named after the file, imports into it and opens it. A failed
 * import leaves the dialog open and names the board it already created, so
 * nothing is silently orphaned.
 */
function ImportBoardDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ImportSource>('klui');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async (chosen: File) => {
      const board = await api.createBoard({ name: boardNameFromFile(chosen) });
      try {
        await api.importBoard(board.id, chosen);
      } catch (cause) {
        // The board exists now: name it, so the reader is not left with an
        // orphan they never asked for and cannot find.
        throw new Error(
          t('boards.import.errorCreated', {
            board: board.name,
            message: failureMessage(cause),
          }),
          { cause },
        );
      }
      return board;
    },
    onSuccess: async (board) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.boards });
      onClose();
      void navigate({ to: '/boards/$boardId', params: { boardId: board.id } });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : failureMessage(cause)),
  });

  const sourceCard = (value: ImportSource, mark: ReactNode, name: string, hint: string) => (
    <button
      type="button"
      aria-pressed={source === value}
      onClick={() => setSource(value)}
      className={cn(
        'flex flex-col items-start gap-1 rounded-sm border border-border p-3 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2',
        source === value && 'border-border-strong bg-surface-muted shadow-[var(--shadow-active)]',
      )}
    >
      <span className="flex items-center gap-2 text-body-sm font-medium text-ink">
        <span aria-hidden="true" className="text-ink-muted">
          {mark}
        </span>
        {name}
      </span>
      <span className="text-body-sm text-ink-muted">{hint}</span>
    </button>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('boards.import.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.action.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={run.isPending}
            disabled={file === null}
            onClick={() => {
              if (file !== null) {
                setError(null);
                run.mutate(file);
              }
            }}
          >
            {t('boards.import.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-label font-medium text-ink-muted">{t('boards.import.source')}</span>
          <div className="grid grid-cols-2 gap-2">
            {sourceCard(
              'klui',
              <SquareKanban size={16} strokeWidth={1.5} />,
              t('boards.import.sourceKlui'),
              t('boards.import.sourceKluiHint'),
            )}
            {sourceCard(
              'trello',
              <LayoutGrid size={16} strokeWidth={1.5} />,
              t('boards.import.sourceTrello'),
              t('boards.import.sourceTrelloHint'),
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-label font-medium text-ink-muted">{t('boards.import.file')}</span>
          <div
            className="flex flex-col items-start gap-3 rounded-sm border border-dashed border-border-strong p-6"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const dropped = event.dataTransfer.files?.[0];
              if (dropped !== undefined) {
                setFile(dropped);
                setError(null);
              }
            }}
          >
            <p className="text-body-sm text-ink-muted">{t('boards.import.dropHint')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                {t('boards.import.choose')}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setError(null);
                }}
                data-testid="import-file"
              />
              <span className="min-w-0 truncate font-mono text-mono-sm text-ink-muted">
                {file?.name ?? ''}
              </span>
            </div>
          </div>
        </div>
        {error === null ? null : (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
