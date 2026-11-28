// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../../api/client';
import type { SessionDto } from '../../api/types';
import { failureMessage } from '../../lib/api-error';
import { t } from '../../i18n';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';

/**
 * Active sessions list with per-session revoke (K5-08).
 * Revoking the current session signs out immediately and returns to `/login`.
 */
export function SessionsSettings() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: api.sessions,
    retry: false,
  });

  const revoke = useMutation({
    mutationFn: (session: SessionDto) => api.revokeSession(session.id),
    onSuccess: async (_data, session) => {
      setError(null);
      if (session.current) {
        queryClient.clear();
        await navigate({ to: '/login' });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (cause) => setError(failureMessage(cause)),
  });

  const revokeAll = useMutation({
    mutationFn: api.logoutAll,
    onSuccess: async () => {
      setError(null);
      queryClient.clear();
      await navigate({ to: '/login' });
    },
    onError: (cause) => setError(failureMessage(cause)),
  });

  const items = sessions.data?.items ?? [];

  return (
    <section className="flex max-w-140 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-h2">{t('settings.sessions.title')}</h2>
        {items.length > 1 ? (
          <Button variant="ghost" loading={revokeAll.isPending} onClick={() => revokeAll.mutate()}>
            {t('settings.sessions.revokeAll')}
          </Button>
        ) : null}
      </div>
      <p className="text-body-sm text-ink-muted">{t('settings.sessions.description')}</p>

      {error ? (
        <p className="text-body-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-border rounded-md border border-border">
        {items.map((session) => (
          <li
            key={session.id}
            data-testid="session-row"
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-body-sm text-ink">
                  {session.user_agent ?? t('settings.sessions.unknownDevice')}
                </span>
                {session.current ? <Chip>{t('settings.sessions.current')}</Chip> : null}
              </div>
              <span className="font-mono text-mono-sm text-ink-subtle">
                {session.ip ?? t('settings.sessions.unknownIp')}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              loading={revoke.isPending}
              onClick={() => revoke.mutate(session)}
            >
              {t('settings.sessions.revoke')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
