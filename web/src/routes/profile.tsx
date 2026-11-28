// SPDX-License-Identifier: AGPL-3.0-only
import { Link, createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { AppShell } from '../components/layout/app-shell';
import { queryKeys } from '../lib/query-client';
import { formatDate } from '../lib/format';
import { t } from '../i18n';
import { rootRoute } from './root';

/**
 * K3-01. The owner's public face: the boards anyone may read. The server
 * prerenders the same list for a crawler; this route replaces it on the first
 * render, so the page a human sees is a product page, not a document.
 */
export const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$username',
  component: ProfilePage,
});

function ProfilePage() {
  const { username } = profileRoute.useParams();
  const profile = useQuery({
    queryKey: queryKeys.profile(username),
    queryFn: () => api.userBoards(username),
    retry: false,
  });

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-1">
          <h1 className="font-display text-h1">@{username}</h1>
          <p className="text-body-sm text-ink-muted">{t('profile.intro')}</p>
        </header>

        {profile.isPending ? (
          <p className="text-body-sm text-ink-muted">{t('common.state.loading')}</p>
        ) : profile.isError ? (
          <p className="text-body-sm text-ink-muted">{t('notFound.body')}</p>
        ) : profile.data.items.length === 0 ? (
          <p className="text-body-sm text-ink-muted">{t('profile.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {profile.data.items.map((board) => (
              <li key={board.id} className="flex items-center justify-between gap-4 py-2">
                <Link
                  to="/$username/$slug"
                  params={{ username, slug: board.slug }}
                  className="rounded-sm text-label underline-offset-4 hover:underline"
                >
                  {board.name}
                </Link>
                <span className="font-mono text-mono-sm text-ink-subtle">
                  {formatDate(board.updated_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
