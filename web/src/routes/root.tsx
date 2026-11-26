// SPDX-License-Identifier: AGPL-3.0-only
import { Link, Outlet, createRootRoute } from '@tanstack/react-router';
import { AppShell } from '../components/layout/app-shell';
import { buttonVariants } from '../components/ui/button';
import { t } from '../i18n';

/** The root renders whatever the child route draws; the shell lives on `authed`. */
export const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

function RootLayout() {
  return <Outlet />;
}

function NotFoundPage() {
  return (
    <AppShell>
      <div className="flex min-h-96 flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-h1">{t('notFound.title')}</h1>
        <p className="text-body-sm text-ink-muted">{t('notFound.body')}</p>
        <Link to="/boards" className={buttonVariants({ variant: 'secondary' })}>
          {t('notFound.action')}
        </Link>
      </div>
    </AppShell>
  );
}
