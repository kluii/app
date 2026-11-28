// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../../api/client';
import { failureMessage } from '../../lib/api-error';
import { applyBranding } from '../../lib/branding';
import { t } from '../../i18n';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';

/**
 * Instance branding admin controls (K5-01, DESIGN.md §2.4, §13).
 * Visible only to instance administrators. Accent contrast is enforced on save
 * by the server, which returns the measured WCAG AA ratio on refusal.
 */
export function BrandingSettings() {
  const queryClient = useQueryClient();
  const branding = useQuery({ queryKey: ['branding'], queryFn: api.branding, retry: false });
  const [instanceName, setInstanceName] = useState('');
  const [tabTitle, setTabTitle] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!branding.data) return;
    setInstanceName(branding.data.instance_name);
    setTabTitle(branding.data.tab_title ?? '');
    setAccentColor(branding.data.accent_color ?? '');
  }, [branding.data]);

  const update = useMutation({
    mutationFn: api.updateBranding,
    onSuccess: async (next) => {
      applyBranding(next);
      setError(null);
      setSavedNotice(true);
      await queryClient.invalidateQueries({ queryKey: ['branding'] });
    },
    onError: (cause) => {
      setSavedNotice(false);
      setError(failureMessage(cause));
    },
  });

  const upload = useMutation({
    mutationFn: ({ file, kind }: { file: File; kind: 'logo' | 'favicon' }) =>
      api.uploadBrandingAsset(file, kind),
    onSuccess: async (next) => {
      applyBranding(next);
      setError(null);
      setSavedNotice(true);
      await queryClient.invalidateQueries({ queryKey: ['branding'] });
    },
    onError: (cause) => {
      setSavedNotice(false);
      setError(failureMessage(cause));
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({
      instance_name: instanceName.trim(),
      tab_title: tabTitle.trim() === '' ? null : tabTitle.trim(),
      accent_color: accentColor.trim() === '' ? null : accentColor.trim(),
    });
  };

  const onFile = (kind: 'logo' | 'favicon') => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    upload.mutate({ file, kind });
    event.target.value = '';
  };

  return (
    <section className="flex max-w-140 flex-col gap-4">
      <h2 className="font-display text-h2">{t('settings.branding.title')}</h2>
      <p className="text-body-sm text-ink-muted">{t('settings.branding.description')}</p>

      {error ? (
        <p className="text-body-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {savedNotice ? (
        <p className="text-body-sm text-ink-muted" role="status">
          {t('settings.branding.saved')}
        </p>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-4 rounded-sm border border-border bg-surface p-4"
      >
        <Field label={t('settings.branding.instanceName')} htmlFor="branding-name">
          <Input
            id="branding-name"
            value={instanceName}
            maxLength={60}
            required
            onChange={(event) => setInstanceName(event.target.value)}
          />
        </Field>
        <Field label={t('settings.branding.tabTitle')} htmlFor="branding-tab-title">
          <Input
            id="branding-tab-title"
            value={tabTitle}
            maxLength={80}
            onChange={(event) => setTabTitle(event.target.value)}
          />
        </Field>
        <Field label={t('settings.branding.accentColor')} htmlFor="branding-accent">
          <Input
            id="branding-accent"
            value={accentColor}
            maxLength={7}
            placeholder={t('settings.branding.accentPlaceholder')}
            onChange={(event) => setAccentColor(event.target.value)}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={update.isPending}>
            {t('settings.branding.save')}
          </Button>
          {branding.data?.accent_color ? (
            <Button
              type="button"
              variant="ghost"
              loading={update.isPending}
              onClick={() => update.mutate({ accent_color: null })}
            >
              {t('settings.branding.resetAccent')}
            </Button>
          ) : null}
        </div>
      </form>

      <div className="flex flex-col gap-3 rounded-sm border border-border bg-surface p-4">
        <Field label={t('settings.branding.logo')} htmlFor="branding-logo">
          <input
            id="branding-logo"
            type="file"
            accept="image/png,image/svg+xml"
            onChange={onFile('logo')}
            className="text-body-sm text-ink-muted"
          />
        </Field>
        {branding.data?.logo_url ? (
          <div>
            <Button type="button" variant="ghost" onClick={() => update.mutate({ logo_url: null })}>
              {t('settings.branding.clearLogo')}
            </Button>
          </div>
        ) : null}

        <Field label={t('settings.branding.favicon')} htmlFor="branding-favicon">
          <input
            id="branding-favicon"
            type="file"
            accept="image/png,image/svg+xml"
            onChange={onFile('favicon')}
            className="text-body-sm text-ink-muted"
          />
        </Field>
        {branding.data?.favicon_url ? (
          <div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => update.mutate({ favicon_url: null })}
            >
              {t('settings.branding.clearFavicon')}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
