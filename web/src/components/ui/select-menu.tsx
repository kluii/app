// SPDX-License-Identifier: AGPL-3.0-only
import { ChevronDown } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Popover } from './popover';

export type SelectMenuOption = { id: string; label: string };

/**
 * A listbox we own. The platform `<select>` cannot show a mark beside its
 * options — its panel belongs to the OS, which paints text and nothing else —
 * so the trigger, the panel and the keyboard are built here on the platform
 * popover, which still gives Esc and light dismiss for free.
 *
 * Focus never leaves the trigger: the option list holds the *virtual* focus and
 * the trigger publishes it through `aria-activedescendant`. That is what keeps
 * a `Tab` after a selection landing in the next field instead of in a panel
 * that is about to close.
 */
export function SelectMenu({
  id,
  value,
  onChange,
  options,
  labelId,
  testId,
  renderMark,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectMenuOption[];
  /** The id of the visible field label; the trigger is named by it. */
  labelId: string;
  testId?: string;
  /** The 16 px tile an option shows before its name, if any. */
  renderMark?: (id: string) => ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const base = useId();

  const listId = `${base}-listbox`;
  const valueId = `${id}-value`;
  const optionId = (index: number): string => `${base}-option-${index}`;

  const chosen = options.findIndex((option) => option.id === value);
  const selected = options[chosen] ?? options[0];
  const last = options.length - 1;

  const close = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };

  const openAt = (index: number): void => {
    setActive(index < 0 ? 0 : index);
    setOpen(true);
  };

  const choose = (index: number): void => {
    const option = options[index];
    if (option !== undefined) onChange(option.id);
    close();
  };

  // Focus stays on the trigger, so every key is read here.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) choose(active);
        else openAt(chosen);
        return;
      case 'ArrowDown':
        event.preventDefault();
        if (open) setActive(active >= last ? 0 : active + 1);
        else openAt(chosen);
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (open) setActive(active <= 0 ? last : active - 1);
        else openAt(chosen);
        return;
      case 'Home':
        if (!open) return;
        event.preventDefault();
        setActive(0);
        return;
      case 'End':
        if (!open) return;
        event.preventDefault();
        setActive(last);
        return;
      case 'Escape':
        if (!open) return;
        event.preventDefault();
        close();
        return;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        id={id}
        data-testid={testId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => {
          if (open) close();
          else openAt(chosen);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-sm border border-control-border bg-surface px-3 text-body-sm text-ink',
          'transition-[color,background-color,border-color] duration-[var(--dur-fast)] hover:bg-surface-2',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {renderMark === undefined || selected === undefined ? null : renderMark(selected.id)}
          <span id={valueId} className="truncate">
            {selected?.label}
          </span>
        </span>
        <ChevronDown aria-hidden strokeWidth={1.5} className="h-4 w-4 shrink-0 text-ink-muted" />
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        labelledBy={labelId}
        anchor={trigger}
        className="min-w-64"
      >
        <ul
          role="listbox"
          id={listId}
          aria-labelledby={labelId}
          aria-activedescendant={open ? optionId(active) : undefined}
          className="flex flex-col"
        >
          {options.map((option, index) => (
            <li
              key={option.id}
              id={optionId(index)}
              role="option"
              aria-selected={option.id === value}
              // A pointerdown that takes focus would break the virtual focus.
              onMouseDown={(event) => {
                event.preventDefault();
                setActive(index);
              }}
              onClick={() => choose(index)}
              className={cn(
                'flex h-9 cursor-pointer items-center gap-2 rounded-key px-2 text-body-sm text-ink',
                index === active ? 'bg-surface-muted' : null,
              )}
            >
              {renderMark === undefined ? null : renderMark(option.id)}
              <span className="truncate">{option.label}</span>
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}
