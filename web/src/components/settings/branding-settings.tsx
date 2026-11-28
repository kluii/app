// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../../api/client';
import { failureMessage } from '../../lib/api-error';
import { applyBranding } from '../../lib/branding';
import { t } from '../../i18n';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';

type AssetKind = 'logo' | 'favicon';

/** The two formats `validateUploadedAsset` accepts (server/src/settings/branding.ts). */
const ASSET_ACCEPT = 'image/png,image/svg+xml';

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
  const [uploadError, setUploadError] = useState<{ kind: AssetKind; message: string } | null>(null);
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
    mutationFn: ({ file, kind }: { file: File; kind: AssetKind }) =>
      api.uploadBrandingAsset(file, kind),
    onSuccess: async (next) => {
      applyBranding(next);
      setUploadError(null);
      setSavedNotice(true);
      await queryClient.invalidateQueries({ queryKey: ['branding'] });
    },
    // The refusal belongs to the row that was refused, not to a toast.
    onError: (cause, variables) => {
      setSavedNotice(false);
      setUploadError({ kind: variables.kind, message: failureMessage(cause) });
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

      <div className="flex flex-col gap-4 rounded-sm border border-border bg-surface p-4">
        <BrandAssetRow
          kind="logo"
          label={t('settings.branding.logo')}
          hint={t('settings.branding.assetHint')}
          url={branding.data?.logo_url ?? null}
          pending={upload.isPending && upload.variables?.kind === 'logo'}
          removing={update.isPending}
          error={uploadError?.kind === 'logo' ? uploadError.message : null}
          onFile={(file) => upload.mutate({ file, kind: 'logo' })}
          onRemove={() => update.mutate({ logo_url: null })}
        />
        <BrandAssetRow
          kind="favicon"
          label={t('settings.branding.favicon')}
          hint={t('settings.branding.assetHint')}
          url={branding.data?.favicon_url ?? null}
          pending={upload.isPending && upload.variables?.kind === 'favicon'}
          removing={update.isPending}
          error={uploadError?.kind === 'favicon' ? uploadError.message : null}
          onFile={(file) => upload.mutate({ file, kind: 'favicon' })}
          onRemove={() => update.mutate({ favicon_url: null })}
        />
      </div>
    </section>
  );
}

/**
 * One instance asset: a 56 px preview, the label, the hint the server enforces,
 * then a real Upload button that opens the picker. The file input stays in the
 * DOM — a button cannot open a picker on its own — but it is out of the tab
 * order: the button is the affordance, never the platform's "Choose file" text.
 * The row carries its own pending state and its own error, inline.
 */
function BrandAssetRow({
  kind,
  label,
  hint,
  url,
  pending,
  removing,
  error,
  onFile,
  onRemove,
}: {
  kind: AssetKind;
  label: string;
  hint: string;
  url: string | null;
  pending: boolean;
  removing: boolean;
  error: string | null;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const inputId = `branding-${kind}`;
  const hintId = `branding-${kind}-hint`;
  const asset =
    kind === 'logo' ? t('settings.branding.assetLogo') : t('settings.branding.assetFavicon');

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    // The same file twice in a row is a second upload, so the field is cleared.
    event.target.value = '';
    if (file) onFile(file);
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-center gap-3 sm:flex-1">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-surface">
          {url === null ? (
            <span className="font-mono text-mono-sm text-ink-subtle">{asset}</span>
          ) : (
            <img src={url} alt="" className="h-full w-full object-contain" />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={inputId} className="text-label font-medium text-ink">
            {label}
          </label>
          <p id={hintId} className="text-body-sm text-ink-muted">
            {hint}
          </p>
          {error === null ? null : (
            <p role="alert" className="text-body-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          loading={pending}
          aria-label={t('settings.branding.uploadFor', { asset })}
          onClick={() => input.current?.click()}
        >
          <Upload aria-hidden strokeWidth={1.5} className="h-4 w-4" />
          {t('settings.branding.upload')}
        </Button>
        {url === null ? null : (
          <Button
            variant="ghost"
            loading={removing}
            aria-label={t('settings.branding.removeFor', { asset })}
            onClick={onRemove}
          >
            {t('settings.branding.remove')}
          </Button>
        )}
        <input
          ref={input}
          id={inputId}
          type="file"
          accept={ASSET_ACCEPT}
          aria-describedby={hintId}
          tabIndex={-1}
          className="sr-only"
          onChange={pick}
        />
      </div>
    </div>
  );
}
