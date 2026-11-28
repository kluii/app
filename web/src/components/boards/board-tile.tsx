// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import type { Board, PublicBoard } from '../../api/types';
import { t } from '../../i18n';
import { formatDate } from '../../lib/format';

/**
 * One board in a grid (brief §4.1): 96 px minimum, a hairline, no shadow and no
 * translation. Hover moves the border and nothing else; the focus ring is the
 * global 2 px one. The surface is shared by the signed-in grid and a public
 * profile so the two lists cannot drift, and each supplies its own address.
 */
const TILE =
  'flex h-full min-h-24 flex-col justify-between gap-4 rounded-sm border border-border bg-card p-4 transition-colors duration-[var(--dur-fast)] hover:border-border-strong';

export function BoardTile({ board }: { board: Board }) {
  return (
    <Link
      to="/boards/$boardId"
      params={{ boardId: board.id }}
      data-testid={`board-${board.id}`}
      className={TILE}
    >
      <TileBody
        name={board.name}
        visibility={t(`boards.meta.${board.visibility}`)}
        role={board.role === undefined ? null : t(`board.role.${board.role}`)}
        closed={board.closed_at !== null}
        updatedAt={board.updated_at}
      />
    </Link>
  );
}

/** A profile tile has no role: whoever reads it is not a member. */
export function PublicBoardTile({ username, board }: { username: string; board: PublicBoard }) {
  return (
    <Link to="/$username/$slug" params={{ username, slug: board.slug }} className={TILE}>
      <TileBody
        name={board.name}
        visibility={t('boards.meta.public')}
        role={null}
        closed={false}
        updatedAt={board.updated_at}
      />
    </Link>
  );
}

/** The name on top, then one mono line: the facts left, the date right. */
function TileBody({
  name,
  visibility,
  role,
  closed,
  updatedAt,
}: {
  name: string;
  visibility: string;
  role: string | null;
  closed: boolean;
  updatedAt: string;
}) {
  return (
    <>
      <span className="line-clamp-2 text-h3 text-ink">{name}</span>
      <span className="flex items-center justify-between gap-2 font-mono text-mono-sm">
        <span className="flex min-w-0 items-center gap-1 text-ink-muted">
          <span className="truncate">{visibility}</span>
          {closed || role !== null ? (
            <>
              <span aria-hidden="true">·</span>
              {closed ? (
                <span className="flex shrink-0 items-center gap-1">
                  <Lock aria-hidden="true" size={12} strokeWidth={1.5} />
                  <span className="truncate">{t('boards.meta.closed')}</span>
                </span>
              ) : (
                <span className="truncate">{role}</span>
              )}
            </>
          ) : null}
        </span>
        <span className="shrink-0 whitespace-nowrap tabular-nums text-ink-subtle">
          {t('boards.meta.updated', { date: formatDate(updatedAt) })}
        </span>
      </span>
    </>
  );
}
