import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OCCLUDER_ALBEDO,
  DEFAULT_PROBE_OPTIONS,
  POINT_REF_DIST,
  SH_A0,
  SH_A1,
  SH_Y00,
  SH_Y1,
  buildProbeGrid,
  buildProbeGridRequest,
  fibonacciSphere,
  hitAabbEntry,
  hitEnclosure,
  irradianceL1,
  packProbeTexture,
  probeInsideOccluder,
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
// Test-only pin: the gather's point-light falloff must mirror the wall side's.
// The source file deliberately does NOT import game-level.ts (it must stay
// dependency-free and worker-friendly); the TEST is what keeps the twins equal.
import { ACCENT_ALBEDO_REF_DIST } from './webgpu/game-level';

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

  it('completes the default grid in under 2.5 s (a loose wall-clock pin; 61 ms when the machine is idle)', () => {
    const t0 = performance.now();
    const grid = buildProbeGrid(BOX, GREY, LIGHT, DEFAULT_PROBE_OPTIONS);
    const dt = performance.now() - t0;
    expect(grid.sh.length).toBe(8 * 4 * 8 * 12);
    expect(dt).toBeLessThan(2500);
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

describe('POINT_REF_DIST', () => {
  it('mirrors the wall falloff reference in game-level.ts', () => {
    // The gather must use the SAME falloff the walls already use, or bodies
    // and walls disagree about the room. The source copy is deliberate (no
    // import from game-level.ts); this test is the pin.
    expect(POINT_REF_DIST).toBe(ACCENT_ALBEDO_REF_DIST);
    expect(POINT_REF_DIST).toBe(2.2);
  });
});

describe('point lights', () => {
  const WHITE: [number, number, number] = [1, 1, 1];
  const NO_KEY: ProbeLight = { ...LIGHT, keyIntensity: 0, fillIntensity: 0 };

  it('falls off as 1/(1+(d/POINT_REF_DIST)^2); directly under is twice the ref distance', () => {
    const albedo: [number, number, number] = [1, 1, 1];
    const up: [number, number, number] = [0, 1, 0];
    // Light straight above the hit point, normal facing it, so N.L = 1 and
    // only the inverse-square-ish falloff is under test.
    const at = (h: number) =>
      wallRadiance(
        'negY',
        albedo,
        up,
        { ...NO_KEY, points: [{ pos: [0, h, 0], color: WHITE }] },
        [0, 0, 0],
        [0, 0, 0],
        [],
      );
    const below = at(0.1); // d = 0.1 m -> f ~= 1
    const atRef = at(POINT_REF_DIST); // d = 2.2 m -> f = 1/(1+1) = 0.5
    expect(below[0]).toBeCloseTo(1 / (1 + (0.1 / POINT_REF_DIST) ** 2), 9);
    expect(atRef[0]).toBeCloseTo(0.5, 9);
    const ratio = below[0]! / atRef[0]!;
    expect(Math.abs(ratio - 2) / 2).toBeLessThan(0.01);
  });

  it('contributes nothing to a surface facing away from the light', () => {
    const albedo: [number, number, number] = [0.8, 0.8, 0.8];
    const light: ProbeLight = { ...NO_KEY, points: [{ pos: [0, 2, 0], color: [1, 0, 0] }] };
    const away: [number, number, number] = [0, -1, 0];
    const got = wallRadiance('negY', albedo, away, light, [0, 0, 0], [0, 0, 0], []);
    expect(got).toEqual([0, 0, 0]);
    const facing = wallRadiance('negY', albedo, [0, 1, 0], light, [0, 0, 0], [0, 0, 0], []);
    expect(facing[0]).toBeGreaterThan(0);
    expect(facing[1]).toBe(0);
    expect(facing[2]).toBe(0);
  });

  it('is ignored when no hit point is supplied (the existing 5-arg call shape)', () => {
    const albedo: [number, number, number] = [0.5, 0.4, 0.3];
    const light: ProbeLight = { ...LIGHT, points: [{ pos: [0, 0, 0], color: [10, 10, 10] }] };
    const got = wallRadiance('negX', albedo, LIGHT.dir, light, [0, 0, 0]);
    const want = wallRadiance('negX', albedo, LIGHT.dir, LIGHT, [0, 0, 0]);
    expect(got).toEqual(want);
  });
});

describe('hitAabbEntry', () => {
  const CRATE: Box = { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] };

  it('returns the nearest positive entry with the outward normal facing the origin', () => {
    const hit = hitAabbEntry([-3, 0.5, 0], [1, 0, 0], CRATE);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(2.5, 9);
    expect(hit!.point).toEqual([-0.5, 0.5, 0]);
    expect(hit!.normal).toEqual([-1, 0, 0]);
  });

  it('returns null from inside, from behind, and on a miss', () => {
    expect(hitAabbEntry([0, 0.5, 0], [1, 0, 0], CRATE)).toBeNull();   // origin inside
    expect(hitAabbEntry([-3, 0.5, 0], [-1, 0, 0], CRATE)).toBeNull(); // box behind
    expect(hitAabbEntry([-3, 2, 0], [1, 0, 0], CRATE)).toBeNull();    // parallel miss
  });
});

describe('buildProbeGrid \u2014 occluders', () => {
  // The +x half of the enclosure, filled by a crate. A ray from the centre
  // toward +x must read the crate's albedo, not the wall behind it.
  const HALF_CRATE: Box = { min: [0.3, 0, -1.99], max: [1.99, 3.19, 1.99] };

  it('a ray from the centre toward a crate hits the crate, not the wall behind it', () => {
    const origin: [number, number, number] = [0, 1.6, 0];
    const dir: [number, number, number] = [1, 0, 0];
    const enc = hitEnclosure(origin, dir, BOX);
    const occ = hitAabbEntry(origin, dir, HALF_CRATE);
    expect(enc).not.toBeNull();
    expect(occ).not.toBeNull();
    expect(occ!.t).toBeCloseTo(0.3, 9);
    expect(occ!.t).toBeLessThan(enc!.t);

    const grid = buildProbeGrid(BOX, GREY, LIGHT, {
      dims: [1, 1, 1],
      raysPerProbe: 256,
      bounces: 0,
      occluders: [HALF_CRATE],
      occluderAlbedo: [0.9, 0.05, 0.05],
    });
    const p: [number, number, number] = [0, 1.6, 0];
    const towardX = sampleProbeGrid(grid, p, [1, 0, 0]);
    const awayX = sampleProbeGrid(grid, p, [-1, 0, 0]);
    // The crate only gets fill (its normal faces -x, away from the key), so
    // +x reads red while -x reads the grey keyed wall.
    expect(redness(towardX)).toBeGreaterThan(redness(awayX) * 2);
  });

  it('a crate lit from above reflects its own albedo', () => {
    const crate: Box = { min: [0.8, 1.0, -1.5], max: [1.6, 2.2, 1.5] };
    const hit = hitAabbEntry([1.2, 2.5, 0], [0, -1, 0], crate);
    expect(hit).not.toBeNull();
    expect(hit!.normal).toEqual([0, 1, 0]);
    const got = wallRadiance('posY', DEFAULT_OCCLUDER_ALBEDO, hit!.normal, LIGHT, [0, 0, 0], hit!.point, []);
    const ndl = Math.max(hit!.normal[1] * LIGHT.dir[1], 0);
    for (let c = 0; c < 3; c++) {
      expect(got[c]).toBeCloseTo(
        DEFAULT_OCCLUDER_ALBEDO[c]! *
          (LIGHT.keyIntensity * ndl * LIGHT.keyColor[c]! + LIGHT.fillIntensity * LIGHT.keyColor[c]!),
        9,
      );
    }
  });

  it('defaults the occluder albedo to the dark crate', () => {
    expect(DEFAULT_OCCLUDER_ALBEDO).toEqual([0.35, 0.33, 0.30]);
  });
});

describe('point light occlusion by occluders', () => {
  it('a crate between a wall point and the light leaves only fill + bounce', () => {
    const albedo: [number, number, number] = [0.5, 0.5, 0.5];
    const up: [number, number, number] = [0, 1, 0];
    const light: ProbeLight = {
      ...LIGHT,
      keyIntensity: 0,
      points: [{ pos: [0, 2, 0], color: [1, 0, 0] }],
    };
    const bounce: [number, number, number] = [0.01, 0.01, 0.01];
    const crate: Box = { min: [-0.5, 0.4, -0.5], max: [0.5, 1.2, 0.5] };
    const blocked = wallRadiance('negY', albedo, up, light, bounce, [0, 0, 0], [crate]);
    const clear = wallRadiance('negY', albedo, up, light, bounce, [0, 0, 0], []);
    for (let c = 0; c < 3; c++) {
      expect(blocked[c]).toBeCloseTo(albedo[c]! * (LIGHT.fillIntensity * LIGHT.keyColor[c]! + bounce[c]!), 9);
    }
    expect(clear[0]).toBeGreaterThan(blocked[0]!);
    expect(clear[1]).toBeCloseTo(blocked[1]!, 9);
    expect(clear[2]).toBeCloseTo(blocked[2]!, 9);
  });
});

describe('probes inside an occluder', () => {
  it('replaces an enclosed probe with the mean of its free axis neighbours', () => {
    const dims: [number, number, number] = [3, 1, 3];
    // The ny = 1 probe row sits at y = 1.6; this crate covers exactly the
    // centre probe and none of its four axis neighbours.
    const crate: Box = { min: [-0.1, 1.5, -0.1], max: [0.1, 1.7, 0.1] };
    const grid = buildProbeGrid(BOX, GREY, LIGHT, { dims, bounces: 1, occluders: [crate] });
    expect(probeInsideOccluder(grid, 1, 0, 1, [crate])).toBe(true);
    expect(probeInsideOccluder(grid, 0, 0, 1, [crate])).toBe(false);

    const nx = dims[0];
    const base = (1 + nx * (0 + dims[1] * 1)) * 12;
    const free = [[0, 0, 1], [2, 0, 1], [1, 0, 0], [1, 0, 2]] as const;
    for (let c = 0; c < 12; c++) {
      let mean = 0;
      for (const [i, j, k] of free) mean += grid.sh[(i + nx * (j + dims[1] * k)) * 12 + c]!;
      mean /= free.length;
      expect(grid.sh[base + c]).toBeCloseTo(mean, 6);
    }
  });

  it('leaves a fully enclosed probe at zero', () => {
    const dims: [number, number, number] = [1, 1, 1];
    const crate: Box = { min: [-3, -1, -3], max: [3, 5, 3] };
    const grid = buildProbeGrid(BOX, GREY, LIGHT, { dims, bounces: 0, occluders: [crate] });
    for (const v of grid.sh) expect(v).toBe(0);
  });
});

describe('buildProbeGridRequest', () => {
  it('matches buildProbeGrid and survives structuredClone', () => {
    const light: ProbeLight = { ...LIGHT, points: [{ pos: [-1, 2.4, -1], color: [1, 0.3, 0.2] }] };
    const options = {
      dims: [3, 2, 3] as [number, number, number],
      raysPerProbe: 32,
      bounces: 1,
      occluders: [{ min: [-1.2, 0, -1.2], max: [-0.7, 1.1, -0.7] } as Box],
      occluderAlbedo: [0.2, 0.18, 0.16] as [number, number, number],
    };
    const req = { box: BOX, walls: GREY, light, options };
    // The REQUEST itself must be postMessage-able: no closures, no classes.
    const clonedReq = structuredClone(req);
    const direct = buildProbeGrid(req.box, req.walls, req.light, req.options);
    const wrapped = buildProbeGridRequest(clonedReq);
    expect(wrapped.dims).toEqual(direct.dims);
    expect(wrapped.min).toEqual(direct.min);
    expect(wrapped.max).toEqual(direct.max);
    expect(Array.from(wrapped.sh)).toEqual(Array.from(direct.sh));
    // And the RESULT buffer survives the worker boundary too.
    const cloned = structuredClone(wrapped);
    expect(Array.from(cloned.sh)).toEqual(Array.from(wrapped.sh));
  });
});

describe('performance pin \u2014 occluders and point lights', () => {
  it('10x4x10, 96 rays, 2 bounces, 2 occluders, 2 point lights under 1500 ms', () => {
    const light: ProbeLight = {
      ...LIGHT,
      points: [
        { pos: [-1.2, 2.6, -1.2], color: [1.0, 0.35, 0.2] },
        { pos: [1.2, 2.6, 1.2], color: [0.2, 0.45, 1.0] },
      ],
    };
    const occluders: Box[] = [
      { min: [-1.6, 0, -1.6], max: [-0.9, 1.1, -0.9] },
      { min: [0.9, 0, 0.9], max: [1.6, 1.1, 1.6] },
    ];
    const t0 = performance.now();
    const grid = buildProbeGrid(BOX, GREY, light, {
      dims: [10, 4, 10],
      raysPerProbe: 96,
      bounces: 2,
      occluders,
    });
    const dt = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`probe-grid perf (10x4x10, 96 rays, 2 bounces, 2 occluders, 2 point lights): ${dt.toFixed(1)} ms`);
    expect(grid.sh.length).toBe(10 * 4 * 10 * 12);
    expect(dt).toBeLessThan(1500);
  });
});
