// SPDX-License-Identifier: AGPL-3.0-only
import { ListFilter } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import type { Card, Member } from '../../api/types';
import { t } from '../../i18n';
import { atUsername } from '../../lib/username';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Popover } from '../ui/popover';

export type Filters = { text: string; tags: string[]; assignees: string[] };

export const NO_FILTERS: Filters = { text: '', tags: [], assignees: [] };

export function filterCount(filters: Filters): number {
  return (filters.text.trim() === '' ? 0 : 1) + filters.tags.length + filters.assignees.length;
}

/** The assignee key: a member username, or the free label an anonymous actor typed. */
export function assigneeKey(card: Card): string | null {
  return card.assignee?.username ?? card.assignee_label ?? null;
}

/**
 * Filtering is a read: it never reorders, and a card's position under a filter
 * is its stored position (a move uses stored neighbours, never the render).
 */
export function matches(card: Card, filters: Filters): boolean {
  const text = filters.text.trim().toLowerCase();
  if (
    text !== '' &&
    !card.title.toLowerCase().includes(text) &&
    !(card.description ?? '').toLowerCase().includes(text)
  ) {
    return false;
  }
  if (filters.tags.length > 0 && !card.tags.some((tag) => filters.tags.includes(tag.name))) {
    return false;
  }
  if (filters.assignees.length > 0) {
    const key = assigneeKey(card);
    if (key === null || !filters.assignees.includes(key)) return false;
  }
  return true;
}

export function BoardFilters({
  filters,
  onChange,
  cards,
  members,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  cards: Card[];
  members: Member[];
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const active = filterCount(filters) > 0;

  const tagOptions = useMemo(
    () => [...new Set(cards.flatMap((card) => card.tags.map((tag) => tag.name)))].sort(),
    [cards],
  );
  // One option per assignee key. The key is what the filter matches (a member's
  // username, or the free label an anonymous author typed); the label is what a
  // person reads, so only the member's side carries an at sign.
  const assigneeOptions = useMemo(() => {
    const fromMembers = members.map((member) => member.username);
    const fromLabels = cards
      .map((card) => card.assignee_label)
      .filter((label): label is string => label !== null);
    return [...new Set([...fromMembers, ...fromLabels])].sort().map((key) => ({
      key,
      label: fromMembers.includes(key) ? atUsername(key) : key,
    }));
  }, [cards, members]);

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        ref={trigger}
        variant="secondary"
        size="md"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <ListFilter aria-hidden size={16} strokeWidth={1.5} />
        {t('board.filter.title')}
        {active ? <span className="font-mono text-mono-sm">{filterCount(filters)}</span> : null}
      </Button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        labelledBy={panelId}
        anchor={trigger}
        className="w-96 max-w-[calc(100vw-2rem)] p-3"
      >
        <div className="flex flex-col gap-4">
          <h2 id={panelId} className="text-h3">
            {t('board.filter.title')}
          </h2>

          <Field
            label={t('board.filter.text')}
            htmlFor="filter-text"
            hint={t('board.filter.textHint')}
          >
            <Input
              id="filter-text"
              value={filters.text}
              onChange={(event) => onChange({ ...filters, text: event.target.value })}
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-label font-medium text-ink-muted">
              {t('board.filter.tags')}
            </legend>
            {tagOptions.length === 0 ? (
              <p className="text-body-sm text-ink-subtle">{t('board.filter.none')}</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {tagOptions.map((tag) => {
                  const selected = filters.tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onChange({ ...filters, tags: toggle(filters.tags, tag) })}
                      className={
                        selected
                          ? 'inline-flex h-6 items-center rounded-key border border-ink bg-surface-muted px-2 font-mono text-mono-sm text-ink'
                          : 'inline-flex h-6 items-center rounded-key border border-border bg-surface-2 px-2 font-mono text-mono-sm text-ink-muted'
                      }
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-label font-medium text-ink-muted">
              {t('board.filter.assignees')}
            </legend>
            <div className="flex flex-wrap gap-1">
              {assigneeOptions.map((assignee) => {
                const selected = filters.assignees.includes(assignee.key);
                return (
                  <button
                    key={assignee.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      onChange({ ...filters, assignees: toggle(filters.assignees, assignee.key) })
                    }
                    className={
                      selected
                        ? 'inline-flex h-6 items-center rounded-key border border-ink bg-surface-muted px-2 font-mono text-mono-sm text-ink'
                        : 'inline-flex h-6 items-center rounded-key border border-border bg-surface-2 px-2 font-mono text-mono-sm text-ink-muted'
                    }
                  >
                    {assignee.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {active ? (
            <Button variant="ghost" size="sm" onClick={() => onChange(NO_FILTERS)}>
              {t('board.filter.clear')}
            </Button>
          ) : null}
        </div>
      </Popover>
    </div>
  );
}

/** One chip per active filter, each removable on its own. */
export function ActiveFilters({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
}) {
  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (filters.text.trim() !== '') {
    chips.push({
      key: 'text',
      label: filters.text.trim(),
      remove: () => onChange({ ...filters, text: '' }),
    });
  }
  for (const tag of filters.tags) {
    chips.push({
      key: `tag:${tag}`,
      label: tag,
      remove: () => onChange({ ...filters, tags: filters.tags.filter((item) => item !== tag) }),
    });
  }
  for (const assignee of filters.assignees) {
    chips.push({
      key: `assignee:${assignee}`,
      label: assignee,
      remove: () =>
        onChange({
          ...filters,
          assignees: filters.assignees.filter((item) => item !== assignee),
        }),
    });
  }
  if (chips.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1 px-4 pb-2"
      aria-label={t('board.filter.active')}
    >
      {chips.map((chip) => (
        <span
          key={chip.key}
          data-testid="active-filter"
          className="inline-flex h-6 items-center gap-1 rounded-key border border-border bg-surface-2 pl-2 pr-1 font-mono text-mono-sm text-ink"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.remove}
            aria-label={t('common.action.dismiss')}
            className="text-ink-subtle hover:text-ink"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
