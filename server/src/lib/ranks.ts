// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Fractional ranks, step 1024 (D-19, docs/architecture.md §3.3).
 *
 * A move is always expressed as neighbours. The client cannot know the stored
 * order under a filter or a concurrent edit, so the server resolves the
 * neighbours against the stored column and ranks between them.
 */
export const RANK_STEP = 1024;

export type RankPlan =
  { kind: 'place'; position: number } | { kind: 'renumber'; then: 'place'; position: number };

/**
 * `before` sits above the insertion point, `after` below it. Either may be null
 * because the client rendered a filtered list, or the card was deleted.
 */
export function planRank(input: {
  before: number | null;
  after: number | null;
  min: number | null;
  max: number | null;
}): RankPlan {
  const { before, after, min, max } = input;

  if (before !== null && after !== null) {
    if (before < after) {
      const gap = after - before;
      return gap >= 1
        ? { kind: 'place', position: before + gap / 2 }
        : { kind: 'renumber', then: 'place', position: before + 0.5 };
    }
    // The named neighbours disagree with the stored order (a stale client):
    // treat the higher one as absent and append after `before`.
    return { kind: 'place', position: before + RANK_STEP };
  }

  if (after !== null) {
    if (min === null || after <= min) return { kind: 'place', position: after - RANK_STEP };
    return { kind: 'place', position: after - RANK_STEP / 2 };
  }

  if (before !== null) {
    if (max === null || before >= max) return { kind: 'place', position: before + RANK_STEP };
    return { kind: 'place', position: before + RANK_STEP / 2 };
  }

  return { kind: 'place', position: (max ?? 0) + RANK_STEP };
}

export function renumberPositions(count: number): number[] {
  return Array.from({ length: count }, (_unused, index) => (index + 1) * RANK_STEP);
}
