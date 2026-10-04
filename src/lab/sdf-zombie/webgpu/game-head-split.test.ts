// src/lab/sdf-zombie/webgpu/game-head-split.test.ts
//
// The head split leaf, the axe that drives it and the debug seams, against a stub ctx and REAL actors (the posed
// zombie, its wound ring and re-pose; a view that swallows every call): no renderer, no WebGPU. The actors are frozen
// (ctx.demo.wanderFrozen), as the gates run them: the leaf's tick re-poses them when the spring moves.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from '../build-body';
import { makeZombie } from '../body';
import { gibPlan } from '../gib-parts';
import { sdBody } from '../validate';
import { MAX_HEAD_WOUNDS, MAX_WOUNDS, pushWound, woundWorldPos, worldHitToWound, type Wound } from '../damage';
import { HEAD_SPLIT, splitMaxAngle, unwarpPoint, type SplitWarp } from '../head-split';
import { add, cross, dot, len, qRotate, scale, sub } from '../vec';
import { headQuatOf } from '../rig-bind';
import type { Vec3 } from '../types';
import type { GameContext } from './game-context';
import { createZombieActor, type ActorBlastEffect, type ZombieActor } from './game-actor';
import { createHeadSplit, type HeadSplitDeps } from './game-head-split';
import { createAxeHarness } from './game-axe';
import { createFireSeams } from './game-seams-fire';
import { makeWeaponSlotState } from './game-weapon-slots';
import { AXE_HEAD } from './axe-head';
import { headShape } from './flame-anchors';
import { traceRaySurface } from './flail-strike';

const made: { dispose(): void }[] = [];
afterEach(() => { for (const r of made.splice(0)) r.dispose(); });

/** A fresh zombie (never stepped: yaw 0, the head frame is the identity), its blasts recorded and its split hook and
 *  head re-poses observable. */
function freshActor(id = 7) {
  const view = new Proxy({}, { get: () => () => {} });
  const a = createZombieActor({ id, room: 0, body: buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {}), view: view as never,
    start: [0, 0, 0], seed: 3, bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, furniture: [] });
  const seen = { blasts: [] as ActorBlastEffect[], reposes: 0, hook: null as ((p: BuildResult) => SplitWarp | null) | null };
  const blast = a.blast, repose = a.reposeHead, setHook = a.setHeadSplit;
  a.blast = (e) => { seen.blasts.push(e); blast(e); };
  a.reposeHead = () => { seen.reposes++; repose(); };
  a.setHeadSplit = (fn) => { seen.hook = fn; setHook(fn); };
  return { a, seen };
}

function fixture(o: { headDamaged?: HeadSplitDeps['headDamaged']; frozen?: boolean } = {}) {
  const { a, seen } = freshActor();
  const ctx = {
    weapon: { aimRig: new THREE.Group(), viewModelAnchor: new THREE.Group(), slotState: makeWeaponSlotState('axe'), headSplit: null as unknown },
    player: { player: { yaw: 0, pitch: 0 } },
    world: { actors: [a], loop: null, sequence: null },
    boot: { canvas: {}, deferredApi: null },
    telemetry: { telemetry: { event: vi.fn() } },
    demo: { wanderFrozen: o.frozen ?? true },
  };
  const split = createHeadSplit(ctx as unknown as GameContext, { headDamaged: o.headDamaged });
  ctx.weapon.headSplit = split;
  const skull = headShape(a.posed())!;
  const view = { eye: [skull.centre[0], skull.centre[1], skull.centre[2] + 1.2] as Vec3 };
  const bleed = vi.fn();
  const axe = createAxeHarness(ctx as unknown as GameContext, { eye: () => view.eye, aimDir: () => [0, 0, -1], bleed, split });
  made.push(axe);
  const ticks = (n: number) => { for (let i = 0; i < n; i++) split.tick(1 / 60); };
  /** The closed body's field, whatever the split. */
  const closed = (q: Vec3) => sdBody(q, { ...a.posed(), split: null });
  /** The closed head's skin where the ray from `from` toward the skull centre + `off` meets it. */
  const skinFrom = (from: Vec3, off: Vec3 = [0, 0, 0]): Vec3 => {
    const d = sub(add(skull.centre, off), from), l = len(d);
    return traceRaySurface(closed, from, scale(d, 1 / l), l + 0.2)!;
  };
  return { a, seen, ctx, split, axe, view, bleed, skull, ticks, closed, skinFrom };
}

const X: Vec3 = [1, 0, 0], Z: Vec3 = [0, 0, 1];
const MID = HEAD_SPLIT.presets.middle, FACE = HEAD_SPLIT.presets.face;

describe('the leaf: open, the spring, widen, kill', () => {
  it('a centred chop opens the middle preset, both halves, sprung toward openAngles[0] of its max; the spring gets there', () => {
    const f = fixture();
    const brow = f.skinFrom(f.view.eye, [0, 0.03, 0]);
    expect(f.split.isOpen(f.a)).toBe(false);
    expect(f.split.state(7)).toBeNull();
    const faces = f.split.open(f.a, X, brow);
    expect(faces).not.toBeNull();
    expect(f.split.isOpen(f.a)).toBe(true);
    const st = f.split.state(7)!;
    expect(st).toMatchObject({ preset: 'middle', sides: 0, offset: 0, angle: 0 });
    expect(st.target).toBeCloseTo(AXE_HEAD.openAngles[0] * MID.maxBoth, 12);
    // Not open yet (angle 0): the pose carries no split.
    expect(f.a.posed().split ?? null).toBeNull();
    expect(f.split.warp(f.a)).toBeNull();
    f.ticks(1);
    expect(f.split.state(7)!.angle).toBeGreaterThan(0);
    expect(f.a.posed().split).toBeTruthy();
    let peak = 0;
    for (let i = 0; i < 240; i++) { f.ticks(1); peak = Math.max(peak, f.split.state(7)!.angle); }
    expect(peak).toBeGreaterThan(st.target * 1.05);               // it overshoots
    expect(f.split.state(7)).toMatchObject({ angle: st.target, vel: 0 });
    // The actor's pose carries exactly this split, and the leaf hands the same object to the renderer.
    const w = f.a.posed().split!;
    expect(w.thetaP).toBe(st.target);
    expect(w.thetaM).toBe(-st.target);
    expect(f.split.warp(f.a)).toBe(w);
    // The gap is real: the middle of the closed skull is empty now.
    const gap = add(f.skull.centre, [0, 0.03, 0]);
    expect(f.closed(gap)).toBeLessThan(-0.05);
    expect(sdBody(gap, f.a.posed())).toBeGreaterThan(0.005);
  });

  it('widen springs on to 0.8 of the max and the kill to 1.0, keeping the preset, side and offset', () => {
    const f = fixture();
    f.split.open(f.a, X, f.skinFrom(f.view.eye, [0.05, 0.03, 0]));
    const first = f.split.state(7)!;
    expect(first.sides).toBe(1);
    f.ticks(240);
    expect(f.split.widen(f.a, AXE_HEAD.openAngles[1])).not.toBeNull();
    expect(f.split.state(7)!.target).toBeCloseTo(0.8 * MID.maxOne, 12);
    f.ticks(240);
    expect(f.split.state(7)).toMatchObject({ preset: 'middle', sides: 1, offset: first.offset, angle: 0.8 * MID.maxOne, vel: 0 });
    f.split.widen(f.a, 1);
    f.ticks(240);
    expect(f.split.state(7)!.angle).toBe(MID.maxOne);
    expect(f.a.posed().split!.thetaP).toBe(MID.maxOne);
    expect(f.a.posed().split!.thetaM).toBe(0);
    // A closed head does not widen.
    const g = fixture();
    expect(g.split.widen(g.a, 0.8)).toBeNull();
    expect(g.split.state(7)).toBeNull();
  });

  it('an off-centre chop opens one side only, the plane at the impact (clamped to 40% of the head\'s half-width)', () => {
    for (const side of [1, -1] as const) {
      const f = fixture();
      const hit = f.skinFrom(f.view.eye, [side * 0.03, 0.04, 0]);
      f.split.open(f.a, X, hit);
      const st = f.split.state(7)!;
      expect(st.sides).toBe(side);
      expect(st.offset).toBeCloseTo(hit[0] - f.skull.centre[0], 9);
      expect(st.target).toBeCloseTo(AXE_HEAD.openAngles[0] * MID.maxOne, 12);
    }
    const f = fixture();
    f.split.open(f.a, X, f.skinFrom(f.view.eye, [0.08, 0.02, 0]));
    expect(f.split.state(7)!.offset).toBeCloseTo(HEAD_SPLIT.maxOffsetFrac * f.skull.axes[0], 12);
  });

  it('a blade plane across the head (normal along the head\'s forward) opens the face preset', () => {
    const f = fixture();
    f.split.open(f.a, Z, f.skinFrom(add(f.skull.centre, [1.2, 0, 0]), [0, 0.03, 0.02]));
    expect(f.split.state(7)).toMatchObject({ preset: 'face', sides: 1 });
    expect(f.split.state(7)!.target).toBeCloseTo(AXE_HEAD.openAngles[0] * FACE.maxOne, 12);
  });

  it('a turned, walking zombie: the chop is read in the HEAD\'s frame, and the split follows the head from step to step', () => {
    const f = fixture({ frozen: false });
    // Walk it until it has turned well away from yaw 0 (the wander is seeded: deterministic).
    const turn = (a: ZombieActor) => { for (let n = 0; Math.abs(Math.sin(a.pose().yaw)) < 0.8 && n < 1500; n++) a.step(1 / 60); };
    turn(f.a);
    const yaw = f.a.pose().yaw;
    expect(Math.abs(Math.sin(yaw))).toBeGreaterThanOrEqual(0.8);
    const q = headQuatOf(f.a.boundRig(), yaw)!;
    const c = headShape(f.a.posed())!.centre;
    // A blade plane across the turned head's own x axis, landing 3 cm to the head's right: middle, the + side.
    f.split.open(f.a, qRotate(q, X), add(c, qRotate(q, [0.03, 0.04, 0.09])));
    expect(f.split.state(7)).toMatchObject({ preset: 'middle', sides: 1 });
    expect(f.split.state(7)!.offset).toBeCloseTo(0.03, 9);
    // In world axes the same plane normal would read as the face preset here: the frame matters.
    expect(Math.abs(qRotate(q, X)[2])).toBeGreaterThan(Math.abs(qRotate(q, X)[0]));
    f.ticks(30);
    for (let i = 0; i < 3; i++) {
      f.a.step(1 / 60);
      f.ticks(1);
      const w = f.a.posed().split!, qi = headQuatOf(f.a.boundRig(), f.a.pose().yaw)!, ci = headShape({ ...f.a.posed(), split: null })!.centre;
      expect(len(sub(w.n, qRotate(qi, X)))).toBeLessThan(1e-9);
      expect(w.d0).toBeCloseTo(dot(w.n, ci) + 0.03, 9);
      expect(f.split.warp(f.a)).toBe(w);
    }
    // And a plane across the turned head's forward axis is the face preset.
    const g = fixture({ frozen: false });
    turn(g.a);
    const qg = headQuatOf(g.a.boundRig(), g.a.pose().yaw)!;
    g.split.open(g.a, qRotate(qg, Z), add(headShape(g.a.posed())!.centre, qRotate(qg, [0.08, 0.03, 0.02])));
    expect(g.split.state(7)).toMatchObject({ preset: 'face', sides: 1 });
    expect(g.split.state(7)!.offset).toBeCloseTo(0.02, 9);
  });

  it('the frame is the head\'s: the hold ball about the hinge has the skull\'s LARGEST semi-axis as its radius', () => {
    const f = fixture();
    f.split.force(7, 'middle', 0, 0, 1);
    const w = f.a.posed().split!;
    const rho = w.r - 0.06;
    expect(rho).toBeCloseTo(len(sub(f.skull.centre, w.h)) + HEAD_SPLIT.holdFrac * Math.max(...f.skull.axes), 9);
  });
});

describe('the leaf: refusals', () => {
  it('a head the head-damage leaf holds state for is refused: no state, no hook, no wound', () => {
    const f = fixture({ headDamaged: a => a.id === 7 });
    expect(f.split.open(f.a, X, f.skinFrom(f.view.eye))).toBeNull();
    expect(f.split.isOpen(f.a)).toBe(false);
    expect(f.split.state(7)).toBeNull();
    expect(f.seen.hook).toBeNull();
    expect(f.seen.blasts).toHaveLength(0);
    expect(f.split.force(7, 'middle', 0, 0, 1)).toBe(false);
  });
  it('only the zombie has presets; an open head does not open again', () => {
    const f = fixture();
    f.a.profileName = () => 'cultist';
    expect(f.split.open(f.a, X, f.skinFrom(f.view.eye))).toBeNull();
    f.a.profileName = () => 'zombie';
    expect(f.split.open(f.a, X, f.skinFrom(f.view.eye))).not.toBeNull();
    const st = f.split.state(7);
    expect(f.split.open(f.a, Z, f.skinFrom(f.view.eye))).toBeNull();
    expect(f.split.state(7)).toEqual(st);
  });
});

describe('the leaf: the hook answers null when there is no split to carry', () => {
  it('the head is severed: null, though the state stays open', () => {
    const f = fixture();
    f.split.force(7, 'middle', 0, 0, 1);
    const posed = f.a.posed();
    expect(f.seen.hook!(posed)).not.toBeNull();
    const headless = { ...posed, clusters: posed.clusters.map(c => (c.limb === 'head' ? { ...c, alive: false } : c)) };
    expect(f.seen.hook!(headless)).toBeNull();
    expect(f.split.warp(f.a)).toBeNull();
    expect(f.split.isOpen(f.a)).toBe(true);
  });
  it('the body is tearing apart: the actor\'s pose and its drawn (pulled apart) body carry no split, and none comes back', () => {
    const f = fixture();
    f.split.force(7, 'middle', 0, 0, 1);
    expect(f.a.posed().split).toBeTruthy();
    f.a.beginTear([0, 1.2, 0.4], 1, gibPlan(f.a.posed()));
    expect(f.a.posed().split ?? null).toBeNull();
    expect(f.a.drawnBody().split ?? null).toBeNull();
    f.ticks(3);
    expect(f.split.warp(f.a)).toBeNull();
    expect(f.seen.hook!(f.a.posed())).toBeNull();
    f.a.reposeHead();
    expect(f.a.posed().split ?? null).toBeNull();
    f.a.stepTear(1 / 60);
    expect(f.a.drawnBody().split ?? null).toBeNull();
  });
  it('the state is closed (forced shut): the hook is gone and the pose has no split key', () => {
    const f = fixture();
    f.split.force(7, 'middle', 0, 0, 1);
    expect(f.split.force(7, 'middle', 0, 0, 0)).toBe(true);
    expect(f.split.state(7)).toBeNull();
    expect(f.split.isOpen(f.a)).toBe(false);
    expect(f.seen.hook).toBeNull();
    expect('split' in f.a.posed()).toBe(false);
  });
});

describe('the leaf: the per-frame tick', () => {
  it('re-poses a FROZEN actor while the spring moves and stops once it has settled; a stepping actor is left to its step', () => {
    const f = fixture();
    f.split.open(f.a, X, f.skinFrom(f.view.eye));
    const n0 = f.seen.reposes;
    f.ticks(5);
    expect(f.seen.reposes).toBe(n0 + 5);
    f.ticks(300);
    const settled = f.seen.reposes;
    f.ticks(30);
    expect(f.seen.reposes).toBe(settled);

    const g = fixture({ frozen: false });
    g.split.open(g.a, X, g.skinFrom(g.view.eye));
    const m0 = g.seen.reposes;
    g.ticks(5);
    expect(g.seen.reposes).toBe(m0);
    expect(g.split.state(7)!.angle).toBeGreaterThan(0);
    // The actor's own step asks the hook.
    g.a.step(1 / 60);
    expect(g.a.posed().split!.thetaP).toBe(g.split.state(7)!.angle);
    expect(g.split.warp(g.a)).toBe(g.a.posed().split);
  });
  it('is deterministic: the same chops and ticks give the same angles', () => {
    const run = () => {
      const f = fixture();
      f.split.open(f.a, X, f.skinFrom(f.view.eye));
      const out: number[] = [];
      for (let i = 0; i < 40; i++) { f.ticks(1); out.push(f.split.state(7)!.angle); }
      return out;
    };
    expect(run()).toEqual(run());
  });
  it('an actor gone from the world, forget() and reset() drop the state and the hook', () => {
    for (const drop of ['gone', 'forget', 'reset'] as const) {
      const f = fixture();
      f.split.force(7, 'middle', 0, 0, 1);
      expect(f.a.posed().split).toBeTruthy();
      if (drop === 'gone') { f.ctx.world.actors.length = 0; f.ticks(1); }
      else if (drop === 'forget') f.split.forget(7);
      else f.split.reset();
      expect(f.split.state(7)).toBeNull();
      expect(f.split.isOpen(f.a)).toBe(false);
      expect(f.split.warp(f.a)).toBeNull();
      expect(f.seen.hook).toBeNull();
      f.a.reposeHead();
      expect('split' in f.a.posed()).toBe(false);
    }
  });
});

describe('the cut faces', () => {
  it('opening stamps one cut per opened half: head-kept, on its own half beside the plane, at the scalp of the closed head', () => {
    const f = fixture();
    const faces = f.split.open(f.a, X, f.skinFrom(f.view.eye, [0, 0.03, 0]))!;
    expect(faces.map(w => w.headRegion)).toEqual(['split+', 'split-']);
    expect(f.seen.blasts).toHaveLength(1);
    expect(f.seen.blasts[0]).toMatchObject({ meterCredit: 0, impulse: null, reaction: 'none' });
    expect(f.seen.blasts[0]!.wounds).toEqual(faces);
    const ring = f.a.wounds();
    const prims = f.a.posed().prims;
    faces.forEach((w, i) => {
      expect(ring).toContain(w);
      expect(w.headSlot).toBe('keep');
      expect(w.shape).toBe('cut');
      expect(w.severRadius).toBe(0);
      expect(prims[w.primIdx]!.limb).toBe('head');
      const at = woundWorldPos(prims, w, 0);
      expect(Math.abs(f.closed(at))).toBeLessThan(2e-3);                     // on the closed scalp
      expect(at[1]).toBeGreaterThan(f.skull.centre[1] + 0.08);               // over the crown
      expect((at[0] - f.skull.centre[0]) * (i === 0 ? 1 : -1)).toBeCloseTo(HEAD_SPLIT.faceCut.inset, 3);
      expect(w.kerf).toBeCloseTo(HEAD_SPLIT.faceCalibre.kerf, 9);
    });
  });
  it('a one-sided split stamps one face, on the side that moves; force() stamps them too', () => {
    const f = fixture();
    const faces = f.split.open(f.a, X, f.skinFrom(f.view.eye, [-0.03, 0.04, 0]))!;
    expect(faces.map(w => w.headRegion)).toEqual(['split-']);
    const g = fixture();
    expect(g.split.force(7, 'face', 1, 0.02, 0.5)).toBe(true);
    expect(g.a.wounds().map(w => [w.headRegion, w.headSlot])).toEqual([['split+', 'keep']]);
    // Forced again (retuned): the face is replaced in place, not added.
    g.split.force(7, 'face', 1, 0.03, 0.8);
    expect(g.a.wounds().map(w => w.headRegion)).toEqual(['split+']);
  });
  it('the faces take 2 of the head\'s kept slots and outlive any number of ordinary wounds', () => {
    const f = fixture();
    const faces = f.split.open(f.a, X, f.skinFrom(f.view.eye))!;
    expect(faces.length).toBeLessThanOrEqual(2);
    expect(MAX_HEAD_WOUNDS).toBe(8);
    let ring: Wound[] = [...f.a.wounds()];
    const posed = f.a.posed();
    for (let i = 0; i < MAX_WOUNDS + 8; i++) {
      ring = pushWound(ring, worldHitToWound(posed.prims, [0.02 * (i % 5), 1.1 + 0.01 * i, 0.2], 0.03, 'pellet', 0), MAX_WOUNDS);
    }
    expect(ring).toHaveLength(MAX_WOUNDS);
    for (const w of faces) expect(ring).toContain(w);
  });
});

describe('the axe drives the split (the real zombie)', () => {
  /** Aim the seam's head chop from `eye`: it aims at the head cluster's centre. */
  const chopFrom = (f: ReturnType<typeof fixture>, eye: Vec3, side: 'H' | 'R' | 'L' = 'H') => { f.view.eye = eye; return f.axe.chop(7, side, 'head'); };

  it('chop 1 opens (the faces are its cut), chop 2 widens, chop 3 throws it fully open and kills; the split stays', () => {
    const f = fixture();
    const front = f.view.eye;
    expect(chopFrom(f, front)).toBe(1);
    expect(f.split.state(7)).toMatchObject({ preset: 'middle' });
    expect(f.split.state(7)!.target).toBeCloseTo(0.55 * splitMaxAngle(f.split.state(7)!), 12);
    // The leaf's blast carries the faces; the axe's own carries the flinch and shove, and no cut of its own.
    expect(f.seen.blasts).toHaveLength(2);
    expect(f.seen.blasts[0]!.wounds.every(w => w.headSlot === 'keep')).toBe(true);
    expect(f.seen.blasts[1]).toMatchObject({ wounds: [], meterCredit: 0, reaction: 'flinch', forceCollapse: false });
    expect(f.bleed).toHaveBeenCalledTimes(f.seen.blasts[0]!.wounds.length);
    expect(f.bleed.mock.calls[0]![1]).toBe(f.seen.blasts[0]!.wounds[0]);
    f.ticks(240);
    const max = splitMaxAngle(f.split.state(7)!);

    // Chop 2, aimed at the open head from the front: it still counts, and widens.
    expect(chopFrom(f, front, 'R')).toBe(1);
    expect(f.axe.debug().last!.heads).toEqual([7]);
    expect(f.axe.debug().heads).toEqual({ 7: 2 });
    expect(f.split.state(7)!.target).toBeCloseTo(0.8 * max, 12);
    expect(f.seen.blasts.at(-1)!.forceCollapse).toBe(false);
    f.ticks(240);

    // Chop 3: fully open, and the kill.
    expect(chopFrom(f, front, 'L')).toBe(1);
    expect(f.axe.debug().heads).toEqual({ 7: 3 });
    expect(f.split.state(7)!.target).toBe(max);
    expect(f.seen.blasts.at(-1)).toMatchObject({ reaction: 'flinch', forceCollapse: true, meterCredit: 0 });
    f.ticks(240);
    expect(f.split.state(7)!.angle).toBe(max);
    expect(Math.max(f.a.posed().split!.thetaP, -f.a.posed().split!.thetaM)).toBe(max);
    // The faces are still in the ring.
    expect(f.a.wounds().filter(w => w.headSlot === 'keep').length).toBeGreaterThan(0);
  });

  it('the blade plane is cross(blade line, view): an overhead chop from the front opens middle, from the side face', () => {
    const f = fixture();
    chopFrom(f, f.view.eye, 'H');
    expect(f.split.state(7)!.preset).toBe('middle');
    const g = fixture();
    const hc = g.a.posed().clusters.find(c => c.limb === 'head')!.center;
    chopFrom(g, [hc[0] + 1.2, hc[1], hc[2]], 'H');
    expect(g.split.state(7)).toMatchObject({ preset: 'face', sides: 1 });
  });

  it('a chop on an open head counts from every side, at every stage; its cut is stamped only on the outer skin', () => {
    const hc0 = fixture().a.posed().clusters.find(c => c.limb === 'head')!.center;
    const eyes: Vec3[] = [[0, 1.6, 1.3], [0, 1.9, 1.2], [1.2, 1.62, 0.1], [-1.2, 1.62, 0.1], [0.8, 1.7, 0.9], [-0.6, 1.75, 1.0], [0, 1.65, -1.1]];
    let onSkin = 0, onFace = 0;
    for (const [preset, sides, offset] of [['middle', 0, 0], ['middle', 1, 0.03], ['middle', -1, -0.03], ['face', 1, 0.02]] as const) {
      for (const frac of [0.55, 0.8, 1]) for (const eye of eyes) {
        const f = fixture();
        f.split.force(7, preset, sides, offset, frac);
        const n = f.seen.blasts.length;
        const tag = `${preset} ${sides} ${frac} from ${eye}`;
        expect(chopFrom(f, eye), tag).toBe(1);
        expect(f.axe.debug().last!.heads, tag).toEqual([7]);
        expect(f.axe.debug().heads, tag).toEqual({ 7: 1 });
        const point = f.axe.debug().last!.points[0]!;
        expect(len(sub(point, hc0)), tag).toBeLessThan(0.3);
        const posed = f.a.posed();
        const u = unwarpPoint(posed.split, point, f.closed);
        const skin = Math.abs(f.closed(u.q)) <= HEAD_SPLIT.skinEps;
        const b = f.seen.blasts[n]!;
        expect(f.seen.blasts, tag).toHaveLength(n + 1);
        if (skin) {
          onSkin++;
          expect(b.wounds, tag).toHaveLength(1);
          expect(b.wounds[0], tag).toMatchObject({ shape: 'cut', headRegion: 'axe-1' });
          expect(b.wounds[0]!.headSlot, tag).toBeUndefined();
          // The cut is anchored where the hit un-warps to, not 9 cm away on the scalp.
          expect(len(sub(woundWorldPos(posed.prims, b.wounds[0]!, 0), u.q)), tag).toBeLessThan(0.02);
          expect(f.bleed.mock.calls.at(-1)![1], tag).toBe(b.wounds[0]);
        } else {
          onFace++;
          expect(b.wounds, tag).toEqual([]);
          expect(f.closed(u.q), tag).toBeLessThan(-HEAD_SPLIT.skinEps);   // inside the closed head: a cut face, or the gap's floor
          // It still bleeds: from the faces.
          expect((f.bleed.mock.calls.at(-1)![1] as Wound).headSlot, tag).toBe('keep');
        }
        expect(b, tag).toMatchObject({ meterCredit: 0, reaction: 'flinch', forceCollapse: false });
        // The widening is the effect either way (chop 1 on a forced head springs it no lower than it stands).
        expect(f.split.state(7)!.target, tag).toBeGreaterThanOrEqual(frac * splitMaxAngle(f.split.state(7)!) - 1e-12);
      }
    }
    console.log(`chops on an open head: ${onSkin} on the outer skin (cut stamped), ${onFace} on a cut face or in the gap (no cut)`);
    expect(onSkin).toBeGreaterThan(20);
    expect(onFace).toBeGreaterThan(5);
  }, 120000);

  it('a head the split refuses keeps part A: a head-tagged cut per chop and the kill on chop N, no split', () => {
    const f = fixture({ headDamaged: () => true });
    for (let i = 0; i < AXE_HEAD.chopsToKill; i++) expect(f.axe.chop(7, 'H', 'head')).toBe(1);
    expect(f.split.state(7)).toBeNull();
    expect(f.seen.blasts.map(b => b.wounds[0]!.headRegion)).toEqual(['axe-1', 'axe-2', 'axe-3']);
    expect(f.seen.blasts.map(b => b.forceCollapse)).toEqual([false, false, true]);
    expect('split' in f.a.posed()).toBe(false);
  });

  it('a body chop neither opens nor widens', () => {
    const f = fixture();
    f.axe.chop(7, 'H', 'torso');
    expect(f.split.state(7)).toBeNull();
    f.split.force(7, 'middle', 0, 0, 0.55);
    const st = f.split.state(7);
    f.axe.chop(7, 'H', 'torso');
    expect(f.split.state(7)).toEqual(st);
    expect(f.axe.debug().heads).toEqual({});
  });
});

describe('the debug seams (game-seams-fire.ts)', () => {
  it('headSplit(id) reads the state; forceSplit(id, preset, sides, offset, angleFrac) sets it at once', () => {
    const f = fixture();
    const seams = createFireSeams(f.ctx as unknown as GameContext);
    expect(seams.headSplit(7)).toBeNull();
    expect(seams.forceSplit(99, 'middle', 0, 0, 1)).toBe(false);
    expect(seams.forceSplit(7, 'middle', 1, 0.02, 0.5)).toBe(true);
    expect(seams.headSplit(7)).toEqual({ preset: 'middle', sides: 1, offset: 0.02, angle: 0.5 * MID.maxOne, vel: 0, target: 0.5 * MID.maxOne });
    // At once: the pose is split before any tick, at the forced plane and angle.
    const w = f.a.posed().split!;
    expect(w.thetaP).toBe(0.5 * MID.maxOne);
    expect(w.thetaM).toBe(0);
    expect(w.d0).toBeCloseTo(dot(w.n, f.skull.centre) + 0.02, 12);
    expect(len(sub(cross(w.n, w.a), [0, 1, 0]))).toBeLessThan(1e-9);
    // The returned state is a copy: writing to it does not move the split.
    seams.headSplit(7)!.angle = 0;
    expect(seams.headSplit(7)!.angle).toBe(0.5 * MID.maxOne);
    // No leaf yet: the seams answer, and do nothing.
    const bare = createFireSeams({ weapon: { headSplit: null } } as unknown as GameContext);
    expect(bare.headSplit(7)).toBeNull();
    expect(bare.forceSplit(7, 'middle', 0, 0, 1)).toBe(false);
  });
});
