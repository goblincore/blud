// src/lab/sdf-zombie/head-split-bounds.test.ts
//
// THE BOUNDS OF AN OPEN HEAD (head-split.ts splitHoldBall / splitBound), on the real posed zombie. Every bound that
// tests a world ray or a screen position against the body (the proxy box, the cluster spheres of the depth pre-pass's
// miss cull, the screen tiles' group spheres, the outer hull) describes the CLOSED head's prims; under a split each
// goes through the one rule, splitBound. Here: the rule's geometry, and that the bounds it makes hold the open head
// for both presets and both hinges over the whole angle range.
import { describe, expect, it } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from './build-body';
import { makeZombie } from './body';
import { applyRig, bindRig, headQuatOf } from './rig-bind';
import { sdBody, sdBodyClosed } from './validate';
import { packBody } from './pack';
import {
  REGION_MARGIN, SHELL_ACCEPT_FRAC, forcedSplit, headFrameOf, splitBound, splitDrawDistance, splitHoldBall, splitMaxAngle,
  splitSphereImages, splitWarpOf, warpPoint,
  type SplitPresetId, type SplitWarp,
} from './head-split';
import { MARCH_BODY } from './webgpu/march.wgsl';
import { cross, dot, len, sub } from './vec';
import type { Vec3 } from './types';
import { headShape } from './webgpu/flame-anchors';
import { buildOuterHullInstances } from './webgpu/shell-hull-outer';
import { HULL_SHRINK, SHADOW_HULL_INFLATE, buildHullInstances } from './webgpu/occluder-hull';

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
const warps = (): [name: string, w: SplitWarp][] => SHAPES.flatMap(([name, preset, sides, offset]) =>
  FRACS.map((frac): [string, SplitWarp] => [`${name} @ ${frac}`, splitWarpOf(forcedSplit(preset, sides, offset, frac)!, FRAME)!]));

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

describe('splitBound: a bound sphere of the closed body, for the split body', () => {
  const w = splitWarpOf(forcedSplit('middle', 0, 0, 1)!, FRAME)!;
  const ball = splitHoldBall(w);

  it('the hold ball is the hinge and rho = r - REGION_MARGIN', () => {
    expect(ball.centre).toBe(w.h);
    expect(ball.radius).toBeCloseTo(w.r - REGION_MARGIN, 12);
  });
  it('no split: the sphere itself', () => {
    const c: Vec3 = [1, 2, 3];
    expect(splitBound(null, c, 0.2)).toEqual({ centre: c, radius: 0.2 });
    expect(splitBound(undefined, c, 0.2).centre).toBe(c);
  });
  it('a sphere clear of the ball stays; within `reach` of it, it grows', () => {
    const gap = 0.05, c: Vec3 = [w.h[0] + ball.radius + 0.1 + gap, w.h[1], w.h[2]];
    expect(splitBound(w, c, 0.1)).toEqual({ centre: c, radius: 0.1 });
    expect(splitBound(w, c, 0.1, gap - 1e-6)).toEqual({ centre: c, radius: 0.1 });
    const grown = splitBound(w, c, 0.1, gap + 1e-6);
    expect(grown.radius).toBeCloseTo((2 * ball.radius + 0.2 + gap) / 2, 9);
  });
  it('a sphere wholly below the hinge plane stays, whatever it overlaps; within `reach` of the plane, it grows', () => {
    const u = cross(w.n, w.a), c: Vec3 = [w.h[0] - u[0] * 0.1, w.h[1] - u[1] * 0.1, w.h[2] - u[2] * 0.1];
    expect(splitBound(w, c, 0.09)).toEqual({ centre: c, radius: 0.09 });
    expect(splitBound(w, c, 0.09, 0.009)).toEqual({ centre: c, radius: 0.09 });
    expect(splitBound(w, c, 0.09, 0.011)).toEqual(ball);
    expect(splitBound(w, c, 0.11)).toEqual(ball);
  });
  it('a sphere inside the ball becomes the ball; one that holds the ball stays', () => {
    expect(splitBound(w, [w.h[0] + 0.05, w.h[1] + 0.02, w.h[2]], 0.04)).toEqual(ball);
    const big: Vec3 = [w.h[0], w.h[1] - 0.1, w.h[2] + 0.05];
    expect(splitBound(w, big, ball.radius + 0.2)).toEqual({ centre: big, radius: ball.radius + 0.2 });
  });
  it('a sphere that reaches the ball grows to the smallest sphere holding both; one that does not is untouched', () => {
    const rnd = rng(11);
    let grew = 0, stayed = 0;
    for (let i = 0; i < 600; i++) {
      const c = inBall(rnd, w.h, ball.radius + 0.3), radius = 0.02 + 0.3 * rnd();
      const b = splitBound(w, c, radius), d = len(sub(c, w.h));
      const up = dot(cross(w.n, w.a), sub(c, w.h));
      if (d - radius > ball.radius || up + radius < 0) { expect(b).toEqual({ centre: c, radius }); stayed++; continue; }
      grew++;
      // Holds the sphere and the ball (their farthest points from the new centre).
      expect(len(sub(c, b.centre)) + radius).toBeLessThanOrEqual(b.radius + 1e-9);
      expect(len(sub(w.h, b.centre)) + ball.radius).toBeLessThanOrEqual(b.radius + 1e-9);
      // And is no larger than that takes: the larger of the two, or half the span across both.
      expect(b.radius).toBeCloseTo(Math.max(radius, ball.radius, (d + radius + ball.radius) / 2), 9);
    }
    expect(grew).toBeGreaterThan(200);
    expect(stayed).toBeGreaterThan(20);
  });
});

describe('splitSphereImages: where the flesh a closed sphere holds is on the open head', () => {
  it('none for a closed head, a sphere below the hinge plane, or one clear of the hold ball', () => {
    const w = splitWarpOf(forcedSplit('middle', 0, 0, 1)!, FRAME)!, ball = splitHoldBall(w), u = cross(w.n, w.a);
    expect(splitSphereImages(null, FRAME.centre, 0.1)).toEqual([]);
    expect(splitSphereImages(w, [w.h[0] - u[0] * 0.2, w.h[1] - u[1] * 0.2, w.h[2] - u[2] * 0.2], 0.19)).toEqual([]);
    expect(splitSphereImages(w, [w.h[0] + u[0] * (ball.radius + 0.2), w.h[1] + u[1] * (ball.radius + 0.2), w.h[2] + u[2] * (ball.radius + 0.2)], 0.19)).toEqual([]);
  });
  it('one copy per half the sphere reaches that turns: both, the + side only, the - side only', () => {
    const both = splitWarpOf(forcedSplit('middle', 0, 0, 1)!, FRAME)!;
    expect(splitSphereImages(both, FRAME.centre, 0.1)).toHaveLength(2);
    // Wholly on the + side of the plane: only the + half's copy.
    const plus: Vec3 = [FRAME.centre[0] + both.n[0] * 0.08, FRAME.centre[1] + both.n[1] * 0.08, FRAME.centre[2] + both.n[2] * 0.08];
    const im = splitSphereImages(both, plus, 0.05);
    expect(im).toHaveLength(1);
    expect(len(sub(im[0]!, warpPoint(both, plus).p))).toBeLessThan(1e-12);
    // A one-sided split turns one half: a sphere on the other side has no copy.
    const one = splitWarpOf(forcedSplit('middle', 1, 0.036, 1)!, FRAME)!;
    expect(splitSphereImages(one, FRAME.centre, 0.1)).toHaveLength(1);
    const minus: Vec3 = [FRAME.centre[0] - one.n[0] * 0.08, FRAME.centre[1] - one.n[1] * 0.08, FRAME.centre[2] - one.n[2] * 0.08];
    expect(splitSphereImages(one, minus, 0.05)).toEqual([]);
  });
  it('every point of the sphere is, after the warp, in the sphere or in one of its copies', () => {
    const rnd = rng(21);
    let moved = 0;
    for (const [name, w] of warps()) {
      for (let k = 0; k < 40; k++) {
        const c = inBall(rnd, w.h, w.r), radius = 0.02 + 0.15 * rnd();
        const spheres = [c, ...splitSphereImages(w, c, radius)].map(centre => ({ centre, radius }));
        for (let i = 0; i < 40; i++) {
          const m = warpPoint(w, inBall(rnd, c, radius));
          if (m.piece !== 0) moved++;
          expect(spheres.some(s => inside(s, m.p)), `${name}: ${m.p}`).toBe(true);
        }
      }
    }
    expect(moved).toBeGreaterThan(5000);
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

  it('every head prim\'s moved extent is inside the head cluster\'s inflated sphere and the head groups\' inflated spheres', () => {
    const headI = clusterSpheres.findIndex(c => c.limb === 'head'), headC = clusterSpheres[headI]!;
    const first = PACKED.clusterGroups[headI * 4]!, count = PACKED.clusterGroups[headI * 4 + 1]!;
    const headGroups = groupSpheres.slice(first, first + count);
    // Head material of the closed body: points in the head cluster's sphere the closed field calls solid, or within
    // a few millimetres of solid (the surface's own neighbourhood).
    const rnd = rng(3);
    const flesh: Vec3[] = [];
    while (flesh.length < 3000) {
      const q = inBall(rnd, headC.centre, headC.radius);
      if (sdBodyClosed(q, POSED) <= 0.004) flesh.push(q);
    }
    let escaped = 0;
    for (const [name, w] of warps()) {
      const grown = splitBound(w, headC.centre, headC.radius, headC.reach);
      expect(len(sub(headC.centre, grown.centre)) + headC.radius, name).toBeLessThanOrEqual(grown.radius + 1e-9);   // it still holds the closed sphere
      const grownGroups = headGroups.map(g => splitBound(w, g.centre, g.radius, g.reach));
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
      const clusters = clusterSpheres.map(c => splitBound(w, c.centre, c.radius, c.reach));
      const groups = groupSpheres.map(g => splitBound(w, g.centre, g.radius, g.reach));
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

  it('a sphere that does not reach the hold ball is left alone: the legs keep their bounds', () => {
    const w = splitWarpOf(forcedSplit('middle', 0, 0, 1)!, FRAME)!;
    const legs = clusterSpheres.filter(c => c.limb.startsWith('leg'));
    expect(legs.length).toBeGreaterThan(0);
    for (const c of legs) expect(splitBound(w, c.centre, c.radius, c.reach)).toEqual({ centre: c.centre, radius: c.radius });
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
  it('the outer hull adds, for each sphere that holds flesh of a half, a copy turned with that half; a closed body gets none', () => {
    const w = splitWarpOf(forcedSplit('face', 1, 0, 1)!, FRAME)!;
    const closedHull = buildOuterHullInstances([POSED], { shellAmp: 0.004, margin: 0.01 });
    const hull = buildOuterHullInstances([{ ...POSED, split: w }], { shellAmp: 0.004, margin: 0.01 });
    const want = closedHull.flatMap(s => splitSphereImages(w, s.centre, s.radius).map(centre => ({ centre, radius: s.radius })));
    expect(want.length).toBeGreaterThan(3);
    expect(want.length).toBeLessThan(closedHull.length);   // the body below the hinge has no copies
    expect(hull.slice(closedHull.length)).toEqual(want);
    expect(buildOuterHullInstances([{ ...POSED, split: null }])).toEqual(buildOuterHullInstances([POSED]));
    // Two bodies: only the split one's spheres are copied.
    const two = buildOuterHullInstances([POSED, { ...POSED, split: w }], { shellAmp: 0.004, margin: 0.01 });
    expect(two.length).toBe(2 * closedHull.length + want.length);
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

  it('the INNER (occluder) hull keeps no sphere that reaches the hold ball, and every sphere it keeps is inside the open body', () => {
    const closed = buildHullInstances([POSED], HULL_SHRINK);
    let inGap = 0;
    for (const [name, w] of warps()) {
      const open: BuildResult = { ...POSED, split: w }, ball = splitHoldBall(w);
      const inner = buildHullInstances([open], HULL_SHRINK);
      expect(inner.length, name).toBeLessThan(closed.length);
      for (const s of inner) {
        expect(len(sub(s.centre, ball.centre)), name).toBeGreaterThanOrEqual(ball.radius + s.radius);
        expect(sdBody(s.centre, open), `${name}: sphere at ${s.centre}`).toBeLessThanOrEqual(-s.radius + 1e-4);
      }
      // What the closed head's inner hull would have left in the open gap.
      for (const s of closed) if (sdBody(s.centre, open) > -s.radius + 1e-4) inGap++;
    }
    expect(inGap).toBeGreaterThan(20);
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
  it('up close the reach stays under the same bar, at the game\'s near strength (6, fading out by 3 m)', () => {
    // t x mix(near, far, smoothstep(fade / 2, fade, t)) peaks near 1.8 m.
    let peak = 0;
    for (let t = 0; t <= 3; t += 0.01) {
      const x = Math.min(1, Math.max(0, (t - 1.5) / 1.5)), ss = x * x * (3 - 2 * x);
      peak = Math.max(peak, t * (6 + (1 - 6) * ss));
    }
    expect(peak * GAME.coneK * GAME.secant).toBeLessThan(SHELL_ACCEPT_FRAC * REGION_MARGIN);
  });
});
