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
import { BleedRegistry } from '../bleed-registry';
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
import { AXE_HEAD, chopKick, chopOpenFrac } from './axe-head';
import { headShape } from './flame-anchors';
import { FLAIL_HEAD, headNeck, traceRaySurface } from './flail-strike';
import { AXE_HIT } from './axe-strike';
import mainSrc from './game-main.ts?raw';
import leafSrc from './game-head-split.ts?raw';

const made: { dispose(): void }[] = [];
afterEach(() => { for (const r of made.splice(0)) r.dispose(); });

/** A fresh zombie (never stepped: yaw 0, the head frame is the identity), its blasts recorded and its split hook and
 *  head re-poses observable. */
function freshActor(id = 7) {
  // The view takes every call and keeps the eyes the split leaf hands it (setSplitEye; null takes the eye back).
  const eyes: (Vec3 | null)[] = [];
  const view = new Proxy({}, { get: (_t, k) => (k === 'setSplitEye' ? (e: Vec3 | null) => { eyes.push(e); } : () => {}) });
  const a = createZombieActor({ id, room: 0, body: buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {}), view: view as never,
    start: [0, 0, 0], seed: 3, bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, furniture: [] });
  const seen = { blasts: [] as ActorBlastEffect[], reposes: 0, hook: null as ((p: BuildResult) => SplitWarp | null) | null, eyes };
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
    render: { frozenHullBuilt: true },
  };
  const split = createHeadSplit(ctx as unknown as GameContext, { headDamaged: o.headDamaged });
  ctx.weapon.headSplit = split;
  const skull = headShape(a.posed())!;
  const view = { eye: [skull.centre[0], skull.centre[1], skull.centre[2] + 1.2] as Vec3 };
  // The blood dep registers each wound's emitter, as game-world-leaves3.ts registerBleed does.
  const emitters = new BleedRegistry();
  const bleed = vi.fn((b: ZombieActor, w: Wound) => { emitters.register(b.id, w, 'slug', 0); });
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
  /** open() at the first chop's angle; `blast` puts the faces in the wound ring, as the axe's chop does. */
  const open = (n: Vec3, impact: Vec3, blast = false) => {
    const faces = split.open(a, n, impact, OPEN);
    if (faces && blast) a.blast({ wounds: faces, meterCredit: 0, impulse: null, reaction: 'none' });
    return faces;
  };
  return { a, seen, ctx, split, axe, view, bleed, emitters, skull, ticks, closed, skinFrom, open };
}

const X: Vec3 = [1, 0, 0], Z: Vec3 = [0, 0, 1];
/** The first and second chops' openings, as fractions of the preset's max. */
const [OPEN, WIDE] = AXE_HEAD.openAngles as readonly [number, number];
/** The split's own stages (the follow table's knots: the thin crack, the wide crack, split wide), whatever the axe uses. */
const STAGES = HEAD_SPLIT.skull.follow.map(k => k[0]);
const MID = HEAD_SPLIT.presets.middle, FACE = HEAD_SPLIT.presets.face;

describe('the leaf: open, the spring, widen, kill', () => {
  it('a centred chop opens the middle preset, both halves, sprung toward openAngles[0] of its max; the spring gets there', () => {
    const f = fixture();
    const brow = f.skinFrom(f.view.eye, [0, 0.03, 0]);
    expect(f.split.isOpen(f.a)).toBe(false);
    expect(f.split.state(7)).toBeNull();
    const faces = f.open(X, brow);
    expect(faces).not.toBeNull();
    expect(f.split.isOpen(f.a)).toBe(true);
    const st = f.split.state(7)!;
    expect(st).toMatchObject({ preset: 'middle', sides: 0, offset: 0, angle: 0 });
    expect(st.target).toBeCloseTo(OPEN * MID.maxBoth, 12);
    // Not open yet (angle 0): the pose carries no split.
    expect(f.a.posed().split ?? null).toBeNull();
    f.ticks(1);
    expect(f.split.state(7)!.angle).toBeGreaterThan(0);
    expect(f.a.posed().split).toBeTruthy();
    let peak = 0;
    for (let i = 0; i < 240; i++) { f.ticks(1); peak = Math.max(peak, f.split.state(7)!.angle); }
    expect(peak).toBeGreaterThan(st.target * 1.05);               // it overshoots
    expect(f.split.state(7)).toMatchObject({ angle: st.target, vel: 0 });
    // The actor's pose carries exactly this split, and the body it draws is that pose.
    const w = f.a.posed().split!;
    expect(w.thetaP).toBe(st.target);
    expect(w.thetaM).toBe(-st.target);
    expect(f.a.drawnBody().split).toBe(w);
    // The gap is real: the middle of the closed skull is empty now.
    const gap = add(f.skull.centre, [0, 0.03, 0]);
    expect(f.closed(gap)).toBeLessThan(-0.05);
    expect(sdBody(gap, f.a.posed())).toBeGreaterThan(0.005);
  });

  it('widen springs on to a later angle and the kill to the max, keeping the preset, side and offset', () => {
    const f = fixture();
    f.split.open(f.a, X, f.skinFrom(f.view.eye, [0.05, 0.03, 0]), STAGES[0]!);
    const first = f.split.state(7)!;
    expect(first.sides).toBe(1);
    f.ticks(240);
    expect(f.split.widen(f.a, STAGES[1]!)).not.toBeNull();
    expect(f.split.state(7)!.target).toBeCloseTo(STAGES[1]! * MID.maxOne, 12);
    f.ticks(240);
    expect(f.split.state(7)).toMatchObject({ preset: 'middle', sides: 1, offset: first.offset, angle: STAGES[1]! * MID.maxOne, vel: 0 });
    f.split.widen(f.a, 1);
    f.ticks(240);
    expect(f.split.state(7)!.angle).toBe(MID.maxOne);
    expect(f.a.posed().split!.thetaP).toBe(MID.maxOne);
    expect(f.a.posed().split!.thetaM).toBe(0);
    // A closed head does not widen.
    const g = fixture();
    expect(g.split.widen(g.a, WIDE)).toBeNull();
    expect(g.split.state(7)).toBeNull();
  });

  it('widen with a kick on a split already at its angle: the target stays, the halves are thrown past it and come back', () => {
    const f = fixture();
    f.split.force(7, 'middle', 0, 0, 1);
    const n0 = f.seen.reposes;
    expect(f.split.widen(f.a, 1, 0.3)).not.toBeNull();
    expect(f.split.state(7)).toMatchObject({ angle: MID.maxBoth, target: MID.maxBoth, stage: MID.maxBoth });
    expect(f.split.state(7)!.vel).toBeGreaterThan(0);
    let peak = 0;
    for (let i = 0; i < 240; i++) { f.ticks(1); peak = Math.max(peak, f.a.posed().split!.thetaP); }
    expect(peak).toBeGreaterThan(MID.maxBoth * 1.25);
    expect(f.seen.reposes).toBeGreaterThan(n0);                   // the frozen actor was re-posed while it swung
    expect(f.split.state(7)).toMatchObject({ angle: MID.maxBoth, vel: 0, stage: MID.maxBoth });
    expect(f.a.posed().split!.thetaP).toBe(MID.maxBoth);
    // No kick asked: a widen with nowhere to go does nothing.
    const st = f.split.state(7);
    f.split.widen(f.a, 1);
    expect(f.split.state(7)).toEqual(st);
  });

  it('an off-centre chop opens one side only, the plane at the impact (clamped to 40% of the head\'s half-width)', () => {
    for (const side of [1, -1] as const) {
      const f = fixture();
      const hit = f.skinFrom(f.view.eye, [side * 0.03, 0.04, 0]);
      f.open(X, hit);
      const st = f.split.state(7)!;
      expect(st.sides).toBe(side);
      expect(st.offset).toBeCloseTo(hit[0] - f.skull.centre[0], 9);
      expect(st.target).toBeCloseTo(OPEN * MID.maxOne, 12);
    }
    const f = fixture();
    f.open(X, f.skinFrom(f.view.eye, [0.08, 0.02, 0]));
    expect(f.split.state(7)!.offset).toBeCloseTo(HEAD_SPLIT.maxOffsetFrac * f.skull.axes[0], 12);
  });

  it('a blade plane across the head (normal along the head\'s forward) opens the face preset', () => {
    const f = fixture();
    f.open(Z, f.skinFrom(add(f.skull.centre, [1.2, 0, 0]), [0, 0.03, 0.02]));
    expect(f.split.state(7)).toMatchObject({ preset: 'face', sides: 1 });
    expect(f.split.state(7)!.target).toBeCloseTo(OPEN * FACE.maxOne, 12);
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
    f.open(qRotate(q, X), add(c, qRotate(q, [0.03, 0.04, 0.09])));
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
    }
    // And a plane across the turned head's forward axis is the face preset.
    const g = fixture({ frozen: false });
    turn(g.a);
    const qg = headQuatOf(g.a.boundRig(), g.a.pose().yaw)!;
    g.open(qRotate(qg, Z), add(headShape(g.a.posed())!.centre, qRotate(qg, [0.08, 0.03, 0.02])));
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
    expect(f.open(X, f.skinFrom(f.view.eye))).toBeNull();
    expect(f.split.isOpen(f.a)).toBe(false);
    expect(f.split.state(7)).toBeNull();
    expect(f.seen.hook).toBeNull();
    expect(f.seen.blasts).toHaveLength(0);
    expect(f.split.force(7, 'middle', 0, 0, 1)).toBe(false);
  });
  it('only the zombie has presets; an open head does not open again', () => {
    const f = fixture();
    f.a.profileName = () => 'cultist';
    expect(f.open(X, f.skinFrom(f.view.eye))).toBeNull();
    f.a.profileName = () => 'zombie';
    expect(f.open(X, f.skinFrom(f.view.eye))).not.toBeNull();
    const st = f.split.state(7);
    expect(f.open(Z, f.skinFrom(f.view.eye))).toBeNull();
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
    expect(f.split.isOpen(f.a)).toBe(true);
  });
  it('the body is tearing apart: on the tear\'s own frame (no tick, no step) the pose and the drawn, pulled-apart body carry no split, and none comes back', () => {
    const f = fixture();
    f.split.force(7, 'middle', 0, 0, 1);
    expect(f.a.posed().split).toBeTruthy();
    expect(f.a.drawnBody().split).toBe(f.a.posed().split);
    const reposes = f.seen.reposes;
    f.a.beginTear([0, 1.2, 0.4], 1, gibPlan(f.a.posed()));
    // At once: nothing has ticked, stepped or re-posed since the tear began.
    expect(f.seen.reposes).toBe(reposes);
    expect(f.a.posed().split ?? null).toBeNull();
    expect(f.a.drawnBody().split ?? null).toBeNull();
    expect(f.a.tearFrame()!.body.split ?? null).toBeNull();
    // The tick leaves a tearing body alone (its window re-uploads it), and the hook answers null from here on.
    f.split.widen(f.a, 1);
    f.ticks(3);
    expect(f.seen.reposes).toBe(reposes);
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
    f.open(X, f.skinFrom(f.view.eye));
    const n0 = f.seen.reposes;
    f.ticks(5);
    expect(f.seen.reposes).toBe(n0 + 5);
    f.ticks(300);
    const settled = f.seen.reposes;
    f.ticks(30);
    expect(f.seen.reposes).toBe(settled);

    const g = fixture({ frozen: false });
    g.open(X, g.skinFrom(g.view.eye));
    const m0 = g.seen.reposes;
    g.ticks(5);
    expect(g.seen.reposes).toBe(m0);
    expect(g.split.state(7)!.angle).toBeGreaterThan(0);
    // The actor's own step asks the hook.
    g.a.step(1 / 60);
    expect(g.a.posed().split!.thetaP).toBe(g.split.state(7)!.angle);
    expect(g.a.drawnBody().split).toBe(g.a.posed().split);
  });

  it('drawEye hands the frame\'s eye to the view of each actor it holds a split for, and the tick hands none', () => {
    const f = fixture();
    f.split.drawEye([9, 9, 9]);
    f.ticks(3);
    expect(f.seen.eyes).toEqual([]);
    f.open(X, f.skinFrom(f.view.eye));
    f.ticks(2);
    expect(f.seen.eyes).toEqual([]);
    f.split.drawEye([1, 2, 3]);
    f.split.drawEye([4, 5, 6]);
    expect(f.seen.eyes).toEqual([[1, 2, 3], [4, 5, 6]]);
    // The pose keeps its split wherever the eye is: every strike and trace reads it there.
    f.split.drawEye([0, 0, 500]);
    f.ticks(300);
    expect(f.a.posed().split).toBeTruthy();
  });

  it('an actor the leaf drops gets its eye taken back: closed by the seam, gone from the cast, or reset', () => {
    for (const how of ['force', 'gone', 'reset'] as const) {
      const f = fixture();
      f.open(X, f.skinFrom(f.view.eye));
      f.split.drawEye([1, 2, 3]);
      if (how === 'force') f.split.force(7, 'middle', 0, 0, 0);
      else if (how === 'gone') { f.ctx.world.actors.length = 0; f.ticks(1); }
      else f.split.reset();
      expect(f.seen.eyes, how).toEqual([[1, 2, 3], null]);
      // And a later frame's eye passes it by.
      f.split.drawEye([7, 7, 7]);
      expect(f.seen.eyes, how).toHaveLength(2);
    }
  });

  it('the draw stage feeds it: game-main calls drawEye with the render camera before the skull meshes and the crowd\'s sync', () => {
    const iEye = mainSrc.indexOf('ctx.weapon.headSplit?.drawEye(camera.position.toArray());');
    expect(iEye).toBeGreaterThan(mainSrc.indexOf("ctx.telemetry.telemetry.lap('region', 'draw:probe-gather-lights');"));
    // The skull follows view.splitDrawn, which this call settles for the frame.
    const iSkull = mainSrc.indexOf('ctx.render.segMeshRenderer.update(');
    expect(iSkull).toBeGreaterThan(iEye);
    expect(mainSrc.slice(iSkull, mainSrc.indexOf("ctx.telemetry.telemetry.end('skeleton-mesh', meshTiming);"))).toContain("warp: (owner, segment) => (segment === 'head' ? (owner as ZombieActor).view.splitDrawn : null),");
    expect(iEye).toBeLessThan(mainSrc.indexOf('refreshActorTiles();', iEye));
    // The tick's call hands no eye.
    expect(mainSrc).toContain('ctx.weapon.headSplit?.tick(dt);');
    expect(leafSrc).not.toContain('ctx.boot.handle');
  });

  it('a FROZEN actor\'s split asks for the frozen hull build again whenever it changes (the hulls follow the pose\'s split)', () => {
    // game-main builds the hulls once per frozen stretch and clears ctx.render.frozenHullBuilt to build them again.
    const f = fixture();
    f.open(X, f.skinFrom(f.view.eye), true);
    f.ctx.render.frozenHullBuilt = true;
    f.ticks(1);   // the spring moves: the pose now carries the split
    expect(f.a.posed().split).toBeTruthy();
    expect(f.ctx.render.frozenHullBuilt).toBe(false);
    f.ticks(300);
    f.ctx.render.frozenHullBuilt = true;
    f.ticks(5);   // settled: nothing changes, nothing is rebuilt
    expect(f.ctx.render.frozenHullBuilt).toBe(true);
    // The seam: a forced split is on the pose at once, and closing it takes it off.
    const g = fixture();
    g.ctx.render.frozenHullBuilt = true;
    expect(g.split.force(7, 'face', 1, 0, 1)).toBe(true);
    expect(g.ctx.render.frozenHullBuilt).toBe(false);
    g.ctx.render.frozenHullBuilt = true;
    expect(g.split.force(7, 'face', 1, 0, 0)).toBe(true);
    expect(g.ctx.render.frozenHullBuilt).toBe(false);
  });
  it('is deterministic: the same chops and ticks give the same angles', () => {
    const run = () => {
      const f = fixture();
      f.open(X, f.skinFrom(f.view.eye));
      const out: number[] = [];
      for (let i = 0; i < 40; i++) { f.ticks(1); out.push(f.split.state(7)!.angle); }
      return out;
    };
    expect(run()).toEqual(run());
  });
  it('an actor gone from the world, and reset(), drop the state and the hook', () => {
    for (const drop of ['gone', 'reset'] as const) {
      const f = fixture();
      f.split.force(7, 'middle', 0, 0, 1);
      expect(f.a.posed().split).toBeTruthy();
      if (drop === 'gone') { f.ctx.world.actors.length = 0; f.ticks(1); }
      else f.split.reset();
      expect(f.split.state(7)).toBeNull();
      expect(f.split.isOpen(f.a)).toBe(false);
      expect(f.seen.hook).toBeNull();
      f.a.reposeHead();
      expect('split' in f.a.posed()).toBe(false);
    }
  });
});

describe('the cut faces', () => {
  it('opening stamps one cut per opened half: head-kept, on its own half beside the plane, at the scalp of the closed head', () => {
    const f = fixture();
    // open() stamps them and hands them over; the caller's blast (the chop's) puts them in the ring.
    const faces = f.split.open(f.a, X, f.skinFrom(f.view.eye, [0, 0.03, 0]), OPEN)!;
    expect(faces.map(w => w.headRegion)).toEqual(['split+', 'split-']);
    expect(f.seen.blasts).toHaveLength(0);
    expect(f.a.wounds()).toHaveLength(0);
    f.a.blast({ wounds: faces, meterCredit: 0, impulse: null, reaction: 'flinch' });
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
    const faces = f.open(X, f.skinFrom(f.view.eye, [-0.03, 0.04, 0]))!;
    expect(faces.map(w => w.headRegion)).toEqual(['split-']);
    // force() blasts its faces itself, with no reaction.
    const g = fixture();
    expect(g.split.force(7, 'face', 1, 0.02, 0.5)).toBe(true);
    expect(g.seen.blasts).toHaveLength(1);
    expect(g.seen.blasts[0]).toMatchObject({ meterCredit: 0, impulse: null, reaction: 'none' });
    expect(g.a.wounds().map(w => [w.headRegion, w.headSlot])).toEqual([['split+', 'keep']]);
    // Forced again (retuned): the face is replaced in place, not added.
    g.split.force(7, 'face', 1, 0.03, 0.8);
    expect(g.a.wounds().map(w => w.headRegion)).toEqual(['split+']);
  });
  it('the faces are the only head-kept wounds on a split head: they fit the head\'s cap and outlive any number of ordinary wounds', () => {
    const f = fixture();
    const faces = f.open(X, f.skinFrom(f.view.eye), true)!;
    // Head damage's kept craters never share a head with them (the two leaves refuse each other's heads), so the faces
    // alone must fit the head cap; then pushWound never evicts one for another head wound.
    expect(f.a.wounds().filter(w => w.headSlot)).toEqual(faces);
    expect(faces.length).toBeLessThanOrEqual(MAX_HEAD_WOUNDS);
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

  it('chop 1 opens (the faces are its cut, in its one blast), chop 2 widens, the kill chop throws it fully open and kills; the split stays', () => {
    const f = fixture();
    const front = f.view.eye;
    expect(chopFrom(f, front)).toBe(1);
    const st = f.split.state(7)!;
    expect(st.preset).toBe('middle');
    expect(st.target).toBeCloseTo(chopOpenFrac(1) * splitMaxAngle(st), 12);
    // ONE blast for the opening chop: the faces, with the chop's flinch and shove.
    expect(f.seen.blasts).toHaveLength(1);
    const opening = f.seen.blasts[0]!;
    expect(opening).toMatchObject({ meterCredit: 0, reaction: 'flinch', forceCollapse: false });
    expect(opening.impulse).not.toBeNull();
    expect(opening.wounds.length).toBeGreaterThan(0);
    expect(opening.wounds.every(w => w.headSlot === 'keep' && w.headRegion!.startsWith('split'))).toBe(true);
    expect(f.a.wounds()).toEqual(opening.wounds);
    expect(f.bleed.mock.calls.map(c => c[1])).toEqual(opening.wounds);
    f.ticks(240);
    const max = splitMaxAngle(st);

    // Chop 2, aimed at the open head from the front: it still counts, and widens: split wide, and the zombie lives.
    expect(chopFrom(f, front, 'R')).toBe(1);
    expect(f.axe.debug().last!.heads).toEqual([7]);
    expect(f.axe.debug().heads).toEqual({ 7: 2 });
    expect(f.split.state(7)!.target).toBeCloseTo(chopOpenFrac(2) * max, 12);
    expect(f.split.state(7)!.target).toBeGreaterThan(st.target);
    expect(f.seen.blasts.at(-1)!.forceCollapse).toBe(false);
    f.ticks(240);
    expect(chopOpenFrac(2)).toBe(1);
    expect(f.split.state(7)).toMatchObject({ target: max, angle: max, vel: 0 });
    expect(f.seen.blasts.filter(b => b.forceCollapse)).toHaveLength(0);

    // The kill chop lands on a split already at its full angle: it kills, and kicks the spring (axe-head.ts chopKick).
    for (let c = 3; c <= AXE_HEAD.chopsToKill; c++) {
      expect(chopFrom(f, front, 'L')).toBe(1);
      const kicked = f.split.state(7)!;
      expect(kicked).toMatchObject({ target: max, angle: max, stage: max });
      expect(kicked.vel > 0).toBe(chopKick(c) > 0);
      let peak = max;
      for (let i = 0; i < 240; i++) { f.ticks(1); peak = Math.max(peak, f.a.posed().split!.thetaP); }
      expect((peak - max) / max).toBeGreaterThan(0.9 * chopKick(c));
    }
    expect(f.axe.debug().heads).toEqual({ 7: AXE_HEAD.chopsToKill });
    expect(f.split.state(7)).toMatchObject({ target: max, angle: max, vel: 0 });
    expect(f.seen.blasts.at(-1)).toMatchObject({ reaction: 'flinch', forceCollapse: true, meterCredit: 0 });
    expect(f.seen.blasts.filter(b => b.forceCollapse)).toHaveLength(1);
    expect(Math.max(f.a.posed().split!.thetaP, -f.a.posed().split!.thetaM)).toBe(max);
    // The faces are still in the ring.
    for (const w of opening.wounds) expect(f.a.wounds()).toContain(w);
  });

  it('three centred chops, the later two into the gap: the faces bleed again, but each wound has ONE emitter', () => {
    const f = fixture();
    const eye: Vec3 = [0, 1.9, 1.2];   // above and in front: its line to the head runs down between the halves
    for (let c = 1; c <= 3; c++) {
      expect(chopFrom(f, eye)).toBe(1);
      f.ticks(240);
    }
    const [opening, second, third] = f.seen.blasts;
    expect(f.split.state(7)!.sides).toBe(0);
    expect(opening!.wounds).toHaveLength(2);
    expect(second!.wounds).toEqual([]);                       // no cut of their own: on a cut face / the gap's floor
    expect(third!.wounds).toEqual([]);
    expect(f.bleed).toHaveBeenCalledTimes(6);                 // the two faces, at each chop
    const live = f.emitters.live(0);
    expect(live.map(e => e.wound)).toEqual(opening!.wounds);  // two emitters, not six
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

  it('a chop on an open head counts from every side, at every stage; a cut it stamps is anchored at the hit, and with none the faces bleed', () => {
    const hc0 = fixture().a.posed().clusters.find(c => c.limb === 'head')!.center;
    const eyes: Vec3[] = [[0, 1.6, 1.3], [0, 1.9, 1.2], [1.2, 1.62, 0.1], [-1.2, 1.62, 0.1], [0.8, 1.7, 0.9], [-0.6, 1.75, 1.0], [0, 1.65, -1.1]];
    let cuts = 0, none = 0;
    for (const [preset, sides, offset] of [['middle', 0, 0], ['middle', 1, 0.03], ['middle', -1, -0.03], ['face', 1, 0.02]] as const) {
      for (const frac of STAGES) for (const eye of eyes) {
        const f = fixture();
        f.split.force(7, preset, sides, offset, frac);
        const n = f.seen.blasts.length;
        const tag = `${preset} ${sides} ${frac} from ${eye}`;
        // Every chop lands, on the head, and counts.
        expect(chopFrom(f, eye), tag).toBe(1);
        expect(f.axe.debug().last!.heads, tag).toEqual([7]);
        expect(f.axe.debug().heads, tag).toEqual({ 7: 1 });
        const point = f.axe.debug().last!.points[0]!;
        expect(len(sub(point, hc0)), tag).toBeLessThan(0.3);
        expect(f.seen.blasts, tag).toHaveLength(n + 1);
        const b = f.seen.blasts[n]!;
        expect(b, tag).toMatchObject({ meterCredit: 0, reaction: 'flinch', forceCollapse: false });
        const posed = f.a.posed();
        if (b.wounds.length > 0) {
          cuts++;
          expect(b.wounds, tag).toHaveLength(1);
          expect(b.wounds[0], tag).toMatchObject({ shape: 'cut', headRegion: 'axe-1' });
          expect(b.wounds[0]!.headSlot, tag).toBeUndefined();
          // The cut sits where the hit un-warps to on the closed head, not centimetres away up on the scalp.
          const u = unwarpPoint(posed.split, point, f.closed);
          expect(len(sub(woundWorldPos(posed.prims, b.wounds[0]!, 0), u.q)), tag).toBeLessThan(0.02);
          expect(f.bleed.mock.calls.at(-1)![1], tag).toBe(b.wounds[0]);
        } else {
          none++;
          // No cut of its own: the faces bleed.
          expect((f.bleed.mock.calls.at(-1)![1] as Wound).headSlot, tag).toBe('keep');
        }
        // The widening is the effect either way (the first chop on a forced head springs it no lower than it stands).
        expect(f.split.state(7)!.target, tag).toBeGreaterThanOrEqual(frac * splitMaxAngle(f.split.state(7)!) - 1e-12);
      }
    }
    console.log(`chops on an open head: ${cuts} stamped their own cut, ${none} did not (a cut face or the gap)`);
    expect(cuts).toBeGreaterThan(20);
    expect(none).toBeGreaterThan(5);
  }, 120000);

  it('a head the split refuses keeps part A: a head-tagged cut per chop and the kill on chop N, no split', () => {
    const f = fixture({ headDamaged: () => true });
    for (let i = 0; i < AXE_HEAD.chopsToKill; i++) expect(f.axe.chop(7, 'H', 'head')).toBe(1);
    expect(f.split.state(7)).toBeNull();
    expect(f.seen.blasts.map(b => b.wounds[0]!.headRegion)).toEqual(Array.from({ length: AXE_HEAD.chopsToKill }, (_, i) => `axe-${i + 1}`));
    expect(f.seen.blasts.map(b => b.forceCollapse)).toEqual(Array.from({ length: AXE_HEAD.chopsToKill }, (_, i) => i === AXE_HEAD.chopsToKill - 1));
    expect('split' in f.a.posed()).toBe(false);
  });

  /** One real click with the eye at `eye`, aimed level along -z: the swing runs to its strike. Returns the strike. */
  const clickFrom = (f: ReturnType<typeof fixture>, eye: Vec3) => {
    f.view.eye = eye;
    const before = f.seen.blasts.length;
    f.axe.onMouseDown(0);
    for (let i = 0; i < 120 && f.seen.blasts.length === before; i++) f.axe.tick(1 / 60);
    f.axe.onMouseUp(0);
    for (let i = 0; i < 90; i++) f.axe.tick(1 / 60);          // the swing ends: the next click starts the combo again
    return { blast: f.seen.blasts[before], last: f.axe.debug().last! };
  };

  it('the axe gate\'s body chop, 0.19 m from the neck root (the flail\'s head region), is a BODY chop: its own cut at the hit, the body\'s meter, no split, no head count', () => {
    const f = fixture();
    const posed = f.a.posed(), torso = posed.clusters.find(c => c.limb === 'torso')!.center, neck = headNeck(posed.prims)!.root;
    // scripts/axe-gate.mjs A / D / T: the eye at standing height, 0.9 m from the torso centre, chopping at it.
    const dy = 1.62 - torso[1];
    f.view.eye = [torso[0], 1.62, torso[2] + Math.sqrt(0.9 * 0.9 - dy * dy)];
    expect(f.axe.chop(7, 'H', 'torso')).toBe(1);
    const point = f.axe.debug().last!.points[0]!;
    // Inside the flail's head region by its neck-root clause, a third of a metre from the head.
    expect(len(sub(point, neck))).toBeLessThan(FLAIL_HEAD.neckDist);
    expect(len(sub(point, f.skull.centre))).toBeGreaterThan(0.3);
    expect(f.axe.debug().last!.heads).toEqual([]);
    expect(f.axe.debug().heads).toEqual({});
    expect(f.split.state(7)).toBeNull();
    expect(f.seen.blasts).toHaveLength(1);
    const b = f.seen.blasts[0]!;
    expect(b).toMatchObject({ meterCredit: AXE_HIT.H.meterCredit, reaction: 'blast' });
    expect(b.forceCollapse ?? false).toBe(false);
    expect(b.wounds).toHaveLength(1);
    expect(b.wounds[0]).toMatchObject({ shape: 'cut' });
    expect(b.wounds[0]!.headRegion).toBeUndefined();
    expect(b.wounds[0]!.headSlot).toBeUndefined();
    expect(posed.prims[b.wounds[0]!.primIdx]!.limb).toBe('torso');
    expect(len(sub(woundWorldPos(f.a.posed().prims, b.wounds[0]!, 0), point))).toBeLessThan(0.05);
    // Three of them do not kill: the head chop counter never moved.
    f.axe.chop(7, 'R', 'torso'); f.axe.chop(7, 'L', 'torso');
    expect(f.seen.blasts.some(x => x.forceCollapse)).toBe(false);
    expect(f.axe.debug().heads).toEqual({});
  });

  it('up the front of the body, level chops from 0.9 m: the chest, the collar and the neck\'s base are body chops; the jaw line and up open the head', () => {
    const run = (y: number) => {
      const f = fixture();
      const { blast, last } = clickFrom(f, [0, y, f.skull.centre[2] + 0.9]);
      const point = last.points[0]!, head = last.heads.length === 1;
      return { f, blast: blast!, head, point };
    };
    for (const y of [1.25, 1.30, 1.35, 1.40, 1.44]) {
      const r = run(y);
      expect(r.head, `y ${y}`).toBe(false);
      expect(r.f.split.state(7), `y ${y}`).toBeNull();
      expect(r.blast.wounds, `y ${y}`).toHaveLength(1);
      expect(r.blast.wounds[0]!.headRegion, `y ${y}`).toBeUndefined();
      expect(r.blast, `y ${y}`).toMatchObject({ meterCredit: AXE_HIT.H.meterCredit, reaction: 'blast' });
    }
    for (const y of [1.50, 1.55, 1.60, 1.65, 1.70]) {
      const r = run(y);
      expect(r.head, `y ${y}`).toBe(true);
      expect(r.f.split.state(7)?.preset, `y ${y}`).toBe('middle');
      expect(r.blast.wounds.every(w => w.headSlot === 'keep'), `y ${y}`).toBe(true);
      expect(r.blast, `y ${y}`).toMatchObject({ meterCredit: 0, reaction: 'flinch' });
    }
  }, 120000);

  it('a body chop neither opens nor widens', () => {
    const f = fixture();
    f.axe.chop(7, 'H', 'torso');
    expect(f.split.state(7)).toBeNull();
    f.split.force(7, 'middle', 0, 0, OPEN);
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
    // What is not a split is refused, not thrown: an unknown preset, a bad side, a non-finite number.
    expect(seams.forceSplit(7, 'sideways' as never, 0, 0, 1)).toBe(false);
    expect(seams.forceSplit(7, 'middle', 3 as never, 0, 1)).toBe(false);
    expect(seams.forceSplit(7, 'middle', 0, NaN, 1)).toBe(false);
    expect(seams.headSplit(7)).toBeNull();
    expect(f.seen.blasts).toHaveLength(0);
    expect(seams.forceSplit(7, 'middle', 1, 0.02, 0.5)).toBe(true);
    expect(seams.headSplit(7)).toEqual({ preset: 'middle', sides: 1, offset: 0.02, angle: 0.5 * MID.maxOne, vel: 0, target: 0.5 * MID.maxOne, stage: 0.5 * MID.maxOne });
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
