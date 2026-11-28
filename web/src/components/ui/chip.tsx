// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** Height 20, mono-sm, surface-2 with a hairline border (DESIGN.md §7). */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-key border border-border bg-surface-2 px-2 font-mono text-mono-sm text-ink-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}
