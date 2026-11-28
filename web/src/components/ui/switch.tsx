// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

type SwitchProps = Omit<ComponentProps<'button'>, 'role' | 'onChange'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/**
 * The control for a preference that is on or off and already saved — not a
 * set you submit, which is what the checkbox is for (DESIGN.md §7). A native
 * button keeps Space/Enter activation for free, and `role="switch"` +
 * `aria-checked` is what a screen reader announces. 36×20 track, 16 px knob:
 * on is `--ink`, off is `--surface-2` with a `--border-strong` edge.
 */
export function Switch({ className, checked, onCheckedChange, disabled, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-[var(--dur-fast)]',
        checked ? 'border-ink bg-ink' : 'border-border-strong bg-surface-2',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0.5 top-1/2 size-4 -translate-y-1/2 rounded-full transition-[transform,background-color] duration-[var(--dur-fast)]',
          checked ? 'translate-x-4 bg-primary-foreground' : 'translate-x-0 bg-ink-muted',
        )}
      />
    </button>
  );
}
