// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Board } from '../api/types';
import { BoardTile } from '../components/boards/board-tile';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { EmptySlot } from '../components/ui/empty-slot';
import { Field } from '../components/ui/field';
import { Input, Select } from '../components/ui/input';
import { t } from '../i18n';
import { cn } from '../lib/cn';
import { useArrival } from '../lib/entrance';
import { useShortcuts } from '../lib/hotkeys';
import { queryClient, queryKeys } from '../lib/query-client';
import { authedRoute } from './authed';

export const boardsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/boards',
  component: BoardsPage,
});

/** One section's grid: the same four columns whatever the section (brief §4.1). */
const GRID =
  'mt-4 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

function BoardsPage() {
  const navigate = useNavigate();
  const arrived = useArrival();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const boards = useQuery({ queryKey: queryKeys.boards, queryFn: api.boards });

  useShortcuts([{ key: 'n', handler: () => setCreating(true) }]);

  const items = boards.data?.items ?? [];
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
        <Button variant="primary" onClick={() => setCreating(true)}>
          {t('boards.action.new')}
        </Button>
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
      ) : boards.data.items.length === 0 ? (
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
                    <BoardTile board={board} />
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
                    <BoardTile board={board} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
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
