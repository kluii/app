// SPDX-License-Identifier: AGPL-3.0-only
import { createRouter } from '@tanstack/react-router';
import { authedRoute } from './authed';
import { boardRoute } from './board';
import { boardsRoute } from './boards';
import { indexRoute } from './index';
import { loginRoute } from './login';
import { settingsRoute } from './settings';
import { rootRoute } from './root';
import { signupRoute } from './signup';

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  signupRoute,
  authedRoute.addChildren([boardsRoute, boardRoute, settingsRoute]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  scrollRestoration: false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
