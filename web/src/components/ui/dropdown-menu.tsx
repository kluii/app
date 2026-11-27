// SPDX-License-Identifier: AGPL-3.0-only
import { Check } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '../../lib/cn';
import { Button } from './button';
import { Popover } from './popover';

/** The wiring a custom trigger needs; the menu owns the ids and the state. */
export type MenuTriggerProps = {
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string;
  ref: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
};

const ITEM =
  'flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-body-sm text-ink hover:bg-surface-2';

/**
 * A menu is a list of actions, not a navigation bar: `role="menu"` with items
 * that are buttons, opened by a labelled trigger. Built on the platform popover
 * so Esc and light dismiss are not reimplemented here; what the platform does
 * not give a menu — arrow keys, a first item focused, focus back on the trigger
 * after a keyboard close — lives in this file.
 */
export function DropdownMenu({
  label,
  open,
  onOpenChange,
  children,
  align = 'start',
  icon,
  trigger,
  panelClassName,
}: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  align?: 'start' | 'end';
  icon?: ReactNode;
  /** A custom trigger (an avatar, a pill); it gets the ARIA wiring and the ref. */
  trigger?: (props: MenuTriggerProps) => ReactNode;
  panelClassName?: string;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const close = (): void => {
    onOpenChange(false);
    triggerRef.current?.focus();
  };

  // The platform popover does not focus anything: a menu that opens with focus
  // still on its trigger reads as if nothing happened.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [open]);

  const items = (): HTMLElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []).filter(
      (element) => element.offsetParent !== null,
    );

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      list[event.key === 'Home' ? 0 : list.length - 1]?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    list[(index + step + list.length) % list.length]?.focus();
  };

  const wiring: MenuTriggerProps = {
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': id,
    ref: triggerRef,
    onClick: () => onOpenChange(!open),
  };

  return (
    <>
      {trigger ? (
        trigger(wiring)
      ) : (
        <Button variant="ghost" size="sm" {...wiring} title={label}>
          {icon}
          {label}
        </Button>
      )}
      <Popover
        open={open}
        onClose={() => onOpenChange(false)}
        labelledBy={id}
        anchor={triggerRef}
        align={align}
        className={cn('min-w-56 p-1', align === 'end' ? 'ml-auto' : '', panelClassName)}
      >
        <ul role="menu" id={id} aria-label={label} ref={menuRef} onKeyDown={onKeyDown}>
          {children}
        </ul>
      </Popover>
    </>
  );
}

/** A non-interactive block above the items: an identity, not an action. */
export function DropdownHeader({ children }: { children: ReactNode }) {
  return (
    <li role="none" className="flex flex-col gap-0.5 px-2 pb-2 pt-1">
      {children}
    </li>
  );
}

export function DropdownSeparator() {
  return <li role="separator" className="my-1 h-px bg-border" />;
}

/** A named run of items, so a theme pair and a language pair stay apart. */
export function DropdownGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li role="none">
      <span className="block px-2 pb-1 pt-1 text-label uppercase tracking-caps text-ink-subtle">
        {label}
      </span>
      <ul role="group" aria-label={label}>
        {children}
      </ul>
    </li>
  );
}

export function DropdownItem({
  onSelect,
  children,
  tone = 'normal',
  trailing,
  icon,
}: {
  onSelect: () => void;
  children: ReactNode;
  tone?: 'normal' | 'danger';
  /** A count, a shortcut: right-aligned, mono, never part of the label. */
  trailing?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        onClick={onSelect}
        className={cn(ITEM, tone === 'danger' ? 'text-danger' : 'text-ink')}
      >
        {icon}
        <span className="flex-1 truncate">{children}</span>
        {trailing === undefined ? null : (
          <span className="font-mono text-mono-sm text-ink-subtle">{trailing}</span>
        )}
      </button>
    </li>
  );
}

/** One of a small set: `aria-checked`, a tick, and no radio group markup needed. */
export function DropdownCheckItem({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitemradio"
        aria-checked={checked}
        onClick={onSelect}
        className={cn(ITEM, checked ? 'text-ink' : 'text-ink-muted')}
      >
        <span className="flex-1 truncate">{children}</span>
        {checked ? <Check aria-hidden className="h-4 w-4" strokeWidth={1.75} /> : null}
      </button>
    </li>
  );
}
