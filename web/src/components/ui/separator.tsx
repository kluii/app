// SPDX-License-Identifier: AGPL-3.0-only
import { cn } from '../../lib/cn';

/** A 1 px hairline; `--border`, never a shadow (DESIGN.md §5). */
export function Separator({
  orientation = 'horizontal',
  className,
}: {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  return (
    <hr
      aria-orientation={orientation}
      className={cn(
        'border-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px self-stretch',
        className,
      )}
    />
  );
}
