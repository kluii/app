// SPDX-License-Identifier: AGPL-3.0-only
import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Button } from './button';
import { Popover } from './popover';

/**
 * A menu is a list of actions, not a navigation bar: `role="menu"` with items
 * that are buttons, opened by a labelled trigger. Built on the platform popover
 * so Esc and light dismiss are not reimplemented here.
 */
export function DropdownMenu({
  label,
  open,
  onOpenChange,
  children,
  align = 'start',
  icon,
}: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  align?: 'start' | 'end';
  icon?: ReactNode;
}) {
  const id = useId();
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
        title={label}
      >
        {icon}
        {label}
      </Button>
      <Popover
        open={open}
        onClose={() => onOpenChange(false)}
        labelledBy={id}
        className={cn('min-w-48', align === 'end' ? 'ml-auto' : '')}
      >
        <ul role="menu" id={id} className="flex flex-col gap-0.5">
          {children}
        </ul>
      </Popover>
    </>
  );
}

export function DropdownItem({
  onSelect,
  children,
  tone = 'normal',
}: {
  onSelect: () => void;
  children: ReactNode;
  tone?: 'normal' | 'danger';
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        onClick={onSelect}
        className={cn(
          'flex h-8 w-full items-center rounded-sm px-2 text-left text-body-sm hover:bg-surface-2',
          tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {children}
      </button>
    </li>
  );
}
