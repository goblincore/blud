// EARLY-Z DRAW ORDER (spec 2026-10-01 D7, amended by the plan). Every crowd mesh sits at
// the world origin, so three's z sort ties them; renderOrder decides instead:
//   1. the level-depth seed;
//   2. the BACK batches (camera-inside = nearest bodies: plain frag_depth, but their
//      depth lands first and occludes everything after);
//   3. the FRONT batches near-to-far (frag_depth greater: early-Z rejects what 1-2 hide).
// Negative ranks keep every other SDF_LAYER object (renderOrder 0) after the crowd.
// Pure: plain data in, plain data out.

export const SEED_RENDER_ORDER = -1_000_000;
export const BACK_BATCH_BASE = -20_000;
export const FRONT_BATCH_BASE = -10_000;

export interface TypeDistance {
  key: string;
  /** Distance to the batch's nearest drawn instance; Infinity when empty. Keys must be unique. */
  nearestBack: number;
  nearestFront: number;
}

export function typeRenderOrder(types: readonly TypeDistance[]): Map<string, { back: number; front: number }> {
  const out = new Map<string, { back: number; front: number }>();
  for (const t of types) out.set(t.key, { back: 0, front: 0 });
  // Normalize NaN to Infinity so empty/invalid batches sort to the end.
  const normalize = (x: number) => (Number.isNaN(x) ? Infinity : x);
  // Array.prototype.sort is stable, so ties keep the input order.
  // Infinity - Infinity is NaN; `|| 0` makes empty batches tie so the stable sort keeps their input order.
  [...types].sort((a, b) => normalize(a.nearestBack) - normalize(b.nearestBack) || 0)
    .forEach((t, i) => { out.get(t.key)!.back = BACK_BATCH_BASE + i; });
  [...types].sort((a, b) => normalize(a.nearestFront) - normalize(b.nearestFront) || 0)
    .forEach((t, i) => { out.get(t.key)!.front = FRONT_BATCH_BASE + i; });
  return out;
}
