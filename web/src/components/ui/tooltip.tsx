// SPDX-License-Identifier: AGPL-3.0-only
import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A tooltip that is a description, not a dialog: the trigger keeps its own
 * accessible name and gains `aria-describedby`. Shown on hover and on focus,
 * hidden under `prefers-reduced-motion` is irrelevant because it does not
 * animate: a static frame is the design.
 */
export function Tooltip({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <span className={cn('group relative inline-flex', className)}>
      <span aria-describedby={id} className="inline-flex">
        {children}
      </span>
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded-sm border border-border bg-surface px-2 py-1 text-label text-ink shadow-[var(--shadow-overlay)] group-hover:block group-focus-within:block"
      >
        {label}
      </span>
    </span>
  );
}
