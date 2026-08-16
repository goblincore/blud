// src/lab/sdf-zombie/webgpu/occluder-hull.test.ts
//
// The hull's one obligation is INSIDE-NESS: every sphere it emits must lie
// inside the blended body, because the march treats hull distance as "solid
// by here" and cuts rays at it. A sphere outside the body turns into a hole
// in the render — twice over, now, since both failures on this branch were
// exactly that (the eye-socket-class carve risk, designed against; and the
// blast-crater hole, observed and fixed).

import { describe, it, expect } from 'vitest';
import { buildHullInstances, HULL_SHRINK, type WoundSphere } from './occluder-hull';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { makeZombie } from '../body';
import { DEFAULT_FACE } from '../face';
import { sdBody } from '../validate';
import type { Vec3 } from '../types';

const body = buildBody(makeZombie({ ...DEFAULT_FACE }), DEFAULT_BUILD_OPTS);

describe('buildHullInstances', () => {
  it('emits spheres strictly inside the blended body', () => {
    // Sampled against the CPU mirror of the field: at each sphere's centre the
    // body must be at least as deep as the sphere's radius, or part of the
    // sphere pokes out of the flesh. sdBody carries the body's own carves, so
    // this check covers the eye-socket case too.
    const inst = buildHullInstances([body]);
    expect(inst.length).toBeGreaterThan(20);
    for (const s of inst) {
      expect(sdBody(s.centre, body), `sphere at ${s.centre}`).toBeLessThanOrEqual(-s.radius + 1e-4);
    }
  });

  it('skips carve primitives outright', () => {
    // A carve endpoint is a point where material was REMOVED — a hull sphere
    // there would sit in the hole. The default zombie happens to carry no
    // carves, so plant one and check it contributes nothing.
    const carved = {
      ...body,
      prims: [...body.prims, {
        a: [0, 1.5, 0.1] as Vec3, b: [0, 1.5, 0.2] as Vec3,
        radius: 0.1, scale: [1, 1, 1] as Vec3, blendK: 0,
        limb: body.prims[0]!.limb, cluster: body.prims[0]!.cluster,
        op: 'sub' as const,
      }],
    };
    expect(buildHullInstances([carved]).length).toBe(buildHullInstances([body]).length);
  });

  it('skips dead clusters, so a severed limb stops occluding', () => {
    const armless = {
      ...body,
      clusters: body.clusters.map(c => (c.id === 1 ? { ...c, alive: false } : c)),
    };
    const full = buildHullInstances([body]).length;
    const cut = buildHullInstances([armless]).length;
    expect(cut).toBeLessThan(full);
  });

  it('drops any sphere a wound bites into', () => {
    // The blast-crater bug: a wound's removal sphere exposed a hull sphere
    // inside the cavity, and every ray into the crater clamped at it — black
    // centre with the occluder on, wet interior with it off. Wounds subtract,
    // and subtraction is the one thing the inside-ness argument cannot cover,
    // so intersecting spheres are dropped rather than shrunk.
    const base = buildHullInstances([body]);
    const target = base[Math.floor(base.length / 2)]!;
    const wound: WoundSphere = { centre: target.centre, radius: 0.08 };
    const after = buildHullInstances([body], HULL_SHRINK, [wound]);
    expect(after.length).toBeLessThan(base.length);
    for (const s of after) {
      const d = Math.hypot(
        s.centre[0] - wound.centre[0],
        s.centre[1] - wound.centre[1],
        s.centre[2] - wound.centre[2],
      );
      // Everything kept clears the wound by more than the two radii together.
      expect(d).toBeGreaterThan(wound.radius + s.radius);
    }
  });

  it('leaves far-away spheres alone when a wound lands', () => {
    const wound: WoundSphere = { centre: [0, 1.4, 0.2] as Vec3, radius: 0.08 };
    const base = buildHullInstances([body]);
    const after = buildHullInstances([body], HULL_SHRINK, [wound]);
    // A single wound must cost a few local spheres, not gut the hull.
    expect(base.length - after.length).toBeGreaterThan(0);
    expect(base.length - after.length).toBeLessThan(base.length / 3);
  });
});

describe('shell displacement (X1.21.2) — inside-ness under the dented field', () => {
  // The fbm displaces BOTH ways: bumps stand proud of the hull (harmless —
  // they are nearer than the hull along the ray), but DENTS retreat up to
  // 0.9 amp BELOW the smooth surface, and the hull clearance is only
  // (1 - shrink) of the prim radius. On thin limbs a dent can pass behind the
  // hull sphere, and a march clamped at the hull discards the pixel: the dark
  // dropout the A/B isolated (occluder off, shell on — patches vanish).
  // Direction of the fix is INWARD, not the BVH instinct: this hull bounds
  // how far a ray may march, so growing a sphere TIGHTENS the bound.
  const SHELL_AMP = 0.016;   // lab-main's production amplitude
  const FBM_MAX = 0.9;       // fbm = noise3*0.6 + noise3*0.3, noise3 in [-1,1]

  it('leaves the hull untouched when the shell is off', () => {
    // The default amp is 0 and the march-side relaxation adds 0 with the
    // shell off; both sides must be bit-identical to the undisplaced hull.
    expect(buildHullInstances([body], HULL_SHRINK, [], 0))
      .toEqual(buildHullInstances([body]));
  });

  it('keeps every sphere inside the DISPLACED field when the shell is on', () => {
    // The contract under displacement: the field can read up to FBM_MAX*amp
    // ABOVE its smooth value at the sphere surface (that is what a dent is),
    // so a sphere is inside the displaced flesh only if it clears the smooth
    // field by its radius plus the worst dent, not the radius alone.
    const inst = buildHullInstances([body], HULL_SHRINK, [], SHELL_AMP);
    expect(inst.length).toBeGreaterThan(10);
    for (const s of inst) {
      expect(sdBody(s.centre, body), `sphere at ${s.centre}`)
        .toBeLessThanOrEqual(-(s.radius + FBM_MAX * SHELL_AMP) + 1e-4);
    }
  });

  it('shrinks each radius by exactly the amp, and never grows one', () => {
    const off = buildHullInstances([body]);
    const on = buildHullInstances([body], HULL_SHRINK, [], SHELL_AMP);
    const key = (s: { centre: Vec3 }) => `${s.centre}`;
    const offByCentre = new Map(off.map(s => [key(s), s.radius]));
    expect(on.length).toBeLessThanOrEqual(off.length);
    for (const s of on) {
      const was = offByCentre.get(key(s));
      expect(was, `sphere at ${s.centre} existed with the shell off`).toBeDefined();
      expect(s.radius).toBeCloseTo(was! - SHELL_AMP, 6);
    }
  });

  it('drops the spheres a dent would expose on thin limbs rather than half-covering them', () => {
    // A prim whose shrunken radius cannot afford the amp is dropped
    // entirely: a sphere keeping a partial margin is the dropout bug in
    // miniature — the dent still passes it, the march still discards.
    const thin = {
      clusters: [{ id: 0, limb: 'armL' as const, start: 0, count: 2, center: [0, 0, 0] as const, radius: 1, alive: true }],
      prims: [
        { a: [0, 0, 0], b: [0, 1, 0], radius: 0.5, scale: [1, 1, 1], blendK: 0.05, limb: 'armL' as const, cluster: 0 },
        // Finger-scale: 0.4*0.8 = 0.32... minus amp stays above the floor.
        { a: [0, 1, 0], b: [0.2, 1, 0], radius: 0.4, scale: [1, 1, 1], blendK: 0.05, limb: 'armL' as const, cluster: 0 },
        // Tiny: 0.05*0.8 = 0.04, minus amp 0.016 leaves 0.024 — above the
        // 0.02 floor, kept but with the full margin paid.
        { a: [0.2, 1, 0], b: [0.35, 1, 0], radius: 0.05, scale: [1, 1, 1], blendK: 0.05, limb: 'armL' as const, cluster: 0 },
        // Sub-floor after the amp: 0.04*0.8 - 0.016 = 0.016 < 0.02 — dropped.
        { a: [0.35, 1, 0], b: [0.45, 1, 0], radius: 0.04, scale: [1, 1, 1], blendK: 0.05, limb: 'armL' as const, cluster: 0 },
      ],
    } as never;
    const off = buildHullInstances([thin]);
    const on = buildHullInstances([thin], HULL_SHRINK, [], SHELL_AMP);
    // The sub-floor prim contributes two endpoint spheres with the shell
    // off and none with it on — dropped, not half-kept. Prim 3's far
    // endpoint also sits at x=0.35 (0.024 after the amp, above the floor) and
    // must SURVIVE: only the prim that cannot afford the margin is dropped.
    expect(off.filter(s => s.centre[0] >= 0.35).length).toBe(3);
    expect(on.filter(s => s.centre[0] >= 0.35).length).toBe(1);
    // And the survivors are exactly the affordable spheres minus the amp —
    // multiset compare, since prims share endpoints with different radii.
    expect(on.map(s => s.radius).sort((a, b) => a - b)).toEqual(
      [0.5, 0.4, 0.05].flatMap(r => [r * HULL_SHRINK - SHELL_AMP, r * HULL_SHRINK - SHELL_AMP])
        .sort((a, b) => a - b));
    expect(on.every(s => s.radius >= 0.02)).toBe(true);
  });

  it('grows the wound clearance by the amp, never shrinking the drop zone', () => {
    // Wound rims evert and the shell adds fbm on top; a sphere that only
    // just cleared a wound against the smooth field can sit inside its
    // displaced rim. The drop reach grows by the amp, so the kept set with
    // the shell on is a SUBSET of the kept set with it off, same wounds.
    const wound: WoundSphere = { centre: [0, 1.4, 0.2] as Vec3, radius: 0.08 };
    const off = buildHullInstances([body], HULL_SHRINK, [wound]);
    const on = buildHullInstances([body], HULL_SHRINK, [wound], SHELL_AMP);
    expect(on.length).toBeLessThanOrEqual(off.length);
    const key = (s: { centre: Vec3 }) => `${s.centre}`;
    const offSet = new Set(off.map(s => key(s)));
    for (const s of on) expect(offSet.has(key(s)), `new sphere at ${s.centre}`).toBe(true);
  });
});

describe('dead prims (mid-limb severing)', () => {
  it('emits no hull spheres for dead prims — a phantom hull punches discard holes', () => {
    // Regression: after severDistal marks a forearm dead, the flesh field
    // skips it but the hull still built spheres at the old joint positions.
    // Those clamp tMax in empty space and every ray through them discards —
    // see-through holes wherever the phantom overlaps the body on screen
    // (playtest 2026-08-16, black discs at blasted wrist/elbow locations).
    const body = {
      clusters: [{ id: 0, limb: 'armL' as const, start: 0, count: 2, center: [0, 0, 0] as const, radius: 1, alive: true }],
      prims: [
        { a: [0, 0, 0], b: [0, 1, 0], radius: 0.2, scale: [1, 1, 1], blendK: 0.05, limb: 'armL' as const, cluster: 0 },
        { a: [0, 1, 0], b: [0, 2, 0], radius: 0.2, scale: [1, 1, 1], blendK: 0.05, limb: 'armL' as const, cluster: 0, dead: true },
      ],
    } as never;
    const instances = buildHullInstances([body]);
    // Only the live prim's two endpoints; nothing at y=2, nothing extra at y=1.
    expect(instances).toHaveLength(2);
    for (const i of instances) expect(i.centre[1]).toBeLessThanOrEqual(1);
  });
});
