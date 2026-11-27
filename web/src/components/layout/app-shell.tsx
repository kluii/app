// SPDX-License-Identifier: AGPL-3.0-only
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '../../api/client';
import { applyBranding } from '../../lib/branding';
import { cn } from '../../lib/cn';
import { queryKeys } from '../../lib/query-client';
import { useTheme } from '../../lib/theme';
import { t } from '../../i18n';
import whiteLogo from '../../assets/klui-logo-white.png';
import blackLogo from '../../assets/klui-logo-black.png';
import { AccountMenu } from './account-menu';
import { NotificationBell } from './notification-bell';

/**
 * 56 px bar, canvas ground, hairline bottom, no shadow (DESIGN.md §4).
 */
export function AppShell({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  const { theme } = useTheme();
  // A board is a fixed frame: its rail scrolls, the page does not. Every other
  // screen is a document and keeps scrolling normally.
  const onBoard = useRouterState({
    select: (state) => /^\/boards\/[^/]+$/.test(state.location.pathname),
  });
  const me = useQuery({
    queryKey: queryKeys.me,
    queryFn: api.me,
    retry: false,
    staleTime: 30_000,
  });

  // An instance may rename itself and swap its wordmark; the defaults are the
  // app's own and the accent is applied as a token override (K5-01).
  const branding = useQuery({
    queryKey: ['branding'],
    queryFn: api.branding,
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (branding.data) applyBranding(branding.data);
  }, [branding.data]);

  return (
    <div
      className={cn(
        'flex flex-col bg-canvas text-ink',
        onBoard ? 'h-dvh overflow-hidden' : 'min-h-dvh',
      )}
    >
      {/* The first Tab stop is a way past the header, every page (K2-15). */}
      <a
        href="#main-content"
        className="sr-only rounded-sm border border-border bg-surface px-3 py-1.5 text-body-sm text-ink focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50"
      >
        {t('common.action.skipToContent')}
      </a>

      <header
        data-app-chrome="true"
        className="flex h-14 items-center justify-between border-b border-border px-4"
      >
        <div className="flex items-center gap-3">
          <Link
            to="/boards"
            className="flex items-center rounded-sm outline-offset-4"
            aria-label={branding.data?.instance_name ?? t('common.app.name')}
          >
            <img
              src={branding.data?.logo_url ?? (theme === 'dark' ? whiteLogo : blackLogo)}
              alt={branding.data?.instance_name ?? t('common.app.name')}
              className="h-7 w-auto sm:h-8"
            />
          </Link>
          {actions}
        </div>
        <div className="flex items-center gap-1.5">
          {me.data ? (
            <>
              <NotificationBell />
              <AccountMenu me={me.data} />
            </>
          ) : null}
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          'min-h-0 flex-1 focus:outline-none',
          onBoard ? 'overflow-hidden' : 'overflow-y-auto',
        )}
      >
        {children ?? <Outlet />}
      </main>
    </div>
  );
}
