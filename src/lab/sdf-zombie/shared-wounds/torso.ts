import type { BuildResult } from '../build-body';
import { MAX_WOUNDS, woundWorldPos, type Wound } from '../damage';
import { add, cross, dot, len, normalize, scale, sub } from '../vec';
import type { Vec3 } from '../types';
import { advanceRegion, createRegionState, hitRegion, PRESETS } from './presets';

/** Upload-only marker. These rows use hard capped subtraction without a rim. */
export type VisualWound = Wound & { presetCut?: true };
export const TORSO_REGION_COUNT = 4;

type Region = {
  state: ReturnType<typeof createRegionState>;
  anchor: Wound;
  tangent: Vec3;
  up: Vec3;
};

const alive = (w: Wound, body: BuildResult) => {
  const p = body.prims[w.primIdx];
  return !!p && !p.dead && body.clusters[p.cluster]?.alive !== false;
};

/** Classify in REST space. Passing a live posed body makes turns change sides. */
function regionFor(w: Wound, rest: BuildResult): number {
  let minY = Infinity, maxY = -Infinity, z = 0, count = 0;
  // Include removed owners in the split definition: losing a primitive must
  // not change the region IDs of the surviving body. Actor layouts are stable.
  for (const p of rest.prims) if (p.limb === 'torso' && p.op === 'add') {
    minY = Math.min(minY, p.a[1], p.b[1]);
    maxY = Math.max(maxY, p.a[1], p.b[1]);
    z += (p.a[2] + p.b[2]) * .5;
    count++;
  }
  const hit = woundWorldPos(rest.prims, w, 0);
  const upper = hit[1] >= (minY + maxY) * .5;
  const front = hit[2] >= z / Math.max(1, count);
  return (upper ? 0 : 2) + (front ? 0 : 1);
}

/** Four shared-preset regions; at most eight cutters and sixteen total rows. */
export function createTorsoWounds() {
  const regions: (Region | null)[] = Array(TORSO_REGION_COUNT).fill(null);
  let timeMs = 0;
  let fallback: Wound[] = [];

  return {
    /** `rest` is the actor's current REST body, never its posed rendering copy. */
    record(w: Wound, rest: BuildResult, allowPreset = true) {
      const p = rest.prims[w.primIdx];
      if (!allowPreset || w.type === 'burn' || p?.limb !== 'torso' || !alive(w, rest)) {
        fallback = [...fallback, { ...w }].slice(-MAX_WOUNDS);
        return;
      }
      const id = regionFor(w, rest);
      let region = regions[id];
      if (!region) {
        const outward = normalize(w.carveN ? scale(w.carveN, -1) : w.local);
        const n: Vec3 = len(outward) > 0 ? outward : [0, 0, 1];
        const seed: Vec3 = Math.abs(n[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
        const up = normalize(sub(seed, scale(n, dot(seed, n))));
        region = { state: createRegionState(), anchor: { ...w, local: [...w.local] }, up, tangent: cross(up, n) };
        regions[id] = region;
      }
      hitRegion(region.state, timeMs);
    },
    advance(dt: number): boolean {
      if (!Number.isFinite(dt) || dt < 0) throw new Error('dt must be finite and nonnegative');
      let moving = false;
      timeMs += dt * 1000;
      for (const region of regions) if (region) {
        moving ||= region.state.current !== region.state.target;
        advanceRegion(region.state, timeMs);
      }
      if (dt > 0) fallback = fallback.map(w => ({ ...w, ageSec: w.ageSec + dt }));
      return moving && dt > 0;
    },
    visual(body: BuildResult): VisualWound[] {
      const cuts: VisualWound[] = [];
      let reserved = 0;
      for (const region of regions) if (region && alive(region.anchor, body)) {
        reserved += 2;
        const { anchor, tangent, up, state } = region;
        const { from, to, blend } = advanceRegion(state, timeMs);
        for (let i = 0; i < 2; i++) {
          const a = PRESETS[from]![i]!, b = PRESETS[to]![i]!;
          const radius = a.radius + (b.radius - a.radius) * blend;
          if (radius <= 0) continue;
          const offset = add(scale(tangent, b.center[0]), scale(up, b.center[1]));
          cuts.push({ ...anchor, local: add(anchor.local, offset), radius, ageSec: 0, presetCut: true });
        }
      }
      // Reserving both cutter slots per live region avoids extra evictions
      // halfway through that region's light-to-heavy blend.
      return [...fallback.filter(w => alive(w, body)).slice(-(MAX_WOUNDS - reserved)), ...cuts];
    },
    snapshot: () => regions.map(r => r ? { ...r.state } : null),
  };
}
