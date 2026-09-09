import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROBE_OPTIONS,
  SH_A0,
  SH_A1,
  SH_Y00,
  SH_Y1,
  buildProbeGrid,
  fibonacciSphere,
  hitEnclosure,
  irradianceL1,
  packProbeTexture,
  probePosition,
  projectL1,
  sampleProbeGrid,
  unpackProbeTexture,
  wallRadiance,
  type Box,
  type EnclosureWalls,
  type ProbeGrid,
  type ProbeLight,
} from './probe-grid';

/** The lab's default enclosure: 4m x 3.2m x 4m sitting on the floor plane. */
const BOX: Box = { min: [-2, 0, -2], max: [2, 3.2, 2] };

/** Neutral grey everywhere — no wall should be able to tint anything. */
const GREY: EnclosureWalls = {
  negX: [0.5, 0.5, 0.5], posX: [0.5, 0.5, 0.5],
  negY: [0.5, 0.5, 0.5], posY: [0.5, 0.5, 0.5],
  negZ: [0.5, 0.5, 0.5], posZ: [0.5, 0.5, 0.5],
};

/** Left wall red, everything else near-black: the spike's headline fixture. */
const RED_LEFT: EnclosureWalls = {
  negX: [0.9, 0.05, 0.05], posX: [0.02, 0.02, 0.02],
  negY: [0.02, 0.02, 0.02], posY: [0.02, 0.02, 0.02],
  negZ: [0.02, 0.02, 0.02], posZ: [0.02, 0.02, 0.02],
};

function norm(v: readonly [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** The lab's `practical-hard-key` numbers from zombie-gpu.ts. */
const LIGHT: ProbeLight = {
  dir: norm([0.45, 0.72, 0.53]),
  keyColor: [1.0, 0.96, 0.92],
  keyIntensity: 2.4,
  fillIntensity: 0.06,
};

const FILL = 0.06;
const CENTRE: [number, number, number] = [0, 1.6, 0];
const redness = (c: readonly number[]) => c[0]! / Math.max(c[1]! + c[2]!, 1e-6);

describe('fibonacciSphere', () => {
  it('returns n unit directions with a near-zero mean', () => {
    const dirs = fibonacciSphere(256, 0.5);
    expect(dirs.length).toBe(256);
    const mean: [number, number, number] = [0, 0, 0];
    for (const d of dirs) {
      expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 9);
      mean[0] += d[0]; mean[1] += d[1]; mean[2] += d[2];
    }
    // A roughly uniform sphere integrates to zero. The Fibonacci lattice is
    // near-exact in y and only ~1/sqrt(n) off in x/z.
    for (const m of mean) expect(Math.abs(m / dirs.length)).toBeLessThan(0.05);
  });

  it('is deterministic for a given seed and varies with the seed', () => {
    expect(fibonacciSphere(32, 0.25)).toEqual(fibonacciSphere(32, 0.25));
    expect(fibonacciSphere(32, 0.25)).not.toEqual(fibonacciSphere(32, 0.75));
  });
});

describe('hitEnclosure', () => {
  const cases: {
    dir: [number, number, number];
    t: number;
    wall: keyof EnclosureWalls;
    point: [number, number, number];
    normal: [number, number, number];
  }[] = [
    { dir: [1, 0, 0], t: 2, wall: 'posX', point: [2, 1.6, 0], normal: [-1, 0, 0] },
    { dir: [-1, 0, 0], t: 2, wall: 'negX', point: [-2, 1.6, 0], normal: [1, 0, 0] },
    { dir: [0, 1, 0], t: 1.6, wall: 'posY', point: [0, 3.2, 0], normal: [0, -1, 0] },
    { dir: [0, -1, 0], t: 1.6, wall: 'negY', point: [0, 0, 0], normal: [0, 1, 0] },
    { dir: [0, 0, 1], t: 2, wall: 'posZ', point: [0, 1.6, 2], normal: [0, 0, -1] },
    { dir: [0, 0, -1], t: 2, wall: 'negZ', point: [0, 1.6, -2], normal: [0, 0, 1] },
  ];

  for (const c of cases) {
    it(`exits through ${c.wall} with the normal pointing into the room`, () => {
      const hit = hitEnclosure(CENTRE, c.dir, BOX);
      expect(hit).not.toBeNull();
      expect(hit!.wall).toBe(c.wall);
      expect(hit!.t).toBeCloseTo(c.t, 9);
      for (let a = 0; a < 3; a++) expect(hit!.point[a]).toBeCloseTo(c.point[a]!, 9);
      for (let a = 0; a < 3; a++) expect(hit!.normal[a]).toBeCloseTo(c.normal[a]!, 9);
      expect(Math.hypot(hit!.normal[0], hit!.normal[1], hit!.normal[2])).toBeCloseTo(1, 9);
      // An inward normal must oppose the outward ray.
      expect(hit!.normal[0] * c.dir[0] + hit!.normal[1] * c.dir[1] + hit!.normal[2] * c.dir[2])
        .toBeLessThan(0);
    });
  }

  it('takes the nearest slab exit on a diagonal', () => {
    // (1,1,1)/sqrt3 leaves the 3.2m-tall box through the ceiling first.
    const d = norm([1, 1, 1]);
    const hit = hitEnclosure(CENTRE, d, BOX);
    expect(hit).not.toBeNull();
    expect(hit!.wall).toBe('posY');
    expect(hit!.t).toBeCloseTo(1.6 * Math.sqrt(3), 9);
    expect(hit!.point[1]).toBeCloseTo(3.2, 9);
  });
});

describe('wallRadiance', () => {
  it('gives a wall facing away from the key only fill + bounce', () => {
    const albedo: [number, number, number] = [0.5, 0.4, 0.3];
    const away: [number, number, number] = [-LIGHT.dir[0], -LIGHT.dir[1], -LIGHT.dir[2]];
    const bounce: [number, number, number] = [0.01, 0.02, 0.03];
    const got = wallRadiance('negX', albedo, away, LIGHT, bounce);
    for (let c = 0; c < 3; c++) {
      expect(got[c]).toBeCloseTo(albedo[c]! * (LIGHT.fillIntensity * LIGHT.keyColor[c]! + bounce[c]!), 9);
    }
  });

  it('adds the key term with the wall N.L, unshadowed', () => {
    const albedo: [number, number, number] = [0.5, 0.5, 0.5];
    const bounce: [number, number, number] = [0, 0, 0];
    const facing = wallRadiance('negX', albedo, LIGHT.dir, LIGHT, bounce);
    const away = wallRadiance('negX', albedo, [-LIGHT.dir[0], -LIGHT.dir[1], -LIGHT.dir[2]], LIGHT, bounce);
    for (let c = 0; c < 3; c++) expect(facing[c]).toBeGreaterThan(away[c]!);
    // A convex box cannot self-shadow a directional light: N.L is the whole story.
    for (let c = 0; c < 3; c++) {
      expect(facing[c]).toBeCloseTo(albedo[c]! * (LIGHT.keyIntensity * LIGHT.keyColor[c]! + LIGHT.fillIntensity * LIGHT.keyColor[c]!), 9);
    }
  });
});

describe('projectL1 / irradianceL1', () => {
  it('recovers pi * c for a uniform radiance sphere within 2%', () => {
    const c = 0.37;
    const dirs = fibonacciSphere(1024, 0.5);
    const samples = dirs.map((dir) => ({ dir, radiance: [c, c, c] as [number, number, number] }));
    const sh = projectL1(samples);
    const ns: [number, number, number][] = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
      norm([0.3, -0.5, 0.81]),
    ];
    for (const n of ns) {
      const e = irradianceL1(sh, 0, n);
      for (let ch = 0; ch < 3; ch++) {
        expect(Math.abs(e[ch]! - Math.PI * c) / (Math.PI * c)).toBeLessThan(0.02);
      }
    }
  });

  it('peaks along a single bright direction and clamps to zero opposite it', () => {
    const c = 5;
    const bright = norm([0.3, 0.8, -0.5]);
    const samples = [{ dir: bright, radiance: [c, c, c] as [number, number, number] }];
    const sh = projectL1(samples);
    const along = irradianceL1(sh, 0, bright);
    const opposite = irradianceL1(sh, 0, [-bright[0], -bright[1], -bright[2]]);
    const perp = irradianceL1(sh, 0, norm([bright[1], -bright[0], 0]));
    for (let ch = 0; ch < 3; ch++) {
      expect(along[ch]).toBeGreaterThan(0);
      expect(opposite[ch]).toBe(0);
      expect(along[ch]).toBeGreaterThan(perp[ch]!);
    }
  });

  it('exports the SH constants the WGSL twin pins', () => {
    expect(SH_Y00).toBeCloseTo(0.282095, 6);
    expect(SH_Y1).toBeCloseTo(0.488603, 6);
    expect(SH_A0).toBeCloseTo(Math.PI, 12);
    expect(SH_A1).toBeCloseTo((2 * Math.PI) / 3, 12);
  });
});

describe('sampleProbeGrid', () => {
  /** Two probes, x = -1 and x = +1, with distinct constant radiances. */
  function twoProbeGrid(): ProbeGrid {
    const sh = new Float32Array(2 * 12);
    // Probe 0: uniform radiance 0.25 (L00 = 4*pi*Y00*c).
    // Probe 1: uniform radiance 0.75.
    const l00 = (c: number) => 4 * Math.PI * SH_Y00 * c;
    sh[0] = sh[1] = sh[2] = l00(0.25);
    sh[12] = sh[13] = sh[14] = l00(0.75);
    return { dims: [2, 1, 1], min: [-1, 0, 0], max: [1, 0, 0], sh };
  }

  it('at a probe position equals that probe\u2019s own irradiance', () => {
    const grid = twoProbeGrid();
    const n: [number, number, number] = [0, 1, 0];
    const p0 = probePosition(grid, 0, 0, 0);
    const p1 = probePosition(grid, 1, 0, 0);
    for (let ch = 0; ch < 3; ch++) {
      expect(sampleProbeGrid(grid, p0, n)[ch]).toBeCloseTo(irradianceL1(grid.sh, 0, n)[ch]!, 9);
      expect(sampleProbeGrid(grid, p1, n)[ch]).toBeCloseTo(irradianceL1(grid.sh, 12, n)[ch]!, 9);
    }
  });

  it('midway between two probes is the mean of their irradiances', () => {
    const grid = twoProbeGrid();
    const n: [number, number, number] = [0, 1, 0];
    const mid = sampleProbeGrid(grid, [0, 0, 0], n);
    const a = irradianceL1(grid.sh, 0, n);
    const b = irradianceL1(grid.sh, 12, n);
    for (let ch = 0; ch < 3; ch++) expect(mid[ch]).toBeCloseTo((a[ch]! + b[ch]!) / 2, 9);
  });
});

describe('buildProbeGrid \u2014 the grey room', () => {
  // keyIntensity 0 isolates the fill/bounce chain, and a white keyColor makes
  // the analytic value a scalar: E_n = pi * 0.5 * f * (1 + 0.5 + ... + 0.5^n).
  const WHITE_LIGHT: ProbeLight = {
    dir: LIGHT.dir, keyColor: [1, 1, 1], keyIntensity: 0, fillIntensity: FILL,
  };

  it('is direction-independent for every n within 5%', () => {
    const grid = buildProbeGrid(BOX, GREY, WHITE_LIGHT, { bounces: 2 });
    const ns: [number, number, number][] = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
      norm([0.577, 0.577, 0.577]),
    ];
    const ref = sampleProbeGrid(grid, CENTRE, ns[0]!);
    for (const n of ns.slice(1)) {
      const e = sampleProbeGrid(grid, CENTRE, n);
      for (let ch = 0; ch < 3; ch++) {
        expect(Math.abs(e[ch]! - ref[ch]!) / Math.max(ref[ch]!, 1e-9)).toBeLessThan(0.05);
      }
    }
  });

  it('increases monotonically with bounces and converges to pi*f at 4 bounces', () => {
    const levels: number[] = [];
    for (let bounces = 0; bounces <= 4; bounces++) {
      const grid = buildProbeGrid(BOX, GREY, WHITE_LIGHT, { bounces });
      levels.push(sampleProbeGrid(grid, CENTRE, [0, 1, 0])[0]!);
    }
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]!);
    const target = (Math.PI * 0.5 * FILL) / (1 - 0.5);
    expect(Math.abs(levels[4]! - target) / target).toBeLessThan(0.1);
  });
});

describe('buildProbeGrid \u2014 a red wall', () => {
  it('reads redder facing the red wall than facing away, near it', () => {
    const grid = buildProbeGrid(BOX, RED_LEFT, LIGHT, { bounces: 2 });
    const near: [number, number, number] = [-1.85, 1.1167, 0.2643];
    const toward = sampleProbeGrid(grid, near, [-1, 0, 0]);
    const away = sampleProbeGrid(grid, near, [1, 0, 0]);
    expect(redness(toward)).toBeGreaterThan(redness(away) * 1.5);
  });

  it('keeps every coefficient finite and every irradiance non-negative', () => {
    const grid = buildProbeGrid(BOX, RED_LEFT, LIGHT, { bounces: 2 });
    for (const v of grid.sh) expect(Number.isFinite(v)).toBe(true);
    const ns: [number, number, number][] = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ];
    for (const p of [[-1.9, 0.2, 0], [0, 1.6, 0], [1.9, 3.0, 0], [-1.9, 3.0, 1.9]] as [number, number, number][]) {
      for (const n of ns) {
        for (const c of sampleProbeGrid(grid, p, n)) {
          expect(Number.isFinite(c)).toBe(true);
          expect(c).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('completes the default grid in under 500 ms', () => {
    const t0 = performance.now();
    const grid = buildProbeGrid(BOX, GREY, LIGHT, DEFAULT_PROBE_OPTIONS);
    const dt = performance.now() - t0;
    expect(grid.sh.length).toBe(8 * 4 * 8 * 12);
    expect(dt).toBeLessThan(500);
  });
});

describe('packProbeTexture', () => {
  it('round-trips the SH coefficients and reports the 3-texels-per-probe width', () => {
    const grid = buildProbeGrid(BOX, GREY, LIGHT, { dims: [2, 1, 2], bounces: 1 });
    const probeCount = 2 * 1 * 2;
    const packed = packProbeTexture(grid);
    expect(packed.height).toBe(1);
    expect(packed.width).toBe(probeCount * 3);
    expect(packed.data.length).toBe(probeCount * 12);
    expect(Array.from(unpackProbeTexture(packed.data, probeCount))).toEqual(Array.from(grid.sh));
  });
});

describe('ProbeGridOptions defaults', () => {
  it('matches the spike plan', () => {
    expect(DEFAULT_PROBE_OPTIONS).toEqual({ dims: [8, 4, 8], raysPerProbe: 128, bounces: 2, inset: 0.15 });
  });
});
