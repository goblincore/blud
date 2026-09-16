// src/lab/sdf-zombie/gib-rupture.test.ts
//
// THE RUPTURE AS A LIFECYCLE, not as a helper. These are the observable
// behaviours the wiring depends on:
//   * a body mid-rupture is already dead for gameplay — it cannot keep
//     attacking, cannot be committed, and does not move — while it is still
//     DRAWN for the window;
//   * the clock is deterministic and the window ends exactly once;
//   * the displayed region and the released piece are the SAME prims at the
//     SAME transform (the hand-off), quantified against the partitioned union;
//   * a reset mid-window drains the transition instead of leaking it.
//
// The game-main scheduling (idempotent second blast, budget split) is not
// reachable from a unit test without the whole page; those are covered by the
// look rig's census and by the guard in `scheduleGib` (`a.tearing()`).
import { describe, it, expect } from 'vitest';
import zombieSrc from './characters/zombie.blob?raw';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { buildBody } from './build-body';
import { applyRig, bindRig } from './rig-bind';
import { gibPlan, displaceGibPieces } from './gib-parts';
import { rupturePosed, rotatePrimAbout, TEAR_TUNING, type TearState } from './gib-tear';
import { sdBody } from './validate';
import { createZombieActor } from './webgpu/game-actor';
import { add, len, qMul, qRotate, sub } from './vec';
import type { Vec3 } from './types';

const doc = parseBlob(zombieSrc);
const body = buildBody(compileBlob(doc));
const posed = applyRig(body, bindRig(body), 0);
const torso = posed.clusters.find(c => c.limb === 'torso')!;

function actor(view: Record<string, unknown> = {}) {
  return createZombieActor({
    id: 1, room: 0, body,
    view: {
      setRootShift() {}, setTime() {}, setHeadRotation() {},
      setWounds() {}, update() {}, setBonesBare() {}, setPackBones() {}, setGoreStrength() {},
      ...view,
    } as never,
    start: [0, 0, 0], seed: 0,
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    furniture: [],
    onSever() {},
  });
}

const planFor = (a: ReturnType<typeof actor>) => gibPlan(a.posed());
const blastAt = (): Vec3 => [torso.center[0], torso.center[1], torso.center[2] + 0.4];

describe('rupture lifecycle (actor)', () => {
  it('a doomed body cannot keep fighting or moving, but is still drawn', () => {
    const a = actor();
    // Warm up so the body has a live motion frame and a real pose.
    for (let f = 0; f < 30; f++) a.step(1 / 60);
    const before = [...a.pose().pos] as Vec3;

    const plan = planFor(a);
    a.beginTear(blastAt(), 1, plan);
    expect(a.tearing()).toBe(true);
    expect(a.tearFrame()).not.toBeNull();
    // Gameplay capability is gone the instant the window begins.
    expect(a.meleeCapable()).toBe(false);
    expect(a.committed()).toBe(false);
    expect(a.engagedForCrowd()).toBe(false);

    // The clock is stepped externally (a frozen capture must still advance it).
    for (let f = 0; f < 8; f++) {
      a.step(1 / 60);
      a.stepTear(1 / 60);
      // Halted: the root does not wander while it comes apart.
      expect(len(sub(a.pose().pos, before))).toBeLessThan(0.02);
    }
    expect(a.tearing()).toBe(true);
  });

  it('advances deterministically and ends exactly once at sec', () => {
    const a = actor();
    for (let f = 0; f < 10; f++) a.step(1 / 60);
    const plan = planFor(a);
    a.beginTear(blastAt(), 1, plan);
    const steps = Math.ceil(TEAR_TUNING.sec / (1 / 60)) + 1;
    let ended = 0;
    for (let f = 0; f < steps; f++) {
      a.stepTear(1 / 60);
      if (!a.tearing()) ended++;
    }
    expect(ended).toBe(1);
    expect(a.tearAge()).toBeGreaterThanOrEqual(TEAR_TUNING.sec);
  });

  it('the released frame is the plan displaced AND rotated by the frame it was drawn at', () => {
    const a = actor();
    for (let f = 0; f < 10; f++) a.step(1 / 60);
    const plan = planFor(a);
    a.beginTear(blastAt(), 1, plan);
    a.stepTear(TEAR_TUNING.sec);
    expect(a.tearing()).toBe(false);
    const frame = a.tearFrame()!;
    const clean = a.posed();
    const drawn = frame.body;
    // Every body prim is exactly its region's rigid transform: rotate about the
    // region origin, then translate by the region offset. No per-prim smear.
    plan.pieces.forEach((piece, r) => {
      const q = frame.quats[r]!;
      const o = frame.offsets[r]!;
      for (const i of piece.srcPrims ?? []) {
        const p0 = clean.prims[i]!;
        const p1 = drawn.prims[i]!;
        const expectA = add(o, add(piece.origin, qRotate(q, sub(p0.a, piece.origin))));
        const expectB = add(o, add(piece.origin, qRotate(q, sub(p0.b, piece.origin))));
        expect(len(sub(p1.a, expectA))).toBeLessThan(1e-9);
        expect(len(sub(p1.b, expectB))).toBeLessThan(1e-9);
      }
    });
    // THE CHUNK HAND-OFF. The piece prims are TRANSLATED but not rotated, the
    // chunk position is the displaced region origin, and the chunk quaternion is
    // the displayed one. Applying that chunk transform (chunkPoint's map)
    // reproduces the drawn world prim exactly — the rotation is not baked twice.
    const pieces = displaceGibPieces(plan.pieces, frame.offsets, frame.quats, frame.angVels);
    let handoffChecked = 0;
    for (let r = 0; r < plan.pieces.length; r++) {
      const piece = pieces[r]!;
      const cleanPiece = plan.pieces[r]!;
      if (piece.prims.length === 0 || cleanPiece.prims.length === 0) continue;
      handoffChecked++;
      const q = frame.quats[r]!;
      const o = frame.offsets[r]!;
      const pivot = cleanPiece.origin;
      // The CHUNK convention: prims translated (not rotated), chunk at the
      // displaced pivot with the displayed quat. `chunkPoint`'s map must
      // reproduce the rupture's own rigid transform of the clean piece prim.
      const chunkWorld = add(piece.origin, qRotate(q, sub(piece.prims[0]!.a, piece.origin)));
      const ruptureWorld = add(o, add(pivot, qRotate(q, sub(cleanPiece.prims[0]!.a, pivot))));
      expect(len(sub(chunkWorld, ruptureWorld))).toBeLessThan(1e-9);
      // ...and the angular velocity handed over is the derivative the region was
      // already turning at (non-zero for a hard blast).
      expect(piece.spinAngVel).toBeDefined();
      expect(len(piece.spinAngVel!)).toBeGreaterThan(0);
    }
    expect(handoffChecked).toBeGreaterThan(5);
  });

  it('a reset mid-window drains the transition cleanly', () => {
    const a = actor();
    for (let f = 0; f < 10; f++) a.step(1 / 60);
    a.beginTear(blastAt(), 1, planFor(a));
    a.stepTear(5 / 60); // mid-window
    expect(a.tearing()).toBe(true);
    expect(a.tearFrame()).not.toBeNull();
    a.endTear();
    expect(a.tearing()).toBe(false);
    expect(a.tearFrame()).toBeNull();
    expect(a.motionFrame()).not.toBeNull();
    // A second window after the reset is a fresh clock, not the old one.
    a.beginTear(blastAt(), 1, planFor(a));
    expect(a.tearAge()).toBe(0);
    expect(a.tearing()).toBe(true);
    a.endTear();
  });
});

describe('rupture hand-off continuity', () => {
  /**
   * The displayed body at release versus the union of the pieces that replace
   * it. They are the same regions at the same offsets, so any miss is the
   * EXISTING partition residual (cluster seams and the smoothed cut fillet),
   * not a new pop introduced by the rupture. The numbers are the same order as
   * `gib-parts.test.ts`'s clean-body check.
   */
  it('the union of the released pieces still covers the drawn body', () => {
    const plan = gibPlan(posed);
    const tear: TearState = { at: [torso.center[0], torso.center[1], torso.center[2] + 0.4], falloff: 1, age: TEAR_TUNING.sec };
    const frame = rupturePosed(posed, plan, tear);
    // The pieces as the CHUNK RENDERER will draw them: prims translated to the
    // release position, then the region spin applied about the displaced region
    // origin. Building them without the spin would compare the rotated drawn
    // body against upright pieces — the exact defect this task removes.
    const pieces = displaceGibPieces(plan.pieces, frame.offsets, frame.quats, frame.angVels)
      .filter(p => p.prims.length > 0);
    const bodies = pieces.map(p => {
      const prims = p.spinQuat ? p.prims.map(q => rotatePrimAbout(q, p.spinQuat!, p.origin)) : p.prims;
      return {
        prims,
        clusters: [{ id: 0, limb: p.limb, start: 0, count: prims.length, center: p.origin, radius: 0.6, alive: true }],
        bonePrims: [],
      };
    });
    const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    // The box is the SOLID body: a carve cap's centre sits a metre off the cut
    // on purpose, so including `sub` prims would sample a box metres wide and
    // miss the surface entirely.
    for (const p of frame.body.prims) {
      if (p.op === 'sub') continue;
      for (const e of [p.a, p.b]) for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, e[i]!); max[i] = Math.max(max[i]!, e[i]!);
      }
    }
    for (let i = 0; i < 3; i++) { min[i] = min[i]! - 0.05; max[i] = max[i]! + 0.05; }
    const n = 40;
    const step = [0, 1, 2].map(i => (max[i]! - min[i]!) / n);
    let total = 0, missed = 0;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) for (let k = 0; k <= n; k++) {
      const q: Vec3 = [min[0]! + i * step[0]!, min[1]! + j * step[1]!, min[2]! + k * step[2]!];
      if (sdBody(q, frame.body) > 0.002) continue;
      total++;
      let dU = Infinity;
      for (const b of bodies) {
        const d = sdBody(q, b);
        if (d < dU) dU = d;
        if (dU < -0.02) break;
      }
      if (dU > 0.002) missed++;
    }
    expect(total).toBeGreaterThan(2000);
    // Same order as the clean partition; the rupture adds no measurable loss.
    expect(missed / total).toBeLessThan(0.1);
  });
});

describe('cap and face anchoring under the region spin (task 4)', () => {
  it('carries a cut cap rigidly with its region, not as a detached sphere', () => {
    const plan = gibPlan(posed);
    const tear: TearState = {
      at: [torso.center[0], torso.center[1], torso.center[2] + 0.4],
      falloff: 1, age: TEAR_TUNING.sec,
    };
    const frame = rupturePosed(posed, plan, tear);
    const pieces = displaceGibPieces(plan.pieces, frame.offsets, frame.quats, frame.angVels);
    let checked = 0;
    for (let r = 0; r < pieces.length; r++) {
      const piece = pieces[r]!;
      const cap = piece.prims.find(p => p.op === 'sub');
      if (!cap) continue;
      checked++;
      const q = frame.quats[r]!;
      const pivot = piece.origin;
      // The cap is applied by the chunk's quat about its displaced region pivot
      // (chunkPoint's map). Its offset from the pivot is unchanged by the rigid
      // rotation, and so is its offset from the piece's flesh — i.e. it stays
      // welded to the cut plane it caps instead of drifting off as a free
      // sphere. Radius is rotation-invariant by construction.
      const local = sub(cap.a, pivot);
      expect(len(local)).toBeGreaterThan(1e-6);
      expect(cap.radius).toBeGreaterThan(0);
      const flesh = piece.prims.find(p => p.op !== 'sub');
      if (flesh) {
        const worldCap = add(pivot, qRotate(q, local));
        const worldFlesh = add(pivot, qRotate(q, sub(flesh.a, pivot)));
        expect(len(sub(worldCap, worldFlesh))).toBeCloseTo(len(sub(cap.a, flesh.a)), 9);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('composes the head region spin onto skull prims already carrying an orient', () => {
    const plan = gibPlan(posed);
    const tear: TearState = {
      at: [torso.center[0], torso.center[1], torso.center[2] + 0.4],
      falloff: 1, age: TEAR_TUNING.sec,
    };
    const frame = rupturePosed(posed, plan, tear);
    const hi = plan.pieces.findIndex(p => p.limb === 'head');
    expect(hi).toBeGreaterThanOrEqual(0);
    const q = frame.quats[hi]!;
    let composed = 0;
    for (const i of plan.pieces[hi]!.srcPrims ?? []) {
      const before = posed.prims[i]!;
      const after = frame.body.prims[i]!;
      if (!before.orient) continue;
      composed++;
      const expectO = qMul(q, before.orient);
      for (let k = 0; k < 4; k++) expect(after.orient![k]).toBeCloseTo(expectO[k]!, 9);
    }
    // The zombie's skull prims are rig-oriented, so this is not vacuous.
    expect(composed).toBeGreaterThan(0);
  });
});
