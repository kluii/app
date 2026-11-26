// SPDX-License-Identifier: AGPL-3.0-only
import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/**
 * The native checkbox, restyled once: 16 px box, 4 px radius, the accent is the
 * ink (DESIGN.md §7). A custom control would have to reimplement focus, the
 * indeterminate state and the label association.
 */
export function Checkbox({
  className,
  label,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        className={cn(
          'peer size-4 shrink-0 appearance-none rounded-xs border border-control-border bg-surface-2 checked:border-ink checked:bg-ink',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          'disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        {...props}
      />
      <label htmlFor={id} className="text-body-sm text-ink">
        {label}
      </label>
    </span>
  );
}
