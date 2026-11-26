// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * The platform popover: light dismiss, Esc, focus handling and the top layer
 * come from the browser (modern-web-guidance). No portal, no positioning
 * library, and it cannot be clipped by `overflow: hidden`.
 */
export function Popover({
  open,
  onClose,
  children,
  className,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.matches(':popover-open')) element.showPopover();
    if (!open && element.matches(':popover-open')) element.hidePopover();
  }, [open]);

  return (
    <div
      ref={ref}
      popover="auto"
      aria-labelledby={labelledBy}
      onToggle={(event) => {
        if ((event as unknown as { newState?: string }).newState === 'closed') onClose();
      }}
      className={cn(
        'm-0 mt-2 rounded-md border border-border bg-surface p-3 text-ink',
        'shadow-[var(--shadow-overlay)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
