// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { api } from '../api/client';
import { AgentsSettings } from '../components/settings/agents-settings';
import { BrandingSettings } from '../components/settings/branding-settings';
import { SecuritySettings } from '../components/settings/security-settings';
import { t } from '../i18n';
import { queryKeys } from '../lib/query-client';
import { authedRoute } from './authed';

export const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings',
  component: SettingsPage,
});

function SettingsPage() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me, retry: false });
  return (
    <div className="mx-auto w-full max-w-content px-6 py-8">
      <h1 className="text-h1">{t('settings.title')}</h1>
      <div className="mt-6 flex flex-col gap-10">
        <AgentsSettings />
        <SecuritySettings />
        {me.data?.is_instance_admin ? <BrandingSettings /> : null}
      </div>
    </div>
  );
}
