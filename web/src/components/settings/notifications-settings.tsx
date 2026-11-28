// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-account notification preferences and webhook settings (K5-04,
 * docs/features/digest.md §1). A switch is a state that is already saved,
 * so it saves the moment it flips (optimistic, rolled back on error); the
 * webhook URL is a form, so it keeps one explicit Save.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { NotificationKind } from '../../api/types';
import { failureMessage } from '../../lib/api-error';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';

const KINDS: { kind: NotificationKind; labelKey: string; descKey: string }[] = [
  {
    kind: 'assignment',
    labelKey: 'notifications.kind.assignment',
    descKey: 'notifications.prefs.kind.assignment.desc',
  },
  {
    kind: 'mention',
    labelKey: 'notifications.kind.mention',
    descKey: 'notifications.prefs.kind.mention.desc',
  },
  {
    kind: 'due_soon',
    labelKey: 'notifications.kind.due_soon',
    descKey: 'notifications.prefs.kind.due_soon.desc',
  },
  {
    kind: 'moderation_pending',
    labelKey: 'notifications.kind.moderation_pending',
    descKey: 'notifications.prefs.kind.moderation_pending.desc',
  },
  {
    kind: 'invitation',
    labelKey: 'notifications.kind.invitation',
    descKey: 'notifications.prefs.kind.invitation.desc',
  },
  {
    kind: 'board_closed',
    labelKey: 'notifications.kind.board_closed',
    descKey: 'notifications.prefs.kind.board_closed.desc',
  },
];

export function NotificationsSettings() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const prefs = useQuery({
    queryKey: queryKeys.notificationPrefs,
    queryFn: api.notificationPrefs,
  });

  const [muted, setMuted] = useState<NotificationKind[]>([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hydrate once: after that the local state leads, so an optimistic switch
  // save never clobbers an unsaved edit in the webhook field.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !prefs.data) return;
    hydrated.current = true;
    setMuted(prefs.data.muted_kinds);
    setWebhookUrl(prefs.data.webhook_url ?? '');
  }, [prefs.data]);

  const toggle = useMutation({
    mutationFn: (muted_kinds: NotificationKind[]) => api.updateNotificationPrefs({ muted_kinds }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationPrefs });
    },
  });

  const toggleKind = (kind: NotificationKind): void => {
    const previous = muted;
    const next = previous.includes(kind)
      ? previous.filter((item) => item !== kind)
      : [...previous, kind];
    setMuted(next);
    setError(null);
    toggle.mutate(next, {
      onError: (cause) => {
        setMuted(previous);
        setError(failureMessage(cause));
      },
    });
  };

  const save = useMutation({
    mutationFn: () =>
      api.updateNotificationPrefs({
        muted_kinds: muted,
        webhook_url: webhookUrl.trim() === '' ? null : webhookUrl.trim(),
      }),
    onSuccess: (updated) => {
      setMuted(updated.muted_kinds);
      setWebhookUrl(updated.webhook_url ?? '');
      setError(null);
      setStatus(t('notifications.prefs.saved'));
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationPrefs });
    },
    onError: (cause) => {
      setStatus(null);
      setError(failureMessage(cause));
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setStatus(null);
    setError(null);
    save.mutate();
  };

  return (
    <section
      aria-labelledby="notifications-settings-heading"
      className="border-t border-border pt-6"
    >
      <h2 id="notifications-settings-heading" className="font-display text-h2">
        {t('notifications.prefs.title')}
      </h2>
      <p className="mt-1 text-body-sm text-ink-muted">{t('notifications.prefs.description')}</p>

      {error ? (
        <p role="alert" className="mt-4 text-body-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-3">
        <h3 className="text-label font-medium text-ink">{t('notifications.prefs.kindsHeading')}</h3>
        <ul className="flex flex-col divide-y divide-border">
          {KINDS.map(({ kind, labelKey, descKey }) => {
            const labelId = `notif-kind-${kind}-label`;
            const descId = `notif-kind-${kind}-desc`;
            return (
              <li key={kind} className="flex min-h-14 items-center justify-between gap-4 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span id={labelId} className="text-label text-ink">
                    {t(labelKey)}
                  </span>
                  <span id={descId} className="text-body-sm text-ink-muted">
                    {t(descKey)}
                  </span>
                </div>
                <Switch
                  aria-labelledby={`${labelId} ${descId}`}
                  checked={!muted.includes(kind)}
                  onCheckedChange={() => toggleKind(kind)}
                />
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-8 flex max-w-lg flex-col gap-3">
        <h3 className="text-label font-medium text-ink">
          {t('notifications.prefs.channelsHeading')}
        </h3>
        <p className="text-body-sm text-ink-muted">{t('notifications.prefs.inAppAlways')}</p>
        <form onSubmit={onSubmit} className="flex flex-col gap-1">
          <label htmlFor="notif-webhook-url" className="text-label font-medium text-ink">
            {t('notifications.prefs.webhookLabel')}
          </label>
          <Input
            id="notif-webhook-url"
            type="url"
            value={webhookUrl}
            onChange={(event) => setWebhookUrl(event.target.value)}
            placeholder={t('notifications.prefs.webhookPlaceholder')}
          />
          <p className="text-body-sm text-ink-muted">{t('notifications.prefs.webhookHint')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" loading={save.isPending}>
              {t('common.action.save')}
            </Button>
            {status ? (
              <p role="status" className="text-body-sm text-ink-muted">
                {status}
              </p>
            ) : null}
          </div>
        </form>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-4">
        <p className="text-body-sm text-ink-muted">{t('notifications.prefs.digestNote')}</p>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void navigate({ to: '/settings', search: { section: 'digest' } })}
        >
          {t('notifications.prefs.digestButton')}
        </Button>
      </div>
    </section>
  );
}
