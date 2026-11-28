// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';

/**
 * One entrance, and it explains something (brief §8, phase 9).
 *
 * A screen rises when it *arrives*: the router replaced one screen with another,
 * and the 8 px settle is what tells the eye that what it is looking at is new
 * rather than merely re-sorted. The first screen a document draws is not an
 * arrival — the browser's own paint is that entrance — and it is also the window
 * the suite measures, by design:
 *
 *   - `e2e/a11y.spec.ts` scans it, and an ancestor caught mid-fade drops
 *     marginal text under 4.5:1 (a `--ink-subtle` hint at 5.85:1 fails
 *     `color-contrast` while the form it sits in is at opacity 0.8);
 *   - `e2e/geometry.spec.ts` reads it, and an ancestor caught mid-rise makes two
 *     boxes sampled 10 ms apart differ by 0.844589233398438 instead of 8, and
 *     gives four tiles two distinct `y`.
 *
 * Neither is a test to narrow: a page that slides and fades while a screen
 * reader or a ruler reads it is a page that moves under its readers. So the
 * first screen of a document stands still, and every screen after it takes the
 * entrance — including a screen the browser history brings back, which is why
 * this counts screens rather than comparing addresses.
 */
let shown = 0;

/** Whether the screen mounting now arrived over one the document already drew. */
export function useArrival(): boolean {
  const [arrived] = useState(() => shown > 0);
  // Counted in an effect, not during render: `StrictMode` replays render, and
  // the count only has to answer "has a screen been drawn before this one".
  useEffect(() => {
    shown += 1;
  }, []);
  return arrived;
}
