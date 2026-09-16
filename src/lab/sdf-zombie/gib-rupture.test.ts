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
import { rupturePosed, TEAR_TUNING, type TearState } from './gib-tear';
import { sdBody } from './validate';
import { createZombieActor } from './webgpu/game-actor';
import { add, len, sub } from './vec';
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
      setWounds() {}, update() {}, setBonesBare() {}, setPackBones() {},
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

  it('the released frame is the plan displaced by the frame it was drawn at', () => {
    const a = actor();
    for (let f = 0; f < 10; f++) a.step(1 / 60);
    const plan = planFor(a);
    a.beginTear(blastAt(), 1, plan);
    a.stepTear(TEAR_TUNING.sec);
    expect(a.tearing()).toBe(false);
    const frame = a.tearFrame()!;
    // The drawn body and the pieces use the SAME offsets: no second partition,
    // no snap. Piece i is the plan's region i translated by offsets[i].
    const pieces = displaceGibPieces(plan.pieces, frame.offsets);
    for (let i = 0; i < plan.pieces.length; i++) {
      const region = frame.offsets[i]!;
      const before = plan.pieces[i]!;
      const after = pieces[i]!;
      for (let k = 0; k < before.prims.length; k++) {
        const p0 = before.prims[k]!;
        const p1 = after.prims[k]!;
        expect(p1.a[0] - p0.a[0]).toBeCloseTo(region[0], 10);
        expect(p1.a[1] - p0.a[1]).toBeCloseTo(region[1], 10);
        expect(p1.a[2] - p0.a[2]).toBeCloseTo(region[2], 10);
      }
    }
    // ...and the drawn body's own flesh prims moved by their region's offset.
    const clean = a.posed();
    const prim0 = clean.prims[0]!;
    const r0 = plan.pieces.findIndex(p => (p.srcPrims ?? []).includes(0));
    if (r0 >= 0) {
      expect(frame.body.prims[0]!.a[0] - prim0.a[0]).toBeCloseTo(frame.offsets[r0]![0], 10);
      expect(frame.body.prims[0]!.a[1] - prim0.a[1]).toBeCloseTo(frame.offsets[r0]![1], 10);
    }
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
    const pieces = displaceGibPieces(plan.pieces, frame.offsets).filter(p => p.prims.length > 0);
    // A one-cluster body per piece, so the CPU field can sample each piece.
    const bodies = pieces.map(p => ({
      prims: p.prims,
      clusters: [{ id: 0, limb: p.limb, start: 0, count: p.prims.length, center: p.origin, radius: 0.6, alive: true }],
      bonePrims: [],
    }));
    const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    for (const p of frame.body.prims) for (const e of [p.a, p.b]) for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, e[i]!); max[i] = Math.max(max[i]!, e[i]!);
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
