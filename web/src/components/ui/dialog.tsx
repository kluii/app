// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { cn } from '../../lib/cn';

/**
 * A native `<dialog>`: focus trap, Esc, inert background and focus restoration
 * come from the platform (modern-web-guidance), so this wrapper only controls
 * open state and the scrim styling.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
  footer,
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  /**
   * Where focus lands when the dialog opens. `showModal()` picks the first
   * focusable in DOM order, which is wrong for a panel whose first control is a
   * text box (K2-15): the caller names the element instead.
   */
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return undefined;
    // The platform restores focus to the element that opened the dialog, but
    // only while the element is still in the document. A dialog conditional on
    // state is removed by React before that can happen, so keep the opener and
    // put focus back ourselves (K2-15).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) {
      dialog.showModal();
      initialFocus?.current?.focus();
    }
    return () => {
      if (dialog.open) dialog.close();
      if (opener?.isConnected === true) opener.focus();
    };
  }, [open, initialFocus]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'dialog-panel m-auto rounded-md border border-border bg-surface p-5 text-ink',
        className,
      )}
      aria-labelledby={titleId}
    >
      <h2 id={titleId} className="font-display text-h2">
        {title}
      </h2>
      {description ? <p className="mt-1 text-body-sm text-ink-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
      {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
    </dialog>
  );
}
