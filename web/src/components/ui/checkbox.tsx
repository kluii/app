// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/**
 * The native checkbox, restyled once: 18 px box, `rounded-key`, 1 px
 * `--control-border` on `--surface` (DESIGN.md §7). Checked is an ink fill
 * with a 12 px tick in `--primary-foreground`, indeterminate a 2 px dash —
 * both drawn as SVG, never a character, so a checked box can no longer be
 * mistaken for a disabled one. A custom control would have to reimplement
 * focus and the label association; the native input keeps both.
 */
export function Checkbox({
  className,
  label,
  id,
  indeterminate = false,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'indeterminate'> & {
  label: string;
  id: string;
  /** The native property is script-only; React has no attribute for it. */
  indeterminate?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative inline-flex shrink-0">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className={cn(
            'peer size-[18px] shrink-0 appearance-none rounded-key border border-control-border bg-surface',
            'checked:border-ink checked:bg-ink',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            'disabled:cursor-not-allowed disabled:opacity-40',
            className,
          )}
          {...props}
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="pointer-events-none absolute inset-0 m-auto hidden size-3 text-primary-foreground peer-checked:block"
        >
          <path
            d="M2.5 6.5 5 9l4.5-6"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="pointer-events-none absolute inset-0 m-auto hidden size-3 text-primary-foreground peer-indeterminate:block"
        >
          <path
            d="M2.5 6h7"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>
      </span>
      <label htmlFor={id} className="text-body-sm text-ink">
        {label}
      </label>
    </span>
  );
}
