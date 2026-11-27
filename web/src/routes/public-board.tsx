// SPDX-License-Identifier: AGPL-3.0-only
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../api/client';
import { AppShell } from '../components/layout/app-shell';
import { queryKeys } from '../lib/query-client';
import { t } from '../i18n';
import { rootRoute } from './root';

/**
 * A human opens `/<owner>/<slug>`. The server answers the shell; this route
 * resolves the URL through the same `can()` the API uses and hands the visitor
 * to the id-addressed board. A URL never grants anything by itself — the
 * resolve endpoint decides, and a failure is the standard 404.
 */
export const publicBoardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$username/$slug',
  component: PublicBoardPage,
});

function PublicBoardPage() {
  const { username, slug } = publicBoardRoute.useParams();
  const navigate = useNavigate();
  const resolved = useQuery({
    queryKey: [...queryKeys.profile(username), slug],
    queryFn: () => api.resolveBoardUrl(username, slug),
    retry: false,
  });

  useEffect(() => {
    if (resolved.data)
      void navigate({
        to: '/boards/$boardId',
        params: { boardId: resolved.data.board_id },
        replace: true,
      });
  }, [navigate, resolved.data]);

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-content flex-col gap-3 px-6 py-8">
        {resolved.isError ? (
          <>
            <h1 className="font-display text-h1">{t('notFound.title')}</h1>
            <p className="text-body-sm text-ink-muted">{t('board.error.notFound')}</p>
            <Link to="/boards" className="text-label underline-offset-4 hover:underline">
              {t('notFound.action')}
            </Link>
          </>
        ) : (
          <p className="text-body-sm text-ink-muted">{t('common.state.loading')}</p>
        )}
      </div>
    </AppShell>
  );
}
