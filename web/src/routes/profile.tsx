// SPDX-License-Identifier: AGPL-3.0-only
import { createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { PublicBoardTile } from '../components/boards/board-tile';
import { AppShell } from '../components/layout/app-shell';
import { cn } from '../lib/cn';
import { useArrival } from '../lib/entrance';
import { queryKeys } from '../lib/query-client';
import { atUsername } from '../lib/username';
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
  const arrived = useArrival();
  const profile = useQuery({
    queryKey: queryKeys.profile(username),
    queryFn: () => api.userBoards(username),
    retry: false,
  });

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-1">
          <h1 className="font-display text-h1">{atUsername(username)}</h1>
          <p className="text-body-sm text-ink-muted">{t('profile.intro')}</p>
        </header>

        {profile.isPending ? (
          <p className="text-body-sm text-ink-subtle">{t('common.state.loading')}</p>
        ) : profile.isError ? (
          <p className="text-body-sm text-ink-muted">{t('notFound.body')}</p>
        ) : profile.data.items.length === 0 ? (
          <p className="text-body-sm text-ink-muted">{t('profile.empty')}</p>
        ) : (
          <ul
            className={cn(
              'grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
              arrived && 'enter-stagger',
            )}
          >
            {profile.data.items.map((board) => (
              <li key={board.id}>
                <PublicBoardTile username={username} board={board} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
