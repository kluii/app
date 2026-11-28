// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Agents (K4-07, docs/mcp.md §7, docs/features/agents.md §1).
 *
 * A signed-in account issues agent keys here, sees the credential exactly once,
 * and afterwards only the facts the list endpoint returns: name, scope, board,
 * role, created, last used, expiry. Revocation is the only mutation on a key.
 * Scope copy is plain language and the role shown is the one the server
 * computed — this screen never guesses a permission.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { failureMessage } from '../../lib/api-error';
import type { AgentKey, CreatedAgentKey, MemberRole } from '../../api/types';
import { t } from '../../i18n';
import { formatDay, relativeUnit } from '../../lib/format';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { EmptySlot } from '../ui/empty-slot';
import { Field } from '../ui/field';
import { Input, Select } from '../ui/input';
import { useToast } from '../ui/toast';
import { AgentSetupPanel } from './agent-setup-panel';

const EXPIRY_DAYS = [30, 90, 365] as const;

type Status = 'active' | 'revoked' | 'expired';

export function AgentsSettings() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const keys = useQuery({ queryKey: queryKeys.agentKeys, queryFn: api.agentKeys });
  const boards = useQuery({ queryKey: queryKeys.boards, queryFn: api.boards });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'board' | 'user'>('board');
  const [boardId, setBoardId] = useState('');
  const [expiryDays, setExpiryDays] = useState<(typeof EXPIRY_DAYS)[number]>(90);
  const [created, setCreated] = useState<CreatedAgentKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = keys.data?.items ?? [];
  const boardItems = boards.data?.items ?? [];
  const boardValue = boardId !== '' ? boardId : (boardItems[0]?.id ?? '');
  const chosenBoard = boardItems.find((board) => board.id === boardValue);
  const scopeCopy =
    scope === 'user'
      ? t('settings.agents.scope.userCopy')
      : chosenBoard?.role === 'viewer'
        ? t('settings.agents.scope.boardCopyViewer')
        : t('settings.agents.scope.boardCopy');

  const failure = (caught: unknown): void => {
    setError(failureMessage(caught));
  };

  const create = useMutation({
    mutationFn: () =>
      api.createAgentKey({
        name: name.trim(),
        scope,
        ...(scope === 'board' ? { board_id: boardValue } : {}),
        expires_in_days: expiryDays,
      }),
    onSuccess: async (key) => {
      setCreated(key);
      setName('');
      setCreating(false);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.agentKeys });
    },
    onError: failure,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeAgentKey(id),
    onSuccess: async () => {
      setError(null);
      notify(t('settings.agents.revoked'));
      await queryClient.invalidateQueries({ queryKey: queryKeys.agentKeys });
    },
    onError: failure,
  });

  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      notify(t('settings.agents.copied'));
    } catch {
      notify(t('settings.agents.copyFailed'), 'danger');
    }
  };

  return (
    <section
      aria-labelledby="settings-agents-title"
      className="flex max-w-5xl flex-col gap-4"
      data-testid="settings-agents"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="settings-agents-title" className="font-display text-h2">
          {t('settings.agents.title')}
        </h2>
        {created === null && !creating ? (
          <Button variant="secondary" onClick={() => setCreating(true)} data-testid="agent-key-new">
            {t('settings.agents.add')}
          </Button>
        ) : null}
      </div>
      <p className="text-body-sm text-ink-muted">{t('settings.agents.description')}</p>

      {error ? (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : null}

      {creating ? (
        <form
          className="flex flex-col gap-3 rounded-md border border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Field
            label={t('settings.agents.name')}
            htmlFor="agent-key-name"
            hint={t('settings.agents.nameHint')}
          >
            <Input
              id="agent-key-name"
              name="agent-key-name"
              value={name}
              maxLength={60}
              autoComplete="off"
              required
              onChange={(event) => setName(event.target.value)}
              data-testid="agent-key-name"
            />
          </Field>

          <Field label={t('settings.agents.scope')} htmlFor="agent-key-scope">
            <Select
              id="agent-key-scope"
              value={scope}
              onChange={(event) => setScope(event.target.value === 'user' ? 'user' : 'board')}
              data-testid="agent-key-scope"
            >
              <option value="board">{t('settings.agents.scope.board')}</option>
              <option value="user">{t('settings.agents.scope.user')}</option>
            </Select>
          </Field>
          <p className="text-body-sm text-ink-muted">{scopeCopy}</p>

          {scope === 'board' ? (
            boardItems.length === 0 ? (
              <p className="text-body-sm text-ink-muted">{t('settings.agents.noBoards')}</p>
            ) : (
              <Field
                label={t('settings.agents.board')}
                htmlFor="agent-key-board"
                hint={t('settings.agents.boardHint')}
              >
                <Select
                  id="agent-key-board"
                  value={boardValue}
                  onChange={(event) => setBoardId(event.target.value)}
                  data-testid="agent-key-board"
                >
                  {boardItems.map((board) => (
                    <option key={board.id} value={board.id}>
                      {board.closed_at === null
                        ? board.name
                        : `${board.name} (${t('boards.meta.closed')})`}
                    </option>
                  ))}
                </Select>
              </Field>
            )
          ) : null}

          <Field label={t('settings.agents.expiry')} htmlFor="agent-key-expiry">
            <Select
              id="agent-key-expiry"
              value={expiryDays}
              onChange={(event) => setExpiryDays(Number(event.target.value) as 30 | 90 | 365)}
              data-testid="agent-key-expiry"
            >
              {EXPIRY_DAYS.map((days) => (
                <option key={days} value={days}>
                  {t('settings.agents.expiry.days', { count: days })}
                </option>
              ))}
            </Select>
          </Field>

          <p className="text-body-sm text-ink-subtle">{t('settings.agents.scope.readOnly')}</p>

          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={name.trim() === '' || (scope === 'board' && boardValue === '')}
              data-testid="agent-key-create"
            >
              {t('settings.agents.submit')}
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              {t('common.action.cancel')}
            </Button>
          </div>
        </form>
      ) : null}

      {created ? (
        <div
          className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3"
          data-testid="agent-key-once"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-h3">{t('settings.agents.created.title')}</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCreated(null)}
              data-testid="agent-key-done"
            >
              {t('settings.agents.created.done')}
            </Button>
          </div>
          <p className="text-body-sm text-ink">{t('settings.agents.created.warning')}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              // The panel mounts with the key: the caret lands on the one thing
              // that will never be shown again.
              autoFocus
              readOnly
              value={created.key}
              aria-label={t('settings.agents.created.key')}
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 font-mono text-mono"
              data-testid="agent-key-value"
            />
            <Button
              variant="secondary"
              onClick={() => void copy(created.key)}
              data-testid="agent-key-copy"
            >
              <Copy aria-hidden className="h-4 w-4" strokeWidth={1.5} />
              {t('settings.agents.copy')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-h3">{t('settings.agents.list.title')}</h3>

        {keys.isPending ? (
          <p className="text-body-sm text-ink-subtle">{t('common.label.loading')}</p>
        ) : keys.isError ? (
          <div className="flex items-center gap-3">
            <p className="text-body-sm text-ink-muted">{failureMessage(keys.error)}</p>
            <Button size="sm" variant="ghost" onClick={() => void keys.refetch()}>
              {t('common.action.retry')}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptySlot
            title={t('settings.agents.empty.title')}
            body={t('settings.agents.empty.body')}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((key) => (
              <AgentKeyRow
                key={key.id}
                agentKey={key}
                revoking={revoke.isPending && revoke.variables === key.id}
                onRevoke={(id) => revoke.mutate(id)}
              />
            ))}
          </ul>
        )}
      </div>

      <AgentSetupPanel
        fresh={created === null ? null : { id: created.id, key: created.key }}
        keys={items}
      />
    </section>
  );
}

function AgentKeyRow({
  agentKey,
  revoking,
  onRevoke,
}: {
  agentKey: AgentKey;
  revoking: boolean;
  onRevoke: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [focusTarget, setFocusTarget] = useState<'confirm' | 'revoke' | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const revokeRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const status = statusOf(agentKey);

  // The trigger and the confirm replace each other, so the browser would drop
  // focus on the floor; move it to whichever button just appeared (DESIGN §12).
  useEffect(() => {
    if (focusTarget === 'confirm') confirmRef.current?.focus();
    if (focusTarget === 'revoke') revokeRef.current?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  // A successful revoke removes both buttons: the row itself takes focus so the
  // reader stays where the change happened.
  const wasRevoked = useRef(agentKey.revoked_at !== null);
  useEffect(() => {
    const revoked = agentKey.revoked_at !== null;
    if (revoked && !wasRevoked.current) rowRef.current?.focus();
    wasRevoked.current = revoked;
  }, [agentKey.revoked_at]);

  return (
    <li
      ref={rowRef}
      tabIndex={-1}
      className="flex flex-col gap-2 py-3"
      data-testid={`agent-key-row-${agentKey.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-words text-body-sm font-medium text-ink">
          {agentKey.name}
        </span>
        <Chip>{t(`settings.agents.status.${status}`)}</Chip>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Chip>{t(`settings.agents.scope.${agentKey.scope}Short`)}</Chip>
        {agentKey.board_name === null ? null : (
          <Chip className="min-w-0 max-w-full">
            <span className="truncate" title={agentKey.board_name}>
              {agentKey.board_name}
            </span>
          </Chip>
        )}
        {agentKey.role === null ? null : <Chip>{roleLabel(agentKey.role)}</Chip>}
      </div>

      <p className="break-words font-mono text-mono-sm tabular-nums text-ink-subtle">
        {t('settings.agents.meta', {
          created: formatDay(agentKey.created_at),
          lastUsed: lastUsed(agentKey.last_used_at),
          expires: formatDay(agentKey.expires_at),
        })}
      </p>

      {agentKey.revoked_at !== null ? null : confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-body-sm text-ink-muted">{t('settings.agents.revokeWarning')}</p>
          <Button
            ref={confirmRef}
            size="sm"
            variant="danger"
            loading={revoking}
            onClick={() => onRevoke(agentKey.id)}
            data-testid={`agent-key-revoke-confirm-${agentKey.id}`}
          >
            {t('settings.agents.revokeConfirm')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setConfirming(false);
              setFocusTarget('revoke');
            }}
          >
            {t('common.action.cancel')}
          </Button>
        </div>
      ) : (
        <Button
          ref={revokeRef}
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => {
            setConfirming(true);
            setFocusTarget('confirm');
          }}
          data-testid={`agent-key-revoke-${agentKey.id}`}
        >
          {t('settings.agents.revoke')}
        </Button>
      )}
    </li>
  );
}

function statusOf(agentKey: AgentKey): Status {
  if (agentKey.revoked_at !== null) return 'revoked';
  if (new Date(agentKey.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

function lastUsed(value: string | null): string {
  if (value === null) return t('settings.agents.neverUsed');
  const { unit, count } = relativeUnit(value);
  return t(`settings.agents.when.${unit}`, { count });
}

function roleLabel(role: MemberRole): string {
  return t(`board.members.role.${role}`);
}
