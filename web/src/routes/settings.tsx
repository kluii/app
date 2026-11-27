// SPDX-License-Identifier: AGPL-3.0-only
import { createRoute } from '@tanstack/react-router';
import { AgentsSettings } from '../components/settings/agents-settings';
import { DangerSettings } from '../components/settings/danger-settings';
import { DigestSettings } from '../components/settings/digest-settings';
import { OidcSettings } from '../components/settings/oidc-settings';
import { ProfileSettings } from '../components/settings/profile-settings';
import { SecuritySettings } from '../components/settings/security-settings';
import { SessionsSettings } from '../components/settings/sessions-settings';
import { t } from '../i18n';
import { authedRoute } from './authed';

export const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings',
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-content px-6 py-8">
      <h1 className="font-display text-h1">{t('settings.title')}</h1>
      <div className="mt-6 flex flex-col gap-10">
        <ProfileSettings />
        <SessionsSettings />
        <DigestSettings />
        <AgentsSettings />
        <SecuritySettings />
        <OidcSettings />
        <DangerSettings />
      </div>
    </div>
  );
}
