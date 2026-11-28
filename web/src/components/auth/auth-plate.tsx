// SPDX-License-Identifier: AGPL-3.0-only
import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { useTheme } from '../../lib/theme';
import type { Tag } from '../../api/types';
import blackLogo from '../../assets/klui-logo-black.png';
import whiteLogo from '../../assets/klui-logo-white.png';
import { TagChip } from '../board/tag-chip';

/**
 * The auth plate (brief §4.6): the landing's hero inside the app — a mat of
 * `--plate` holding a 16:10 crop of the board, printed flat, no shadow, no
 * tilt. It is decorative: `aria-hidden`, no focusable element inside, and the
 * caption under it in `auth-page.tsx` carries the meaning for screen readers.
 * One plate per screen: the mat is the only one on the auth page, and the mock
 * holds no held card.
 *
 * The mat hugs its content — the aside centres it vertically — and keeps its
 * own padding of 16 px; the frame inside it keeps the app's surfaces
 * (`--canvas`, `--column`, `--card`), separated from the mat by a 1 px rule at
 * 20 % of `--plate-muted`.
 */
export function AuthPlate() {
  // The plate inverts in the light theme, so the wordmark printed on it
  // inverts with it: black on parchment in dark, white on ink in light.
  const { theme } = useTheme();
  return (
    <div
      aria-hidden="true"
      data-testid="auth-plate"
      className="flex w-full flex-col items-start gap-4 rounded-sm bg-plate p-4"
    >
      {/* `items-start` on the mat (and `self-start` here) keeps the wordmark at
          its own 808:490 ratio: as a stretched flex child it would fill the
          mat's width. */}
      <img
        src={theme === 'dark' ? blackLogo : whiteLogo}
        alt=""
        className="h-6 w-auto self-start"
      />
      {/* A 16:10 crop of the board, not a frame stretched to fill the page: the
          mock inside is anchored at the top left and clipped by the frame's
          edges, like a board wider than the mat. */}
      <div className="aspect-[16/10] w-full overflow-hidden rounded-key border border-plate-rule bg-canvas">
        <div className="relative h-full">
          <div className="absolute left-6 top-4 flex items-start gap-4">
            <MockColumn title={t('auth.preview.column.todo')}>
              <MockCard title={t('auth.preview.card.copy')} />
              <MockCard title={t('auth.preview.card.legal')} />
            </MockColumn>
            <MockColumn title={t('auth.preview.column.doing')}>
              <MockCard
                title={t('auth.preview.card.photos')}
                tags={[
                  { name: t('auth.preview.tag.photo'), color: 'var(--tag-sky)' },
                  { name: t('auth.preview.tag.copy'), color: null },
                ]}
              />
              <MockCard title={t('auth.preview.card.import')} />
            </MockColumn>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    // Plain divs, not landmarks: the mock is aria-hidden, and a named <section>
    // would surface as a region to axe anyway.
    <div className="flex w-column shrink-0 flex-col gap-2 rounded-sm border border-border bg-column p-2">
      <div className="flex h-8 items-center justify-between px-2">
        <h3 className="text-label text-ink">{title}</h3>
        <span className="font-mono text-mono-sm tabular-nums text-ink-subtle">2</span>
      </div>
      <ul className="flex flex-col gap-2">{children}</ul>
      {/* The real column footer (board-view.tsx): a Plus 14 and Add card — but
          a plain div, because the plate is aria-hidden and holds nothing
          focusable. */}
      <div className="flex h-8 w-full items-center gap-2 px-2 text-label text-ink-subtle">
        <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
        {t('board.card.add')}
      </div>
    </div>
  );
}

function MockCard({ title, tags }: { title: string; tags?: Tag[] }) {
  return (
    <li className="flex w-full flex-col gap-2 rounded-key border border-border bg-card p-3">
      <span className="line-clamp-3 text-body-sm font-medium text-ink">{title}</span>
      {tags && tags.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <TagChip key={tag.name} tag={tag} />
          ))}
        </span>
      ) : null}
    </li>
  );
}
