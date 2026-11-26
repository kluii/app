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
 * `before` sits above the insertion point, `after` below it. Both are the
 * *effective* immediate neighbours: `planMove` resolves them against the stored
 * column before asking, so a client that names a deleted card, or only one of
 * the two, cannot land on the wrong side of a card it never saw.
 *
 * The plan is total: a head insertion halves towards the floor and asks for a
 * renumber rather than drifting below zero forever.
 */
export function planRank(input: {
  before: number | null;
  after: number | null;
  min: number | null;
  max: number | null;
}): RankPlan {
  const { before, after, max } = input;

  if (before !== null && after !== null) {
    const gap = after - before;
    if (gap >= 2) return { kind: 'place', position: before + gap / 2 };
    return { kind: 'renumber', then: 'place', position: before + gap / 2 };
  }

  // Below the last card of the column: one step down the ladder.
  if (before !== null) return { kind: 'place', position: before + RANK_STEP };

  // Above the first card: one step up, then halve, then renumber.
  if (after !== null) {
    if (after - RANK_STEP >= 1) return { kind: 'place', position: after - RANK_STEP };
    if (after / 2 >= 1) return { kind: 'place', position: after / 2 };
    return { kind: 'renumber', then: 'place', position: RANK_STEP / 2 };
  }

  return { kind: 'place', position: (max ?? 0) + RANK_STEP };
}

export function renumberPositions(count: number): number[] {
  return Array.from({ length: count }, (_unused, index) => (index + 1) * RANK_STEP);
}
