// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { useTheme } from '../../lib/theme';
import type { Tag } from '../../api/types';
import blackLogo from '../../assets/klui-logo-black.png';
import whiteLogo from '../../assets/klui-logo-white.png';
import { TagChip } from '../board/tag-chip';

/**
 * The auth plate (brief §4.6): the landing's hero inside the app — a mat of
 * `--plate` holding a mock of the board, printed flat, no shadow, no tilt.
 * It is decorative: `aria-hidden`, no focusable element inside, and the caption
 * under it in `auth-page.tsx` carries the meaning for screen readers. One plate
 * per screen: the mat is the only one on the auth page, and the mock holds no
 * held card.
 *
 * The mat keeps its own padding of 16 px; the frame inside it keeps the app's
 * surfaces (`--canvas`, `--column`, `--card`), separated from the mat by a
 * 1 px rule at 20 % of `--plate-muted`.
 */
export function AuthPlate() {
  // The plate inverts in the light theme, so the wordmark printed on it
  // inverts with it: black on parchment in dark, white on ink in light.
  const { theme } = useTheme();
  return (
    <div
      aria-hidden="true"
      data-testid="auth-plate"
      className="flex h-[calc(100dvh-56px-24px)] flex-col overflow-hidden rounded-sm bg-plate p-4"
    >
      <img src={theme === 'dark' ? blackLogo : whiteLogo} alt="" className="h-6 w-auto" />
      <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-key border border-plate-rule bg-canvas">
        {/* Two columns rise from the bottom of the frame; the frame clips the
            second one at its right edge, like a board wider than the mat. */}
        <div className="relative h-full">
          <div className="absolute bottom-0 left-6 flex items-start gap-4">
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
