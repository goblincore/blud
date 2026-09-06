import type { BuildResult } from '../build-body';
import { MAX_WOUNDS, type Wound } from '../damage';
import { add, cross, dot, len, normalize, scale, sub } from '../vec';
import type { Vec3 } from '../types';
import { advanceRegion, createRegionState, hitRegion, PRESETS } from './presets';

/** Upload-only marker. These rows use hard capped subtraction without a rim. */
export type VisualWound = Wound & { presetCut?: true };

/** One experimental torso region. Shared recipes; bounded per-actor metadata. */
export function createTorsoWounds() {
  const state = createRegionState();
  let timeMs = 0;
  let anchor: Wound | null = null;
  let tangent: Vec3 = [1, 0, 0], up: Vec3 = [0, 1, 0];
  let fallback: Wound[] = [];

  const alive = (w: Wound, body: BuildResult) => {
    const p = body.prims[w.primIdx];
    return !!p && !p.dead && body.clusters[p.cluster]?.alive !== false;
  };
  return {
    record(w: Wound, body: BuildResult, allowPreset = true) {
      const p = body.prims[w.primIdx];
      if (!allowPreset || w.type === 'burn' || p?.limb !== 'torso' || !alive(w, body)) {
        fallback = [...fallback, { ...w }].slice(-MAX_WOUNDS);
        return;
      }
      if (!anchor) {
        anchor = { ...w, local: [...w.local] };
        // Author the two offsets in the tangent plane of the first impact,
        // then retain that plane in the same transported frame as the wound.
        const outward = normalize(w.carveN ? scale(w.carveN, -1) : w.local);
        const n: Vec3 = len(outward) > 0 ? outward : [0, 0, 1];
        const seed: Vec3 = Math.abs(n[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
        up = normalize(sub(seed, scale(n, dot(seed, n))));
        tangent = cross(up, n);
      }
      hitRegion(state, timeMs);
    },
    advance(dt: number): boolean {
      if (!Number.isFinite(dt) || dt < 0) throw new Error('dt must be finite and nonnegative');
      const moving = state.current !== state.target;
      timeMs += dt * 1000;
      advanceRegion(state, timeMs);
      if (dt > 0) fallback = fallback.map(w => ({ ...w, ageSec: w.ageSec + dt }));
      return moving && dt > 0;
    },
    visual(body: BuildResult): VisualWound[] {
      const cuts: VisualWound[] = [];
      if (anchor && alive(anchor, body)) {
        const { from, to, blend } = advanceRegion(state, timeMs);
        for (let i = 0; i < 2; i++) {
          const a = PRESETS[from]![i]!, b = PRESETS[to]![i]!;
          const radius = a.radius + (b.radius - a.radius) * blend;
          if (radius <= 0) continue;
          const offset = add(scale(tangent, b.center[0]), scale(up, b.center[1]));
          cuts.push({ ...anchor, local: add(anchor.local, offset), radius, ageSec: 0, presetCut: true });
        }
      }
      // Reserve both endpoint cutter slots as soon as the region exists, so
      // growing the second cutter never evicts an extra fallback mid-blend.
      return [...fallback.filter(w => alive(w, body)).slice(-(MAX_WOUNDS - (anchor ? 2 : 0))), ...cuts];
    },
    snapshot: () => ({ ...state }),
  };
}
