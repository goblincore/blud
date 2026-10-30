// src/lab/sdf-zombie/webgpu/level-batch.ts
//
// LEVEL BATCHING, THE PURE CORE (draw-count pass, 2026-10-28). three r186 pays ~15-25 µs of CPU per object it
// renders (render object lookup, node and binding updates, a uniform write, the draw), so repeated small things are
// drawn as one instanced draw each: the level's pickups one per item type, a soldier's spent casings with no draw at
// all while it has thrown none. This module holds the decisions (no `three`): the switch, which pickups share a
// batch, and the packing of the shown instances' matrices to the front of a batch's rows (the draw's instance count
// is then the shown count: a taken pickup, or one in a sector the zone cull cannot see, is simply not drawn).
// The renderer side is game-level-batch.ts and shotgun-casings.ts.

/** `?batch=0` restores the old per-object path (every pickup its own mesh, empty casing pools drawn). */
export function levelBatchOn(search: string): boolean {
  return new URLSearchParams(search).get('batch') !== '0';
}

export interface BatchItem { readonly id: string; readonly item: string }

/** The level's pickups grouped by item type, in first-seen order (one batch, one draw, each); within a group, the
 *  file's order (the instance index). Pickups all use the scene's light list, so the item is the whole key. */
export function groupPickups<T extends BatchItem>(pickups: readonly T[]): { item: string; members: T[] }[] {
  const by = new Map<string, T[]>();
  for (const p of pickups) {
    let g = by.get(p.item);
    if (!g) by.set(p.item, g = []);
    g.push(p);
  }
  return [...by].map(([item, members]) => ({ item, members }));
}

/** Things grouped by zone (a barrel's zone room), zones in first-seen order, members in input order: one merged
 *  mesh per zone (game-barrel-view.ts BarrelBatches), as the zone's light list and the zone cull both go by zone. */
export function groupByZone(items: readonly { id: string; zone: number }[]): [number, string[]][] {
  const by = new Map<number, string[]>();
  for (const it of items) {
    let g = by.get(it.zone);
    if (!g) by.set(it.zone, g = []);
    g.push(it.id);
  }
  return [...by];
}

/** The matrix row width (a column-major 4×4). */
export const ROW_FLOATS = 16;

/** PACK: copy the rows of the shown instances (`shown(i)`) from `src` (16 floats each, instance order) to the front
 *  of `dst`, in order, and return how many were packed (the draw's instance count). `dst` must hold `n` rows. Writes
 *  only the packed rows; returns whether any packed row differs from what `dst` held (no upload needed when not). */
export function packShown(src: Float32Array, n: number, shown: (i: number) => boolean, dst: Float32Array): { count: number; changed: boolean } {
  let count = 0, changed = false;
  for (let i = 0; i < n; i++) {
    if (!shown(i)) continue;
    const s = i * ROW_FLOATS, d = count * ROW_FLOATS;
    if (!changed) for (let k = 0; k < ROW_FLOATS; k++) if (dst[d + k] !== src[s + k]) { changed = true; break; }
    if (changed) for (let k = 0; k < ROW_FLOATS; k++) dst[d + k] = src[s + k]!;
    count++;
  }
  return { count, changed };
}

/** Whether a sector-placed thing can be seen: any of its sectors in the flood (`seen[s]` 1), or it is placed by no
 *  sector at all (never culled, as the zone cull leaves such meshes on). */
export function anySectorSeen(sectors: readonly number[], seen: ArrayLike<number>): boolean {
  if (sectors.length === 0) return true;
  for (const s of sectors) if (seen[s]) return true;
  return false;
}
