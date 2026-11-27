// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OIDC SSO account linking + instance admin provider management (K5-09).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api/client';
import type { OidcTestResult } from '../../api/types';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Field } from '../ui/field';
import { Input } from '../ui/input';

export function OidcSettings() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const isAdmin = me.data?.is_instance_admin === true;

  const publicProviders = useQuery({
    queryKey: queryKeys.oidcProviders,
    queryFn: api.oidcProviders,
  });
  const linkedAccounts = useQuery({
    queryKey: queryKeys.linkedOidc,
    queryFn: api.linkedOidcAccounts,
  });
  const adminProviders = useQuery({
    queryKey: queryKeys.adminOidcProviders,
    queryFn: api.adminOidcProviders,
    enabled: isAdmin,
  });

  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [issuerUrl, setIssuerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, OidcTestResult>>({});

  const createProvider = useMutation({
    mutationFn: () =>
      api.createAdminOidcProvider({
        slug: slug.trim().toLowerCase(),
        name: name.trim(),
        issuer_url: issuerUrl.trim(),
        client_id: clientId.trim(),
        client_secret: clientSecret,
        enabled,
      }),
    onSuccess: () => {
      setSlug('');
      setName('');
      setIssuerUrl('');
      setClientId('');
      setClientSecret('');
      setEnabled(false);
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminOidcProviders });
      void queryClient.invalidateQueries({ queryKey: queryKeys.oidcProviders });
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : t('common.error.generic'));
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: (input: { slug: string; enabled: boolean }) =>
      api.updateAdminOidcProvider(input.slug, { enabled: input.enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminOidcProviders });
      void queryClient.invalidateQueries({ queryKey: queryKeys.oidcProviders });
    },
  });

  const deleteProvider = useMutation({
    mutationFn: (targetSlug: string) => api.deleteAdminOidcProvider(targetSlug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminOidcProviders });
      void queryClient.invalidateQueries({ queryKey: queryKeys.oidcProviders });
    },
  });

  const testProvider = useMutation({
    mutationFn: (targetSlug: string) => api.testAdminOidcProvider(targetSlug),
    onSuccess: (result, targetSlug) => {
      setTestResults((prev) => ({ ...prev, [targetSlug]: result }));
    },
  });

  const linkProvider = useMutation({
    mutationFn: (targetSlug: string) => api.linkOidcProvider(targetSlug),
    onSuccess: (res) => {
      window.location.assign(res.url);
    },
  });

  const unlinkProvider = useMutation({
    mutationFn: (targetSlug: string) => api.unlinkOidcProvider(targetSlug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.linkedOidc });
    },
  });

  const enabledList = publicProviders.data?.items ?? [];
  const linkedList = linkedAccounts.data?.items ?? [];
  const linkedBySlug = new Set(linkedList.map((item) => item.provider));
  const enabledSlugs = new Set(enabledList.map((item) => item.slug));
  const disconnectedLinked = linkedList.filter((item) => !enabledSlugs.has(item.provider));

  const showUserSection = enabledList.length > 0 || linkedList.length > 0;
  if (!showUserSection && !isAdmin) return null;

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    createProvider.mutate();
  };

  return (
    <section aria-labelledby="oidc-settings-heading" className="border-t border-border pt-6">
      <h2 id="oidc-settings-heading" className="text-h2">
        {t('oidc.settings.title')}
      </h2>
      <p className="mt-1 text-body-sm text-ink-muted">{t('oidc.settings.description')}</p>

      {showUserSection ? (
        <div className="mt-4 flex flex-col gap-2">
          <h3 className="text-label font-medium text-ink">{t('oidc.settings.linkedHeading')}</h3>
          {enabledList.map((provider) => {
            const isLinked = linkedBySlug.has(provider.slug);
            return (
              <div
                key={provider.slug}
                className="flex items-center justify-between rounded-sm border border-border px-3 py-2"
              >
                <div>
                  <p className="text-body-sm font-medium text-ink">{provider.name}</p>
                  <p className="font-mono text-mono-sm text-ink-muted">{provider.slug}</p>
                </div>
                {isLinked ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => unlinkProvider.mutate(provider.slug)}
                    disabled={unlinkProvider.isPending}
                  >
                    {t('oidc.settings.unlink')}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => linkProvider.mutate(provider.slug)}
                    disabled={linkProvider.isPending}
                  >
                    {t('oidc.settings.link')}
                  </Button>
                )}
              </div>
            );
          })}
          {disconnectedLinked.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between rounded-sm border border-border px-3 py-2"
            >
              <div>
                <p className="font-mono text-mono-sm text-ink">{account.provider}</p>
                <p className="font-mono text-mono-sm text-ink-muted">
                  {account.provider_account_id}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => unlinkProvider.mutate(account.provider)}
                disabled={unlinkProvider.isPending}
              >
                {t('oidc.settings.unlink')}
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {isAdmin ? (
        <div className="mt-6 flex flex-col gap-4">
          <div>
            <h3 className="text-label font-medium text-ink">{t('oidc.admin.heading')}</h3>
            <p className="mt-1 text-body-sm text-ink-muted">{t('oidc.admin.breakGlassNotice')}</p>
            {me.data && !me.data.totp_enabled ? (
              <p className="mt-1 text-body-sm text-danger">{t('oidc.admin.breakGlassTotpWarn')}</p>
            ) : null}
          </div>

          {(adminProviders.data?.items.length ?? 0) > 0 ? (
            <div className="flex flex-col gap-3">
              {adminProviders.data?.items.map((provider) => {
                const tested = testResults[provider.slug];
                return (
                  <div
                    key={provider.slug}
                    className="rounded-sm border border-border bg-surface px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-body-sm font-medium text-ink">
                          {provider.name}{' '}
                          <span className="font-mono text-mono-sm text-ink-muted">
                            ({provider.slug})
                          </span>
                        </p>
                        <p className="font-mono text-mono-sm text-ink-muted">
                          {provider.issuer_url}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => testProvider.mutate(provider.slug)}
                          disabled={testProvider.isPending}
                        >
                          {t('oidc.admin.testProvider')}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            toggleEnabled.mutate({
                              slug: provider.slug,
                              enabled: !provider.enabled,
                            })
                          }
                          disabled={toggleEnabled.isPending}
                        >
                          {provider.enabled ? t('oidc.admin.disable') : t('oidc.admin.enable')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteProvider.mutate(provider.slug)}
                          disabled={deleteProvider.isPending}
                        >
                          {t('common.action.delete')}
                        </Button>
                      </div>
                    </div>
                    {tested ? (
                      <p
                        role={tested.ok ? 'status' : 'alert'}
                        className={`mt-2 text-body-sm ${
                          tested.ok ? 'text-ink-muted' : 'text-danger'
                        }`}
                      >
                        {tested.ok
                          ? t('oidc.admin.testOk', { issuer: tested.issuer })
                          : tested.error}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          <form
            onSubmit={onCreate}
            className="flex max-w-lg flex-col gap-3 rounded-sm border border-border p-4"
          >
            <h4 className="text-label font-medium text-ink">{t('oidc.admin.addHeading')}</h4>
            <Field label={t('oidc.admin.slug')} htmlFor="oidc-slug">
              <Input
                id="oidc-slug"
                required
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder={t('oidc.admin.slugPlaceholder')}
              />
            </Field>
            <Field label={t('oidc.admin.name')} htmlFor="oidc-name">
              <Input
                id="oidc-name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('oidc.admin.namePlaceholder')}
              />
            </Field>
            <Field label={t('oidc.admin.issuerUrl')} htmlFor="oidc-issuer">
              <Input
                id="oidc-issuer"
                type="url"
                required
                value={issuerUrl}
                onChange={(event) => setIssuerUrl(event.target.value)}
                placeholder={t('oidc.admin.issuerPlaceholder')}
              />
            </Field>
            <Field label={t('oidc.admin.clientId')} htmlFor="oidc-client-id">
              <Input
                id="oidc-client-id"
                required
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
              />
            </Field>
            <Field label={t('oidc.admin.clientSecret')} htmlFor="oidc-client-secret">
              <Input
                id="oidc-client-secret"
                type="password"
                required
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
              />
            </Field>
            <Checkbox
              id="oidc-enabled"
              label={t('oidc.admin.enabledLabel')}
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            {formError ? (
              <p role="alert" className="text-body-sm text-danger">
                {formError}
              </p>
            ) : null}
            <div>
              <Button type="submit" disabled={createProvider.isPending}>
                {t('oidc.admin.addSubmit')}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
