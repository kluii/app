// SPDX-License-Identifier: AGPL-3.0-only
import { createRoute } from '@tanstack/react-router';
import { SecuritySettings } from '../components/settings/security-settings';
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
      <h1 className="text-h1">{t('settings.title')}</h1>
      <div className="mt-6">
        <SecuritySettings />
      </div>
    </div>
  );
}
