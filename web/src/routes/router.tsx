// SPDX-License-Identifier: AGPL-3.0-only
import { createRouter } from '@tanstack/react-router';
import { authedRoute } from './authed';
import { boardAccessRoute } from './board-access';
import { boardRoute } from './board';
import { boardSummaryRoute } from './board-summary';
import { boardsRoute } from './boards';
import { indexRoute } from './index';
import { loginRoute } from './login';
import { profileRoute } from './profile';
import { publicBoardRoute } from './public-board';
import { resetRoute } from './reset';
import { settingsRoute } from './settings';
import { styleguideRoute } from './styleguide';
import { rootRoute } from './root';
import { signupRoute } from './signup';

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  signupRoute,
  resetRoute,
  styleguideRoute,
  profileRoute,
  publicBoardRoute,
  boardAccessRoute.addChildren([boardRoute, boardSummaryRoute]),
  authedRoute.addChildren([boardsRoute, settingsRoute]),
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
