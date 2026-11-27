// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-account notification mute list and webhook settings (K5-04).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api/client';
import type { NotificationKind } from '../../api/types';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';

const KINDS: { kind: NotificationKind; labelKey: string }[] = [
  { kind: 'assignment', labelKey: 'notifications.kind.assignment' },
  { kind: 'mention', labelKey: 'notifications.kind.mention' },
  { kind: 'due_soon', labelKey: 'notifications.kind.due_soon' },
  { kind: 'moderation_pending', labelKey: 'notifications.kind.moderation_pending' },
  { kind: 'invitation', labelKey: 'notifications.kind.invitation' },
  { kind: 'board_closed', labelKey: 'notifications.kind.board_closed' },
];

export function NotificationsSettings() {
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: queryKeys.notificationPrefs,
    queryFn: api.notificationPrefs,
  });

  const [muted, setMuted] = useState<NotificationKind[]>([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!prefs.data) return;
    setMuted(prefs.data.muted_kinds);
    setWebhookUrl(prefs.data.webhook_url ?? '');
  }, [prefs.data]);

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
    onError: (err) => {
      setStatus(null);
      setError(err instanceof ApiError ? err.message : t('common.error.generic'));
    },
  });

  const toggleKind = (kind: NotificationKind) => {
    setMuted((prev) =>
      prev.includes(kind) ? prev.filter((item) => item !== kind) : [...prev, kind],
    );
  };

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
      <h2 id="notifications-settings-heading" className="text-h2">
        {t('notifications.prefs.title')}
      </h2>
      <p className="mt-1 text-body-sm text-ink-muted">{t('notifications.prefs.description')}</p>

      <form onSubmit={onSubmit} className="mt-4 flex max-w-lg flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-label font-medium text-ink">
            {t('notifications.prefs.typesHeading')}
          </legend>
          {KINDS.map(({ kind, labelKey }) => (
            <Checkbox
              key={kind}
              id={`notif-kind-${kind}`}
              label={t(labelKey)}
              checked={!muted.includes(kind)}
              onChange={() => toggleKind(kind)}
            />
          ))}
        </fieldset>

        <div className="flex flex-col gap-1.5">
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
        </div>

        {error ? (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        ) : null}
        {status ? (
          <p role="status" className="text-body-sm text-ink-muted">
            {status}
          </p>
        ) : null}

        <div>
          <Button type="submit" disabled={save.isPending}>
            {t('common.action.save')}
          </Button>
        </div>
      </form>
    </section>
  );
}
