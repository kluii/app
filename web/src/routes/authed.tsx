// SPDX-License-Identifier: AGPL-3.0-only
import { createRoute, redirect } from '@tanstack/react-router';
import { AppShell } from '../components/layout/app-shell';
import { loadMe } from '../lib/session';
import { rootRoute } from './root';

/**
 * Every screen behind a session hangs off this route. The guard runs once per
 * navigation, before the component mounts, so a signed-out visitor never sees
 * a board frame first.
 */
export const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  component: AppShell,
  beforeLoad: async () => {
    const me = await loadMe();
    if (!me) throw redirect({ to: '/login' });
    return { me };
  },
});
