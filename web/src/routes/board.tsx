// SPDX-License-Identifier: AGPL-3.0-only
import { createRoute } from '@tanstack/react-router';
import { BoardView } from '../components/board/board-view';
import { authedRoute } from './authed';

export const boardRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/boards/$boardId',
  component: BoardPage,
});

function BoardPage() {
  const { boardId } = boardRoute.useParams();
  return <BoardView boardId={boardId} />;
}
