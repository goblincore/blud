// src/lab/sdf-zombie/draft-fit.test.ts
import { describe, it, expect } from 'vitest';
import type { Vec3 } from './types';
import { add, basisFromAxis, cross, dot, len, normalize, scale as vscale, sub } from './vec';
import { dirVector } from './blob-compile';
import { bandCloud, cloudOffset, inferDir, medialLine, rigLine } from './draft-fit';

// All clouds below are deterministic lattices — no RNG — so a failure is
// reproducible by construction rather than by seed. Surface sampling (fixed
// radius) also gives a straight tube an EXACT expected residual of R, which
// pins medialLine's residual as the RMS of perpendicular distance.

/**
 * Surface points of a straight tube: stations along the axis (endpoints
 * INCLUDED, so the lattice's extremes sit exactly at ±L/2) × evenly spaced
 * angles. Symmetric stations plus a full angle sweep put the centroid exactly
 * on the axis midpoint, so expected t0/t1 are exact, not statistical.
 */
function tubeCloud(axis: Vec3, L: number, R: number, offset: Vec3 = [0, 0, 0]): Vec3[] {
  const nT = 25, nTheta = 12;
  const { u, v, w } = basisFromAxis(axis);
  const pts: Vec3[] = [];
  for (let i = 0; i < nT; i++) {
    const t = -L / 2 + (L * i) / (nT - 1);
    for (let j = 0; j < nTheta; j++) {
      const th = (2 * Math.PI * j) / nTheta;
      const ru = R * Math.cos(th), rv = R * Math.sin(th);
      pts.push([
        offset[0] + t * w[0] + ru * u[0] + rv * v[0],
        offset[1] + t * w[1] + ru * u[1] + rv * v[1],
        offset[2] + t * w[2] + ru * u[2] + rv * v[2],
      ]);
    }
  }
  return pts;
}

/** A banana: a tube bent along a circular arc of radius `Rc`, sweeping ±`Phi`
 *  radians (arc length 2·Rc·Phi), thickness `r`. Bending plane is x-y, arc
 *  centre at the origin. A straight line cannot fit this cloud — the residual
 *  about the best line is dominated by the sagitta Rc·(1-cos Phi). */
function bananaCloud(Rc: number, Phi: number, r: number): Vec3[] {
  const nT = 31, nTheta = 12;
  const pts: Vec3[] = [];
  for (let i = 0; i < nT; i++) {
    const phi = -Phi + (2 * Phi * i) / (nT - 1);
    const cx = Rc * Math.sin(phi), cy = Rc * Math.cos(phi);
    const nx = Math.sin(phi), ny = Math.cos(phi); // in-plane normal at phi
    for (let j = 0; j < nTheta; j++) {
      const th = (2 * Math.PI * j) / nTheta;
      const rad = r * Math.cos(th), ax = r * Math.sin(th);
      pts.push([cx + rad * nx, cy + rad * ny, ax]);
    }
  }
  return pts;
}

/** A dumbbell: tube radius Rfat except within ±waist of the mid-axis, where
 *  it is Rthin — a straight JUMP in r(t), not a ramp, so the inflection the
 *  bands must land on is as sharp as a lattice can make it. */
function dumbbellCloud(axis: Vec3, L: number, Rfat: number, Rthin: number, waist: number): Vec3[] {
  const nT = 41, nTheta = 12;
  const { u, v, w } = basisFromAxis(axis);
  const pts: Vec3[] = [];
  for (let i = 0; i < nT; i++) {
    const t = -L / 2 + (L * i) / (nT - 1);
    const r = Math.abs(t) < waist ? Rthin : Rfat;
    for (let j = 0; j < nTheta; j++) {
      const th = (2 * Math.PI * j) / nTheta;
      const ru = r * Math.cos(th), rv = r * Math.sin(th);
      pts.push([
        t * w[0] + ru * u[0] + rv * v[0],
        t * w[1] + ru * u[1] + rv * v[1],
        t * w[2] + ru * u[2] + rv * v[2],
      ]);
    }
  }
  return pts;
}

/** An elliptical tube: cross-section semi-axes A (on the bone basis's u) and
 *  B (on v), rotated by `rot` about the bone axis. rot=0 is the ALIGNED case
 *  — alignment by construction, since the cloud is built FROM basisFromAxis,
 *  the same basis the fit resolves onto. */
function ellipseCloud(axis: Vec3, L: number, A: number, B: number, rot: number): Vec3[] {
  const nT = 25, nTheta = 12;
  const { u, v, w } = basisFromAxis(axis);
  const cf = Math.cos(rot), sf = Math.sin(rot);
  const pts: Vec3[] = [];
  for (let i = 0; i < nT; i++) {
    const t = -L / 2 + (L * i) / (nT - 1);
    for (let j = 0; j < nTheta; j++) {
      const th = (2 * Math.PI * j) / nTheta;
      const ex = A * Math.cos(th), ey = B * Math.sin(th);
      const ru = ex * cf - ey * sf, rv = ex * sf + ey * cf;
      pts.push([
        t * w[0] + ru * u[0] + rv * v[0],
        t * w[1] + ru * u[1] + rv * v[1],
        t * w[2] + ru * u[2] + rv * v[2],
      ]);
    }
  }
  return pts;
}

/** tubeCloud plus `perStation` spur points per t-station at `spurR` — the
 *  spec's blades-and-spurs surface. Exists because mean and median AGREE on
 *  every clean lattice here; without spurs, `r`'s median choice would be
 *  vacuously unpinned (a mean passes every clean-lattice test). */
function spikyTube(axis: Vec3, L: number, R: number, spurR: number, perStation: number): Vec3[] {
  const pts = tubeCloud(axis, L, R);
  const { u, v, w } = basisFromAxis(axis);
  const nT = 25;
  for (let i = 0; i < nT; i++) {
    const t = -L / 2 + (L * i) / (nT - 1);
    for (let j = 0; j < perStation; j++) {
      // Angles offset from the lattice grid so spurs do not stack onto an
      // existing surface point.
      const th = (2 * Math.PI * (j + 0.5)) / perStation;
      const ru = spurR * Math.cos(th), rv = spurR * Math.sin(th);
      pts.push([
        t * w[0] + ru * u[0] + rv * v[0],
        t * w[1] + ru * u[1] + rv * v[1],
        t * w[2] + ru * u[2] + rv * v[2],
      ]);
    }
  }
  return pts;
}

/** Angle between two LINES — the medial axis is a line, its sign is not
 *  meaningful, so the dot is taken absolute before the arccos. */
function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.min(1, Math.abs(dot(normalize(a), normalize(b)))));
}

describe('medialLine', () => {
  it('recovers the axis of a synthetic cylinder', () => {
    // Direction deliberately off every world axis: an axis solver that only
    // looks right on x/y/z-aligned fixtures must fail here.
    const D = normalize([1, 2, 3]);
    const L = 1.0, R = 0.1;
    const fit = medialLine(tubeCloud(D, L, R));

    expect(angleBetween(fit.dir, D)).toBeLessThan(Math.PI / 180);
    expect(Math.abs(len(fit.dir) - 1)).toBeLessThan(1e-9);
    // Stations include the endpoints, so the extent IS the tube length.
    expect(fit.t0).toBeCloseTo(-L / 2, 3);
    expect(fit.t1).toBeCloseTo(L / 2, 3);
    // Every surface point sits at perpendicular distance R from the true
    // axis, so the RMS residual is R — this pins RMS, not max or mean-of-|d|.
    expect(fit.residual).toBeCloseTo(R, 2);
  });

  it('is NOT the joint-to-joint line when the cloud is offset from it', () => {
    // The trap, as a test. Rig joints sit 9-13 cm off the skin, so the real
    // cloud never straddles the joint line. Build a tube whose whole cloud is
    // displaced 0.10 perpendicular from a "joint" line through the world
    // origin along the same direction: the fit must follow the CLOUD —
    // origin on the cloud's centroid, 0.10 away from the joint line — and
    // still recover the cloud's own axis.
    const D = normalize([2, 1, -1]);
    // cross(D, s) is perpendicular to D by construction; magnitude exactly 0.10.
    const s: Vec3 = [0.31, 0.17, 0.91];
    const perp = normalize([
      D[1] * s[2] - D[2] * s[1],
      D[2] * s[0] - D[0] * s[2],
      D[0] * s[1] - D[1] * s[0],
    ]);
    const offset: Vec3 = vscale(perp, 0.1);

    const L = 1.0, R = 0.08;
    const fit = medialLine(tubeCloud(D, L, R, offset));

    for (let k = 0; k < 3; k++) expect(fit.origin[k]).toBeCloseTo(offset[k]!, 3);
    // Distance from the fitted line's origin to the JOINT line (through the
    // world origin, along D) is the full 0.10 — the fit did not snap back.
    const onJoint = vscale(D, dot(fit.origin, D));
    expect(len(sub(fit.origin, onJoint))).toBeCloseTo(0.1, 3);
    expect(angleBetween(fit.dir, D)).toBeLessThan(Math.PI / 180);
    // Extent is measured along the CLOUD's own axis, unaffected by the offset.
    expect(fit.t1 - fit.t0).toBeCloseTo(L, 3);
  });

  it('reports a large residual for a curved cloud', () => {
    // A banana-shaped cloud: a straight line cannot fit it, and this residual
    // is how the draft tells an author that bone wants a `bend=` it cannot
    // emit. Same thickness as the straight control (so the floor residual R is
    // identical) but bent enough that the sagitta dwarfs it — measured on this
    // lattice the ratio is ~4.8x, comfortably clear of the 3x bar below.
    const r = 0.05;
    const straight = medialLine(tubeCloud(normalize([1, 2, 3]), 2.0, r));
    const banana = medialLine(bananaCloud(1.0, 1.3, r));
    expect(straight.residual).toBeCloseTo(r, 2);
    expect(banana.residual).toBeGreaterThan(3 * straight.residual);
  });
});

describe('bandCloud', () => {
  it('emits ONE band for a uniform cylinder', () => {
    // A flat r(t) profile is ONE band — the draft must not invent structure a
    // straight limb does not have (the mirror defect of one-prim-per-bone:
    // over-fragmentation burns the prim budget for nothing).
    const D = normalize([1, 2, 3]);
    const cloud = tubeCloud(D, 1.0, 0.1);
    const bands = bandCloud(cloud, medialLine(cloud));

    expect(bands.length).toBe(1);
    const b = bands[0]!;
    // Median radius IS the lattice radius, and the band spans the FULL
    // extent — no stations dropped at the ends.
    expect(b.r).toBeCloseTo(0.1, 2);
    expect(b.t0).toBeCloseTo(-0.5, 3);
    expect(b.t1).toBeCloseTo(0.5, 3);
    // Circular: no 2θ content, so both axis ratios come back neutral.
    expect(b.wide).toBeCloseTo(1, 2);
    expect(b.deep).toBeCloseTo(1, 2);
    expect(b.rotated).toBeLessThan(0.01);
    // Every point of the cloud is accounted for by the one band.
    expect(b.samples).toBe(cloud.length);
  });

  it('keeps r at the MEDIAN when the cloud carries spurs', () => {
    // ~14% of points sit at 3.5x the radius — the spec's blades-and-spurs
    // case. They must not move the ring: a mean here reads 0.136, not 0.1.
    // They must not bend the profile either, or the band shatters.
    const D = normalize([0, 1, 1]);
    const cloud = spikyTube(D, 1.0, 0.1, 0.35, 2);
    const bands = bandCloud(cloud, medialLine(cloud));
    expect(bands.length).toBe(1);
    expect(bands[0]!.r).toBeCloseTo(0.1, 2);
  });

  it('splits a dumbbell into bands at the waist', () => {
    // Two fat ends and a thin middle. Band edges must land at the waist:
    // >= 3 bands, the thinnest band IS the waist, the fattest the ends.
    const D = normalize([0, 1, 0]);
    const Rfat = 0.2, Rthin = 0.08;
    const cloud = dumbbellCloud(D, 1.0, Rfat, Rthin, 0.15);
    const bands = bandCloud(cloud, medialLine(cloud));

    expect(bands.length).toBeGreaterThanOrEqual(3);
    // Ordered and non-overlapping — the emitter consumes this array as-is,
    // in this order.
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]!.t0).toBeGreaterThanOrEqual(bands[i - 1]!.t1 - 1e-9);
    }
    const thinnest = Math.min(...bands.map(x => x.r));
    const fattest = Math.max(...bands.map(x => x.r));
    expect(thinnest).toBeCloseTo(Rthin, 2);
    expect(fattest).toBeCloseTo(Rfat, 2);
    // No point lost between bands.
    expect(bands.reduce((s, x) => s + x.samples, 0)).toBe(cloud.length);
  });

  it('resolves wide/deep onto the bone axes for an elliptical cloud', () => {
    // A 2:1 cross-section ALIGNED to the bone's basis axes. Constant profile
    // along t, so the whole cloud is one band.
    const D = normalize([1, 1, 2]);
    const cloud = ellipseCloud(D, 1.0, 0.2, 0.1, 0);
    const bands = bandCloud(cloud, medialLine(cloud));
    expect(bands.length).toBe(1);
    const b = bands[0]!;

    // Fat axis is the one the ellipse was built on; ratios are against d0,
    // so neutral is 1.
    expect(b.wide).toBeGreaterThan(1);
    expect(b.deep).toBeLessThan(1);
    // ~2:1 and not 2.0 exactly: d(θ) of an ellipse is NOT a pure cos-2θ (it
    // carries cos-4θ and higher), so the truncated fit's amplitude comes out
    // ~7% short. Pinned as a range so nobody "fixes" it to A/B later.
    expect(b.wide / b.deep).toBeGreaterThan(1.7);
    expect(b.wide / b.deep).toBeLessThan(2.3);
    // Aligned means the sin-2θ coefficient vanishes: not rotated at all.
    expect(b.rotated).toBeLessThan(0.25);
  });

  it('flags a ROTATED cross-section instead of reporting it as axis-aligned', () => {
    // The spec's pinned decision, as a test. The same 2:1 ellipse turned 45°
    // about the bone axis: .blob scales a prim's OWN axes and carries no
    // cross-section rotation, so the only honest axis-aligned reading is
    // "near-circular" plus a LOUD rotated flag — not confident 2:1 scales
    // pointing the wrong way, and not the ellipse silently rotated into its
    // own principal frame either.
    const D = normalize([1, 1, 2]);
    const cloud = ellipseCloud(D, 1.0, 0.2, 0.1, Math.PI / 4);
    const bands = bandCloud(cloud, medialLine(cloud));
    expect(bands.length).toBe(1);
    const b = bands[0]!;

    expect(b.rotated).toBeGreaterThan(3);
    // Near 1:1 — the axis-aligned approximation of a rotated ellipse IS a
    // circle-ish prim, with the debt owned by `rotated`.
    expect(Math.abs(b.wide - 1)).toBeLessThan(0.05);
    expect(Math.abs(b.deep - 1)).toBeLessThan(0.05);
  });
});

describe('inferDir', () => {
  // (pitch, tilt) pairs lifted from the zombie's real bones — the same ones
  // blob-compile.test.ts uses: a pure pitch, a pure tilt, and both combined.
  // The combined case is the one that bites: tilt is applied AFTER pitch and
  // shrinks |y| by cos(tilt) without touching z, so z/|y| = tan(pitch)/
  // cos(tilt), NOT tan(pitch) — an inversion that ignores the coupling leaves
  // a real residual here and nowhere else (scripts/derive_blob_angles.mjs's
  // "the bit that bites").
  const ANGLES: Array<[number, number]> = [
    [0, 0],
    [6.842773, 0],
    [0, 16.699244],
    [5.703515, 2.862405],
  ];

  it('round-trips an up-based direction through dirVector', () => {
    // For several (pitch, tilt): dirVector('up', p, t) → inferDir → the same
    // p and t back. This is the only honest test of an inversion — checking
    // the angles against hand-derived formulas would just restate the
    // implementation. The error is analytic, so the round-trip is exact to
    // float precision, not approximately right.
    for (const [p, t] of ANGLES) {
      const fit = inferDir(dirVector('up', p, t));
      expect(fit.dir).toBe('up');
      expect(fit.derivable).toBe(true);
      expect(fit.pitchDeg).toBeCloseTo(p, 5);
      expect(fit.tiltDeg).toBeCloseTo(t, 5);
      // What the emitted line reproduces IS what was measured. Tolerance is
      // float noise on a ~1 dot, not a fudge factor.
      expect(fit.errDeg).toBeLessThan(1e-4);
    }
  });

  it('round-trips a down-based direction', () => {
    // The sign-fix'd dirVector tips 'down' toward +z exactly like 'up'
    // (blob-compile's sign(y0) trick), so the SAME pairs must round-trip —
    // an inversion that worked only for 'up' would silently emit a forearm
    // pointing backwards, the exact P8 bug in reverse.
    for (const [p, t] of ANGLES) {
      const fit = inferDir(dirVector('down', p, t));
      expect(fit.dir).toBe('down');
      expect(fit.derivable).toBe(true);
      expect(fit.pitchDeg).toBeCloseTo(p, 5);
      expect(fit.tiltDeg).toBeCloseTo(t, 5);
      expect(fit.errDeg).toBeLessThan(1e-4);
    }
  });

  it('picks side/fwd for a horizontal direction and REFUSES angles', () => {
    // dirVector's pitch is a no-op when the base has no vertical component
    // (side: y0 = 0, so sign(y0) = 0), and its tilt only swings a side bone
    // toward +y — so a measured horizontal direction with any z in it is
    // simply NOT EXPRESSIBLE as base+angles. Emitting nearest numbers anyway
    // would put inert-but-plausible pitch/tilt into a .blob line: confidently
    // wrong is worse than absent, so the fit refuses and lets errDeg say how
    // far off the bare base actually is.
    const side = inferDir(normalize([2, 0, 1]));
    expect(side.dir).toBe('side');
    expect(side.derivable).toBe(false);
    expect(side.pitchDeg).toBeUndefined();
    expect(side.tiltDeg).toBeUndefined();
    // errDeg is ALWAYS owed — on a refusal it is the angle between what was
    // measured and what the bare `dir=side` line reproduces, here exactly
    // atan(1/2) off [1,0,0].
    expect(side.errDeg).toBeCloseTo((Math.atan(1 / 2) * 180) / Math.PI, 5);

    const fwd = inferDir([0, 0, 1]);
    expect(fwd.dir).toBe('fwd');
    expect(fwd.derivable).toBe(false);
    expect(fwd.pitchDeg).toBeUndefined();
    expect(fwd.tiltDeg).toBeUndefined();
  });
});

// rigLine/cloudOffset are the chain-drift amendment: the CHAIN (len=/dir=) is
// a rig quantity — joint-to-joint segments × one global scale — because
// `.blob`'s skeleton is a rigid kinematic chain and overlapping vertex clouds
// do not compose into one. The cloud keeps radii/bands/colour and answers for
// the SURFACE via cloudOffset. Spec:
// docs/superpowers/specs/2026-09-02-blob-draft-chain-drift-design.md.
describe('rigLine', () => {
  it('returns the rig segment scaled by one global scale', () => {
    // head [0,1,0] -> tail [0,0.6,0], scale 2: joint-to-joint 0.4, scaled
    // length 0.8, direction -y.
    const line = rigLine([0, 1, 0], [0, 0.6, 0], 2);

    expect(line.dir[1]).toBeCloseTo(-1, 9);
    expect(line.dir[0]).toBeCloseTo(0, 9);
    expect(line.dir[2]).toBeCloseTo(0, 9);
    expect(line.t1 - line.t0).toBeCloseTo(0.8, 10);
    // Chain placement convention — what the emitter's headPoint/tailPoint
    // already consume: the line grows FROM the scaled head (t0 = 0 there) to
    // the scaled tail. A child bone's head is exactly this tail, which is
    // what makes len= place descendants instead of describing one bone.
    const headPt = add(line.origin, vscale(line.dir, line.t0));
    const tailPt = add(line.origin, vscale(line.dir, line.t1));
    expect(headPt[0]).toBeCloseTo(0, 10);
    expect(headPt[1]).toBeCloseTo(2, 10);
    expect(headPt[2]).toBeCloseTo(0, 10);
    expect(tailPt[0]).toBeCloseTo(0, 10);
    expect(tailPt[1]).toBeCloseTo(1.2, 10);
    expect(tailPt[2]).toBeCloseTo(0, 10);
  });

  it('composes: a chain of rigLines sums to the scaled chain length', () => {
    // THE PROPERTY THE CLOUD VERSION LACKS. Three bones head-to-tail in the
    // rig — collinear here, so "sum of lengths" and "first head to last tail"
    // name the same number (for a BENT chain the sum is the path length and
    // strictly exceeds the endpoint distance; the plan's sentence is a
    // collinear-only identity). Also asserted per bone: each line's tail
    // lands exactly on its child's head — placement, not just arithmetic, is
    // what stops the drift.
    const joints: Vec3[] = [[0, 1.7, 0], [0, 1.1, 0], [0, 0.55, 0], [0, 0.1, 0]];
    const scale = 1.7;
    const lines = [];
    for (let i = 0; i < 3; i++) lines.push(rigLine(joints[i]!, joints[i + 1]!, scale));

    const sum = lines.reduce((s, l) => s + (l.t1 - l.t0), 0);
    const endToEnd = len(sub(joints[3]!, joints[0]!)) * scale;
    expect(sum).toBeCloseTo(endToEnd, 10);

    for (let i = 0; i < 2; i++) {
      const tail = add(lines[i]!.origin, vscale(lines[i]!.dir, lines[i]!.t1));
      const nextHead = add(lines[i + 1]!.origin, vscale(lines[i + 1]!.dir, lines[i + 1]!.t0));
      for (let k = 0; k < 3; k++) {
        expect(tail[k]).toBeCloseTo(joints[i + 1]![k]! * scale, 10);
        expect(nextHead[k]).toBeCloseTo(tail[k]!, 10);
      }
    }
  });

  it('is unaffected by where the SURFACE sits', () => {
    // Same rig segment, two very different clouds around it: one centred on
    // the rig axis, one displaced 0.12 laterally (the 9-13 cm trap, made
    // explicit). The returned line is IDENTICAL — exact equality, because the
    // function must not read the cloud for dir/origin/extent at all. Only the
    // residual may differ, and it MUST: it is the check that says the offset
    // cloud's surface sits off its bone.
    const D = normalize([1, 2, 3]);
    const head: Vec3 = [0.3, 1.1, -0.2];
    const tail = add(head, vscale(D, 0.4));
    const mid = vscale(add(head, tail), 0.5);
    const s: Vec3 = [0.31, 0.17, 0.91];
    const perp = normalize([
      D[1] * s[2] - D[2] * s[1],
      D[2] * s[0] - D[0] * s[2],
      D[0] * s[1] - D[1] * s[0],
    ]);
    // Clouds go in SCALED — rigLine's one-frame contract: points live in the
    // same frame as the returned line (the global scale applied), otherwise
    // the residual measures against a parallel-but-shifted axis.
    const centred = tubeCloud(D, 0.4, 0.06, mid).map(p => vscale(p, 1.7));
    const shoved = tubeCloud(D, 0.4, 0.06, add(mid, vscale(perp, 0.12))).map(p => vscale(p, 1.7));

    const a = rigLine(head, tail, 1.7, centred);
    const b = rigLine(head, tail, 1.7, shoved);

    expect(b.dir).toEqual(a.dir);
    expect(b.origin).toEqual(a.origin);
    expect(b.t0).toBe(a.t0);
    expect(b.t1).toBe(a.t1);
    // residual is the cloud's RMS spread about the RIG axis: exactly the
    // (scaled) radius for a tube centred on it, louder once the cloud is
    // shoved off.
    expect(a.residual).toBeCloseTo(0.06 * 1.7, 2);
    expect(b.residual).toBeGreaterThan(a.residual);
  });
});

describe('cloudOffset', () => {
  // Both tests run against the RIG line (origin at the scaled head, extent
  // t0=0..t1=len) — the way Task 2's CLI will call it — not against some
  // centroid-origin line that would make the along-axis discard vacuous.
  it('is zero for a cloud centred on its rig segment', () => {
    // Tube axis == rig axis. The centroid sits at the segment MIDPOINT, so
    // the raw centroid-to-origin vector carries half a segment of ALONG-axis
    // displacement; only the perpendicular component may come back, and it
    // is exactly zero here (symmetric lattice, float noise only). Cloud
    // scaled: one frame with the line, per rigLine's contract.
    const D = normalize([1, 2, 3]);
    const head: Vec3 = [0.3, 1.1, -0.2];
    const tail = add(head, vscale(D, 0.5));
    const mid = vscale(add(head, tail), 0.5);
    const cloud = tubeCloud(D, 0.5, 0.07, mid).map(p => vscale(p, 1.7));

    const off = cloudOffset(cloud, rigLine(head, tail, 1.7, cloud));
    for (let k = 0; k < 3; k++) expect(off[k]).toBeCloseTo(0, 9);
  });

  it('measures the lateral displacement of an offset cloud', () => {
    // Cloud centroid 0.12 off the rig axis: offset ~= that 0.12 (scaled by
    // the global scale — the cloud goes in scaled), along the direction it
    // was displaced in. The ALONG-axis component is discarded (that is
    // `at=`'s job, not `offset=`'s) — dot with the bone axis stays 0 even
    // though the centroid is also half a segment along it.
    const D = normalize([2, 1, -1]);
    const head: Vec3 = [-0.1, 0.9, 0.4];
    const tail = add(head, vscale(D, 0.45));
    const mid = vscale(add(head, tail), 0.5);
    const s: Vec3 = [0.23, 0.71, 0.13];
    const perp = normalize([
      D[1] * s[2] - D[2] * s[1],
      D[2] * s[0] - D[0] * s[2],
      D[0] * s[1] - D[1] * s[0],
    ]);
    const scale = 1.7;
    const cloud = tubeCloud(D, 0.45, 0.06, add(mid, vscale(perp, 0.12))).map(p => vscale(p, scale));

    const line = rigLine(head, tail, scale, cloud);
    const off = cloudOffset(cloud, line);
    for (let k = 0; k < 3; k++) expect(off[k]).toBeCloseTo(perp[k]! * 0.12 * scale, 9);
    expect(dot(off, line.dir)).toBeCloseTo(0, 9);
  });
});
