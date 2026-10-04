// src/lab/sdf-zombie/head-split-cpu.test.ts
//
// THE HEAD SPLIT'S CPU MIRROR (plan docs/superpowers/plans/2026-10-04-head-split-part-b.md, Task B2), on the real posed
// zombie. Two halves:
//   - sdBody honours `body.split` (head-split.ts splitField), so every strike, shot and trace sees the opened halves;
//   - a stamp takes its hit back to the UN-WARPED head first (damage.ts unwarpHit, cut-wound.ts unwarpCutSeg), where
//     wounds live and the GPU reads them: the prims are the closed head's, whatever the split does to the field.
// The harness tests run the real rod and axe leaves and a real actor against stub ctx / views (game-rod.test.ts,
// game-axe.test.ts and game-actor-first-wound.test.ts's patterns): no renderer, no WebGPU.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from './build-body';
import { makeZombie } from './body';
import { applyRig, bindRig, headQuatOf } from './rig-bind';
import { sdBody, sdGroove, sdPrimitive, smax, smin, sminChamfer, type Body } from './validate';
import {
  HEAD_SPLIT, choosePreset, makeSplitState, splitWarpOf, unwarpDir, unwarpPoint, type HeadFrame, type SplitWarp,
} from './head-split';
import { unwarpHit, woundDirToWorld, woundWorldPos, worldHitToWound, type Wound } from './damage';
import { resolveExplosion } from './explosion-aoe';
import { unwarpCutSeg } from './cut-wound';
import { add, cross, dot, len, normalize, scale, sub } from './vec';
import type { Vec3 } from './types';
import { headShape } from './webgpu/flame-anchors';
import { strikeActorsFrom } from './webgpu/flail-strike';
import { createRodHarness, type RodDeps } from './webgpu/game-rod';
import { createAxeHarness, type AxeDeps } from './webgpu/game-axe';
import { createZombieActor, type ZombieActor } from './webgpu/game-actor';
import { woundFromPellet, woundFromSlug } from './webgpu/game-weapon';
import { makeWeaponSlotState } from './webgpu/game-weapon-slots';
import type { GameContext } from './webgpu/game-context';
import flailSrc from './webgpu/game-flail.ts?raw';
import seamSrc from './webgpu/game-seams-fx.ts?raw';

const BODY = buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {});
const BOUND = bindRig(BODY);
/** The posed zombie, head closed (no `split` field at all: what every pose is until a leaf installs the hook). */
const CLOSED: BuildResult = applyRig(BODY, BOUND, 0);

/** The head's frame on a posed body. The radius is the skull's LARGEST semi-axis so the hold ball (rho) covers the
 *  whole cranium (headShape axes.x alone leaves the crown outside it: the plan's amendment after B1, B3's to size). */
function frameOf(posed: BuildResult): HeadFrame {
  const hs = headShape(posed)!;
  return { centre: hs.centre, quat: headQuatOf(BOUND, 0) ?? [0, 0, 0, 1], radius: Math.max(...hs.axes) };
}
/** The `middle` preset fully open on `frame` (a centred impact: both halves). */
function middleOpen(frame: HeadFrame): SplitWarp {
  const st = { ...makeSplitState(), ...choosePreset([1, 0, 0], [0, 0, 0.1], frame.radius) };
  return splitWarpOf({ ...st, angle: HEAD_SPLIT.presets.middle.maxBoth }, frame)!;
}
const FRAME = frameOf(CLOSED);
const SPLIT = middleOpen(FRAME);
const OPEN: BuildResult = { ...CLOSED, split: SPLIT };
const closedField = (p: Vec3) => sdBody(p, CLOSED);
const openField = (p: Vec3) => sdBody(p, OPEN);
const U = cross(SPLIT.n, SPLIT.a);

const dist = (a: Vec3, b: Vec3) => len(sub(a, b));
/** Deterministic uniform [0, 1) (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** sdBody as it was before the split (validate.ts, copied): the oracle for "no split changes nothing". */
function referenceBody(p: Vec3, body: Body): number {
  let d = 1e9;
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (const prim of body.prims.slice(c.start, c.start + c.count)) {
      if (prim.op === 'sub' || prim.op === 'groove' || prim.op === 'bone' || prim.op === 'organ' || prim.dead) continue;
      d = prim.blendProfile === 'chamfer' ? sminChamfer(d, sdPrimitive(p, prim), prim.blendK) : smin(d, sdPrimitive(p, prim), prim.blendK);
    }
  }
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (const prim of body.prims.slice(c.start, c.start + c.count)) {
      if (prim.dead) continue;
      if (prim.op === 'sub') d = smax(d, -sdPrimitive(p, prim), prim.blendK);
      else if (prim.op === 'groove') d = sdGroove(d, sdPrimitive(p, prim), prim.grooveDepth ?? 0, prim.grooveWidth ?? 0);
    }
  }
  return d;
}

/** Sphere-trace `field` from `o` along unit `d` to its surface. */
function surfaceAlong(field: (p: Vec3) => number, o: Vec3, d: Vec3): Vec3 {
  let t = 0;
  for (let i = 0; i < 600; i++) {
    const p = add(o, scale(d, t)), s = field(p);
    if (s < 1e-5) return p;
    t += Math.max(s * 0.9, 1e-5);
  }
  throw new Error('ray missed the body');
}
/** Head-local metres (the head frame is the identity at yaw 0) to world. */
const headPoint = (frame: HeadFrame, local: Vec3): Vec3 => add(frame.centre, local);
/** A point on the OPENED + half's (side +1) or - half's (side -1) outer skin: where the closed-head point `local` went
 *  when its half turned open, found by a ray along -n / +n from outside the split body. */
function openedSkin(split: SplitWarp, field: (p: Vec3) => number, frame: HeadFrame, side: 1 | -1, local: Vec3 = [0.04, 0.05, 0]): Vec3 {
  const q0 = headPoint(frame, [side * local[0], local[1], local[2]]);
  const theta = side > 0 ? split.thetaP : split.thetaM;
  const k = split.a, v = sub(q0, split.h), c = Math.cos(theta), s = Math.sin(theta);
  const moved = add(split.h, add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c))));
  return surfaceAlong(field, add(moved, scale(split.n, side * 0.4)), scale(split.n, -side));
}

describe('(a) no split: sdBody is what it was, bit for bit', () => {
  it('1000 random points: absent split, split null and split undefined all equal the pre-split fold', () => {
    const r = rng(0x5911);
    const off: string[] = [];
    for (let i = 0; i < 1000; i++) {
      // Half in the body's box, half round the head (where a split would act).
      const p: Vec3 = i % 2 === 0
        ? [(r() - 0.5) * 1.2, r() * 2 - 0.1, (r() - 0.5) * 1.0]
        : [FRAME.centre[0] + (r() - 0.5) * 0.5, FRAME.centre[1] + (r() - 0.5) * 0.5, FRAME.centre[2] + (r() - 0.5) * 0.5];
      const want = referenceBody(p, CLOSED);
      const got = [sdBody(p, CLOSED), sdBody(p, { ...CLOSED, split: null }), sdBody(p, { ...CLOSED, split: undefined })];
      if (!got.every(g => Object.is(g, want))) off.push(`${p.map(v => v.toFixed(3)).join(',')}: ${got.join(' ')} != ${want}`);
    }
    expect(off).toEqual([]);
  });
});

describe('(b) sdBody sees the split', () => {
  it('a point on the old plane above the hinge, inside the closed head, is in the open gap', () => {
    // 2 cm above the skull centre, on the plane: the middle of the closed skull.
    const p = add(FRAME.centre, scale(U, 0.02));
    expect(Math.abs(dot(SPLIT.n, p) - SPLIT.d0)).toBeLessThan(1e-9);
    expect(dot(U, sub(p, SPLIT.h))).toBeGreaterThan(0.05);
    expect(closedField(p)).toBeLessThan(-0.05);
    expect(openField(p)).toBeGreaterThan(0.01);
  });
  it('where each half went there is flesh now; where it was, beside the old plane, there is none', () => {
    for (const side of [1, -1] as const) {
      const was = add(add(FRAME.centre, scale(U, 0.05)), scale(SPLIT.n, side * 0.01));   // 1 cm off the plane, high in the skull
      expect(closedField(was)).toBeLessThan(-0.02);
      expect(openField(was)).toBeGreaterThan(0.01);
      const skin = openedSkin(SPLIT, openField, FRAME, side);
      const inside = add(skin, scale(SPLIT.n, -side * 0.01));   // 1 cm under the opened half's skin
      expect(openField(inside)).toBeLessThan(-0.002);
      expect(closedField(skin)).toBeGreaterThan(0.01);          // the closed head never reached here
    }
  });
  it('away from the head the split body is the closed body', () => {
    const r = rng(77);
    let n = 0;
    for (let i = 0; i < 200; i++) {
      // Round the torso and legs, outside the body and well outside the region sphere (the region shell bound C is
      // REGION_MARGIN + |dh - r|, far above the field out here).
      const p: Vec3 = [(r() - 0.5) * 0.6, r() * 1.1, (r() - 0.5) * 0.5];
      if (dist(p, SPLIT.h) <= SPLIT.r + 0.3 || closedField(p) < 0) continue;
      expect(openField(p)).toBe(closedField(p));
      n++;
    }
    expect(n).toBeGreaterThan(50);
  });
});

describe('(c) a point on an opened half un-warps onto the closed head', () => {
  it('unwarpPoint with the closed body field: the + half is piece 1, the - half piece 2, both land on the closed skin', () => {
    for (const side of [1, -1] as const) {
      const p = openedSkin(SPLIT, openField, FRAME, side);
      const u = unwarpPoint(SPLIT, p, closedField);
      expect(u.piece).toBe(side > 0 ? 1 : 2);
      expect(Math.abs(closedField(u.q))).toBeLessThan(2e-3);
      expect(dist(u.q, p)).toBeGreaterThan(0.02);   // it really moved
      // damage.ts unwarpHit is the same point, with the closed field and the piece's direction map.
      const h = unwarpHit(OPEN, p);
      expect(h.hit).toEqual(u.q);
      expect(h.piece).toBe(u.piece);
      const q2: Vec3 = [u.q[0] + 0.013, u.q[1] - 0.02, u.q[2] + 0.007];
      expect(h.field(q2)).toBe(closedField(q2));
      expect(h.dir([0, 0, 1])).toEqual(unwarpDir(SPLIT, u.piece, [0, 0, 1]));
    }
  });
  it('a point on the unmoved body (the chest) stays where it is', () => {
    const chest = surfaceAlong(openField, [0, 1.2, 1], [0, 0, -1]);
    const h = unwarpHit(OPEN, chest);
    expect(h.piece).toBe(0);
    expect(h.hit).toBe(chest);
  });
  it('no split: the hit, the field and directions pass through untouched', () => {
    const p: Vec3 = [0.03, 1.66, 0.2], v: Vec3 = [0, 0, -1];
    const h = unwarpHit(CLOSED, p);
    expect(h.hit).toBe(p);
    expect(h.piece).toBe(0);
    expect(h.dir(v)).toBe(v);
    expect(h.field(p)).toBe(closedField(p));
    const seg = { a: [0, 1.6, 0.2] as Vec3, b: [0.05, 1.65, 0.2] as Vec3, view: v };
    expect(unwarpCutSeg(CLOSED, seg).seg).toBe(seg);
  });
});

type Blast = { wounds: readonly Wound[] };
function stubActor(id: number, posed: BuildResult) {
  const blasts: Blast[] = [];
  const actor = { id, posed: () => posed, pose: () => ({ pos: [0, 0, 0] as Vec3, yaw: 0 }), blast: (e: Blast) => { blasts.push(e); } };
  return { actor: actor as unknown as ZombieActor, blasts };
}
const made: { dispose(): void }[] = [];
afterEach(() => { for (const r of made.splice(0)) r.dispose(); });

describe('(d) a cut through an opened half is stamped in the un-warped head', () => {
  it('unwarpCutSeg: one rigid motion for the whole segment (its midpoint\'s piece); length and view angle kept', () => {
    const p = openedSkin(SPLIT, openField, FRAME, 1);
    const t = SPLIT.a, view = scale(SPLIT.n, -1);
    const seg = { a: sub(p, scale(t, 0.04)), b: add(p, scale(t, 0.04)), view };
    const u = unwarpCutSeg(OPEN, seg);
    const q = unwarpPoint(SPLIT, p, closedField).q;
    expect(dist(scale(add(u.seg.a, u.seg.b), 0.5), q)).toBeLessThan(1e-9);
    expect(dist(u.seg.a, u.seg.b)).toBeCloseTo(0.08, 9);
    expect(dist(u.seg.view, unwarpDir(SPLIT, 1, view))).toBeLessThan(1e-12);
    // The hinge axis is the rotation's own axis: a segment along it keeps its direction.
    expect(dot(normalize(sub(u.seg.b, u.seg.a)), t)).toBeCloseTo(1, 9);
    expect(u.field(q)).toBe(closedField(q));
  });

  it('the rod: the cut lands, by woundWorldPos on the closed prims, where unwarpPoint sent its midpoint', () => {
    const s = stubActor(7, OPEN);
    const ctx = {
      weapon: { aimRig: new THREE.Group(), slotState: makeWeaponSlotState('rod') },
      player: { player: { yaw: 0, pitch: 0 } },
      world: { actors: [s.actor], loop: null, sequence: null },
      boot: { canvas: {} },
      telemetry: { telemetry: { event: vi.fn() } },
    };
    const bleed = vi.fn();
    const deps: RodDeps = { traceMelee: () => ({ actorId: -1, hit: null }), eye: () => [1, 1.6, 0.1], aimDir: () => [-1, 0, 0], bleed };
    const rod = createRodHarness(ctx as unknown as GameContext, deps);
    made.push(rod);
    for (const side of [1, -1] as const) {
      const p = openedSkin(SPLIT, openField, FRAME, side);
      const t = SPLIT.a, view = scale(SPLIT.n, -side);
      const a = sub(p, scale(t, 0.04)), b = add(p, scale(t, 0.04));
      expect(rod.cut(7, a, b, view)).toBe(1);
      const w = s.blasts[s.blasts.length - 1]!.wounds[0]!;
      expect(w.shape).toBe('cut');
      const u = unwarpPoint(SPLIT, p, closedField);
      const back = woundWorldPos(CLOSED.prims, w, 0);
      expect(dist(back, u.q)).toBeLessThan(1e-3);
      expect(dist(back, p)).toBeGreaterThan(0.02);              // not where the warped point is
      expect(CLOSED.prims[w.primIdx]!.limb).toBe('head');
      // The slot runs along the un-warped segment, and cuts INTO the closed head (its inward axis is the un-warped view's side).
      const along = woundDirToWorld(CLOSED.prims, w, w.cutDir!, 0);
      expect(Math.abs(dot(normalize(along), unwarpDir(SPLIT, u.piece, t)))).toBeGreaterThan(0.95);
      const inward = normalize(woundDirToWorld(CLOSED.prims, w, w.carveN!, 0));
      expect(closedField(add(back, scale(inward, 0.02)))).toBeLessThan(-0.01);
      // The blood is a world effect: it keeps the world midpoint and view.
      const call = bleed.mock.calls[bleed.mock.calls.length - 1]!;
      expect(dist(call[2] as Vec3, p)).toBeLessThan(1e-9);
      expect(call[3]).toEqual(view);
    }
  });

  it('the axe: a head chop on an opened half leaves its cut where the hit un-warps to', () => {
    const s = stubActor(7, OPEN);
    const ctx = {
      weapon: { aimRig: new THREE.Group(), viewModelAnchor: new THREE.Group(), slotState: makeWeaponSlotState('axe') },
      player: { player: { yaw: 0, pitch: 0 } },
      world: { actors: [s.actor], loop: null, sequence: null },
      boot: { canvas: {}, deferredApi: null },
      telemetry: { telemetry: { event: vi.fn() } },
    };
    // The eye beside the head, on the + side: the chop meets the + half's outer skin.
    const eye: Vec3 = [1.2, 1.66, 0.1];
    const deps: AxeDeps = { eye: () => eye, aimDir: () => [-1, 0, 0], bleed: vi.fn() };
    const axe = createAxeHarness(ctx as unknown as GameContext, deps);
    made.push(axe);
    expect(axe.chop(7, 'H', 'head')).toBe(1);
    const point = axe.debug().last!.points[0]!;
    expect(Math.abs(openField(point))).toBeLessThan(0.01);      // on the split body's skin
    const u = unwarpPoint(SPLIT, point, closedField);
    expect(u.piece).toBe(1);
    expect(dist(u.q, point)).toBeGreaterThan(0.02);
    const w = s.blasts[0]!.wounds[0]!;
    expect(w.shape).toBe('cut');
    expect(w.headRegion).toBe('axe-1');
    expect(CLOSED.prims[w.primIdx]!.limb).toBe('head');
    const back = woundWorldPos(CLOSED.prims, w, 0);
    // The strike's snap leaves up to its residual (flail-strike.ts residualEps); stampCut then walks onto the skin.
    expect(dist(back, u.q)).toBeLessThan(5e-3);
    expect(Math.abs(closedField(back))).toBeLessThan(1e-3);
  });
});

describe('(e) the strike list carries the split', () => {
  it('the head magnet\'s head field is sdBody over the head clusters WITH the split; the body field is the posed body\'s', () => {
    const s = strikeActorsFrom([{ id: 1, posed: () => OPEN }])[0]!;
    const headClusters = OPEN.clusters.filter(c => c.limb === 'head' && c.alive);
    const headBody: Body = { prims: OPEN.prims, clusters: headClusters, split: SPLIT };
    const r = rng(0xe5);
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [FRAME.centre[0] + (r() - 0.5) * 0.6, FRAME.centre[1] + (r() - 0.5) * 0.6, FRAME.centre[2] + (r() - 0.5) * 0.6];
      expect(s.head!.field(p)).toBe(sdBody(p, headBody));
      expect(s.field(p)).toBe(openField(p));
    }
    // Not vacuous: the head field has the gap.
    const gap = add(FRAME.centre, scale(U, 0.02));
    expect(s.head!.field(gap)).toBeGreaterThan(0.01);
    expect(sdBody(gap, { prims: OPEN.prims, clusters: headClusters })).toBeLessThan(-0.05);
  });
  it('a closed body: no split on the head field', () => {
    const s = strikeActorsFrom([{ id: 1, posed: () => CLOSED }])[0]!;
    const headClusters = CLOSED.clusters.filter(c => c.limb === 'head' && c.alive);
    const gap = add(FRAME.centre, scale(U, 0.02));
    expect(s.head!.field(gap)).toBe(sdBody(gap, { prims: CLOSED.prims, clusters: headClusters }));
  });
});

describe('(g) a blast beside an opened half', () => {
  it('resolveExplosion traces the split body and stamps each wound at its un-warped hit', () => {
    // Above and beside the head on the + side: the nearest skin is the + half, turned out toward the blast.
    const at: Vec3 = [0.4, 1.8, 0.05];
    const fx = resolveExplosion(at, [{ id: 'z', body: OPEN }]).perBody[0]!;
    const near = fx.rigImpulse!.at;                    // the nearest hit, in world (the shove keeps the world point)
    expect(Math.abs(openField(near))).toBeLessThan(0.02);
    const u = unwarpHit(OPEN, near);
    expect(u.piece).toBe(1);
    expect(dist(u.hit, near)).toBeGreaterThan(0.02);
    const got = fx.wounds[0]!;
    const want = worldHitToWound(OPEN.prims, u.hit, got.radius, 'blast', 0, closedField);
    expect(got.primIdx).toBe(want.primIdx);
    expect(got.local).toEqual(want.local);
    expect(got.carveDepth).toBe(want.carveDepth);
    expect(OPEN.prims[got.primIdx]!.limb).toBe('head');
    // No head wound is left out in the air where only the opened half is: on the closed prims each sits on the
    // closed head's skin (the resolver's traces stop within its traceEps of the surface).
    const heads = fx.wounds.filter(w => OPEN.prims[w.primIdx]!.limb === 'head');
    expect(heads.length).toBeGreaterThan(2);
    for (const w of heads) expect(Math.abs(closedField(woundWorldPos(CLOSED.prims, w, 0)))).toBeLessThan(4e-3);
  });
});

describe('(h) the leaves with no harness here stamp through unwarpHit too (source pins)', () => {
  it('the flail\'s body crater and its head-region read; the dev stampWoundAt seam', () => {
    expect(flailSrc).toContain('const u = unwarpHit(posed, h.point);');
    expect(flailSrc).toContain("const probe = worldHitToWound(posed.prims, u.hit, FLAIL_FEEL.craterR, 'blast', yaw, u.field);");
    expect(flailSrc).toContain('isHeadRegion(posed.prims[probe.primIdx]?.limb, u.hit, headC, neck?.root ?? null)');
    expect(flailSrc).toContain("worldHitToWound(posed.prims, u.hit, spec.radius, 'blast', yaw, u.field)");
    expect(flailSrc).not.toMatch(/worldHitToWound\(posed\.prims, h\.point/);
    expect(seamSrc).toContain('const u = unwarpHit(posed, hit);');
    expect(seamSrc).toContain('woundFromSlug(posed.prims, u.hit, u.field, yaw)');
    expect(seamSrc).toContain('woundFromPellet(posed.prims, u.hit, yaw, u.field)');
  });
});

/** A fresh actor that has never stepped, with a view that swallows every call. */
function freshActor() {
  const view = new Proxy({}, { get: () => () => {} });
  return createZombieActor({ id: 1, room: 0, body: buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {}), view: view as never,
    start: [0, 0, 0], seed: 3, bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, furniture: [] });
}

describe('(f) the actor: the split hook, unwarp, and the gun paths', () => {
  it('setHeadSplit: posed() carries the hook\'s split after a re-pose, over the closed head\'s own prims; null removes it', () => {
    const actor = freshActor();
    const before = actor.posed();
    expect('split' in before).toBe(false);
    const split = middleOpen(frameOf(before));
    const seen: BuildResult[] = [];
    actor.setHeadSplit((p) => { seen.push(p); return split; });
    actor.reposeHead();
    const posed = actor.posed();
    expect(posed.split).toBe(split);
    expect(seen).toHaveLength(1);
    expect('split' in seen[0]!).toBe(false);          // the hook is handed the un-split pose
    expect(posed.prims).toEqual(before.prims);
    const gap = add(frameOf(before).centre, scale(cross(split.n, split.a), 0.02));
    expect(sdBody(gap, before)).toBeLessThan(-0.05);
    expect(sdBody(gap, posed)).toBeGreaterThan(0.01);
    // A hook that returns null (a closed head) leaves the pose as it is: no `split` key.
    actor.setHeadSplit(() => null);
    actor.reposeHead();
    expect('split' in actor.posed()).toBe(false);
    actor.setHeadSplit(null);
    actor.reposeHead();
    expect('split' in actor.posed()).toBe(false);
    expect(actor.posed().prims).toEqual(before.prims);
  });

  it('unwarp(p): unwarpPoint on the posed split with the closed body field; the identity when closed', () => {
    const actor = freshActor();
    const p0: Vec3 = [0.05, 1.7, 0.1];
    expect(actor.unwarp(p0)).toEqual({ q: p0, piece: 0 });
    const frame = frameOf(actor.posed());
    const split = middleOpen(frame);
    actor.setHeadSplit(() => split);
    actor.reposeHead();
    const posed = actor.posed();
    const closed = (q: Vec3) => sdBody(q, { ...posed, split: null });
    const p = openedSkin(split, q => sdBody(q, posed), frame, 1);
    const u = actor.unwarp(p);
    expect(u).toEqual(unwarpPoint(split, p, closed));
    expect(u.piece).toBe(1);
    expect(Math.abs(closed(u.q))).toBeLessThan(2e-3);
  });

  for (const kind of ['pellet', 'slug'] as const) {
    it(`a ${kind} into an opened half is stamped at the un-warped hit, with the closed body field`, () => {
      const actor = freshActor();
      const frame = frameOf(actor.posed());
      const split = middleOpen(frame);
      actor.setHeadSplit(() => split);
      actor.reposeHead();
      const posed = actor.posed(), yaw = actor.pose().yaw;
      const closed = (q: Vec3) => sdBody(q, { ...posed, split: null });
      const p = openedSkin(split, q => sdBody(q, posed), frame, -1);
      const q = unwarpPoint(split, p, closed).q;
      expect(dist(q, p)).toBeGreaterThan(0.02);
      const want = kind === 'pellet' ? woundFromPellet(posed.prims, q, yaw, closed) : woundFromSlug(posed.prims, q, closed, yaw);
      const got = kind === 'pellet' ? actor.hit(p, [1, 0, 0])! : actor.hitSlug(p, [1, 0, 0])!;
      expect(got.primIdx).toBe(want.primIdx);
      expect(posed.prims[got.primIdx]!.limb).toBe('head');
      expect(got.local).toEqual(want.local);
      expect(got.carveDepth).toBe(want.carveDepth);
      expect(got.carveN).toEqual(want.carveN);
      expect(got.rimScale).toBe(want.rimScale);
      // On the closed prims the wound sits on the closed head's skin, not out where the half now is.
      const back = woundWorldPos(posed.prims, { ...got, local: want.local }, yaw);
      expect(Math.abs(closed(back))).toBeLessThan(2e-3);
    });
  }
});
