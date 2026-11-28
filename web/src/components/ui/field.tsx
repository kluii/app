// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** A visible label, an optional hint, and the error that belongs to the field. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-label font-medium text-ink-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="text-body-sm text-ink-subtle">{hint}</p> : null}
      {error ? (
        <p className="text-body-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
