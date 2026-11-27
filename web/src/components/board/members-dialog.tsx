// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Membership (K3-05). Reading the list is a board read; every control here is
 * rendered only when the server said the caller may use it, and the owner is
 * never demoted by a select — ownership moves through Transfer, deliberately.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { BoardState, Member, MemberRole } from '../../api/types';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input, Select } from '../ui/input';

const MANAGEABLE: MemberRole[] = ['admin', 'editor', 'viewer'];

export function MembersButton({ boardState }: { boardState: BoardState }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        data-testid="open-members"
      >
        {t('board.members.open')}
      </Button>
      <MembersDialog boardState={boardState} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function MembersDialog({
  boardState,
  open,
  onClose,
}: {
  boardState: BoardState;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<MemberRole>('editor');
  const [error, setError] = useState<string | null>(null);
  const members = useQuery({
    queryKey: queryKeys.members(boardState.board.id),
    queryFn: () => api.members(boardState.board.id),
    enabled: open,
  });
  const canManage = boardState.caller.can_manage_members;
  const isOwner = boardState.caller.role === 'owner';

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.members(boardState.board.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.board(boardState.board.id) }),
    ]);
  };
  const failure = (error_: unknown): void => {
    setError(error_ instanceof ApiError ? error_.message : t('common.error.generic'));
  };

  const invite = useMutation({
    mutationFn: () => api.inviteMember(boardState.board.id, username.trim(), role),
    onSuccess: async () => {
      setUsername('');
      setError(null);
      await refresh();
    },
    onError: failure,
  });
  const changeRole = useMutation({
    mutationFn: (input: { userId: string; role: MemberRole }) =>
      api.updateMember(boardState.board.id, input.userId, input.role),
    onSuccess: refresh,
    onError: failure,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(boardState.board.id, userId),
    onSuccess: refresh,
    onError: failure,
  });
  const transfer = useMutation({
    mutationFn: (userId: string) => api.transferBoard(boardState.board.id, userId),
    onSuccess: refresh,
    onError: failure,
  });

  const items: Member[] = members.data?.items ?? [];
  const busy = invite.isPending || changeRole.isPending || remove.isPending || transfer.isPending;

  return (
    <Dialog open={open} onClose={onClose} title={t('board.members.title')}>
      <div className="flex flex-col gap-4">
        {members.isPending ? (
          <p className="text-body-sm text-ink-subtle">{t('common.label.loading')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((member) => (
              <li key={member.user_id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-mono text-body-sm text-ink">{member.username}</span>
                {canManage && member.role !== 'owner' ? (
                  <Select
                    aria-label={t('board.members.roleFor', { username: member.username })}
                    value={member.role}
                    disabled={busy}
                    onChange={(event) =>
                      changeRole.mutate({
                        userId: member.user_id,
                        role: event.target.value as MemberRole,
                      })
                    }
                    className="h-7 w-28"
                  >
                    {MANAGEABLE.map((value) => (
                      <option key={value} value={value}>
                        {t(`board.members.role.${value}`)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="text-body-sm text-ink-muted">
                    {t(`board.members.role.${member.role}`)}
                  </span>
                )}
                <span className="ml-auto flex gap-1">
                  {isOwner && member.role !== 'owner' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => transfer.mutate(member.user_id)}
                    >
                      {t('board.members.transfer')}
                    </Button>
                  ) : null}
                  {canManage && member.role !== 'owner' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => remove.mutate(member.user_id)}
                    >
                      {t('board.members.remove')}
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          <form
            className="flex flex-col gap-2 border-t border-border pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (username.trim() === '') return;
              invite.mutate();
            }}
          >
            <label htmlFor="member-username" className="text-label text-ink">
              {t('board.members.invite')}
            </label>
            <div className="flex gap-2">
              <Input
                id="member-username"
                value={username}
                placeholder={t('board.members.username')}
                onChange={(event) => setUsername(event.target.value)}
                className="flex-1"
              />
              <Select
                aria-label={t('board.members.roleLabel')}
                value={role}
                onChange={(event) => setRole(event.target.value as MemberRole)}
                className="w-28"
              >
                {MANAGEABLE.map((value) => (
                  <option key={value} value={value}>
                    {t(`board.members.role.${value}`)}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="primary" loading={invite.isPending}>
                {t('board.members.add')}
              </Button>
            </div>
          </form>
        ) : null}

        {error ? (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
