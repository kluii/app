// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * The one empty state (brief §4.7): a dashed slot that says where the thing
 * will go — a board list, a column rail, a key list, a 404. Left-aligned, never
 * centred, never illustrated: an empty screen is a place, not a poster. One
 * action at most, because the page's own button is usually already there.
 *
 * `heading` exists for the 404, where the slot's title is the page's only h1.
 */
export function EmptySlot({
  title,
  body,
  action,
  heading: Heading = 'h2',
  className,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  heading?: 'h1' | 'h2';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-2 rounded-sm border border-dashed border-border-strong p-6',
        className,
      )}
    >
      <Heading className="text-h3 text-ink">{title}</Heading>
      <p className="max-w-80 text-body-sm text-ink-muted">{body}</p>
      {action}
    </div>
  );
}
