// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One rule for every collection the board holds: merge by server id
 * (docs/features/realtime.md §2.1). An SSE echo can arrive before the HTTP
 * response to the same mutation, so an append duplicates the entity and a
 * replace-by-index loses a teammate's concurrent edit.
 */
export type Identified = { id: string };

/**
 * Inserts the incoming rows, replacing any row that already has that id. The
 * incoming order wins for the rows it touches; untouched rows keep their place.
 */
export function mergeById<T extends Identified>(current: T[], incoming: T[]): T[] {
  const byId = new Map(incoming.map((row) => [row.id, row]));
  const merged = current.map((row) => byId.get(row.id) ?? row);
  const known = new Set(current.map((row) => row.id));
  for (const row of incoming) {
    if (!known.has(row.id)) merged.push(row);
  }
  return merged;
}

/** True when the two collections carry the same ids in the same order. */
export function sameIds(current: Identified[], incoming: Identified[]): boolean {
  if (current.length !== incoming.length) return false;
  return current.every((row, index) => row.id === incoming[index]?.id);
}
