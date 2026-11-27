// SPDX-License-Identifier: AGPL-3.0-only
import { t } from '../../i18n';

/**
 * A braille spinner in mono (DESIGN.md §14). One frame at a time is visible;
 * the schedule is CSS (`tokens.css`, `.spinner`), so no element carries an
 * inline style — the tag chip is the only allowed exception.
 */
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Spinner({ label }: { label?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2 text-body-sm text-ink-subtle"
    >
      <span className="spinner inline-block font-mono text-mono" aria-hidden="true">
        {FRAMES.map((frame) => (
          <span key={frame}>{frame}</span>
        ))}
      </span>
      <span>{label ?? t('common.label.loading')}</span>
    </span>
  );
}
