// SPDX-License-Identifier: AGPL-3.0-only
import { ChevronDown } from 'lucide-react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/**
 * One field: 36 high, 12 of side padding, radius 8, `--control-border` on
 * `--surface`, `body-sm` (DESIGN.md §7). The focus ring is the global one
 * (2 px `--focus`, offset 2, tokens.css). The select drops the native frame:
 * `appearance-none` plus a chevron of our own, so it reads like the input.
 */
const FIELD =
  'w-full rounded-sm border border-control-border bg-surface px-3 text-body-sm text-ink placeholder:text-ink-subtle transition-[color,background-color,border-color] duration-[var(--dur-fast)] disabled:opacity-40';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD, 'min-h-18 py-2', className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn('relative', className)}>
      <select className={cn(FIELD, 'h-9 appearance-none pr-8')} {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden
        strokeWidth={1.5}
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
      />
    </div>
  );
}
