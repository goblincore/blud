// src/lab/sdf-zombie/gib-rest.test.ts
//
// GROUNDED REST ON REAL GEOMETRY. The synthetic-capsule tests in
// gib-chunks.test.ts pin the support maths; this file measures the thing the
// owner actually sees: the gap between a REAL severed limb's rendered surface
// and the floor after it has come to rest, and whether the bake predicate would
// freeze it there.
//
// The "rendered surface" uses the exact capsule surface of each prim
// (`chunkPoint` of an endpoint, minus the prim's world radius) — the same
// rotate-then-squash transform `zombie-gpu.ts` packs and `baked-chunks.ts`
// bakes, so the number is a render-space gap, not a proxy.
import { describe, it, expect } from 'vitest';
import {
  makeChunk, stepChunk, chunkSettled, chunkPoint, squashFactors,
  type Chunk,
} from './gib-chunks';
import { chunkExtent, chunkSupportSpheres } from './extent';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { severLimb } from './sever';
import type { Primitive, Vec3 } from './types';

/** Longest prim chord in local space — the topple axis (mirrors game-main). */
function longAxis(prims: readonly Primitive[]): Vec3 {
  let best: Vec3 = [0, 1, 0]; let bestLen = 0;
  for (const p of prims) {
    if (p.op === 'sub') continue;
    const d: Vec3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    if (l > bestLen) { bestLen = l; best = d; }
  }
  return bestLen < 1e-6 ? [0, 1, 0] : [best[0] / bestLen, best[1] / bestLen, best[2] / bestLen];
}

/** Lowest rendered world-space point of the piece's capsules at state `c`.
 *  `prims` are WORLD-space at spawn; the view/`bakeData` map them to local by
 *  subtracting the spawn origin (`chunk.origin`) before rotating about
 *  `c.pos`, so this does the same. */
function lowestSurfaceY(prims: readonly Primitive[], spawnOrigin: Vec3, c: Chunk): number {
  const { sx, sy, sz } = squashFactors(c);
  let low = Infinity;
  for (const p of prims) {
    if (p.op === 'sub') continue;
    const r = Math.max(p.radius, p.radiusB ?? p.radius) * Math.max(p.scale[0], p.scale[1], p.scale[2]);
    for (const e of [p.a, p.b]) {
      const local: Vec3 = [e[0] - spawnOrigin[0], e[1] - spawnOrigin[1], e[2] - spawnOrigin[2]];
      const w = chunkPoint(c, local, sx, sy, sz);
      low = Math.min(low, w[1] - r);
    }
  }
  return low;
}

/** Spawn a real severed piece the way `spawnChunkPiece` does, then settle it. */
function settleSevered(limb: 'legL' | 'armR' | 'armL' | 'legR'): {
  prims: Primitive[]; origin: Vec3; state: Chunk; extent: number; frames: number;
} {
  const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const { chunk } = severLimb(body, limb);
  const prims = chunk.prims;
  const origin = chunk.origin;
  const extent = chunkExtent(prims, origin);
  const support = chunkSupportSpheres(prims, origin);
  let state = makeChunk(
    limb, origin, [0.7, 0.3, -0.5], extent, longAxis(prims),
    () => 0.37, 'limb', undefined, support,
  );
  let frames = 0;
  for (; frames < 60 * 12; frames++) {
    state = stepChunk(state, 1 / 60);
    if (chunkSettled(state)) break;
  }
  return { prims, origin, state, extent, frames };
}

describe('real severed pieces come to rest on the floor', () => {
  for (const limb of ['legL', 'legR', 'armL', 'armR'] as const) {
    it(`${limb}: rendered surface within tolerance of the floor`, () => {
      const { prims, origin, state, extent, frames } = settleSevered(limb);
      expect(chunkSettled(state)).toBe(true);
      const gap = lowestSurfaceY(prims, origin, state);
      // Never below the floor (support is conservative), and no longer hovering
      // at the old `chunkExtent` pin. 5 cm of slop covers the conservative
      // max-scale girth used for tapered prims.
      expect(gap).toBeGreaterThan(-0.005);
      expect(gap).toBeLessThan(0.05);
      // The old behaviour pinned the origin at `extent` (half the limb), which
      // for a leg is far above the floor.
      expect(extent).toBeGreaterThan(0.15);
      expect(state.pos[1]).toBeLessThan(extent * 0.6);
      // The bake predicate must not freeze it while it moves.
      expect(frames).toBeLessThan(60 * 8);
    });
  }

  it('topples to lying flat rather than standing on end', () => {
    const { state } = settleSevered('legL');
    const { sx, sy, sz } = squashFactors(state);
    const long = chunkPoint(state, state.longAxis, sx, sy, sz);
    // chunkPoint adds pos; subtract it to read the axis direction.
    const ay = long[1] - state.pos[1];
    expect(Math.abs(ay)).toBeLessThan(0.2);
  });
});
