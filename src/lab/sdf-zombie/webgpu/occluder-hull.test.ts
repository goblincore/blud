// src/lab/sdf-zombie/webgpu/occluder-hull.test.ts
//
// The hull's one obligation is INSIDE-NESS: every sphere it emits must lie
// inside the blended body, because the march treats hull distance as "solid
// by here" and cuts rays at it. A sphere outside the body turns into a hole
// in the render — twice over, now, since both failures on this branch were
// exactly that (the eye-socket-class carve risk, designed against; and the
// blast-crater hole, observed and fixed).

import { describe, it, expect } from 'vitest';
// Entry-point SOURCE, imported with Vite's ?raw rather than read through
// node:fs — this tsconfig ships `types: ['vite/client']` and no @types/node,
// so an fs read does not type-check here even though vitest runs it.
import gameMainSrc from './game-main.ts?raw';
import labMainSrc from './lab-main.ts?raw';
import benchMainSrc from './bench-main.ts?raw';
import { buildHullInstances, HULL_SHRINK, createOccluderHull, SHADOW_HULL_INFLATE, type WoundSphere } from './occluder-hull';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { makeZombie } from '../body';
import { DEFAULT_FACE } from '../face';
import { sdBody } from '../validate';
import type { Vec3 } from '../types';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import mouseSrc from '../characters/mouse.blob?raw';
import clownSrc from '../characters/clown.blob?raw';
import goblinSrc from '../characters/goblin.blob?raw';

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

  // THE WHOLE CAST, not just the zombie. The zombie has no tapered primitive,
  // so the inside-ness test above passed for months while the mouse's snout
  // tip — a round cone, r 0.058 tapering to 0.036 — got a b-sphere sized
  // from the fat end, 10 mm proud of the surface. Every ray reaching that cap
  // clamped and discarded: a perfectly round see-through hole in the face,
  // hunted for most of a day as a modelling defect. Any character with a
  // tapered prim fat enough to clear MIN_HULL_RADIUS would have shown it.
  // INSIDE-NESS IS TESTED ON THE SPHERE'S SURFACE, not at its centre. Carves
  // apply as smax(d, -carve), which leaves the zero-set exact but makes every
  // INTERIOR reading "minus the distance to the nearest carve": the mouse's
  // ear dishes sit far from its snout-root sphere and the carved field at
  // that centre read -0.055 through 85 mm of flesh. And sdPrimitive on a
  // scaled ellipsoid is a conservative LOWER bound, so "clearance >= r" is
  // over-strict the other way. What the march actually relies on is that
  // every point OF the sphere is inside the carved body — so that is what is
  // sampled, in 26 directions.
  it('emits spheres strictly inside EVERY authored character', () => {
    const dirs: Vec3[] = [];
    for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
      if (!x && !y && !z) continue;
      const l = Math.hypot(x, y, z); dirs.push([x / l, y / l, z / l]);
    }
    for (const [name, src] of [['mouse', mouseSrc], ['clown', clownSrc], ['goblin', goblinSrc]] as const) {
      const doc = parseBlob(src);
      const b = buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS);
      for (const s of buildHullInstances([b]))
        for (const d of dirs) {
          const p: Vec3 = [s.centre[0] + d[0] * s.radius, s.centre[1] + d[1] * s.radius, s.centre[2] + d[2] * s.radius];
          expect(sdBody(p, b), `${name}: sphere r ${s.radius.toFixed(3)} at ${s.centre}, dir ${d}`).toBeLessThanOrEqual(1e-4);
        }
    }
  });

  it('sizes the far end of a tapered primitive from radiusB, not radius', () => {
    // A lone round cone, fat at a and thin at b. The b-sphere must fit the
    // thin end.
    const cone = {
      prims: [{
        a: [0, 0, 0] as Vec3, b: [0, 0, 0.3] as Vec3,
        radius: 0.10, radiusB: 0.04, scale: [1, 1, 1] as Vec3, blendK: 0,
        limb: body.prims[0]!.limb, cluster: 0,
      }],
      clusters: [{ ...body.clusters[0]!, id: 0, start: 0, count: 1, alive: true }],
      bones: body.bones,
    };
    const inst = buildHullInstances([cone]);
    const atB = inst.find((s) => s.centre[2] > 0.2)!;
    const atA = inst.find((s) => s.centre[2] < 0.1)!;
    expect(atA.radius).toBeCloseTo(0.10 * HULL_SHRINK, 6);
    expect(atB.radius).toBeCloseTo(0.04 * HULL_SHRINK, 6);
    for (const s of inst) expect(sdBody(s.centre, cone)).toBeLessThanOrEqual(-s.radius + 1e-4);
  });

  it('skips groove primitives, which are cutters', () => {
    const grooved = {
      ...body,
      prims: [...body.prims, {
        a: [0, 1.5, 0.1] as Vec3, b: [0, 1.5, 0.2] as Vec3,
        radius: 0.1, scale: [1, 1, 1] as Vec3, blendK: 0,
        limb: body.prims[0]!.limb, cluster: body.prims[0]!.cluster,
        op: 'groove' as const, grooveDepth: 0.01, grooveWidth: 0.01,
      }],
    };
    expect(buildHullInstances([grooved]).length).toBe(buildHullInstances([body]).length);
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

describe('shadow-caster hull', () => {
  // The owner rejected the figure's shadow casting as DISCONNECTED BLOBS
  // (2026-09-01). Cause: the shadow caster was the depth-occlusion hull, and
  // HULL_SHRINK 0.8 keeps every sphere conservatively INSIDE its primitive —
  // correct for occlusion (the march cuts rays at the hull), wrong for shadows
  // (gaps between shrunk spheres are gaps in the shadow map). A shadow caster
  // wants the opposite bias: inflation, so neighbouring spheres fuse into one
  // silhouette.
  it('inflates rather than shrinks — gaps between spheres become gaps in the shadow', () => {
    expect(SHADOW_HULL_INFLATE).toBeGreaterThan(1.0);
    expect(HULL_SHRINK).toBeLessThan(1.0);
  });

  it('shadow spheres are strictly larger than occlusion spheres for the same body', () => {
    // Compared per CENTRE, not per index: prims share endpoint centres (joints)
    // and the two hulls keep different sets of tiny prims (inflated radii clear
    // MIN_HULL_RADIUS where shrunk ones did not), so index i is not the same
    // sphere across the two hulls. The property that matters is per sphere:
    // same centre, strictly bigger radius.
    const occl = buildHullInstances([body], HULL_SHRINK, []);
    const shad = buildHullInstances([body], SHADOW_HULL_INFLATE, []);
    expect(shad.length).toBeGreaterThanOrEqual(occl.length);
    const biggest = (inst: ReturnType<typeof buildHullInstances>) => {
      const m = new Map<string, number>();
      for (const s of inst) {
        const k = `${s.centre}`;
        const r = m.get(k);
        if (r === undefined || s.radius > r) m.set(k, s.radius);
      }
      return m;
    };
    const occlR = biggest(occl);
    const shadR = biggest(shad);
    for (const [centre, r] of occlR) {
      const twin = shadR.get(centre);
      expect(twin, `shadow sphere at ${centre}`).toBeDefined();
      expect(twin!).toBeGreaterThan(r);
    }
  });

  it('the shadow mesh casts; the occlusion mesh does not', () => {
    // The split of duties, pinned where a camera test cannot see it: the
    // inflated hull exists ONLY to be rendered into the shadow map, and the
    // occlusion hull must stay a pure depth pre-pass.
    const hull = createOccluderHull();
    expect(hull.shadowObject.castShadow).toBe(true);
    expect(hull.object.castShadow).toBe(false);
    // Visible, because three only renders shadow casters that pass the
    // visibility test; layers, not visibility, keep it off the camera.
    expect(hull.shadowObject.visible).toBe(true);
    hull.dispose();
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

describe('the pre-pass ships DISABLED (2026-09-01 holes-at-range)', () => {
  // The hull this file builds is correct — every test above pins that, and
  // __sdfGame.hullInsideness confirms it on the live POSED bodies too. What
  // is not correct is the distance the pre-pass RASTERISES for it: measured
  // with one synthetic sphere of known geometry, it is exact below ~3 m and
  // then collapses (true 7.9 m reads 3.78, true 11.9 m reads 0.37), and the
  // error depends on distance alone, not on the sphere's size or its screen
  // footprint. march.wgsl.ts no longer clamps tMax by it for that reason.
  //
  // Rendering a pre-pass nothing consumes is pure cost, so all three entry
  // points ship it off. This is a source guard rather than a behavioural one
  // because the defect only exists on a GPU — nothing here compiles WGSL, so
  // a green suite is not evidence that the holes are gone. The evidence is
  // the before/after capture and the frame-time A/B in the commit.
  const entries: [string, string][] = [
    ['game-main.ts', gameMainSrc],
    ['lab-main.ts', labMainSrc],
    ['bench-main.ts', benchMainSrc],
  ];
  for (const [file, src] of entries) {
    it(`${file} does not enable the occluder pre-pass at startup`, () => {
      expect(src).toContain('sdfLayer.setOccluderEnabled(false);');
      // Two-space indent = module scope, i.e. the startup line. Deeper
      // indents are the diagnostics turning the pass on to read it back, and
      // those stay: they are how the bound gets re-measured.
      expect(src).not.toMatch(/\n {2}sdfLayer\.setOccluderEnabled\(true\);/);
    });
  }
});
