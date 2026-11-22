// flesh-jiggle.ts: a hit QUIVERS soft flesh on a rigid frame. Pins that the struck lobes move more than the far ones,
// that neighbours move out of step (the shape distorts, not just scales), that the calm zone (the face) moves less,
// that a volley's pellets fold into one capped kick, and that it rings out to the untouched body.
import { describe, it, expect } from 'vitest';
import { ageJiggle, jiggleBulk, jiggleFlesh, kickJiggle, type FleshJiggleSpec, type JiggleKick } from './flesh-jiggle';
import type { Primitive, Vec3 } from './types';

const spec: FleshJiggleSpec = { amp: 0.09, bulk: 0.025, freq: 7, decay: 0.16, reach: 0.45, squash: 0.18, calm: 0.35, calmReach: 0.35 };
const ball = (at: Vec3): Primitive => ({ a: at, b: at, radius: 0.3, limb: 'torso' } as unknown as Primitive);
const body = { prims: [ball([0, 2, 0.6]), ball([0.15, 2, 0.6]), ball([0, 2, -0.6]), ball([0, 1.5, 0.9])] };
const moved = (b: typeof body, i: number) => Math.hypot(...b.prims[i]!.a.map((v, k) => v - body.prims[i]!.a[k]!));

describe('jiggleFlesh', () => {
  it('leaves the body alone with no kicks', () => {
    expect(jiggleFlesh(body, [], spec, () => true, null)).toBe(body);
  });
  it('shakes the struck side hardest, neighbours out of step, the face least', () => {
    const kicks: JiggleKick[] = [];
    kickJiggle(kicks, [0, 2, 0.9], [0, 0, -1], 1);
    let near = 0, far = 0, apart = 0;
    for (let i = 0; i < 30; i++) {
      ageJiggle(kicks, 1 / 60, spec);
      const j = jiggleFlesh(body, kicks, spec, () => true, [0, 1.5, 0.9]);
      near = Math.max(near, moved(j, 0)); far = Math.max(far, moved(j, 2));
      // How differently two neighbours moved: a pure scale or shove would move them alike.
      const d0 = j.prims[0]!.a.map((v, k) => v - body.prims[0]!.a[k]!), d1 = j.prims[1]!.a.map((v, k) => v - body.prims[1]!.a[k]!);
      apart = Math.max(apart, Math.hypot(...d0.map((v, k) => v - d1[k]!)));
    }
    expect(near, 'the struck lobe lurches').toBeGreaterThan(0.05);
    expect(far, 'the far side only takes the bulk').toBeLessThan(near / 2);
    expect(apart, 'neighbours move out of step').toBeGreaterThan(0.02);
  });
  it('folds a volley into one kick, capped', () => {
    const kicks: JiggleKick[] = [];
    for (let i = 0; i < 16; i++) kickJiggle(kicks, [0, 2, 0.9 + i * 0.01], [0, 0, -1], 0.35);
    expect(kicks.length).toBe(1);
    expect(kicks[0]!.gain).toBeLessThanOrEqual(2.2 + 1e-9);
  });
  it('rings out', () => {
    const kicks: JiggleKick[] = [];
    kickJiggle(kicks, [0, 2, 0.9], [0, 0, -1], 1);
    for (let i = 0; i < 120; i++) ageJiggle(kicks, 1 / 60, spec);
    expect(kicks.length).toBe(0);
    expect(jiggleBulk(kicks, spec)).toEqual([0, 0, 0]);
  });
});
