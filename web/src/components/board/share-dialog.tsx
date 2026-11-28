// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sharing (K3-06). Visibility, the readable URL, suffix rotation and links.
 *
 * A share link is read-only and nobody writes without an account, so the two
 * selectors that used to live here are gone: there is no link role to choose and
 * no anonymous write to allow. The token of a link is shown exactly once, in
 * this dialog, and only while it is open (docs/features/links-and-anonymous.md
 * §3).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api/client';
import { failureMessage } from '../../lib/api-error';
import type { BoardLink, BoardState, LinkRole, Visibility } from '../../api/types';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input, Select } from '../ui/input';

const VISIBILITIES: Visibility[] = ['private', 'link', 'public'];

export function ShareDialog({
  boardState,
  open,
  onClose,
}: {
  boardState: BoardState;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const boardId = boardState.board.id;
  const [error, setError] = useState<string | null>(null);
  const [confirmingRotation, setConfirmingRotation] = useState(false);
  const [created, setCreated] = useState<(BoardLink & { token: string; url: string }) | null>(null);

  const links = useQuery({
    queryKey: queryKeys.links(boardId),
    queryFn: () => api.links(boardId),
    enabled: open,
  });

  const failure = (error_: unknown): void => {
    setError(failureMessage(error_));
  };
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
  };

  const update = useMutation({
    mutationFn: (input: { visibility?: Visibility; link_role?: LinkRole }) =>
      api.updateBoard(boardId, input),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: failure,
  });
  const rotate = useMutation({
    mutationFn: () => api.rotateSuffix(boardId),
    onSuccess: async () => {
      setConfirmingRotation(false);
      await refresh();
    },
    onError: failure,
  });
  const createLink = useMutation({
    mutationFn: () => api.createLink(boardId, 'read'),
    onSuccess: async (link) => {
      setCreated(link);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.links(boardId) });
    },
    onError: failure,
  });
  const revoke = useMutation({
    mutationFn: (linkId: string) => api.revokeLink(boardId, linkId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.links(boardId) });
    },
    onError: failure,
  });

  const board = boardState.board;
  const items = links.data?.items ?? [];

  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError(t('board.share.copyFailed'));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('board.share.title')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="share-visibility" className="text-label text-ink">
            {t('board.share.visibility')}
          </label>
          <Select
            id="share-visibility"
            value={board.visibility}
            onChange={(event) => update.mutate({ visibility: event.target.value as Visibility })}
            className="w-48"
          >
            {VISIBILITIES.map((value) => (
              <option key={value} value={value}>
                {t(`board.visibility.${value}`)}
              </option>
            ))}
          </Select>
        </div>

        {board.visibility === 'private' ? (
          <p className="text-body-sm text-ink-muted">{t('board.share.privateHint')}</p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-label text-ink">{t('board.share.url')}</span>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={board.url ?? ''}
                  aria-label={t('board.share.url')}
                  className="flex-1 font-mono text-mono-sm"
                />
                <Button
                  variant="secondary"
                  onClick={() => void copy(board.url ?? '')}
                  aria-label={t('board.share.copy')}
                >
                  <Copy aria-hidden className="h-4 w-4" strokeWidth={1.5} />
                </Button>
              </div>
              {board.visibility === 'link' ? (
                confirmingRotation ? (
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-body-sm text-ink-muted">{t('board.share.rotateWarning')}</p>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={rotate.isPending}
                      onClick={() => rotate.mutate()}
                    >
                      {t('board.share.rotateConfirm')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingRotation(false)}>
                      {t('common.action.cancel')}
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1 self-start"
                    onClick={() => setConfirmingRotation(true)}
                    data-testid="rotate-suffix"
                  >
                    {t('board.share.rotate')}
                  </Button>
                )
              ) : null}
            </div>

            <p className="text-body-sm text-ink-muted">{t('board.share.linkReadOnly')}</p>
            {board.link_role === 'none' ? (
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                loading={update.isPending}
                onClick={() => update.mutate({ link_role: 'read' })}
                data-testid="enable-link"
              >
                {t('board.share.enableLink')}
              </Button>
            ) : null}
          </>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-label text-ink">{t('board.share.links')}</span>
          <p className="text-body-sm text-ink-muted">{t('board.share.linksHint')}</p>
          {items.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border">
              {items.map((link) => (
                <li key={link.id} className="flex items-center gap-2 py-2">
                  <span className="font-mono text-mono-sm text-ink">{link.role}</span>
                  <span className="font-mono text-mono-sm text-ink-subtle">
                    {link.last_used_at
                      ? t('board.share.lastUsed', { date: link.last_used_at.slice(0, 10) })
                      : t('board.share.neverUsed')}
                  </span>
                  {link.revoked_at ? (
                    <span className="ml-auto text-body-sm text-ink-subtle">
                      {t('board.share.revoked')}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      loading={revoke.isPending}
                      onClick={() => revoke.mutate(link.id)}
                    >
                      {t('board.share.revoke')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {board.link_role === 'none' && created === null ? (
            <p className="text-body-sm text-ink-muted">{t('board.share.setLinkRoleFirst')}</p>
          ) : created ? (
            <div className="flex flex-col gap-1 rounded-sm border border-border bg-surface-2 p-2">
              <p className="text-body-sm text-ink">{t('board.share.tokenWarning')}</p>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={created.url}
                  aria-label={t('board.share.token')}
                  className="flex-1 font-mono text-mono-sm"
                />
                <Button variant="secondary" onClick={() => void copy(created.url)}>
                  {t('board.share.copy')}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="primary"
              className="self-start"
              loading={createLink.isPending}
              onClick={() => createLink.mutate()}
              data-testid="create-link"
            >
              {t('board.share.createLink')}
            </Button>
          )}
        </div>

        {error ? (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
