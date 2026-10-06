// src/lab/sdf-zombie/head-split-bounds.test.ts
//
// THE BOUNDS OF AN OPEN HEAD (head-split.ts), on the real posed zombie. Every bound that tests a world ray or a screen
// position against the body describes the CLOSED head's prims, and under a split each goes through one gate
// (splitHolds: which turning halves a sphere holds flesh of) and one of three rules: the cluster spheres of the depth
// pre-pass's miss cull and the screen tiles' group spheres grow to hold the hold ball (splitBound), the outer hull
// adds a turned copy of each of its spheres (splitSphereImages), the proxy box adds the hold ball (splitHoldBall),
// and the inner hull drops what the gate names. Here: the rules' geometry, that the bounds they make hold the open head
// for both presets and both hinges over the whole angle range, and the two accept-reach laws that keep the region
// shell from being drawn (splitDrawDistance at range, splitNearReach up close).
import { describe, expect, it } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from './build-body';
import { makeZombie } from './body';
import { applyRig, bindRig, headQuatOf } from './rig-bind';
import { sdBody, sdBodyClosed } from './validate';
import { packBody } from './pack';
import {
  REGION_MARGIN, SHELL_ACCEPT_FRAC, forcedSplit, headFrameOf, splitBound, splitDrawDistance, splitFrame, splitHoldBall,
  splitHolds, splitMaxAngle, splitNearReach, splitSphereImages, splitWarpOf, warpPoint,
  type HeadFrame, type SplitPresetId, type SplitWarp, HEAD_SPLIT,
} from './head-split';
import { MARCH_BODY } from './webgpu/march.wgsl';
import { cross, dot, len, normalize, qFromAxisAngle, qRotate, sub } from './vec';
import type { Vec3 } from './types';
import { headShape } from './webgpu/flame-anchors';
import { SPLIT_HULL_LIP, blendReach, buildOuterHullInstances, ellipsoidChain } from './webgpu/shell-hull-outer';
import { SPLIT_BOUND, splitAblate } from './webgpu/split-ablate';
import { HULL_SHRINK, SHADOW_HULL_INFLATE, buildHullInstances } from './webgpu/occluder-hull';
import { FISHEYE_DEFAULTS } from './webgpu/fisheye';
import { GAME_AA, GAME_AA_FADE_M, GAME_AA_NEAR, GAME_LAST_STEP_DEFAULT } from './webgpu/game-march-accept';

const BODY = buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {});
const BOUND = bindRig(BODY);
const POSED: BuildResult = applyRig(BODY, BOUND, 0);
const FRAME = headFrameOf(headShape(POSED)!, headQuatOf(BOUND, 0) ?? [0, 0, 0, 1]);
const PACKED = packBody(POSED);

/** Both presets, both hinges (`middle` both halves / one side either way, `face`), at shares of the full angle. */
const SHAPES: [name: string, preset: SplitPresetId, sides: -1 | 0 | 1, offset: number][] = [
  ['middle, both halves', 'middle', 0, 0],
  ['middle, + side', 'middle', 1, 0.036],
  ['middle, - side', 'middle', -1, -0.036],
  ['face', 'face', 1, 0],
  ['face, far forward', 'face', 1, 0.045],
];
const FRACS = [0.02, 0.25, 0.5, 0.75, 1];
/** The two halves at different angles, as the wobble leaves them (head-split.ts HEAD_SPLIT.wobble): one thrown to the
 *  over-open margin with the other swung back, either way round, and one all but shut. Shares of the full angle. */
const UNEQUAL: [plus: number, minus: number][] = [[1.45, 0.55], [0.55, 1.45], [0.06, 1.1]];
const warps = (frame: HeadFrame = FRAME): [name: string, w: SplitWarp][] => [
  ...SHAPES.flatMap(([name, preset, sides, offset]) =>
    FRACS.map((frac): [string, SplitWarp] => [`${name} @ ${frac}`, splitWarpOf(forcedSplit(preset, sides, offset, frac)!, frame)!])),
  ...UNEQUAL.map(([plus, minus]): [string, SplitWarp] => {
    const w = splitWarpOf(forcedSplit('middle', 0, 0, 1)!, frame)!;
    return [`middle, both halves, unequal ${plus} / ${minus}`, { ...w, thetaP: plus * w.full, thetaM: -minus * w.full }];
  }),
];
/** The same head turned off every world axis: the pure-geometry rules must not lean on an upright frame. */
const TILTED: HeadFrame = { ...FRAME, quat: qFromAxisAngle(normalize([0.3, 0.5, 0.8]), 0.7) };
/** The rules take a split made ready once (splitFrame); these wrap a bare warp. */
const bound = (w: SplitWarp | null, c: Vec3, r: number, reach = 0) => splitBound(splitFrame(w), c, r, reach);
const images = (w: SplitWarp | null, c: Vec3, r: number) => splitSphereImages(splitFrame(w), c, r);
const holds = (w: SplitWarp, c: Vec3, r: number) => splitHolds(splitFrame(w)!, c, r);
const along = (c: Vec3, d: Vec3, k: number): Vec3 => [c[0] + d[0] * k, c[1] + d[1] * k, c[2] + d[2] * k];

/** Seeded uniform [0, 1). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
function inBall(rnd: () => number, c: Vec3, radius: number): Vec3 {
  const rr = radius * Math.cbrt(rnd()), ct = 2 * rnd() - 1, st = Math.sqrt(1 - ct * ct), ph = 2 * Math.PI * rnd();
  return [c[0] + rr * st * Math.cos(ph), c[1] + rr * ct, c[2] + rr * st * Math.sin(ph)];
}
const inside = (s: { centre: Vec3; radius: number }, p: Vec3, slack = 1e-9) => len(sub(p, s.centre)) <= s.radius + slack;

/** The body's cluster and group spheres as the march reads them (pack.ts), with the reach the march adds to each in
 *  its own cull: 4 x the blend width x the sphere's distortion factor. */
const K4 = 4 * PACKED.maxBlendK;
const clusterSpheres = POSED.clusters.map((c, i) => ({
  limb: c.limb, centre: c.center, radius: c.radius, reach: K4 * Math.max(PACKED.clusterGroups[i * 4 + 2]!, 1),
}));
const groupSpheres = Array.from({ length: PACKED.groupCount }, (_, g) => ({
  centre: [PACKED.groupBounds[g * 4]!, PACKED.groupBounds[g * 4 + 1]!, PACKED.groupBounds[g * 4 + 2]!] as Vec3,
  radius: PACKED.groupBounds[g * 4 + 3]!, reach: K4 * Math.max(PACKED.groupRange[g * 4 + 2]!, 1),
}));

describe('splitHolds: which turning halves a sphere of the closed body holds flesh of', () => {
  const both = splitWarpOf(forcedSplit('middle', 0, 0, 1)!, FRAME)!, ball = splitHoldBall(both), u = cross(both.n, both.a);
  const one = splitWarpOf(forcedSplit('middle', 1, 0.036, 1)!, FRAME)!;

  it('the hold ball is the hinge and rho = r - REGION_MARGIN; the frame carries u = n x a and rho', () => {
    expect(ball.centre).toBe(both.h);
    expect(ball.radius).toBeCloseTo(both.r - REGION_MARGIN, 12);
    const f = splitFrame(both)!;
    expect(f.w).toBe(both);
    expect(len(sub(f.u, u))).toBe(0);
    expect(f.rho).toBe(ball.radius);
    expect(splitFrame(null)).toBeNull();
    expect(splitFrame(undefined)).toBeNull();
  });
  it('none below the hinge plane or clear of the hold ball, to the radius', () => {
    const below = along(both.h, u, -0.1);
    expect(holds(both, below, 0.099)).toBe(0);
    expect(holds(both, below, 0.101)).toBe(3);
    const clear = along(both.h, u, ball.radius + 0.1);
    expect(holds(both, clear, 0.099)).toBe(0);
    expect(holds(both, clear, 0.101)).toBe(3);
  });
  it('bit 1 the + half, bit 2 the - half, by the side of the old plane the sphere reaches', () => {
    expect(holds(both, FRAME.centre, 0.1)).toBe(3);
    expect(holds(both, along(FRAME.centre, both.n, 0.08), 0.05)).toBe(1);
    expect(holds(both, along(FRAME.centre, both.n, -0.08), 0.05)).toBe(2);
  });
  it('a half that does not turn holds nothing that moves: the larger side of a one-sided split', () => {
    expect(one.thetaM).toBe(0);
    expect(holds(one, FRAME.centre, 0.1)).toBe(1);
    expect(holds(one, along(FRAME.centre, one.n, -0.08), 0.03)).toBe(0);
  });
});

describe('splitSphereImages: where the flesh a closed sphere holds is on the open head', () => {
  it('none for a closed head, a sphere below the hinge plane, or one clear of the hold ball', () => {
    const w = splitWarpOf(forcedSplit('middle', 0, 0, 1)!, FRAME)!, ball = splitHoldBall(w), u = cross(w.n, w.a);
    expect(images(null, FRAME.centre, 0.1)).toEqual([]);
    expect(images(w, along(w.h, u, -0.2), 0.19)).toEqual([]);
    expect(images(w, along(w.h, u, ball.radius + 0.2), 0.19)).toEqual([]);
  });
  it('one copy per half the sphere reaches that turns: both, the + side only, the - side only', () => {
    const both = splitWarpOf(forcedSplit('middle', 0, 0, 1)!, FRAME)!;
    expect(images(both, FRAME.centre, 0.1)).toHaveLength(2);
    // Wholly on the + side of the plane: only the + half's copy.
    const plus = along(FRAME.centre, both.n, 0.08);
    const im = images(both, plus, 0.05);
    expect(im).toHaveLength(1);
    expect(len(sub(im[0]!, warpPoint(both, plus).p))).toBeLessThan(1e-12);
    // A one-sided split turns one half: a sphere on the other side has no copy.
    const one = splitWarpOf(forcedSplit('middle', 1, 0.036, 1)!, FRAME)!;
    expect(images(one, FRAME.centre, 0.1)).toHaveLength(1);
    expect(images(one, along(FRAME.centre, one.n, -0.08), 0.05)).toEqual([]);
  });
  it('every point of the sphere is, after the warp, in the sphere or in one of its copies (upright and tilted heads)', () => {
    const rnd = rng(21);
    let moved = 0;
    for (const [name, w] of [...warps(), ...warps(TILTED)]) {
      for (let k = 0; k < 40; k++) {
        const c = inBall(rnd, w.h, w.r), radius = 0.02 + 0.15 * rnd();
        const spheres = [c, ...images(w, c, radius)].map(centre => ({ centre, radius }));
        for (let i = 0; i < 40; i++) {
          const m = warpPoint(w, inBall(rnd, c, radius));
          if (m.piece !== 0) moved++;
          expect(spheres.some(s => inside(s, m.p)), `${name}: ${m.p}`).toBe(true);
        }
      }
    }
    expect(moved).toBeGreaterThan(10000);
  });
});

describe('splitBound: a bound sphere of the closed body, for the split body', () => {
  const w = splitWarpOf(forcedSplit('middle', 0, 0, 1)!, FRAME)!;
  const ball = splitHoldBall(w), u = cross(w.n, w.a);

  it('no split: the sphere itself', () => {
    const c: Vec3 = [1, 2, 3];
    expect(bound(null, c, 0.2)).toEqual({ centre: c, radius: 0.2 });
    expect(bound(null, c, 0.2).centre).toBe(c);
  });
  it('a sphere that holds no turning flesh stays; within `reach` of some, it grows', () => {
    const gap = 0.05, clear = along(w.h, u, ball.radius + 0.1 + gap);
    expect(bound(w, clear, 0.1)).toEqual({ centre: clear, radius: 0.1 });
    expect(bound(w, clear, 0.1, gap - 1e-6)).toEqual({ centre: clear, radius: 0.1 });
    expect(bound(w, clear, 0.1, gap + 1e-6).radius).toBeCloseTo((2 * ball.radius + 0.2 + gap) / 2, 9);
    const below = along(w.h, u, -0.1);
    expect(bound(w, below, 0.09)).toEqual({ centre: below, radius: 0.09 });
    expect(bound(w, below, 0.09, 0.009)).toEqual({ centre: below, radius: 0.09 });
    expect(bound(w, below, 0.09, 0.011)).toEqual(ball);
    // The larger side of a one-sided split does not turn: a sphere wholly on it stays, deep in the hold ball as it is.
    const one = splitWarpOf(forcedSplit('middle', 1, 0.036, 1)!, FRAME)!, still = along(FRAME.centre, one.n, -0.08);
    expect(len(sub(still, one.h))).toBeLessThan(splitHoldBall(one).radius);
    expect(bound(one, still, 0.03)).toEqual({ centre: still, radius: 0.03 });
  });
  it('a sphere inside the ball becomes the ball; one that holds the ball stays', () => {
    expect(bound(w, [w.h[0] + 0.05, w.h[1] + 0.02, w.h[2]], 0.04)).toEqual(ball);
    const big: Vec3 = [w.h[0], w.h[1] - 0.1, w.h[2] + 0.05];
    expect(bound(w, big, ball.radius + 0.2)).toEqual({ centre: big, radius: ball.radius + 0.2 });
  });
  it('a sphere that holds turning flesh grows to the smallest sphere holding itself and the ball (upright and tilted heads)', () => {
    const rnd = rng(11);
    let grew = 0, stayed = 0;
    for (const [name, sw] of [...warps(), ...warps(TILTED)]) {
      const sb = splitHoldBall(sw);
      for (let i = 0; i < 60; i++) {
        const c = inBall(rnd, sw.h, sb.radius + 0.3), radius = 0.02 + 0.3 * rnd();
        const b = bound(sw, c, radius), d = len(sub(c, sw.h));
        if (holds(sw, c, radius) === 0) { expect(b, name).toEqual({ centre: c, radius }); stayed++; continue; }
        grew++;
        // Holds the sphere and the ball (their farthest points from the new centre).
        expect(len(sub(c, b.centre)) + radius, name).toBeLessThanOrEqual(b.radius + 1e-9);
        expect(len(sub(sw.h, b.centre)) + sb.radius, name).toBeLessThanOrEqual(b.radius + 1e-9);
        // And is no larger than that takes: the larger of the two, or half the span across both.
        expect(b.radius, name).toBeCloseTo(Math.max(radius, sb.radius, (d + radius + sb.radius) / 2), 9);
      }
    }
    expect(grew).toBeGreaterThan(1000);
    expect(stayed).toBeGreaterThan(300);
  });
});

describe('the inflated bounds hold the open head (both presets, both hinges, angle 0 to max)', () => {
  it('the shapes cover both halves, each side alone and the face preset, to their full angles', () => {
    const all = warps().map(([, w]) => w);
    expect(all.some(w => w.thetaP > 0 && w.thetaM < 0)).toBe(true);
    expect(all.some(w => w.thetaP > 0 && w.thetaM === 0)).toBe(true);
    expect(all.some(w => w.thetaP === 0 && w.thetaM < 0)).toBe(true);
    for (const [, preset, sides] of SHAPES) {
      const max = splitMaxAngle({ preset, sides });
      expect(all.some(w => Math.abs(Math.max(w.thetaP, -w.thetaM) - max) < 1e-12)).toBe(true);
    }
  });

  it('every head prim\'s moved extent is inside the head cluster\'s grown sphere and each of the head groups\' grown spheres', () => {
    const headI = clusterSpheres.findIndex(c => c.limb === 'head'), headC = clusterSpheres[headI]!;
    const first = PACKED.clusterGroups[headI * 4]!, count = PACKED.clusterGroups[headI * 4 + 1]!;
    const headGroups = groupSpheres.slice(first, first + count);
    // Head material of the closed body: points in the head cluster's sphere the closed field calls solid.
    const rnd = rng(3);
    const flesh: Vec3[] = [];
    while (flesh.length < 3000) {
      const q = inBall(rnd, headC.centre, headC.radius);
      if (sdBodyClosed(q, POSED) <= 0) flesh.push(q);
    }
    let escaped = 0;
    for (const [name, w] of warps()) {
      const grown = bound(w, headC.centre, headC.radius, headC.reach);
      expect(len(sub(headC.centre, grown.centre)) + headC.radius, name).toBeLessThanOrEqual(grown.radius + 1e-9);   // it still holds the closed sphere
      const grownGroups = headGroups.map(g => bound(w, g.centre, g.radius, g.reach));
      for (const q of flesh) {
        const m = warpPoint(w, q);
        expect(inside(grown, m.p), `${name}: ${m.p}`).toBe(true);
        if (m.piece === 0) continue;
        for (const g of grownGroups) expect(inside(g, m.p), `${name}: ${m.p}`).toBe(true);
        if (!headGroups.some(g => inside(g, m.p))) escaped++;
      }
    }
    // The test bites: the tips of the opened halves are outside every closed sphere of the head's groups (901 of the
    // 75 000 moved samples here: the slab's tip, which the closed tiles cut off).
    expect(escaped).toBeGreaterThan(500);
  });

  it('the open body\'s solid is inside the union of the inflated cluster spheres, and of the inflated group spheres', () => {
    let outsideClosed = 0;   // solid the closed body's group spheres do not hold
    for (const [name, w] of warps()) {
      const open: BuildResult = { ...POSED, split: w };
      const clusters = clusterSpheres.map(c => bound(w, c.centre, c.radius, c.reach));
      const groups = groupSpheres.map(g => bound(w, g.centre, g.radius, g.reach));
      const rnd = rng(1000 + name.length * 7 + Math.round(w.thetaP * 1e4) - Math.round(w.thetaM * 1e3));
      let solid = 0;
      for (let i = 0; i < 2500; i++) {
        const p = inBall(rnd, w.h, w.r + 0.1);
        if (sdBody(p, open) > 0) continue;
        solid++;
        expect(clusters.some(s => inside(s, p)), `${name}: ${p} outside every cluster sphere`).toBe(true);
        expect(groups.some(s => inside(s, p)), `${name}: ${p} outside every group sphere`).toBe(true);
        if (!groupSpheres.some(s => inside(s, p))) outsideClosed++;
      }
      expect(solid, name).toBeGreaterThan(100);
    }
    expect(outsideClosed).toBeGreaterThan(10);
  });

  it('a sphere that holds no turning flesh is left alone: the legs keep their bounds', () => {
    const w = splitWarpOf(forcedSplit('middle', 0, 0, 1)!, FRAME)!;
    const legs = clusterSpheres.filter(c => c.limb.startsWith('leg'));
    expect(legs.length).toBeGreaterThan(0);
    for (const c of legs) expect(bound(w, c.centre, c.radius, c.reach)).toEqual({ centre: c.centre, radius: c.radius });
  });
});

describe('the hulls follow the open head', () => {
  const sdSpheres = (p: Vec3, hull: { centre: Vec3; radius: number }[]) =>
    Math.min(...hull.map(s => len(sub(p, s.centre)) - s.radius));

  it('the OUTER hull holds the open body\'s solid; the closed head\'s hull does not', () => {
    const closedHull = buildOuterHullInstances([POSED]);
    let escapedClosed = 0;
    for (const [name, w] of warps()) {
      const open: BuildResult = { ...POSED, split: w };
      const hull = buildOuterHullInstances([open]);
      expect(hull.length, name).toBeGreaterThan(closedHull.length);
      expect(hull.slice(0, closedHull.length), name).toEqual(closedHull);
      const rnd = rng(77 + Math.round(w.thetaP * 1e4) - Math.round(w.thetaM * 1e3) + name.length);
      for (let i = 0; i < 2500; i++) {
        const p = inBall(rnd, w.h, w.r + 0.1);
        if (sdBody(p, open) > 0) continue;
        expect(sdSpheres(p, hull), `${name}: ${p}`).toBeLessThanOrEqual(0);
        if (sdSpheres(p, closedHull) > 0) escapedClosed++;
      }
    }
    // The closed hull's skull sphere is fat (the largest semi-axis all round), so it is the halves' tips that escape it.
    expect(escapedClosed).toBeGreaterThan(10);
  });
  it('the outer hull adds, for each sphere of a prim\'s cover that holds flesh of a half, a copy turned with that half; a closed body gets none', () => {
    const w = splitWarpOf(forcedSplit('face', 1, 0, 1)!, FRAME)!;
    const opts = { shellAmp: 0.004, margin: 0.01 };
    const closedHull = buildOuterHullInstances([POSED], opts);
    const hull = buildOuterHullInstances([{ ...POSED, split: w }], opts);
    // The closed body's spheres come first, untouched: what does not turn is where it was.
    expect(hull.slice(0, closedHull.length)).toEqual(closedHull);
    // THE FIRST RULE (the dev switch SPLIT_BOUND.hullOld): a turned copy of each of those spheres.
    const loose = closedHull.flatMap(s => images(w, s.centre, s.radius).map(centre => ({ centre, radius: s.radius })));
    expect(loose.length).toBeGreaterThan(3);
    expect(loose.length).toBeLessThan(closedHull.length);   // the body below the hinge has no copies
    splitAblate.boundsOff = SPLIT_BOUND.hullOld;
    expect(buildOuterHullInstances([{ ...POSED, split: w }], opts).slice(closedHull.length)).toEqual(loose);
    splitAblate.boundsOff = 0;
    // THE RULE: the copies are of each prim's COVER, a plain ellipsoid's being its tight chain (ellipsoidChain).
    const pad = (p: (typeof POSED.prims)[number]) => blendReach(p.blendK ?? 0, p.blendProfile) + opts.shellAmp + opts.margin;
    const plain = (p: (typeof POSED.prims)[number]) => p.a.every((v, i) => v === p.b[i]) && p.bend === undefined && p.box === undefined
      && p.strand === undefined && p.shell === undefined && (p.radiusB === undefined || p.radiusB === p.radius);
    const want: { centre: Vec3; radius: number }[] = [];
    let at = 0, tight = 0, kept = 0;
    for (const p of POSED.prims) {
      if (p.op === 'sub' || p.op === 'groove' || p.dead || !POSED.clusters.find(c => c.id === p.cluster)?.alive) continue;
      const own = buildOuterHullInstances([{ ...POSED, prims: [p] }], opts);
      expect(closedHull.slice(at, at + own.length)).toEqual(own);
      at += own.length;
      // A plain ellipsoid's tight chain, padded by the face cut's lip as well, where it is slimmer than the prim's own
      // sphere; otherwise the prim's own spheres.
      const chain = plain(p) ? ellipsoidChain(p.a, [p.radius * p.scale[0], p.radius * p.scale[1], p.radius * p.scale[2]], p.orient, pad(p) + SPLIT_HULL_LIP) : null;
      const slim = chain !== null && chain[0]!.radius < own[0]!.radius;
      for (const s of slim ? chain : own) for (const centre of images(w, s.centre, s.radius)) { want.push({ centre, radius: s.radius }); if (slim) tight++; else if (plain(p)) kept++; }
    }
    expect(at).toBe(closedHull.length);
    expect(tight).toBeGreaterThan(1);
    // The lip is the face cut's own (HEAD_SPLIT.faceCalibre through cut-wound.ts cutLip's amplitude): 15.6 mm today.
    expect(SPLIT_HULL_LIP).toBeCloseTo(HEAD_SPLIT.faceCalibre.kerf * 1.3, 12);
    console.log(`outer hull copies (face, full): ${tight} of a tight chain, ${kept} of plain ellipsoids whose padded chain is no slimmer than their sphere; lip pad ${(SPLIT_HULL_LIP * 1000).toFixed(1)} mm`);
    expect(hull.slice(closedHull.length)).toEqual(want);
    expect(buildOuterHullInstances([{ ...POSED, split: null }])).toEqual(buildOuterHullInstances([POSED]));
    // Two bodies: only the split one's spheres are copied.
    const two = buildOuterHullInstances([POSED, { ...POSED, split: w }], opts);
    expect(two.length).toBe(2 * closedHull.length + want.length);
  });
  it('a plain ellipsoid\'s tight chain holds the padded ellipsoid, in less room than its one sphere', () => {
    const rnd = rng(4242);
    let slimmer = 0;
    for (let n = 0; n < 60; n++) {
      const a0 = 0.01 + 0.15 * rnd(), a1 = 0.01 + 0.15 * rnd(), a2 = 0.01 + 0.15 * rnd();
      const axes: Vec3 = n < 3 ? [a0, a0, a0] : [a0, a1, a2];       // spheres too
      const pad = n % 4 === 0 ? 0 : 0.03 * rnd();
      const orient = n % 3 === 0 ? undefined : qFromAxisAngle(normalize([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]), 3 * rnd());
      const c: Vec3 = [rnd(), rnd(), rnd()];
      const chain = ellipsoidChain(c, axes, orient, pad);
      const big = Math.max(...axes), mid = [...axes].sort((x, y) => x - y)[1]!;
      // Its spheres are the middle semi-axis's (plus the pad), inflated as every chain's; one sphere for a sphere.
      for (const s of chain) expect(s.radius).toBeCloseTo((mid + pad) * 1.13, 12);
      if (big - mid < 1e-12) expect(chain.length).toBe(1);
      if ((mid + pad) * 1.13 < (big + pad) * 1.13 * 0.9) slimmer++;
      // Every point of the padded ellipsoid's surface (a surface point pushed out along its normal by the pad) and of
      // its inside is in some sphere of the chain.
      for (let i = 0; i < 400; i++) {
        const u = normalize([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]), k = i % 2 ? 1 : Math.cbrt(rnd());
        const local: Vec3 = [axes[0] * u[0] * k, axes[1] * u[1] * k, axes[2] * u[2] * k];
        const nrm = normalize([u[0] / axes[0], u[1] / axes[1], u[2] / axes[2]]);
        const out: Vec3 = [local[0] + nrm[0] * pad, local[1] + nrm[1] * pad, local[2] + nrm[2] * pad];
        const world = orient ? qRotate(orient, out) : out;
        const p: Vec3 = [c[0] + world[0], c[1] + world[1], c[2] + world[2]];
        expect(sdSpheres(p, chain), `${n}: axes ${axes}, pad ${pad}`).toBeLessThanOrEqual(1e-12);
      }
    }
    expect(slimmer).toBeGreaterThan(20);
  });
  it('the tight copies hold the opened halves with room to spare, in less of the hold ball than the loose ones', () => {
    for (const [name, preset, sides, offset] of [['middle both', 'middle', 0, 0], ['middle one', 'middle', 1, 0.036], ['face', 'face', 1, 0]] as const) {
      const w = splitWarpOf(forcedSplit(preset, sides, offset, 1)!, FRAME)!, ball = splitHoldBall(w);
      const open: BuildResult = { ...POSED, split: w };
      const hull = buildOuterHullInstances([open]);
      splitAblate.boundsOff = SPLIT_BOUND.hullOld;
      const loose = buildOuterHullInstances([open]);
      splitAblate.boundsOff = 0;
      const rnd = rng(31 + name.length);
      let inNew = 0, inOld = 0, solid = 0, worst = Infinity;
      for (let i = 0; i < 30000; i++) {
        const p = inBall(rnd, ball.centre, ball.radius + 0.05);
        // (Not a subset: a padded chain's end spheres reach a little past the one loose sphere along the long axis.)
        const dNew = sdSpheres(p, hull), dOld = sdSpheres(p, loose);
        if (dNew <= 0) inNew++;
        if (dOld <= 0) inOld++;
        if (sdBody(p, open) > 0) continue;
        solid++;
        expect(dNew, `${name}: ${p}`).toBeLessThanOrEqual(0);
        worst = Math.min(worst, -dNew);
      }
      console.log(`outer hull, ${name}: the tight copies cover ${(100 * inNew / 30000).toFixed(1)}% of the hold ball's neighbourhood against ${(100 * inOld / 30000).toFixed(1)}% (${solid} solid samples, all inside; the shallowest ${(worst * 1000).toFixed(1)} mm in)`);
      expect(solid).toBeGreaterThan(1500);
      expect(inNew).toBeLessThan(inOld);
    }
  });
  it('the split hull is far smaller on screen than a sphere round the whole hold ball', () => {
    // The share of the hold ball's volume the head's spheres and their copies cover (the rest is not marched).
    for (const [preset, sides, offset] of [['middle', 0, 0], ['middle', 1, 0.036], ['face', 1, 0]] as const) {
      const w = splitWarpOf(forcedSplit(preset, sides, offset, 1)!, FRAME)!, ball = splitHoldBall(w);
      const hull = buildOuterHullInstances([{ ...POSED, split: w }]);
      const rnd = rng(9);
      let inHull = 0;
      for (let i = 0; i < 4000; i++) if (sdSpheres(inBall(rnd, ball.centre, ball.radius), hull) <= 0) inHull++;
      expect(inHull / 4000, preset).toBeLessThan(0.75);
    }
  });

  it('the INNER (occluder) hull keeps exactly the spheres that hold no turning flesh, and every point of each is solid on the open body', () => {
    const closed = buildHullInstances([POSED], HULL_SHRINK);
    // Points of a sphere: its centre and 26 on its surface.
    const DIRS: Vec3[] = [];
    for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) DIRS.push(normalize([x, y, z]));
    let inGap = 0, keptInBall = 0;
    for (const [name, w] of warps()) {
      const open: BuildResult = { ...POSED, split: w }, ball = splitHoldBall(w);
      const inner = buildHullInstances([open], HULL_SHRINK);
      expect(inner, name).toEqual(closed.filter(s => holds(w, s.centre, s.radius) === 0));
      expect(inner.length, name).toBeLessThan(closed.length);
      for (const s of inner) {
        for (const p of [s.centre, ...DIRS.map(d => along(s.centre, d, s.radius))]) {
          expect(sdBody(p, open), `${name}: sphere r ${s.radius.toFixed(3)} at ${s.centre}, point ${p}`).toBeLessThanOrEqual(1e-9);
        }
        // Kept although it is in the hold ball (the jaw and the neck, below the hinge plane).
        if (len(sub(s.centre, ball.centre)) < ball.radius) keptInBall++;
      }
      // What the closed head's inner hull would have left poking into the open gap.
      for (const s of closed) if (DIRS.some(d => sdBody(along(s.centre, d, s.radius), open) > 1e-9)) inGap++;
    }
    expect(inGap).toBeGreaterThan(20);
    expect(keptInBall).toBeGreaterThan(20);
  });
  it('the inner hull\'s gate takes the silhouette noise with the radius', () => {
    const w = splitWarpOf(forcedSplit('middle', 0, 0, 1)!, FRAME)!, amp = 0.004;
    const closed = buildHullInstances([POSED], HULL_SHRINK, [], amp);
    expect(buildHullInstances([{ ...POSED, split: w }], HULL_SHRINK, [], amp))
      .toEqual(closed.filter(s => holds(w, s.centre, s.radius + amp) === 0));
  });
  it('the SHADOW hull (an outer shape) is the closed head\'s', () => {
    const w = splitWarpOf(forcedSplit('middle', 0, 0, 1)!, FRAME)!;
    expect(buildHullInstances([{ ...POSED, split: w }], SHADOW_HULL_INFLATE, [], 0, true, true))
      .toEqual(buildHullInstances([POSED], SHADOW_HULL_INFLATE, [], 0, true, true));
  });
});

// THE REGION SHELL AT RANGE (head-split.ts splitDrawDistance). The shell bound C is never under REGION_MARGIN, so it
// is drawn as a surface only by a march whose accept reach is over that: the hit epsilon (the pixel footprint,
// t x coneK x strength) times the last-step secant's factor. The view closes the split in its record before then.
describe('the region shell at range: the distance the split is drawn to', () => {
  const w = splitWarpOf(forcedSplit('middle', 0, 0, 1)!, FRAME)!;
  // The game at its defaults (probed 2026-10-04): aaCfg.x 0.000924 (one pixel of the 600-row grid at 58 degrees),
  // far strength aaCfg.y 1, last-step secant perfCfg.w 4.
  const GAME = { coneK: Math.tan(29 * Math.PI / 180) / 600, strength: 1, secant: 4 };

  it('the law it mirrors is the march\'s: the footprint epsilon, and the secant accept at perfCfg.w epsilons', () => {
    expect(MARCH_BODY).toContain('let aaK = aaCfg.x * aaCfg.y;');
    expect(MARCH_BODY).toContain('let aaKt = select(aaK, aaCfg.x * mix(aaCfg.z, aaCfg.y, smoothstep(aaCfg.w * 0.5, aaCfg.w, t)), aaCfg.z > 0.0);');
    expect(MARCH_BODY).toContain('let hitEps = max(hitEpsBase, t * aaKt / distort);');
    expect(MARCH_BODY).toContain('let root = radius * stepLen / (prevRadius - radius);');
    expect(MARCH_BODY).toContain('if (root < hitEps * perfCfg.w) {');
    expect(MARCH_BODY).toContain('if (d < hitEps) {');
  });
  it('a secant root on the shell is over REGION_MARGIN: an accept reach at or under it cannot take the shell', () => {
    // root = radius x step / (prev - radius) with step <= prev (a sphere-traced step) and radius = C >= REGION_MARGIN.
    const rnd = rng(5);
    for (let i = 0; i < 2000; i++) {
      const radius = REGION_MARGIN + rnd() * 0.5, prev = radius + 1e-6 + rnd() * 2;
      expect(radius * prev / (prev - radius)).toBeGreaterThan(REGION_MARGIN);
    }
  });
  it('at the distance, the accept reach at the far side of the region sphere is SHELL_ACCEPT_FRAC x REGION_MARGIN', () => {
    const d = splitDrawDistance(w, GAME);
    expect((d + w.r) * GAME.coneK * GAME.strength * GAME.secant).toBeCloseTo(SHELL_ACCEPT_FRAC * REGION_MARGIN, 12);
    expect(SHELL_ACCEPT_FRAC).toBeLessThan(1);
    // The game's numbers: the reach is REGION_MARGIN at 16.2 m, and the split is drawn to 12.7 m.
    expect(REGION_MARGIN / (GAME.coneK * GAME.strength * GAME.secant)).toBeCloseTo(16.24, 1);
    expect(d).toBeGreaterThan(12.6);
    expect(d).toBeLessThan(12.7);
  });
  it('a coarser pixel or a larger secant factor closes it nearer; no secant is one epsilon; no footprint accept never closes it', () => {
    const d = splitDrawDistance(w, GAME);
    expect(splitDrawDistance(w, { ...GAME, coneK: GAME.coneK * 2 })).toBeCloseTo((d + w.r) / 2 - w.r, 9);
    expect(splitDrawDistance(w, { ...GAME, secant: 8 })).toBeLessThan(d);
    expect(splitDrawDistance(w, { ...GAME, secant: 0 })).toBeCloseTo(splitDrawDistance(w, { ...GAME, secant: 1 }), 12);
    expect(splitDrawDistance(w, { ...GAME, secant: 0 })).toBeCloseTo((d + w.r) * 4 - w.r, 9);
    expect(splitDrawDistance(w, { ...GAME, strength: 0 })).toBe(Infinity);
    expect(splitDrawDistance(w, { ...GAME, coneK: 0 })).toBe(Infinity);
  });
});

// THE ACCEPT REACH UP CLOSE (head-split.ts splitNearReach). The near accept boost is strongest at arm's length, where
// the split cannot be closed for it: the game's shipped numbers must keep the reach under REGION_MARGIN, and the
// helper must say when a live configuration does not (the view warns with it).
describe('the region shell up close: the near accept reach', () => {
  /** One pixel's footprint per metre at an SDF pass `rows` high (sdf-layer.ts coneKFor) under the shipped lens. */
  const coneK = (rows: number) => Math.tan(FISHEYE_DEFAULTS.renderFovDeg * Math.PI / 360) / rows;
  /** The game as it ships (game-march-accept.ts), at the default 800 x 600 rung (game-main.ts RES_RUNGS). */
  const SHIPPED = { coneK: coneK(600), strength: GAME_AA, near: GAME_AA_NEAR, fadeM: GAME_AA_FADE_M, secant: GAME_LAST_STEP_DEFAULT };

  it('is the peak of t x aaKt(t) x the secant factor, with the march\'s own aaKt', () => {
    expect(MARCH_BODY).toContain('let aaKt = select(aaK, aaCfg.x * mix(aaCfg.z, aaCfg.y, smoothstep(aaCfg.w * 0.5, aaCfg.w, t)), aaCfg.z > 0.0);');
    // A dense scan with the WGSL's smoothstep written out, for a few configurations.
    const scan = (a: typeof SHIPPED) => {
      let peak = 0;
      for (let t = 0; t <= a.fadeM * 1.0000001; t += a.fadeM / 20000) {
        const x = Math.min(1, Math.max(0, (t - a.fadeM * 0.5) / (a.fadeM - a.fadeM * 0.5))), ss = x * x * (3 - 2 * x);
        const aaKt = a.near > 0 ? a.coneK * (a.near * (1 - ss) + a.strength * ss) : a.coneK * a.strength;
        peak = Math.max(peak, t * aaKt * Math.max(1, a.secant));
      }
      return peak;
    };
    for (const a of [SHIPPED, { ...SHIPPED, near: 12 }, { ...SHIPPED, near: 2, fadeM: 5 }, { ...SHIPPED, secant: 0 }, { ...SHIPPED, strength: 3 }]) {
      expect(splitNearReach(a) / scan(a)).toBeGreaterThan(1 - 1e-3);
      expect(splitNearReach(a) / scan(a)).toBeLessThan(1 + 1e-3);
    }
    // No boost: the far law, at the fade distance.
    expect(splitNearReach({ ...SHIPPED, near: 0 })).toBeCloseTo(GAME_AA_FADE_M * GAME_AA * SHIPPED.coneK * GAME_LAST_STEP_DEFAULT, 12);
  });
  it('the game as it ships stays under REGION_MARGIN, at both resolution rungs, and under the range rule\'s bar', () => {
    expect(splitNearReach(SHIPPED) / REGION_MARGIN).toBeGreaterThan(0.55);
    expect(splitNearReach(SHIPPED) / REGION_MARGIN).toBeLessThan(0.65);
    expect(splitNearReach(SHIPPED)).toBeLessThan(SHELL_ACCEPT_FRAC * REGION_MARGIN);
    expect(splitNearReach({ ...SHIPPED, coneK: coneK(480) })).toBeLessThan(SHELL_ACCEPT_FRAC * REGION_MARGIN);   // ?res=640
  });
  it('says when a configuration is not safe: a last-step factor of 7 or more, or an SDF pass under 0.61 of the default', () => {
    expect(splitNearReach({ ...SHIPPED, secant: 6 })).toBeLessThan(REGION_MARGIN);
    expect(splitNearReach({ ...SHIPPED, secant: 7 })).toBeGreaterThan(REGION_MARGIN);
    expect(splitNearReach({ ...SHIPPED, coneK: coneK(600 * 0.62) })).toBeLessThan(REGION_MARGIN);
    expect(splitNearReach({ ...SHIPPED, coneK: coneK(600 * 0.6) })).toBeGreaterThan(REGION_MARGIN);
  });
});
