// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Board } from '../api/types';
import { Chip } from '../components/ui/chip';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Field } from '../components/ui/field';
import { Input, Select } from '../components/ui/input';
import { t } from '../i18n';
import { useShortcuts } from '../lib/hotkeys';
import { queryClient, queryKeys } from '../lib/query-client';
import { authedRoute } from './authed';

export const boardsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/boards',
  component: BoardsPage,
});

function BoardsPage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const boards = useQuery({ queryKey: queryKeys.boards, queryFn: api.boards });

  useShortcuts([{ key: 'n', handler: () => setCreating(true) }]);

  return (
    <div className="mx-auto w-full max-w-content px-6 py-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-h1">{t('boards.title')}</h1>
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
        <div className="mt-16 flex flex-col items-center gap-2 text-center">
          <h2 className="font-display text-h2">{t('boards.empty.title')}</h2>
          <p className="max-w-80 text-body-sm text-ink-muted">{t('boards.empty.body')}</p>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards.data.items.map((board) => (
            <li key={board.id}>
              <BoardTile board={board} />
            </li>
          ))}
        </ul>
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

function BoardTile({ board }: { board: Board }) {
  const visibility = t(`boards.meta.${board.visibility}`);
  const role = board.role ? t(`board.role.${board.role}`) : null;
  return (
    <Link
      to="/boards/$boardId"
      params={{ boardId: board.id }}
      data-testid={`board-${board.id}`}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 transition-colors hover:border-border-strong"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="text-h3 text-ink">{board.name}</span>
        {board.closed_at ? <Chip>{t('boards.meta.closed')}</Chip> : null}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <Chip>{visibility}</Chip>
        {role ? <Chip>{role}</Chip> : null}
      </span>
    </Link>
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
