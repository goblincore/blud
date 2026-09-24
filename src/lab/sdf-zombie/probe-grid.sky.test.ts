// src/lab/sdf-zombie/probe-grid.sky.test.ts
//
// Outdoor v1 §7: an open room's probes see the sky through the top (and through
// walls above the edge) instead of a reflecting ceiling. No sky option = the bake
// is bit-identical to before.

import { describe, expect, it } from 'vitest';
import { buildProbeGrid, irradianceL1, type ProbeLight } from './probe-grid';
import type { Box, EnclosureWalls } from './ambient';

const box: Box = { min: [0, 0, 0], max: [8, 6, 8] };
const grey: EnclosureWalls = { negX: [0.3, 0.3, 0.3], posX: [0.3, 0.3, 0.3], negY: [0.3, 0.3, 0.3],
  posY: [0.3, 0.3, 0.3], negZ: [0.3, 0.3, 0.3], posZ: [0.3, 0.3, 0.3] };
const light: ProbeLight = { dir: [0.3, -0.8, 0.5], keyColor: [1, 1, 1], keyIntensity: 1, fillIntensity: 0.2 };
const opts = { dims: [3, 3, 3] as [number, number, number], raysPerProbe: 64, bounces: 1 };

describe('buildProbeGrid sky term', () => {
  it('without sky it is unchanged (same call twice, and sky: undefined)', () => {
    const a = buildProbeGrid(box, grey, light, opts);
    const b = buildProbeGrid(box, grey, light, { ...opts, sky: undefined });
    expect(Array.from(b.sh)).toEqual(Array.from(a.sh));
  });

  it('an open room receives the sky colour from above', () => {
    const sky = { radiance: [0.0, 0.0, 1.0] as [number, number, number], above: 2.2 };
    const g = buildProbeGrid(box, grey, light, { ...opts, sky });
    const centre = 13 * 12; // probe (1,1,1) of a 3x3x3 grid
    const up = irradianceL1(g.sh, centre, [0, 1, 0]);
    const closed = buildProbeGrid(box, grey, light, opts);
    const upClosed = irradianceL1(closed.sh, centre, [0, 1, 0]);
    expect(up[2]).toBeGreaterThan(upClosed[2]);          // blue sky above
    expect(up[0]).toBeLessThan(upClosed[0]);              // no grey ceiling bounce
  });
});
