// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { cn } from '../../lib/cn';

/**
 * The platform popover: light dismiss, Esc, focus handling and the top layer
 * come from the browser (modern-web-guidance). No portal, no positioning
 * library, and it cannot be clipped by `overflow: hidden`.
 *
 * A top-layer popover is laid out against the viewport, so it is anchored to its
 * trigger here: without this, the UA centres it in the window and a menu opens
 * nowhere near the button that owns it.
 */
export function Popover({
  open,
  onClose,
  children,
  className,
  labelledBy,
  anchor,
  align = 'start',
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  anchor?: RefObject<HTMLElement | null>;
  align?: 'start' | 'end';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.matches(':popover-open')) element.showPopover();
    if (!open && element.matches(':popover-open')) element.hidePopover();
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const element = ref.current;
    if (!element) return;

    const place = () => {
      const sibling = element.previousElementSibling;
      const trigger = anchor?.current ?? (sibling instanceof HTMLElement ? sibling : null);
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const left = align === 'end' ? rect.right - width : rect.left;
      const below = rect.bottom + 8;
      const flip = below + height > window.innerHeight - 8;
      element.style.position = 'fixed';
      element.style.margin = '0';
      element.style.left = `${Math.round(Math.max(8, Math.min(left, window.innerWidth - width - 8)))}px`;
      const top = flip ? Math.max(8, rect.top - 8 - height) : below;
      element.style.top = `${Math.round(top)}px`;
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, anchor]);

  return (
    <div
      ref={ref}
      popover="auto"
      aria-labelledby={labelledBy}
      onToggle={(event) => {
        if ((event as unknown as { newState?: string }).newState === 'closed') onClose();
      }}
      className={cn(
        'rounded-md border border-border bg-surface p-3 text-ink',
        'shadow-[var(--shadow-overlay)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
