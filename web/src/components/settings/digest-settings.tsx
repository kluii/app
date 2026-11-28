// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { failureMessage } from '../../lib/api-error';
import { t } from '../../i18n';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Field } from '../ui/field';
import { Input } from '../ui/input';

/**
 * Daily digest preferences (K5-05 + K5-08).
 */
export function DigestSettings() {
  const queryClient = useQueryClient();
  const digest = useQuery({ queryKey: ['digest'], queryFn: api.digest, retry: false });

  const [enabled, setEnabled] = useState(false);
  const [hour, setHour] = useState('8');
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const [webhook, setWebhook] = useState('');
  const [email, setEmail] = useState('');
  const [rssUrl, setRssUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!digest.data) return;
    setEnabled(digest.data.enabled);
    setHour(String(digest.data.hour));
    setTimezone(digest.data.timezone);
  }, [digest.data]);

  const save = useMutation({
    mutationFn: api.updateDigest,
    onSuccess: async (next) => {
      setError(null);
      setStatus(t('settings.digest.saved'));
      if (next.rss_url) setRssUrl(next.rss_url);
      await queryClient.invalidateQueries({ queryKey: ['digest'] });
    },
    onError: (cause) => {
      setStatus(null);
      setError(failureMessage(cause));
    },
  });

  const testSend = useMutation({
    mutationFn: api.testDigest,
    onSuccess: (result) => {
      setError(null);
      setStatus(result.sent ? t('settings.digest.testSent') : t('settings.digest.testEmpty'));
    },
    onError: (cause) => {
      setStatus(null);
      setError(failureMessage(cause));
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({
      enabled,
      hour: Number(hour),
      timezone: timezone.trim(),
      ...(webhook.trim() === '' ? {} : { webhook: webhook.trim() }),
      ...(email.trim() === '' ? {} : { email: email.trim() }),
    });
  };

  return (
    <section className="flex max-w-140 flex-col gap-4">
      <h2 className="font-display text-h2">{t('settings.digest.title')}</h2>
      <p className="text-body-sm text-ink-muted">{t('settings.digest.description')}</p>

      {digest.data?.last_result === 'empty' ? (
        <p className="text-body-sm text-ink-subtle">{t('settings.digest.lastEmpty')}</p>
      ) : null}

      {error ? (
        <p className="text-body-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="text-body-sm text-ink-muted" role="status">
          {status}
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-sm border border-border p-4">
        <Checkbox
          id="digest-enabled"
          label={t('settings.digest.enabled')}
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.digest.hour')} htmlFor="digest-hour">
            <Input
              id="digest-hour"
              type="number"
              min={0}
              max={23}
              value={hour}
              onChange={(event) => setHour(event.target.value)}
            />
          </Field>
          <Field label={t('settings.digest.timezone')} htmlFor="digest-timezone">
            <Input
              id="digest-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
          </Field>
        </div>

        <Field label={t('settings.digest.webhook')} htmlFor="digest-webhook">
          <Input
            id="digest-webhook"
            type="url"
            value={webhook}
            placeholder={t('settings.digest.webhookPlaceholder')}
            onChange={(event) => setWebhook(event.target.value)}
          />
        </Field>

        <Field label={t('settings.digest.email')} htmlFor="digest-email">
          <Input
            id="digest-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t('settings.digest.save')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={testSend.isPending}
            onClick={() => testSend.mutate()}
          >
            {t('settings.digest.test')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            loading={save.isPending}
            onClick={() => save.mutate({ rss: 'rotate' })}
          >
            {t('settings.digest.rotateRss')}
          </Button>
          {digest.data?.channels.rss ? (
            <Button
              type="button"
              variant="ghost"
              loading={save.isPending}
              onClick={() => {
                setRssUrl(null);
                save.mutate({ rss: 'disable' });
              }}
            >
              {t('settings.digest.disableRss')}
            </Button>
          ) : null}
        </div>

        {rssUrl ? (
          <div className="flex flex-col gap-1 rounded-key bg-surface-2 p-3">
            <span className="text-label text-ink-muted">{t('settings.digest.rssOnce')}</span>
            <code className="break-all font-mono text-mono text-ink">{rssUrl}</code>
          </div>
        ) : null}
      </form>
    </section>
  );
}
