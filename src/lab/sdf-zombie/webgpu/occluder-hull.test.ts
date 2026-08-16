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
