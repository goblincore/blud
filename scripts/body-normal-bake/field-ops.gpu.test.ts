// scripts/body-normal-bake/field-ops.gpu.test.ts
//
// THE OP FIXTURES (spec 2026-10-24-gpu-body-normal-bake-design.md, Tests 1): one small hand-built body per op
// `sdBody` folds, evaluated on the CPU (validate.ts, the reference) and on the GPU (body-normal-bake/bake.wgsl.ts,
// the game's leaf WGSL under sdBodyClosed's fold), so a mismatch names the op. Run with `npm run test:gpu`.
import { describe, expect, it } from 'vitest';
import type { Primitive } from '../../src/lab/sdf-zombie/types';
import type { Body } from '../../src/lab/sdf-zombie/body-normal-bake/regions';
import { compareField, describeParity, FIELD_TOL, parityGpu, samplePoints } from './gpu-parity-lib';

const gpu = await parityGpu();

type P = Partial<Primitive>;
const prim = (o: P = {}): Primitive => ({
  a: [0, 0, 0], b: [0, 0.3, 0], radius: 0.08, scale: [1, 1, 1], blendK: 0.02, limb: 'torso', cluster: 0, ...o,
} as Primitive);

/** One body; `groups` are clusters in order, each a list of prims. A cluster named in `deadClusters` is not alive. */
function body(groups: Primitive[][], deadClusters: number[] = []): Body {
  const prims: Primitive[] = [];
  const clusters = groups.map((g, id) => {
    const start = prims.length;
    prims.push(...g.map(p => ({ ...p, cluster: id })));
    return { id, limb: g[0]?.limb ?? 'torso', start, count: g.length, center: [0, 0.15, 0], radius: 1, alive: !deadClusters.includes(id) };
  });
  return { prims, clusters, bones: new Map(), bonePrims: [] } as unknown as Body;
}

// A 30-degree turn about normalize(1, 1, 0), as an [x, y, z, w] quat.
const s30 = Math.sin(Math.PI / 12), c30 = Math.cos(Math.PI / 12);
const ORIENT: [number, number, number, number] = [s30 / Math.SQRT2, s30 / Math.SQRT2, 0, c30];
const SHELL = { thickness: 0.012, clipNormal: [0, 0, 1] as [number, number, number], clipOffset: 0.02, rim: 0.01 };
const STRAND = { count: 4, wave: 0.2, cycles: 3, fat: 0.5 };
const second = (o: P = {}) => prim({ a: [0.05, 0.25, 0.02], b: [0.2, 0.32, 0.05], radius: 0.05, blendK: 0.03, ...o });

const FIXTURES: Record<string, Body> = {
  'plain capsule': body([[prim()]]),
  'tapered capsule': body([[prim({ radiusB: 0.03 })]]),
  'taper to a point': body([[prim({ radiusB: 0 })]]),
  'radiusB equal to radius': body([[prim({ radiusB: 0.08 })]]),
  'bent': body([[prim({ bend: [0.08, 0, 0.02] })]]),
  'bent and tapered': body([[prim({ bend: [0.08, 0, 0.02], radiusB: 0.035 })]]),
  'scaled ellipsoid': body([[prim({ b: [0, 0, 0], scale: [1.6, 0.7, 1.1] })]]),
  'scaled capsule': body([[prim({ scale: [1.4, 1, 0.6] })]]),
  'box': body([[prim({ box: { round: 0 }, scale: [1, 1.3, 0.6] })]]),
  'round box': body([[prim({ box: { round: 0.3 }, scale: [1, 1.3, 0.6] })]]),
  'oriented': body([[prim({ orient: ORIENT, scale: [1.5, 0.6, 1] })]]),
  'oriented and bent': body([[prim({ orient: ORIENT, scale: [1.5, 0.6, 1], bend: [0.06, 0, 0] })]]),
  'strand': body([[prim({ strand: STRAND, radiusB: 0.04 })]]),
  'bent strand': body([[prim({ strand: STRAND, radiusB: 0.04, bend: [0.07, 0, 0.03] })]]),
  'shell': body([[prim({ shell: SHELL })]]),
  'warped shell': body([[prim({ shell: { ...SHELL, warpAmp: 0.004, warpFreq: [40, 30, 50] } })]]),
  'smin pair': body([[prim(), second()]]),
  'hard union (blendK 0)': body([[prim({ blendK: 0 }), second({ blendK: 0 })]]),
  'chamfer': body([[prim(), second({ blendProfile: 'chamfer' })]]),
  'chamfer and bent': body([[prim(), second({ blendProfile: 'chamfer', bend: [0, 0.05, 0.03] })]]),
  'carve': body([[prim(), prim({ op: 'sub', a: [0.06, 0.12, 0], b: [0.06, 0.18, 0], radius: 0.04, blendK: 0.01 })]]),
  'hard carve (blendK 0)': body([[prim(), prim({ op: 'sub', a: [0.06, 0.12, 0], b: [0.06, 0.18, 0], radius: 0.04, blendK: 0 })]]),
  'groove': body([[prim(), prim({ op: 'groove', a: [0.08, 0, 0], b: [0.08, 0.3, 0], radius: 0.01, scale: [1, 1, 0.2], grooveDepth: 0.004, grooveWidth: 0.0015 })]]),
  'dead prim': body([[prim(), second({ dead: true })]]),
  'dead carve': body([[prim(), prim({ op: 'sub', dead: true, a: [0.06, 0.12, 0], b: [0.06, 0.18, 0], radius: 0.04 })]]),
  'bone and organ are not folded': body([[prim(), second({ op: 'bone' }), second({ op: 'organ', a: [-0.1, 0.1, 0] })]]),
  'two clusters, carve across': body([
    [prim(), second()],
    [prim({ limb: 'head', a: [0, 0.38, 0], b: [0, 0.45, 0], radius: 0.07 }), prim({ limb: 'head', op: 'sub', a: [0, 0.3, 0.06], b: [0, 0.4, 0.06], radius: 0.03, blendK: 0.01 })],
  ]),
  'dead cluster': body([[prim()], [second({ limb: 'head' })]], [1]),
};

describe.skipIf(!gpu)(`bake field op fixtures vs sdBody (${gpu?.adapter})`, () => {
  for (const [name, b] of Object.entries(FIXTURES)) {
    it(name, async () => {
      const r = await compareField(gpu!, b, samplePoints(b, 4096, 7));
      console.log(`${name}: ${describeParity(r)}`);
      expect(r.maxErr, describeParity(r)).toBeLessThanOrEqual(FIELD_TOL);
    });
  }
});
