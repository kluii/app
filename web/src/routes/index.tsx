// SPDX-License-Identifier: AGPL-3.0-only
import { createRoute, redirect } from '@tanstack/react-router';
import { t } from '../i18n';
import { loadMe } from '../lib/session';
import { rootRoute } from './root';

/** `/` answers with a redirect, never marketing copy (docs/decisions.md D-01). */
export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async () => {
    const me = await loadMe();
    throw redirect({ to: me ? '/boards' : '/login' });
  },
  component: Redirecting,
});

function Redirecting() {
  return <p className="p-6 text-body-sm text-ink-muted">{t('startup.loading')}</p>;
}
