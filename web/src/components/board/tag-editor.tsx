// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The tag editor of the card panel (K2-14, D-21), in the v1 interaction: a row
 * of chips, one input under it, and — under the input — the colour panel of the
 * chip that was clicked.
 *
 * The common action comes first: the input adds a tag on Enter or `,`, and
 * Backspace on an empty input removes the last one. A chip is a real `TagChip`
 * followed by a 16 px `X`; clicking the chip opens its colour panel, where the
 * pill preview carries the draft colour live. "Use on every card with this
 * tag" stays a second, explicit action: it writes the board default, and the
 * card's own value stops overriding it.
 */
import { useId, useState } from 'react';
import { X } from 'lucide-react';
import type { Card, Tag } from '../../api/types';
import { t } from '../../i18n';
import { normalizeTag, palette } from '../../lib/tag-palette';
import { Input } from '../ui/input';
import { TagChip } from './tag-chip';

export type TagDraft = {
  name: string;
  color: string | null;
  boardWide: boolean;
};

/** A card carries at most eight tags. */
export const MAX_TAGS = 8;

export function TagEditor({
  tags,
  boardTags,
  onChange,
  disabled,
}: {
  tags: TagDraft[];
  /** Every tag name the board already uses, for the input's datalist. */
  boardTags: string[];
  onChange: (tags: TagDraft[]) => void;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const listId = useId();
  const swatches = palette();

  const setAt = (name: string, patch: Partial<TagDraft>): void => {
    onChange(tags.map((tag) => (tag.name === name ? { ...tag, ...patch } : tag)));
  };

  /** Empty, duplicate or past eight tags: ignored, the input just clears. */
  const add = (raw: string): void => {
    const name = normalizeTag(raw);
    setAdding('');
    if (name === null) return;
    if (tags.some((tag) => tag.name === name)) return;
    if (tags.length >= MAX_TAGS) return;
    onChange([...tags, { name, color: null, boardWide: false }]);
  };

  const remove = (name: string): void => {
    if (editing === name) setEditing(null);
    onChange(tags.filter((tag) => tag.name !== name));
  };

  const editingTag = tags.find((tag) => tag.name === editing) ?? null;
  const suggestions = boardTags.filter((name) => !tags.some((tag) => tag.name === name));

  return (
    <div className="flex flex-col gap-2" data-testid="tag-editor">
      {tags.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-1" data-testid="tag-chips">
          {tags.map((tag) => (
            <li key={tag.name} className="flex items-center gap-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => setEditing(editing === tag.name ? null : tag.name)}
                aria-label={t('board.tags.colorOf', { name: tag.name })}
                aria-expanded={editing === tag.name}
                data-testid={`tag-chip-${tag.name}`}
                className="rounded-key"
              >
                <TagChip tag={{ name: tag.name, color: tag.color }} />
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(tag.name)}
                aria-label={t('board.tags.removeNamed', { name: tag.name })}
                data-testid={`tag-remove-${tag.name}`}
                className="flex h-4 w-4 items-center justify-center rounded-xs text-ink-muted transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-ink"
              >
                <X aria-hidden size={12} strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Input
        list={listId}
        maxLength={32}
        aria-label={t('board.tags.add')}
        placeholder={t('board.tags.addPlaceholder')}
        value={adding}
        disabled={disabled}
        onChange={(event) => setAdding(event.target.value)}
        onKeyDown={(event) => {
          // Enter must add the tag, not submit the modal's form.
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            add(adding);
          } else if (event.key === 'Backspace' && adding === '') {
            event.preventDefault();
            const last = tags[tags.length - 1];
            if (last) remove(last.name);
          }
        }}
        data-testid="tag-add-input"
        className="font-mono text-mono-sm"
      />
      <datalist id={listId}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {editingTag ? (
        <div
          className="flex flex-col gap-2 rounded-sm border border-border bg-surface-2 p-2"
          data-testid={`tag-panel-${editingTag.name}`}
        >
          <span data-testid={`tag-preview-${editingTag.name}`}>
            <TagChip tag={{ name: editingTag.name, color: editingTag.color }} />
          </span>
          <div
            className="flex flex-wrap items-center gap-1"
            role="group"
            aria-label={t('board.tags.color')}
          >
            {swatches.map((swatch) => (
              <button
                key={swatch.hue}
                type="button"
                disabled={disabled}
                aria-label={swatch.hue}
                aria-pressed={editingTag.color?.toLowerCase() === swatch.color.toLowerCase()}
                data-testid={`swatch-${editingTag.name}-${swatch.hue}`}
                className="h-9 w-9 rounded-sm border border-border"
                style={{ backgroundColor: swatch.color }}
                onClick={() => setAt(editingTag.name, { color: swatch.color })}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-body-sm text-ink-muted">
            <input
              type="checkbox"
              checked={editingTag.boardWide}
              disabled={disabled}
              onChange={(event) => setAt(editingTag.name, { boardWide: event.target.checked })}
              data-testid={`board-wide-${editingTag.name}`}
            />
            {t('board.tags.boardWide')}
          </label>
        </div>
      ) : null}
    </div>
  );
}

/** Every tag name the board already uses, for the input's datalist. */
export function boardTagNames(cards: Card[]): string[] {
  return [...new Set(cards.flatMap((card) => card.tags.map((tag) => tag.name)))].sort();
}

export function tagsToDraft(tags: Tag[]): TagDraft[] {
  return tags.map((tag) => ({ name: tag.name, color: tag.color, boardWide: false }));
}

/**
 * The API's tag input, not the DTO: a tag with no colour omits the field. The
 * server rejects `color: null` (`tagInputSchema` accepts a hex or nothing), so
 * sending the DTO shape back was a 400 waiting for the first colourless tag.
 */
export type TagInput = { name: string; color?: string };

export function draftToTags(drafts: TagDraft[]): TagInput[] {
  return drafts.map((draft) =>
    draft.color === null ? { name: draft.name } : { name: draft.name, color: draft.color },
  );
}
