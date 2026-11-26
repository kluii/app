// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useRef, type ReactNode } from 'react';
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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

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
      <h2 id={titleId} className="text-h2">
        {title}
      </h2>
      {description ? <p className="mt-1 text-body-sm text-ink-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
      {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
    </dialog>
  );
}
