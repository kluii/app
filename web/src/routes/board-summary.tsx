// SPDX-License-Identifier: AGPL-3.0-only
import { createRoute } from '@tanstack/react-router';
import { BoardSummaryPage } from '../components/board/board-summary-page';
import { authedRoute } from './authed';

/**
 * `/boards/$boardId/summary` is a sibling of the board route, not a child: the
 * board page renders the board rail and has no outlet, and a summary is its own
 * page — a record you read and print.
 */
export const boardSummaryRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/boards/$boardId/summary',
  component: BoardSummaryRoute,
});

function BoardSummaryRoute() {
  const { boardId } = boardSummaryRoute.useParams();
  return <BoardSummaryPage boardId={boardId} />;
}
