// SPDX-License-Identifier: AGPL-3.0-only
import { Link, Outlet, createRootRoute } from '@tanstack/react-router';
import { AppShell } from '../components/layout/app-shell';
import { buttonVariants } from '../components/ui/button';
import { EmptySlot } from '../components/ui/empty-slot';
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
      <div className="mx-auto w-full max-w-content px-6 py-8">
        <EmptySlot
          className="max-w-96"
          heading="h1"
          title={t('notFound.title')}
          body={t('notFound.body')}
          action={
            <Link to="/boards" className={buttonVariants({ variant: 'secondary' })}>
              {t('notFound.action')}
            </Link>
          }
        />
      </div>
    </AppShell>
  );
}
