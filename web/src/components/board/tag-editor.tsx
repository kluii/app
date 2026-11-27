// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The tag editor of the card panel (K2-14, D-21).
 *
 * A colour is chosen from the twelve hues the design defines or typed as a hex;
 * either way the chip stays readable because the tint is capped and the label
 * is `--ink`. "Use on every card with this tag" is a second, explicit action:
 * it writes the board default, and the card's own value stops overriding it.
 */
import { useState } from 'react';
import type { Tag } from '../../api/types';
import { t } from '../../i18n';
import { isHex, normalizeTag, palette } from '../../lib/tag-palette';
import { Button } from '../ui/button';

export type TagDraft = {
  name: string;
  color: string | null;
  boardWide: boolean;
};

export function TagEditor({
  tags,
  onChange,
  disabled,
}: {
  tags: TagDraft[];
  onChange: (tags: TagDraft[]) => void;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState('');
  const swatches = palette();

  const setAt = (index: number, patch: Partial<TagDraft>): void => {
    onChange(tags.map((tag, position) => (position === index ? { ...tag, ...patch } : tag)));
  };

  return (
    <div className="flex flex-col gap-3" data-testid="tag-editor">
      {tags.length === 0 ? (
        <p className="text-body-sm text-ink-subtle">{t('board.tags.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tags.map((tag, index) => (
            <li
              key={tag.name}
              className="flex flex-col gap-1.5"
              data-testid={`tag-row-${tag.name}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-mono-sm text-ink">{tag.name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => onChange(tags.filter((_unused, position) => position !== index))}
                >
                  {t('board.tags.remove')}
                </Button>
              </div>
              <div
                className="flex flex-wrap items-center gap-1.5"
                role="group"
                aria-label={t('board.tags.color')}
              >
                {swatches.map((swatch) => (
                  <button
                    key={swatch.hue}
                    type="button"
                    disabled={disabled}
                    aria-label={swatch.hue}
                    aria-pressed={tag.color?.toLowerCase() === swatch.color.toLowerCase()}
                    data-testid={`swatch-${tag.name}-${swatch.hue}`}
                    className="h-6 w-6 rounded-sm border border-border"
                    style={{ backgroundColor: swatch.color }}
                    onClick={() => setAt(index, { color: swatch.color })}
                  />
                ))}
                <input
                  className="h-8 w-24 rounded-sm border border-border bg-surface px-2 font-mono text-mono-sm text-ink"
                  aria-label={t('board.tags.hex')}
                  placeholder={t('board.tags.hexPlaceholder')}
                  value={tag.color ?? ''}
                  disabled={disabled}
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    setAt(index, { color: isHex(value) ? value : null });
                  }}
                  data-testid={`hex-${tag.name}`}
                />
              </div>
              <label className="flex items-center gap-2 text-body-sm text-ink-muted">
                <input
                  type="checkbox"
                  checked={tag.boardWide}
                  disabled={disabled}
                  onChange={(event) => setAt(index, { boardWide: event.target.checked })}
                  data-testid={`board-wide-${tag.name}`}
                />
                {t('board.tags.boardWide')}
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <input
          className="h-8 w-40 rounded-sm border border-border bg-surface px-2 font-mono text-mono-sm text-ink"
          aria-label={t('board.tags.add')}
          placeholder={t('board.tags.add')}
          value={adding}
          disabled={disabled}
          onChange={(event) => setAdding(event.target.value)}
          data-testid="tag-add-input"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || normalizeTag(adding) === null}
          onClick={() => {
            const name = normalizeTag(adding);
            if (name === null) return;
            if (!tags.some((tag) => tag.name === name)) {
              onChange([...tags, { name, color: null, boardWide: false }]);
            }
            setAdding('');
          }}
          data-testid="tag-add-submit"
        >
          {t('board.tags.addAction')}
        </Button>
      </div>
    </div>
  );
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
