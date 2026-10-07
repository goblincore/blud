import { describe, it, expect } from 'vitest';
import {
  carryNormal, det3, fitSkull, measureFlesh, outermost, skullAffineFit, skullWarpAt, skullWarpJacobian, skullWarpPasses,
  SKULL_FITS, type FleshField, type Mat3, type SkullFitParams, type SkullWarpPass, type V3,
} from './skull-fit';

/** A head of flesh for the tests: an ellipsoid of the given half axes about `c`, by the scaled-distance field the
 *  game's prims use (it reads short of distance off the short axis, as a squashed prim's field does). */
const ellipsoid = (c: V3, r: V3): FleshField => p => {
  const k = Math.hypot((p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]);
  return (k - 1) * Math.min(r[0], r[1], r[2]);
};

/** A stand-in skull: points on a box-like superquadric shell and a second shell 5 mm inside it (a plate's inner
 *  surface), half sizes 0.07, 0.10, 0.085. Wider up high than a head that narrows to its crown. */
function shell(): { positions: number[]; normals: number[] } {
  const positions: number[] = [], normals: number[] = [];
  for (const inset of [0, 0.005]) for (let a = 0; a <= 16; a++) for (let b = 0; b < 32; b++) {
    const th = a / 16 * Math.PI, ph = b / 32 * 2 * Math.PI;
    const d: V3 = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    const k = Math.pow(Math.abs(d[0]) ** 4 + Math.abs(d[1]) ** 4 + Math.abs(d[2]) ** 4, -0.25);
    positions.push(d[0] * k * (0.07 - inset), d[1] * k * (0.10 - inset), d[2] * k * (0.085 - inset));
    normals.push(d[0], d[1], d[2]);
  }
  return { positions, normals };
}

const passOf = (radius: number, anchors: number[][]): SkullWarpPass => {
  const a = new Float64Array(anchors.flat());
  return { radius, anchors: a };
};

describe('the warp field (skullWarpAt)', () => {
  // Two passes of a handful of anchors with unequal moves and weights.
  const passes = [
    passOf(0.04, [[0, 0.1, 0, 0, -0.01, 0.002, 0.6], [0.01, 0.1, 0.005, 0.001, -0.008, 0, 0.5], [0.03, 0.09, -0.01, -0.004, -0.004, 0, 1]]),
    passOf(0.03, [[0, 0.085, 0.01, 0.002, -0.003, -0.001, 1], [0.02, 0.08, 0, 0, -0.002, 0.004, 0.8]]),
  ];
  it('moves nothing further than its radius from every anchor, and an anchor alone by most of its move', () => {
    expect(skullWarpAt(passes, [0.2, 0.1, 0])).toEqual([0.2, 0.1, 0]);
    const lone = [passOf(0.04, [[0, 0, 0, 0, -0.01, 0, 1]])];
    const moved = skullWarpAt(lone, [0, 0, 0]);
    // S = 1 at a lone anchor of weight 1: the move over (1 + 1)^(1/4).
    expect(moved[1]).toBeCloseTo(-0.01 / Math.pow(2, 0.25), 12);
    expect(skullWarpAt(lone, [0.04, 0, 0])[1]).toBe(0);
  });
  it('is a function of the place: two vertices at one place go to one place', () => {
    const p: V3 = [0.012, 0.094, 0.003];
    expect(skullWarpAt(passes, [p[0], p[1], p[2]])).toEqual(skullWarpAt(passes, p));
  });
  it('has the Jacobian skullWarpJacobian gives (central differences of the field itself)', () => {
    const h = 1e-6;
    for (const p of [[0.004, 0.095, 0.002], [0.02, 0.085, -0.004], [0.012, 0.11, 0.01], [-0.01, 0.08, 0.02]] as V3[]) {
      const j = skullWarpJacobian(passes, p);
      for (let col = 0; col < 3; col++) {
        const up: V3 = [p[0], p[1], p[2]], down: V3 = [p[0], p[1], p[2]];
        up[col] += h; down[col] -= h;
        const a = skullWarpAt(passes, up), b = skullWarpAt(passes, down);
        for (let row = 0; row < 3; row++) expect(j[row * 3 + col], `d${row}/d${col} at ${p}`).toBeCloseTo((a[row]! - b[row]!) / (2 * h), 6);
      }
    }
  });
  it('carries a normal by the inverse transpose', () => {
    // A shear and a stretch: a plane's normal must stay square to the plane's carried tangents.
    const m: Mat3 = [1.2, 0.3, 0, 0, 0.8, 0.1, 0.2, 0, 1.1];
    const t1: V3 = [1, 0, 0], t2: V3 = [0, 0, 1], n: V3 = [0, 1, 0];
    const carry = (v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
    const out = carryNormal(m, n), a = carry(t1), b = carry(t2);
    expect(out[0] * a[0] + out[1] * a[1] + out[2] * a[2]).toBeCloseTo(0, 12);
    expect(out[0] * b[0] + out[1] * b[1] + out[2] * b[2]).toBeCloseTo(0, 12);
    expect(Math.hypot(...out)).toBeCloseTo(1, 12);
    expect(out[1]).toBeGreaterThan(0);
    expect(det3(m)).toBeCloseTo(1.2 * 0.8 * 1.1 + 0.3 * 0.1 * 0.2, 12);
  });
});

describe('measuring the flesh and choosing who to ask', () => {
  it('finds the deepest point on the middle plane and the reach along each axis', () => {
    const head = measureFlesh(ellipsoid([0, 0.1, 0.01], [0.09, 0.14, 0.105]), 0, [0, 0.06, -0.03]);
    expect(head.centre[1]).toBeCloseTo(0.1, 2);
    expect(head.centre[2]).toBeCloseTo(0.01, 2);
    expect(head.half).toBeCloseTo(0.09, 3);
    expect(head.up + head.down).toBeCloseTo(0.28, 3);
    expect(head.front + head.back).toBeCloseTo(0.21, 3);
    // The floor stops the measure downward.
    expect(measureFlesh(ellipsoid([0, 0.1, 0.01], [0.09, 0.14, 0.105]), 0, [0, 0.1, 0], 0.05).down).toBeLessThan(0.06);
  });
  it('outermost keeps the furthest point of each direction and drops what stands behind one', () => {
    const { positions } = shell();
    const kept = new Set(outermost(positions, [0, 0, 0]));
    const outerCount = positions.length / 6;
    // Nothing of the inner shell: every point of it has an outer point further out in its direction.
    for (const i of kept) expect(i).toBeLessThan(outerCount);
    expect(kept.size).toBeGreaterThan(100);
  });
});

describe('stage 1 (skullAffineFit) and stage 2 (skullWarpPasses) on a head that narrows to its crown', () => {
  // An egg: wide at mid height, the skull's own width is high up. The asset's box is centred on the origin.
  const egg: FleshField = p => {
    const narrow = 1 - 0.35 * Math.max(0, Math.min(1, (p[1] - 0.05) / 0.2));
    return ellipsoid([0, 0.08, 0], [0.09 * narrow, 0.15, 0.105 * narrow])(p);
  };
  const { positions, normals } = shell();
  const plate = { positions, normals, face: false };
  const envelope = { min: [-0.1, -0.08, -0.1], max: [0.1, 0.24, 0.1] };
  const all: [keyof typeof SKULL_FITS, SkullFitParams][] = [['affine', SKULL_FITS.affine], ['mid', SKULL_FITS.mid], ['snug', SKULL_FITS.snug], ['tight', SKULL_FITS.tight]];

  it.each(all)('%s: every vertex keeps its margin, the axis scales keep their limit, nothing is turned inside out', (_name, params) => {
    const fit = fitSkull([plate], egg, envelope, [0, 0.08, 0], params, params.eyes ? { x: 0, y: 0.01, at: 0.1 } : undefined);
    const out = fit.positions[0]!;
    let worst = -Infinity;
    for (let i = 0; i < out.length; i += 3) worst = Math.max(worst, egg([out[i]!, out[i + 1]!, out[i + 2]!]) + params.margin);
    // Float32 storage of the fitted vertices: a micron of slack.
    expect(worst).toBeLessThanOrEqual(1e-6);
    const s = fit.affine.scale;
    expect(Math.max(...s) / Math.min(...s)).toBeLessThanOrEqual(params.limit + 1e-9);
    expect(fit.shrunk).toBe(1);
    expect(fit.warp.detMin).toBeGreaterThan(0.2);
    if (params.pull === 0) { expect(fit.passes).toHaveLength(0); expect(fit.warp.maxMove).toBe(0); }
    else {
      expect(fit.passes.length).toBeGreaterThan(0);
      expect(fit.warp.maxMove).toBeGreaterThan(0.002);
      // The pull budget bounds what stage 1 leaves for stage 2; a vertex may be carried a little past its own lack.
      expect(fit.warp.maxMove).toBeLessThan(2.5 * fit.affine.budget[0]);
    }
    // Held by the eyes: the held point's height is where it was asked for, whatever the size.
    if (params.eyes) expect(0.01 * s[1] + fit.affine.offset[1]).toBeCloseTo(0.1, 12);
    for (let i = 0; i < fit.normals[0]!.length; i += 3) expect(Math.hypot(fit.normals[0]![i]!, fit.normals[0]![i + 1]!, fit.normals[0]![i + 2]!)).toBeCloseTo(1, 5);
  });
  it('the warped fits are larger than the affine one, in order of their margins', () => {
    const volume = (params: SkullFitParams) => { const s = fitSkull([plate], egg, envelope, [0, 0.08, 0], { ...params, eyes: false }).affine.scale; return s[0] * s[1] * s[2]; };
    expect(volume({ ...SKULL_FITS.snug, margin: 0.006 })).toBeGreaterThan(volume(SKULL_FITS.affine) * 1.05);
    expect(volume(SKULL_FITS.tight)).toBeGreaterThan(volume(SKULL_FITS.mid));
  });
  it('stage 1 with no pull holds the margin by itself, and its face budget is its vault budget scaled', () => {
    const fit = skullAffineFit(positions, new Array(positions.length / 3).fill(0), { min: [-0.07, -0.1, -0.085], max: [0.07, 0.1, 0.085] }, egg, envelope, [0, 0.08, 0], SKULL_FITS.affine);
    expect(fit.budget).toEqual([0, 0]);
    let worst = -Infinity;
    for (let i = 0; i < positions.length; i += 3)
      worst = Math.max(worst, egg([positions[i]! * fit.scale[0] + fit.offset[0], positions[i + 1]! * fit.scale[1] + fit.offset[1], positions[i + 2]! * fit.scale[2] + fit.offset[2]]));
    expect(worst).toBeLessThanOrEqual(-SKULL_FITS.affine.margin + 1e-9);
    const warped = skullAffineFit(positions, new Array(positions.length / 3).fill(0), { min: [-0.07, -0.1, -0.085], max: [0.07, 0.1, 0.085] }, egg, envelope, [0, 0.08, 0], SKULL_FITS.snug);
    expect(warped.budget[1] / warped.budget[0]).toBeCloseTo(SKULL_FITS.snug.facePull / SKULL_FITS.snug.pull, 12);
  });
  it('stage 2 leaves alone what has its margin, and moves a plate\'s inner surface with its outer one', () => {
    const sized = positions.map((v, i) => v * 1.12 + (i % 3 === 1 ? 0.085 : 0));
    const { passes, settled } = skullWarpPasses(sized, egg, 0.006, 0.045, [0, 0.085, 0]);
    expect(settled).toBe(true);
    const outer = positions.length / 6;
    let still = 0, thin = Infinity, thick = -Infinity;
    for (let i = 0; i < outer; i++) {
      const a: V3 = [sized[i * 3]!, sized[i * 3 + 1]!, sized[i * 3 + 2]!], b: V3 = [sized[(i + outer) * 3]!, sized[(i + outer) * 3 + 1]!, sized[(i + outer) * 3 + 2]!];
      const wa = skullWarpAt(passes, a), wb = skullWarpAt(passes, b);
      if (wa[0] === a[0] && wa[1] === a[1] && wa[2] === a[2]) { still++; expect(egg(a)).toBeLessThanOrEqual(-0.006); }
      const before = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), after = Math.hypot(wa[0] - wb[0], wa[1] - wb[1], wa[2] - wb[2]);
      thin = Math.min(thin, after / before); thick = Math.max(thick, after / before);
    }
    // The lower half of the egg has room: a good part of the shell is not touched at all.
    expect(still).toBeGreaterThan(outer * 0.2);
    // The shell's two surfaces stay about 5 mm apart where it is pulled in.
    expect(thin).toBeGreaterThan(0.8);
    expect(thick).toBeLessThan(1.2);
  });
  it('a skull that cannot be warped under the flesh in its passes is shrunk under it, and says so', () => {
    // No stage 1 worth the name: a share far over the flesh, and budgets that let all of it through.
    const wild: SkullFitParams = { share: 1.6, margin: 0.006, limit: 1.15, pull: 5, facePull: 5, radius: 0.05, eyes: false };
    const fit = fitSkull([plate], ellipsoid([0, 0.08, 0], [0.06, 0.08, 0.06]), envelope, [0, 0.08, 0], wild);
    expect(fit.shrunk).toBeLessThan(1);
    const out = fit.positions[0]!;
    for (let i = 0; i < out.length; i += 3) expect(ellipsoid([0, 0.08, 0], [0.06, 0.08, 0.06])([out[i]!, out[i + 1]!, out[i + 2]!]) + 0.006).toBeLessThanOrEqual(1e-6);
  });
});
