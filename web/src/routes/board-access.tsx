// SPDX-License-Identifier: AGPL-3.0-only
import { createRoute } from '@tanstack/react-router';
import { AppShell } from '../components/layout/app-shell';
import { rootRoute } from './root';

/**
 * A board is not behind a session: a link cookie is a credential too
 * (docs/features/links-and-anonymous.md §3). The guard that matters is `can()`
 * on `/boards/:id/state`, so the route renders the shell and lets the page
 * answer 404 (unreadable) or 401 (no credential at all).
 */
export const boardAccessRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'board-access',
  component: AppShell,
});
