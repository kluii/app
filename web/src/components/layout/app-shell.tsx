// SPDX-License-Identifier: AGPL-3.0-only
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { LogOut, Moon, Sun } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { api } from '../../api/client';
import { applyBranding } from '../../lib/branding';
import { queryKeys } from '../../lib/query-client';
import { useTheme } from '../../lib/theme';
import { t } from '../../i18n';
import { Button } from '../ui/button';
import lightLogo from '../../assets/light-logo.png';
import darkLogo from '../../assets/dark-logo.png';

/**
 * 48 px bar, canvas ground, hairline bottom, no shadow (DESIGN.md §4).
 * The footer is mandatory on every page (AGENTS.md §8).
 */
export function AppShell({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const me = useQuery({
    queryKey: queryKeys.me,
    queryFn: api.me,
    retry: false,
    staleTime: 30_000,
  });

  const branding = useQuery({
    queryKey: ['branding'],
    queryFn: api.branding,
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    document.documentElement.lang = 'en';
  }, []);

  useEffect(() => {
    if (branding.data) applyBranding(branding.data);
  }, [branding.data]);

  const signOut = async () => {
    await api.logout();
    await navigate({ to: '/login' });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      {/* The first Tab stop is a way past the header, every page (K2-15). */}
      <a
        href="#main-content"
        className="sr-only rounded-sm border border-border bg-surface px-3 py-1.5 text-body-sm text-ink focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50"
      >
        {t('common.action.skipToContent')}
      </a>

      <header
        data-app-chrome="true"
        className="flex h-12 items-center justify-between border-b border-border px-4"
      >
        <div className="flex items-center gap-3">
          <Link
            to="/boards"
            className="flex items-center rounded-sm outline-offset-4"
            aria-label={branding.data?.instance_name ?? t('common.app.name')}
          >
            <img
              src={branding.data?.logo_url ?? (theme === 'dark' ? lightLogo : darkLogo)}
              alt={branding.data?.instance_name ?? t('common.app.name')}
              className="h-6 w-auto"
            />
          </Link>
          {actions}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={t('theme.toggle')}
            title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
          {me.data ? (
            <>
              <Link
                to="/settings"
                className="rounded-sm px-2 text-label text-ink-muted underline-offset-4 hover:text-ink hover:underline"
              >
                {t('nav.account')}
              </Link>
              <span className="font-mono text-mono-sm text-ink-muted">{me.data.username}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void signOut()}
                aria-label={t('common.action.signOut')}
                title={t('common.action.signOut')}
              >
                <LogOut size={16} />
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
        {children ?? <Outlet />}
      </main>

      <footer className="border-t border-border px-4 py-3">
        <a
          href="https://wyliam.dev"
          target="_blank"
          rel="noreferrer noopener"
          className="text-body-sm text-ink-subtle underline-offset-4 hover:text-ink-muted hover:underline"
        >
          {t('common.footer.madeBy')}
        </a>
      </footer>
    </div>
  );
}
