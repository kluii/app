// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { Lock, Pencil, Trash2 } from 'lucide-react';
import type { Board, PublicBoard } from '../../api/types';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import { formatDate } from '../../lib/format';
import { BoardIconGlyph } from './board-icon';

/**
 * One board in a grid (brief §4.1): 96 px minimum, a hairline, no shadow and no
 * translation. Hover moves the border and nothing else; the focus ring is the
 * global 2 px one. The surface is shared by the signed-in grid and a public
 * profile so the two lists cannot drift, and each supplies its own address.
 */
const TILE =
  'flex h-full w-full min-h-24 flex-col justify-between gap-4 rounded-sm border border-border bg-card p-4 transition-colors duration-[var(--dur-fast)] hover:border-border-strong';

/**
 * The signed-in tile: a `relative` wrapper holds the link, stretched over the
 * whole tile with `absolute inset-0` so a click anywhere opens the board. The
 * visual surface sits under it and its content is `pointer-events-none`, so
 * the click lands on the link; the corner actions ride above both — they must
 * live outside the link, a button cannot nest in a link. The wrapper carries
 * no border of its own, so the stretched link measures the tile's full box,
 * border included.
 */
export function BoardTile({
  board,
  onEdit,
  onDelete,
}: {
  board: Board;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="group relative h-full w-full">
      <div className={TILE}>
        <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-2">
          <span className="flex items-start gap-2">
            {/* The 20 px box exists even without an icon, so the names of two
                tiles stay on the same column. */}
            <span
              aria-hidden="true"
              className="flex h-5 w-5 shrink-0 items-center justify-center text-ink-muted"
            >
              {board.icon === null ? null : <BoardIconGlyph name={board.icon} size={20} />}
            </span>
            <span className="line-clamp-2 min-w-0 text-h3 text-ink">{board.name}</span>
          </span>
          {board.description === null ? null : (
            <p className="line-clamp-1 text-body-sm text-ink-muted">{board.description}</p>
          )}
        </div>
        <TileMeta
          className="pointer-events-none"
          visibility={t(`boards.meta.${board.visibility}`)}
          role={board.role === undefined ? null : t(`board.role.${board.role}`)}
          closed={board.closed_at !== null}
          updatedAt={board.updated_at}
        />
      </div>
      <Link
        to="/boards/$boardId"
        params={{ boardId: board.id }}
        data-testid={`board-${board.id}`}
        aria-label={t('boards.tile.open', { name: board.name })}
        className="absolute inset-0 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      {onEdit === undefined && onDelete === undefined ? null : (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-100 [@media(pointer:coarse)]:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          {onEdit === undefined ? null : (
            <button
              type="button"
              onClick={onEdit}
              aria-label={t('boards.tile.edit')}
              data-testid={`board-edit-${board.id}`}
              className="flex h-7 w-7 items-center justify-center rounded-key bg-surface-raised/90 text-ink-muted transition-colors duration-[var(--dur-fast)] hover:text-ink"
            >
              <Pencil aria-hidden="true" size={16} strokeWidth={1.5} />
            </button>
          )}
          {onDelete === undefined ? null : (
            <button
              type="button"
              onClick={onDelete}
              aria-label={t('boards.tile.delete')}
              data-testid={`board-delete-${board.id}`}
              className="flex h-7 w-7 items-center justify-center rounded-key bg-surface-raised/90 text-ink-muted transition-colors duration-[var(--dur-fast)] hover:text-danger"
            >
              <Trash2 aria-hidden="true" size={16} strokeWidth={1.5} />
            </button>
          )}
        </div>
      )}
    </div>
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
      <TileMeta visibility={visibility} role={role} closed={closed} updatedAt={updatedAt} />
    </>
  );
}

/** One mono line: the visibility and role left, the date right. */
function TileMeta({
  visibility,
  role,
  closed,
  updatedAt,
  className,
}: {
  visibility: string;
  role: string | null;
  closed: boolean;
  updatedAt: string;
  className?: string;
}) {
  return (
    <span
      className={cn('flex items-center justify-between gap-2 font-mono text-mono-sm', className)}
    >
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
  );
}
