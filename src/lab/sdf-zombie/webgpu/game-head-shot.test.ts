// @vitest-environment happy-dom
// src/lab/sdf-zombie/webgpu/game-head-shot.test.ts
//
// What a gun round does to a zombie's head: the head-shot leaf against the real head split leaf, the real head damage
// leaf and a real actor, on a stub ctx and a view that swallows every call (no renderer, no WebGPU); and the actor's
// own half, the pop and the decapitation that asks first.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { makeZombie } from '../body';
import { parseBlob } from '../blob-parse';
import { compileBlob } from '../blob-compile';
import { characterEntry, characterNames } from '../character-registry';
import { isGoreBody } from '../motion-profile';
import { sdBody } from '../validate';
import type { Primitive, Vec3 } from '../types';
import type { ShotProvenance, Wound } from '../damage';
import type { GameContext } from './game-context';
import { createZombieActor, type ZombieActor } from './game-actor';
import { createHeadDamage } from './game-head-damage';
import { createHeadSplit } from './game-head-split';
import { createHeadShot, slugSplitNormal } from './game-head-shot';
import { BURST, BURST_TUNING_DEFAULTS, decapitationRule, headRadius, hsOf, onHeadPrim, setBurstTuning } from '../head-burst';
import { headAlive, headShape } from './flame-anchors';
import { headQuatOf } from '../rig-bind';
import { rotate, type Quat } from '../head-deform';
import { traceRaySurface } from './flail-strike';
import { spawnSlug, stepProjectiles, traceProjectile, woundFromSlug } from './game-weapon';
import { HUMANOIDS } from './skeleton-spike/skull-cast';
import tickSrc from './game-tick.ts?raw';
import spawnSrc from './game-spawn.ts?raw';

afterEach(() => setBurstTuning({ ...BURST_TUNING_DEFAULTS }));

interface Hooks {
  pops: { head: { origin: Vec3; prims: Primitive[] }; dir: Vec3; stump: Wound | null }[];
  severed: string[];
}
/** `character`: a registry character in place of the plain zombie body, on its own motion profile and under its own
 *  name, as game-spawn.ts makes it. */
function fixture(o: { decapitate?: (c: { weapon: 'slug' | 'pellet' | 'other' }) => number | null; character?: string } = {}) {
  const hooks: Hooks = { pops: [], severed: [] };
  const view = new Proxy({}, { get: () => () => {} });
  const entry = o.character ? characterEntry(o.character) : null;
  const a: ZombieActor = createZombieActor({
    id: 1, room: 0, view: view as never,
    body: entry ? buildBody(compileBlob(parseBlob(entry.src)), DEFAULT_BUILD_OPTS) : buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {}),
    ...(entry ? { profile: entry.profile, characterName: entry.name } : {}),
    start: [0, 0, 0], seed: 3, bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, furniture: [],
    onSever: piece => { hooks.severed.push(piece.limb); },
    onHeadPop: (head, dir, stump) => { hooks.pops.push({ head, dir, stump }); },
    onDecapitate: o.decapitate ?? (({ weapon }) => decapitationRule(weapon)),
  });
  const ctx = { world: { actors: [a] }, demo: { wanderFrozen: true }, render: { frozenHullBuilt: true } } as unknown as GameContext;
  const damage = createHeadDamage(ctx, { headShape, gore: vi.fn(), burst: vi.fn(), bleed: vi.fn(), splitOpen: q => split.isOpen(q) });
  const split = createHeadSplit(ctx, { headDamaged: q => damage.has(q) });
  const opening = vi.fn((q: ZombieActor, p: Vec3, d: Vec3, s: undefined, k: 'pellet' | 'slug') => damage.burst(q, p, d, s, k));
  const bleed = vi.fn();
  const leaf = createHeadShot(ctx, { headShape, split, headDamaged: q => damage.has(q), opening: opening as never, bleed });
  const posed = a.posed();
  const c = headShape(posed)!.centre;
  /** Where a round along `dir`, through the point `off` from the head's centre, meets the posed body. */
  const on = (dir: Vec3, off: Vec3 = BROW): Vec3 => {
    const body = a.posed();
    const from: Vec3 = [c[0] + off[0] - dir[0] * 0.6, c[1] + off[1] - dir[1] * 0.6, c[2] + off[2] - dir[2] * 0.6];
    return traceRaySurface(q => sdBody(q, body), from, dir, 1.2)!;
  };
  /** A slug's provenance: fired with the crosshair on the point `off` from the head's centre, from an eye `dist` m
   *  back along `dir` from that point. The slug itself lands wherever the test puts it (on()). */
  const aimed = (dir: Vec3, off: Vec3 = [0, 0, 0], dist = 2): ShotProvenance => ({
    weapon: 'slug', aim: { eye: [c[0] + off[0] - dir[0] * dist, c[1] + off[1] - dir[1] * dist, c[2] + off[2] - dir[2] * dist], dir },
  });
  /** One slug along `dir`: it lands where a round through `land` (from the head's centre) meets the body, and was
   *  fired with the crosshair on `aim` (from the centre) from `dist` m. */
  const slug = (dir: Vec3, o: { land?: Vec3; aim?: Vec3; dist?: number } = {}): boolean =>
    leaf.hit(a, on(dir, o.land ?? BROW), dir, aimed(dir, o.aim, o.dist), 'slug');
  return { a, ctx, leaf, split, damage, hooks, opening, bleed, on, aimed, slug, centre: c, axes: headShape(posed)!.axes, radius: headRadius(headShape(posed)!.axes), halfWidth: headShape(posed)!.axes[0] };
}
const FRONT: Vec3 = [0, 0, -1], SIDE: Vec3 = [-1, 0, 0];
/** The rounds land 3 cm over the head's centre unless a test says otherwise: the brow from in front, the temple from
 *  the side. Where a round lands and where its crosshair was are separate things here, as they are for the gun. */
const BROW: Vec3 = [0, 0.03, 0];
/** A slug on the jaw, well under the crosshair and to one side. (The gun's own aimed slug lands lower still: "the
 *  gun's real landing" below.) */
const CHIN: Vec3 = [0.03, -0.065, 0];

/** THE GUN'S MUZZLE AGAINST THE EYE, in the aim's own frame (right, up, forward; metres), with the gun at rest. Read
 *  off the running game: the mean of six real fire()s at 1 to 4.9 m on the ring page (the loaded gun's two muzzle
 *  nodes, game-weapon-rig.ts muzzleWorld; they agreed to 2 mm). */
const MUZZLE: Vec3 = [0.0283, -0.1117, 0.6177];
/** game-weapon-rig.ts AIM_CONVERGE_M: the slug leaves toward the point of the crosshair's ray this far out. */
const CONVERGE_M = 8;
/** The head as it is posed now: its frame, and the direction its face looks along the floor. */
function headNow(f: ReturnType<typeof fixture>) {
  const shape = headShape(f.a.posed())!;
  const quat = (headQuatOf(f.a.boundRig(), f.a.pose().yaw) ?? [0, 0, 0, 1]) as Quat;
  const face = rotate(quat, [0, 0, 1]), l = Math.hypot(face[0], face[2]) || 1;
  return { frame: { centre: shape.centre, axes: shape.axes, quat }, face: [face[0] / l, 0, face[2] / l] as Vec3 };
}
/** ONE REAL AIMED SLUG at the fixture's zombie, flown as the game flies it (spawnSlug from the muzzle down the
 *  converged ray, stepProjectiles at 60 Hz, traceProjectile against the posed body): fired from `dist` m in front of
 *  the face, the eye level with the crosshair, the crosshair on the point `aim` from the head's centre (x to the
 *  shooter's right, y up). Returns where it lands, its direction there, the provenance it carries, how far under
 *  the head's centre it landed and how far out in the head ellipsoid's units (|hs|, 1 on the ellipsoid). Null when
 *  the slug meets no flesh. */
function gunSlug(f: ReturnType<typeof fixture>, dist: number, aim: Vec3 = [0, 0, 0]) {
  const { frame, face } = headNow(f);
  const fwd: Vec3 = [-face[0], 0, -face[2]], right: Vec3 = [-fwd[2], 0, fwd[0]], up: Vec3 = [0, 1, 0];
  const v3 = (f: (k: 0 | 1 | 2) => number): Vec3 => [f(0), f(1), f(2)];
  const target = v3(k => frame.centre[k] + right[k] * aim[0] + up[k] * aim[1]);
  const eye = v3(k => target[k] - fwd[k] * dist);
  const muzzle = v3(k => eye[k] + right[k] * MUZZLE[0] + up[k] * MUZZLE[1] + fwd[k] * MUZZLE[2]);
  const to = v3(k => eye[k] + fwd[k] * CONVERGE_M - muzzle[k]), l = Math.hypot(...to);
  const p = spawnSlug(muzzle, [to[0] / l, to[1] / l, to[2] / l], { eye, dir: fwd });
  const body = f.a.posed();
  for (let i = 0; i < 240; i++) {
    const from = [...p.pos] as Vec3;
    stepProjectiles([p], 1 / 60);
    const hit = traceProjectile(from, p.pos, q => sdBody(q, body));
    if (!hit) continue;
    const v = Math.hypot(...p.vel);
    return { point: hit, dir: v3(k => p.vel[k] / v), shot: p.shot!, under: frame.centre[1] - hit[1], reach: Math.hypot(...hsOf(frame, hit)), frame };
  }
  return null;
}

describe('the head-shot leaf: ordinary rounds', () => {
  it('a pellet on the head is left to the caller, and nothing about the head changes', () => {
    const f = fixture();
    expect(f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'pellet')).toBe(false);
    expect(f.split.isOpen(f.a)).toBe(false);
    expect(f.damage.has(f.a)).toBe(false);
    expect(f.a.wounds()).toHaveLength(0);
    expect(f.opening).not.toHaveBeenCalled();
    expect(f.leaf.last(f.a.id)).toMatchObject({ rule: 'ordinary', kind: 'pellet', aimOffset: null, rangeM: null, took: false });
  });
  it('an IMPRECISE slug is ordinary: the crosshair 5 cm beside the head\'s centre, wherever the slug itself lands', () => {
    for (const land of [BROW, CHIN]) {
      const f = fixture();
      expect(f.slug(FRONT, { land, aim: [0.05, 0, 0] })).toBe(false);
      const v = f.leaf.last(f.a.id)!;
      expect(v).toMatchObject({ rule: 'ordinary', kind: 'slug', took: false });
      expect(v.aimOffset!).toBeCloseTo(0.05 / f.radius, 3);
      expect(v.aimOffset!).toBeGreaterThan(BURST_TUNING_DEFAULTS.splitFrac);
      expect(f.split.isOpen(f.a)).toBe(false);
    }
  });
  it('a precise slug from BEYOND splitRangeM is ordinary; the same aim from inside it splits', () => {
    const far = fixture();
    expect(far.slug(FRONT, { dist: BURST_TUNING_DEFAULTS.splitRangeM + 1 })).toBe(false);
    expect(far.leaf.last(far.a.id)).toMatchObject({ rule: 'ordinary', took: false });
    expect(far.leaf.last(far.a.id)!.aimOffset!).toBeCloseTo(0, 6);
    expect(far.leaf.last(far.a.id)!.rangeM!).toBeCloseTo(BURST_TUNING_DEFAULTS.splitRangeM + 1, 6);
    expect(far.split.isOpen(far.a)).toBe(false);
    const near = fixture();
    expect(near.slug(FRONT, { dist: BURST_TUNING_DEFAULTS.splitRangeM - 0.5 })).toBe(true);
    expect(near.leaf.last(near.a.id)!.rule).toBe('split');
  });
  it('a slug that carries no aim is ordinary: nothing but a crosshair makes a shot precise', () => {
    const f = fixture();
    expect(f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'slug')).toBe(false);
    expect(f.leaf.hit(f.a, f.on(FRONT), FRONT, { weapon: 'slug', shotId: 4 }, 'slug')).toBe(false);
    expect(f.leaf.last(f.a.id)).toMatchObject({ rule: 'ordinary', aimOffset: null, rangeM: null, took: false });
    expect(f.split.isOpen(f.a)).toBe(false);
  });
  it('a round on the torso is not judged at all', () => {
    const f = fixture();
    const torso = f.on(FRONT, [0, -0.45, 0]);
    expect(f.leaf.hit(f.a, torso, FRONT, f.aimed(FRONT), 'slug')).toBe(false);
    expect(f.leaf.last(f.a.id)).toBeNull();
  });
  it('switched off, a precise slug is ordinary', () => {
    const f = fixture();
    setBurstTuning({ on: false });
    expect(f.slug(FRONT)).toBe(false);
    expect(f.split.isOpen(f.a)).toBe(false);
  });
});

describe('the slug split', () => {
  it('a precise slug from the front opens the head left and right, to the full angle, and the zombie keeps its head', () => {
    const f = fixture();
    expect(f.slug(FRONT)).toBe(true);
    expect(f.leaf.last(f.a.id)).toMatchObject({ rule: 'split', kind: 'slug', took: true });
    const st = f.split.state(f.a.id)!;
    expect(st.preset).toBe('middle');
    expect(st.sides).toBe(0);
    // Sprung toward the preset's full angle, as the axe's second chop leaves it.
    for (let i = 0; i < 240; i++) f.split.tick(1 / 60);
    const settled = f.split.state(f.a.id)!;
    expect(settled.target).toBeGreaterThan(0);
    expect(settled.angle).toBeCloseTo(settled.target, 2);
    expect(headAlive(f.a.posed())).toBe(true);
    // The split's cut faces are the slug's wound, and they bleed.
    expect(f.a.wounds().filter(w => w.headRegion === 'split+' || w.headRegion === 'split-').length).toBeGreaterThan(0);
    expect(f.bleed).toHaveBeenCalled();
    expect(f.hooks.pops).toHaveLength(0);
  });
  it('precise is the crosshair\'s: the slug lands on the jaw, well under the centre and off to a side, and still splits', () => {
    const f = fixture();
    expect(f.slug(FRONT, { land: CHIN, aim: [0.01, 0.02, 0] })).toBe(true);
    const v = f.leaf.last(f.a.id)!;
    expect(v.rule).toBe('split');
    expect(v.aimOffset!).toBeLessThan(BURST_TUNING_DEFAULTS.splitFrac);
    // The slug's own line ran far wider than the aim, and far wider than splitFrac.
    expect(v.offset).toBeGreaterThan(2 * BURST_TUNING_DEFAULTS.splitFrac);
    expect(v.rangeM!).toBeCloseTo(Math.hypot(2, 0.01, 0.02), 2);
  });
  it('BOTH HALVES OPEN for a precise slug from the front, wherever it lands: the split is laid on the head\'s middle line', () => {
    // Slugs that land well to one side of the middle line (past bothFrac of the half-width, where an axe chop peels
    // one half), on either side, high and low.
    for (const land of [[0.05, 0.03, 0], [-0.05, 0.03, 0], [0.036, -0.06, 0], CHIN] as Vec3[]) {
      const f = fixture();
      expect(Math.abs(land[0])).toBeGreaterThan(0.15 * f.halfWidth);
      expect(f.slug(FRONT, { land }), JSON.stringify(land)).toBe(true);
      const st = f.split.state(f.a.id)!;
      expect(st).toMatchObject({ preset: 'middle', sides: 0, offset: 0 });
      // Two cut faces, one per opened half.
      expect(f.a.wounds().filter(w => w.headRegion === 'split+')).toHaveLength(1);
      expect(f.a.wounds().filter(w => w.headRegion === 'split-')).toHaveLength(1);
      // Both halves of the pose turn, by the same angle, opposite ways.
      for (let i = 0; i < 240; i++) f.split.tick(1 / 60);
      f.a.reposeHead();
      const w = f.a.posed().split!;
      expect(w.thetaP).toBeGreaterThan(0.3);
      expect(w.thetaM).toBeCloseTo(-w.thetaP, 9);
    }
  });
  it('splitAim slug is the split as it was: judged on the slug\'s own line, laid through where it landed (one half off the middle line)', () => {
    setBurstTuning({ splitAim: 'slug', splitFrac: 1.25, splitRangeM: 0, popPrecise: true });
    const f = fixture();
    // No aim at all on this slug, and it lands 5 cm to one side.
    expect(f.leaf.hit(f.a, f.on(FRONT, [0.05, 0.03, 0]), FRONT, undefined, 'slug')).toBe(true);
    const st = f.split.state(f.a.id)!;
    expect(st.preset).toBe('middle');
    expect(st.sides).not.toBe(0);
    expect(Math.abs(st.offset)).toBeGreaterThan(0);
    // And a crosshair dead on the centre does not make a wide slug split there.
    setBurstTuning({ splitFrac: 0.3 });
    const g = fixture();
    expect(g.slug(FRONT, { land: [0.07, 0, 0], aim: [0, 0, 0] })).toBe(false);
    expect(g.leaf.last(g.a.id)!.offset).toBeGreaterThan(0.3);
  });
  it('the opening fraction is the tuning\'s', () => {
    const full = fixture();
    full.slug(FRONT);
    const half = fixture();
    setBurstTuning({ splitOpen: 0.5 });
    half.slug(FRONT);
    expect(half.split.state(half.a.id)!.target).toBeCloseTo(full.split.state(full.a.id)!.target * 0.5, 5);
  });
  it('a precise slug from the side takes the face preset, as before: the plane holds the shot and the head\'s up axis', () => {
    const f = fixture();
    expect(f.slug(SIDE)).toBe(true);
    expect(f.split.state(f.a.id)!.preset).toBe('face');
    // The face comes off where the slug landed, as it did when the split was handed the impact.
    setBurstTuning({ splitAim: 'slug', splitFrac: 1.25, splitRangeM: 0 });
    const g = fixture();
    expect(g.leaf.hit(g.a, g.on(SIDE), SIDE, undefined, 'slug')).toBe(true);
    expect(f.split.state(f.a.id)).toMatchObject({ preset: 'face', sides: g.split.state(g.a.id)!.sides });
    expect(f.split.state(f.a.id)!.offset).toBeCloseTo(g.split.state(g.a.id)!.offset, 9);
    expect(slugSplitNormal(FRONT, [0, 0, 0, 1]).map(v => Math.abs(v))).toEqual([1, 0, 0]);
    expect(slugSplitNormal(SIDE, [0, 0, 0, 1]).map(v => Math.abs(v))).toEqual([0, 0, 1]);
    // Straight down the up axis there is no such plane: left and right.
    expect(slugSplitNormal([0, -1, 0], [0, 0, 0, 1])).toEqual([1, 0, 0]);
  });
  it('an earlier ordinary slug wound on the head does not stop a later precise slug from splitting it', () => {
    const f = fixture();
    const wide = f.on(FRONT, [0.07, 0.02, 0]);
    expect(f.leaf.hit(f.a, wide, FRONT, f.aimed(FRONT, [0.07, 0.1, 0]), 'slug')).toBe(false);
    f.a.hitSlug(wide, FRONT);
    expect(f.a.wounds().length).toBeGreaterThan(0);
    if (!headAlive(f.a.posed())) throw new Error('fixture: one slug took the head off');
    expect(f.slug(FRONT)).toBe(true);
    expect(f.split.isOpen(f.a)).toBe(true);
  });
  it('a head the flail has damaged is refused by the split: the precise slug is ordinary', () => {
    const f = fixture();
    expect(f.damage.hit(f.a, f.on(FRONT, [0, 0.03, 0]), FRONT, { meterCredit: 0.1, shove: 5, side: 'R' })).toBe(true);
    expect(f.slug(FRONT)).toBe(false);
    expect(f.leaf.last(f.a.id)).toMatchObject({ rule: 'ordinary', took: false });
    expect(f.split.isOpen(f.a)).toBe(false);
  });
});

describe('the gun\'s real landing: an aimed slug is judged on its aim, wherever on the head\'s flesh it stops', () => {
  /** The crosshair's places tried: the centre, and round the precise zone (all within splitFrac of the centre). */
  const ZONE: Vec3[] = [[0, 0, 0], [0, 0.03, 0], [0, -0.03, 0], [0.03, 0, 0], [-0.03, 0, 0], [0.02, -0.02, 0]];
  const RANGES = [1, 2, 4, 4.9];
  it('an aimed slug lands about 10 cm under the crosshair, on the head\'s own flesh, at the edge of the head ellipsoid\'s old reach', () => {
    for (const dist of RANGES) {
      const f = fixture(), s = gunSlug(f, dist)!;
      // The running game's six shots landed 9.4 to 10.8 cm under the centre, 1.29 to 1.31 out.
      expect(s.under, `${dist} m`).toBeGreaterThan(0.09);
      expect(s.under, `${dist} m`).toBeLessThan(0.12);
      expect(onHeadPrim(f.a.posed().prims, s.point), `${dist} m`).toBe(true);
      expect(s.reach, `${dist} m`).toBeGreaterThan(1.28);
      expect(s.reach, `${dist} m`).toBeLessThan(BURST.maxHs);
    }
  });
  it('the crosshair anywhere in the precise zone from 1, 2, 4 and 4.9 m: each real slug splits the head, both halves', () => {
    for (const dist of RANGES) for (const aim of ZONE) {
      const f = fixture(), s = gunSlug(f, dist, aim)!, at = `${dist} m, crosshair ${JSON.stringify(aim)}`;
      expect(Math.hypot(...aim) / f.radius).toBeLessThan(BURST_TUNING_DEFAULTS.splitFrac);
      expect(f.leaf.hit(f.a, s.point, s.dir, s.shot, 'slug'), at).toBe(true);
      const v = f.leaf.last(f.a.id)!;
      expect(v, at).toMatchObject({ rule: 'split', took: true });
      expect(v.aimOffset!).toBeCloseTo(Math.hypot(...aim) / f.radius, 2);
      expect(v.rangeM!).toBeCloseTo(Math.hypot(dist, ...aim), 2);
      expect(f.split.state(f.a.id), at).toMatchObject({ preset: 'middle', sides: 0, offset: 0 });
    }
  });
  /** Walk the fixture's zombie (its shamble carries the head tipped forward) to the first step at which a real slug
   *  from 2 m, the crosshair 3 cm under the head's centre, stops in the head's flesh PAST the old reach. */
  function walkToALowLanding(f: ReturnType<typeof fixture>) {
    for (let step = 0; step < 400; step++) {
      f.a.step(1 / 60);
      const s = gunSlug(f, 2, [0, -0.03, 0]);
      if (s && onHeadPrim(f.a.posed().prims, s.point) && s.reach > BURST.maxHs) return s;
    }
    throw new Error('fixture: no step of the walk lands the slug past the old reach');
  }
  it('A WALKING ZOMBIE: its head tips forward, a precisely aimed slug stops past the old reach of the head ellipsoid, and it still splits', () => {
    const f = fixture(), s = walkToALowLanding(f);
    expect(s.reach).toBeGreaterThan(BURST.maxHs);
    expect(0.03 / f.radius).toBeLessThan(BURST_TUNING_DEFAULTS.splitFrac);
    expect(f.leaf.hit(f.a, s.point, s.dir, s.shot, 'slug')).toBe(true);
    expect(f.leaf.last(f.a.id)).toMatchObject({ rule: 'split', took: true });
    expect(f.split.isOpen(f.a)).toBe(true);
  });
  it('judged on the slug\'s own line (splitAim slug) that reach still holds: the same landing is not judged', () => {
    setBurstTuning({ splitAim: 'slug', splitFrac: 1.25, splitRangeM: 0 });
    const f = fixture(), s = walkToALowLanding(f);
    expect(f.leaf.hit(f.a, s.point, s.dir, s.shot, 'slug')).toBe(false);
    expect(f.leaf.last(f.a.id)).toBeNull();
  });
  it('the crosshair outside the zone, or the head past the range, is ordinary on the same kind of landing', () => {
    const wide = fixture(), w = gunSlug(wide, 2, [0.05, 0, 0])!;
    expect(wide.leaf.hit(wide.a, w.point, w.dir, w.shot, 'slug')).toBe(false);
    expect(wide.leaf.last(wide.a.id)).toMatchObject({ rule: 'ordinary', took: false });
    const far = fixture(), g = gunSlug(far, BURST_TUNING_DEFAULTS.splitRangeM + 0.1)!;
    expect(far.leaf.hit(far.a, g.point, g.dir, g.shot, 'slug')).toBe(false);
    expect(far.leaf.last(far.a.id)).toMatchObject({ rule: 'ordinary', took: false });
  });
  it('a slug that stops in the torso is not judged, however the crosshair lay', () => {
    const f = fixture();
    const chest = f.on(FRONT, [0, -0.3, 0]);
    expect(onHeadPrim(f.a.posed().prims, chest)).toBe(false);
    expect(f.leaf.hit(f.a, chest, FRONT, f.aimed(FRONT), 'slug')).toBe(false);
    expect(f.leaf.last(f.a.id)).toBeNull();
  });
});

describe('only the zombie: the character, not the motion profile', () => {
  /** Every registered character that moves on the zombie's profile and is not the zombie. */
  const onZombieProfile = characterNames().filter(n => n !== 'zombie' && characterEntry(n).profile.name === 'zombie');
  it('many characters move on the zombie\'s motion profile; each answers its own name', () => {
    for (const n of ['female', 'schoolgirl', 'bonewalker', 'clown']) expect(onZombieProfile).toContain(n);
    const f = fixture({ character: 'female' });
    expect(f.a.profileName()).toBe('zombie');
    expect(f.a.characterName()).toBe('female');
    expect(fixture().a.characterName()).toBe('zombie');
  });
  it('a precise slug from within range on such a character\'s head is not judged: the caller stamps an ordinary slug wound', () => {
    for (const character of ['female', 'clown', 'bonewalker']) {
      const f = fixture({ character });
      const at = f.on(FRONT);
      if (!onHeadPrim(f.a.posed().prims, at)) throw new Error(`fixture: the round missed ${character}'s head`);
      expect(f.leaf.hit(f.a, at, FRONT, f.aimed(FRONT), 'slug'), character).toBe(false);
      expect(f.leaf.last(f.a.id), character).toBeNull();
      expect(f.split.isOpen(f.a), character).toBe(false);
      expect(f.a.headPopping(), character).toBe(false);
      // The ordinary path: one slug crater on the head.
      const wound = f.a.hitSlug(at, FRONT, f.aimed(FRONT));
      expect(wound, character).not.toBeNull();
      expect(f.a.wounds().some(w => w.headRegion === 'split+' || w.headRegion === 'split-'), character).toBe(false);
      // It is the character's name that refuses it: the same body, called the zombie, is judged.
      const g = fixture({ character });
      g.a.characterName = () => 'zombie';
      g.leaf.hit(g.a, g.on(FRONT), FRONT, g.aimed(FRONT), 'slug');
      expect(g.leaf.last(g.a.id), character).not.toBeNull();
    }
  });
  it('the split leaf refuses every one of them, so a slug cannot pop what cannot be split', () => {
    for (const character of ['female', 'clown', 'bonewalker']) {
      const f = fixture({ character });
      expect(f.split.force(f.a.id, 'middle', 0, 0, 0.8), character).toBe(false);
      expect(f.split.open(f.a, [1, 0, 0], f.on(FRONT), 1), character).toBeNull();
    }
  });
});

describe('the pop on a split head', () => {
  it('a second slug swells the open head for popSwellS and then bursts it: no flying head', () => {
    const f = fixture();
    f.slug(FRONT);
    expect(f.slug(FRONT)).toBe(true);
    expect(f.leaf.last(f.a.id)).toMatchObject({ rule: 'pop', took: true });
    expect(f.a.headPopping()).toBe(true);
    expect(headAlive(f.a.posed())).toBe(true);
    expect(f.hooks.pops).toHaveLength(0);
    // Half the swell: the head is bigger and still on.
    const before = headShape(f.a.posed())!.axes[0];
    expect(f.a.advanceHeadPop(BURST_TUNING_DEFAULTS.popSwellS / 2)).toBe(true);
    expect(headShape(f.a.posed())!.axes[0]).toBeGreaterThan(before);
    expect(headAlive(f.a.posed())).toBe(true);
    // The rest of it: the burst.
    expect(f.a.advanceHeadPop(BURST_TUNING_DEFAULTS.popSwellS / 2 + 1e-6)).toBe(true);
    expect(f.a.headPopping()).toBe(false);
    expect(headAlive(f.a.posed())).toBe(false);
    expect(f.hooks.pops).toHaveLength(1);
    expect(f.hooks.pops[0]!.dir).toEqual(FRONT);
    expect(f.hooks.pops[0]!.head.prims.length).toBeGreaterThan(0);
    expect(f.hooks.severed).not.toContain('head');
    expect(f.a.advanceHeadPop(1 / 60)).toBe(false);
  });
  it('a round that lands while the head swells is ordinary, and the head pops once', () => {
    const f = fixture();
    f.slug(FRONT);
    f.slug(FRONT);
    expect(f.slug(FRONT)).toBe(false);
    expect(f.a.beginHeadPop(FRONT, 0.1)).toBe(false);
    f.a.advanceHeadPop(1);
    expect(f.hooks.pops).toHaveLength(1);
  });
  it('popSwellS 0 bursts on the hit', () => {
    const f = fixture();
    setBurstTuning({ popSwellS: 0 });
    f.slug(FRONT);
    expect(f.slug(FRONT)).toBe(true);
    expect(f.a.headPopping()).toBe(false);
    expect(headAlive(f.a.posed())).toBe(false);
    expect(f.hooks.pops).toHaveLength(1);
  });
  it('a head only cracked open (under popSplitMin of its angle) takes a slug as an ordinary wound, precise or not', () => {
    // (The slugs land 3.5 cm to one side of the middle line: on a half, not through the gap.)
    const HALF: Vec3 = [0.035, 0.03, 0];
    for (const aim of [[0, 0, 0], HALF] as Vec3[]) {
      const f = fixture();
      expect(f.split.force(f.a.id, 'middle', 0, 0, 0.25)).toBe(true);
      expect(f.slug(FRONT, { land: HALF, aim })).toBe(false);
      expect(f.leaf.last(f.a.id)).toMatchObject({ rule: 'ordinary', took: false });
      expect(f.a.headPopping()).toBe(false);
      const g = fixture();
      expect(g.split.force(g.a.id, 'middle', 0, 0, 0.8)).toBe(true);
      expect(g.slug(FRONT, { land: HALF, aim })).toBe(true);
      expect(g.leaf.last(g.a.id)!.rule).toBe('pop');
    }
  });
  it('THE SECOND STAGE IS EASY: a slug on a head split wide pops it with the crosshair anywhere on it, from within range', () => {
    const HALF: Vec3 = [0.035, 0.03, 0];
    // The crosshair 6 cm off the centre: over twice splitFrac, far from precise.
    const f = fixture();
    expect(f.split.force(f.a.id, 'middle', 0, 0, 0.8)).toBe(true);
    expect(f.slug(FRONT, { land: HALF, aim: [0.06, 0.02, 0] })).toBe(true);
    const v = f.leaf.last(f.a.id)!;
    expect(v.rule).toBe('pop');
    expect(v.aimOffset!).toBeGreaterThan(2 * BURST_TUNING_DEFAULTS.splitFrac - 0.1);
    expect(f.a.headPopping()).toBe(true);
    // From beyond the range it is an ordinary wound on the open head.
    const far = fixture();
    expect(far.split.force(far.a.id, 'middle', 0, 0, 0.8)).toBe(true);
    expect(far.slug(FRONT, { land: HALF, dist: BURST_TUNING_DEFAULTS.splitRangeM + 1 })).toBe(false);
    expect(far.leaf.last(far.a.id)).toMatchObject({ rule: 'ordinary', took: false });
    expect(far.a.headPopping()).toBe(false);
    // A slug with no aim has no range: ordinary.
    const none = fixture();
    expect(none.split.force(none.a.id, 'middle', 0, 0, 0.8)).toBe(true);
    expect(none.leaf.hit(none.a, none.on(FRONT, HALF), FRONT, undefined, 'slug')).toBe(false);
    // popPrecise asks for the split's precision.
    setBurstTuning({ popPrecise: true });
    const p = fixture();
    expect(p.split.force(p.a.id, 'middle', 0, 0, 0.8)).toBe(true);
    expect(p.slug(FRONT, { land: HALF, aim: [0.06, 0.02, 0] })).toBe(false);
    expect(p.slug(FRONT, { land: HALF, aim: [0, 0, 0] })).toBe(true);
  });
  it('a pellet, or popOnSplit off, leaves the open head on', () => {
    const f = fixture();
    f.slug(FRONT);
    expect(f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'pellet')).toBe(false);
    setBurstTuning({ popOnSplit: false });
    expect(f.slug(FRONT)).toBe(false);
    expect(f.a.headPopping()).toBe(false);
    expect(headAlive(f.a.posed())).toBe(true);
  });
});

describe('the decapitation asks first (the actor)', () => {
  const DIRS: Vec3[] = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  /** Round `n`'s hit on the neck: from the front, the back and each side in turn. */
  function neckHit(f: ReturnType<typeof fixture>, n: number): { at: Vec3; dir: Vec3 } {
    const dir = DIRS[n % 4]!, body = f.a.posed();
    const neck = body.prims.find(p => p.limb === 'head' && p.bone === 'neck') ?? body.prims.find(p => p.limb === 'head')!;
    const mid: Vec3 = [(neck.a[0] + neck.b[0]) / 2, (neck.a[1] + neck.b[1]) / 2, (neck.a[2] + neck.b[2]) / 2];
    return { at: traceRaySurface(q => sdBody(q, body), [mid[0] - dir[0] * 0.5, mid[1], mid[2] - dir[2] * 0.5], dir, 1) ?? mid, dir };
  }
  const headLeft = (f: ReturnType<typeof fixture>) => f.a.headPopping() || !headAlive(f.a.posed());
  /** Slugs into the neck from all round until the head leaves or swells. Returns how many it took (-1: it held). */
  function cutNeck(f: ReturnType<typeof fixture>, max = 40): number {
    for (let n = 1; n <= max; n++) {
      const h = neckHit(f, n);
      f.a.hitSlug(h.at, h.dir);
      if (headLeft(f)) return n;
    }
    return -1;
  }
  /** The same slugs but the last, so the neck is one round from cut. */
  function nearlyCut(f: ReturnType<typeof fixture>): number {
    setBurstTuning({ slugPop: false });
    const n = cutNeck(fixture());
    setBurstTuning({ ...BURST_TUNING_DEFAULTS });
    for (let k = 1; k < n; k++) { const h = neckHit(f, k); f.a.hitSlug(h.at, h.dir); }
    if (headLeft(f)) throw new Error('fixture: the head left early');
    return n;
  }
  it('a slug that cuts the head off pops it: the head holds through the swell, then bursts, and never flies', () => {
    const f = fixture();
    expect(cutNeck(f)).toBeGreaterThan(0);
    expect(f.a.headPopping()).toBe(true);
    expect(headAlive(f.a.posed())).toBe(true);
    expect(f.hooks.severed).not.toContain('head');
    // More slugs while it swells do not take it off either.
    cutNeck(f, 2);
    expect(f.hooks.severed).not.toContain('head');
    f.a.advanceHeadPop(BURST_TUNING_DEFAULTS.popSwellS + 0.01);
    expect(headAlive(f.a.posed())).toBe(false);
    expect(f.hooks.pops).toHaveLength(1);
    expect(f.hooks.severed).not.toContain('head');
    // The neck's stump is stamped, as the ordinary sever's is.
    expect(f.hooks.pops[0]!.stump).not.toBeNull();
  });
  it('popSwellS 0: the slug that cuts the head off bursts it in the same hit', () => {
    setBurstTuning({ popSwellS: 0 });
    const f = fixture();
    expect(cutNeck(f)).toBeGreaterThan(0);
    expect(f.a.headPopping()).toBe(false);
    expect(headAlive(f.a.posed())).toBe(false);
    expect(f.hooks.pops).toHaveLength(1);
    expect(f.hooks.severed).not.toContain('head');
  });
  it('a blast that cuts the head off sends it flying, as before: only the slug\'s decapitation pops', () => {
    const f = fixture();
    const n = nearlyCut(f);
    // The last round's wound, delivered as a blast's (the dynamite's path) instead of a slug's.
    const h = neckHit(f, n), body = f.a.posed();
    const w = woundFromSlug(body.prims, h.at, q => sdBody(q, body), f.a.pose().yaw);
    f.a.blast({ wounds: [w], meterCredit: 0, impulse: null });
    expect(f.a.headPopping()).toBe(false);
    // (The body, not the pose: a blast's own sever is posed at the actor's next step.)
    expect(f.a.body.clusters.find(c => c.limb === 'head')!.alive).toBe(false);
    expect(f.hooks.severed).toContain('head');
    expect(f.hooks.pops).toHaveLength(0);
  });
  it('slugPop off: the slug\'s decapitation is the flying head', () => {
    setBurstTuning({ slugPop: false });
    const f = fixture();
    expect(cutNeck(f)).toBeGreaterThan(0);
    expect(f.hooks.severed).toContain('head');
    expect(f.hooks.pops).toHaveLength(0);
  });
  it('the hook is told what cut the head off: a slug, a pellet volley with a slug in it, a blast', () => {
    const causes: string[] = [];
    const tell = ({ weapon }: { weapon: 'slug' | 'pellet' | 'other' }) => { causes.push(weapon); return null; };
    cutNeck(fixture({ decapitate: tell }));
    expect(causes).toEqual(['slug']);
    // One batch of rounds (a frame's worth): a pellet and the slug that cuts. The slug names the batch.
    const g = fixture({ decapitate: tell });
    const n = nearlyCut(g), h = neckHit(g, n);
    g.a.beginHits(); g.a.hitSlug(h.at, h.dir); g.a.hit(g.on(FRONT), FRONT); g.a.endHits();
    expect(causes).toEqual(['slug', 'slug']);
    const b = fixture({ decapitate: tell });
    const m = nearlyCut(b), hb = neckHit(b, m), body = b.a.posed();
    b.a.blast({ wounds: [woundFromSlug(body.prims, hb.at, q => sdBody(q, body), b.a.pose().yaw)], meterCredit: 0, impulse: null });
    expect(causes).toEqual(['slug', 'slug', 'other']);
  });
  it('pellets alone are a pellet\'s cause: the tail after a volley with no slug says so', () => {
    const causes: string[] = [];
    const f = fixture({ decapitate: ({ weapon }) => { causes.push(weapon); return null; } });
    const n = nearlyCut(f);
    // Pellets round the nearly cut neck until it goes (or 300 have landed: then the cause was never asked).
    for (let k = 0; k < 300 && !headLeft(f); k++) { const h = neckHit(f, n + k); f.a.hit(h.at, h.dir); }
    if (headLeft(f)) expect(causes).toEqual(['pellet']);
    else expect(causes).toEqual([]);
  });
  it('a body with no onHeadPop cannot pop: beginHeadPop refuses', () => {
    const view = new Proxy({}, { get: () => () => {} });
    const a = createZombieActor({ id: 2, room: 0, body: buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {}), view: view as never,
      start: [0, 0, 0], seed: 3, bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, furniture: [] });
    expect(a.beginHeadPop(FRONT, 0.1)).toBe(false);
    expect(a.headPopping()).toBe(false);
  });
});

describe('an ordinary gun crater on the head keeps a low lip', () => {
  it('a pellet\'s and a slug\'s crater on the head are stamped with headLip of the stock lip; the torso\'s is stock', () => {
    const f = fixture();
    const head = f.a.hit(f.on(FRONT), FRONT)!;
    const torso = f.a.hit(f.on(FRONT, [0, -0.45, 0]), FRONT)!;
    expect(f.a.posed().prims[head.primIdx]!.limb).toBe('head');
    expect(f.a.posed().prims[torso.primIdx]!.limb).toBe('torso');
    expect(head.rimScale).toBeGreaterThan(0);
    expect(head.rimScale!).toBeLessThanOrEqual(BURST_TUNING_DEFAULTS.headLip);
    expect(torso.rimScale ?? 1).toBeGreaterThan(BURST_TUNING_DEFAULTS.headLip);
    setBurstTuning({ slugSplit: false });
    const g = fixture();
    const slug = g.a.hitSlug(g.on(FRONT), FRONT)!;
    expect(slug.rimScale!).toBeLessThanOrEqual(BURST_TUNING_DEFAULTS.headLip);
  });
  it('WHO GETS IT: every gore body (isGoreBody), which of the humanoids is all but the soldier\'s family and the soft cultists', () => {
    const gore = HUMANOIDS.filter(n => isGoreBody(characterEntry(n).profile));
    expect([...gore].sort()).toEqual(['bonewalker', 'bride', 'clown', 'clown-alt', 'female', 'schoolgirl', 'schoolgirl-alt', 'schoolgirl-described', 'zombie']);
    expect(HUMANOIDS.filter(n => !gore.includes(n)).sort()).toEqual(['cultist', 'cultist-cowled', 'juggernaut', 'soldier']);
    expect(isGoreBody(undefined)).toBe(true);
    expect(isGoreBody({ family: 'soldier' })).toBe(false);
    expect(isGoreBody({ soft: true })).toBe(false);
    // A gore body that is not the zombie: the female's head crater has the low lip, her torso's the stock one.
    const f = fixture({ character: 'female' });
    const head = f.a.hit(f.on(FRONT), FRONT)!;
    expect(f.a.posed().prims[head.primIdx]!.limb).toBe('head');
    expect(head.rimScale!).toBeLessThanOrEqual(BURST_TUNING_DEFAULTS.headLip);
    // The soldier's head crater keeps the stock lip.
    const s = fixture({ character: 'soldier' });
    const sh = s.a.hit(s.on(FRONT), FRONT);
    if (sh && s.a.posed().prims[sh.primIdx]!.limb === 'head') expect(sh.rimScale ?? 1).toBeGreaterThan(BURST_TUNING_DEFAULTS.headLip);
  });
  it('headLip 1 is the stock lip (the look before)', () => {
    const low = fixture().a, at = fixture();
    const a = low.hit(at.on(FRONT), FRONT)!;
    setBurstTuning({ headLip: 1 });
    const b = fixture().a.hit(at.on(FRONT), FRONT)!;
    expect(a.rimScale!).toBeCloseTo((b.rimScale ?? 1) * BURST_TUNING_DEFAULTS.headLip, 9);
  });
  it('THE EDGE IS TORN (headTear): a head crater is ragged and bleeding at its rim, the torso\'s is not, and 0 is the smooth crater', () => {
    expect(BURST_TUNING_DEFAULTS.headTear).toBeGreaterThan(0);
    const f = fixture();
    const head = f.a.hit(f.on(FRONT), FRONT)!;
    const torso = f.a.hit(f.on(FRONT, [0, -0.45, 0]), FRONT)!;
    expect(head.tear).toBeCloseTo(BURST_TUNING_DEFAULTS.headTear, 9);
    expect(torso.tear ?? 0).toBe(0);
    setBurstTuning({ slugSplit: false });
    const g = fixture();
    expect(g.a.hitSlug(g.on(FRONT), FRONT)!.tear).toBeCloseTo(BURST_TUNING_DEFAULTS.headTear, 9);
    setBurstTuning({ headTear: 0 });
    const h = fixture();
    expect(h.a.hit(h.on(FRONT), FRONT)!.tear ?? 0).toBe(0);
  });
});

describe('the last verdict', () => {
  it('is read through the cast: an actor that has left it has none, and reset() forgets them all', () => {
    const f = fixture();
    f.slug(FRONT);
    expect(f.leaf.last(f.a.id)).not.toBeNull();
    const cast = f.ctx.world.actors;
    cast.length = 0;
    expect(f.leaf.last(f.a.id)).toBeNull();
    cast.push(f.a);
    expect(f.leaf.last(f.a.id)).not.toBeNull();
    f.leaf.reset();
    expect(f.leaf.last(f.a.id)).toBeNull();
  });
});

describe('the wiring', () => {
  it('the projectile loop asks the head-shot leaf before it stamps a round\'s own wound', () => {
    expect(tickSrc).toContain('ctx.weapon.headShot?.hit(hitActor, hitPoint, dirN, p.shot, p.kind)');
    expect(tickSrc).not.toContain('ctx.weapon.headDamage?.burst(');
    expect(tickSrc).toContain('a.advanceHeadPop(dt)');
  });
  it('THE LEAF IS ASKED BEFORE THE SKULL\'S OWN HIT PATH, and a round it takes never reaches it (no ejected eyes, no broken plate)', () => {
    const asked = tickSrc.indexOf('ctx.weapon.headShot?.hit(hitActor, hitPoint, dirN, p.shot, p.kind)');
    const impact = tickSrc.indexOf('ctx.render.segMeshRenderer.impact(hitActor');
    expect(asked).toBeGreaterThan(0);
    expect(impact).toBeGreaterThan(asked);
    // One call of impact in the player's projectile loop, and it is inside the branch of a round the leaf declined.
    expect(tickSrc.split('segMeshRenderer.impact(hitActor').length - 1).toBe(1);
    expect(tickSrc.slice(asked, impact)).toContain('if (!burstHandled && ctx.render.segMeshRenderer) {');
  });
  it('the actor is told which character it is, and the zombie\'s pop is wired by that name', () => {
    expect(spawnSrc).toContain('characterName: name,');
    expect(spawnSrc).toContain("...(name === 'zombie' ? {\n      onDecapitate:");
  });
  it('the zombie is spawned with the pop and with the decapitation rule', () => {
    expect(spawnSrc).toContain('onDecapitate: ({ weapon }');
    expect(spawnSrc).toContain('decapitationRule(weapon)');
    expect(spawnSrc).toContain("characterEntry(name).profile.soft || name === 'zombie'");
  });
});
