// SPDX-License-Identifier: AGPL-3.0-only
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

/**
 * Height 32 (28 small, 36 large), one radius, one label size (DESIGN.md §7).
 * A variant is added here, never at the call site.
 */
export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-1.5 rounded-full text-label font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary: 'border border-border bg-surface-2 text-ink hover:bg-surface-muted',
        ghost: 'text-ink-muted hover:bg-surface-2 hover:text-ink',
        danger: 'bg-danger text-primary-foreground',
        link: 'h-auto px-0 text-ink underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-7 px-2',
        md: 'h-8 px-3',
        lg: 'h-9 px-4',
        icon: 'h-8 w-8 px-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { loading?: boolean };

export function Button({
  className,
  variant,
  size,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled === true || loading === true}
      aria-busy={loading === true}
      {...props}
    >
      {children}
    </button>
  );
}
