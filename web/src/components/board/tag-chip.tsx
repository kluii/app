// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from 'react';
import type { Tag } from '../../api/types';

/**
 * The only inline style the app allows: a custom property set from data
 * (DESIGN.md §15). The tint and the border mix live in tokens.css.
 */
export function TagChip({ tag }: { tag: Tag }) {
  if (!tag.color) {
    return (
      <span className="inline-flex h-5 items-center rounded-key border border-border bg-surface-2 px-2 font-mono text-mono-sm text-ink-muted">
        {tag.name}
      </span>
    );
  }
  return (
    <span
      className="tag-chip inline-flex h-5 items-center gap-1 rounded-key px-2 font-mono text-mono-sm"
      style={{ '--tag': tag.color } as CSSProperties}
    >
      <span aria-hidden="true" className="tag-chip__bar inline-block h-2.5 w-0.5 rounded-xs" />
      {tag.name}
    </span>
  );
}
