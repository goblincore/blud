// src/lab/sdf-zombie/gib-tear.test.ts
//
// The rupture window is a LOOK effect, so what is testable about it is not
// "does it look right" but the properties that make it a coherent transition
// rather than a second death scheduler:
//   * progress is MONOTONIC 0..1 and STOPS at 1 — the old envelope relaxed back
//     to the clean pose, which is the "the body just becomes chunks" bug;
//   * progress 0 is bit-identical to the posed body (the onset silhouette);
//   * regions move rigidly, flesh leads bone, the head is damped, cuts open;
//   * nothing NaNs, the cull bound COVERS the moved flesh (an under-covering
//     bound does not draw a wrong shape, it deletes geometry);
//   * it does not mutate the body it was handed — the actor's own `posed()` is
//     what the resolver, the wound ring and the piece plan read.
import { describe, it, expect } from 'vitest';
import zombieSrc from './characters/zombie.blob?raw';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { buildBody } from './build-body';
import { applyRig, bindRig } from './rig-bind';
import { sdBody } from './validate';
import { gibPlan } from './gib-parts';
import {
  TEAR_TUNING, ruptureProgress, rupturePosed, ruptureOffsets, type TearState,
} from './gib-tear';
import { len, sub } from './vec';
import type { Vec3 } from './types';

const body = buildBody(compileBlob(parseBlob(zombieSrc)));
const posed = applyRig(body, bindRig(body), 0);
const torso = posed.clusters.find(c => c.limb === 'torso')!;
const plan = gibPlan(posed);
const tearAt = (age: number, falloff = 1): TearState => ({ at: torso.center, falloff, age });

describe('ruptureProgress', () => {
  it('rises monotonically, reaches 1 at sec, then STAYS there', () => {
    expect(ruptureProgress(0)).toBe(0);
    expect(ruptureProgress(-1)).toBe(0);
    expect(ruptureProgress(0, 0)).toBe(0);
    // A blast arrives as an impulse: a third of the separation by 35 ms of a
    // 200 ms window.
    expect(ruptureProgress(TEAR_TUNING.sec * 0.175)).toBeGreaterThan(0.25);
    // ...and it CLAMPS at 1 instead of relaxing back to 0.
    expect(ruptureProgress(TEAR_TUNING.sec)).toBe(1);
    expect(ruptureProgress(TEAR_TUNING.sec * 2)).toBe(1);
    let prev = 0;
    for (let t = 0; t <= TEAR_TUNING.sec * 1.5; t += TEAR_TUNING.sec / 500) {
      const p = ruptureProgress(t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('rupturePosed', () => {
  it('progress 0 is the posed body, bit for bit', () => {
    const frame = rupturePosed(posed, plan, tearAt(0));
    expect(JSON.stringify(frame.body)).toBe(JSON.stringify(posed));
    for (const o of frame.offsets) expect(o).toEqual([0, 0, 0]);
  });

  it('moves flesh AWAY from the blast and bone LESS than flesh', () => {
    const { offsets } = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec));
    const at = (part: string) => offsets[plan.pieces.findIndex(p => p.part === part)]!;
    const chest = at('torso.chest');
    const cage = at('bone.cage');
    expect(len(chest)).toBeGreaterThan(0.005);
    // The chest is pushed away from the blast (outward from `torso.center`).
    const chestOrigin = plan.pieces.find(p => p.part === 'torso.chest')!.origin;
    const outward = sub(chestOrigin, torso.center);
    expect(chest[0] * outward[0] + chest[1] * outward[1] + chest[2] * outward[2]).toBeGreaterThan(0);
    // The ribcage LAGS the meat around it — that lag is the exposure.
    expect(len(cage)).toBeLessThan(len(chest));
    expect(len(cage)).toBeGreaterThan(0);
  });

  it('damps the head so the face stays recognizable', () => {
    const { offsets } = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec));
    const head = offsets[plan.pieces.findIndex(p => p.part === 'head')]!;
    // No cut touches the head and its damping is applied last, so it can never
    // exceed the damped amplitude.
    const cap = TEAR_TUNING.amplitudeM * TEAR_TUNING.headDamp * (1 + TEAR_TUNING.jiggleAmp) + 1e-9;
    expect(len(head)).toBeGreaterThan(0);
    expect(len(head)).toBeLessThanOrEqual(cap);
  });

  it('opens every cut: the two sides separate along the cut normal', () => {
    const { offsets } = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec));
    expect(plan.cuts.length).toBeGreaterThan(0);
    for (const cut of plan.cuts) {
      const rel = sub(offsets[cut.b]!, offsets[cut.a]!);
      const along = rel[0] * cut.n[0] + rel[1] * cut.n[1] + rel[2] * cut.n[2];
      expect(along).toBeGreaterThan(0);
    }
  });

  it('a graze barely moves and a zero falloff does nothing', () => {
    const hard = ruptureOffsets(plan, tearAt(TEAR_TUNING.sec, 1));
    const graze = ruptureOffsets(plan, tearAt(TEAR_TUNING.sec, 0.1));
    const none = ruptureOffsets(plan, tearAt(TEAR_TUNING.sec, 0));
    const mag = (os: Vec3[]) => Math.max(...os.map(o => len(o)));
    expect(mag(graze)).toBeLessThan(mag(hard) * 0.2);
    expect(mag(none)).toBe(0);
  });

  it('the cull bound still COVERS the moved flesh', () => {
    // The trap this guards is documented in extent.ts: a bound that stops
    // covering does not draw the wrong shape, it CULLS, and the symptom is a
    // round see-through hole in the body.
    const frame = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec));
    for (const c of frame.body.clusters) {
      for (let i = c.start; i < c.start + c.count; i++) {
        const m = frame.body.prims[i]!;
        for (const e of [m.a, m.b]) {
          expect(len(sub(e, c.center))).toBeLessThanOrEqual(c.radius + 1e-9);
        }
      }
    }
  });

  it('never NaNs, even with the blast exactly on a prim', () => {
    const onAPrim = posed.prims[0]!;
    const frame = rupturePosed(posed, plan, { at: onAPrim.a, falloff: 1, age: TEAR_TUNING.sec });
    for (const p of [...frame.body.prims, ...(frame.body.bonePrims ?? [])]) {
      for (const v of [...p.a, ...p.b]) expect(Number.isFinite(v)).toBe(true);
    }
    const q: Vec3 = [torso.center[0], torso.center[1] + 0.05, torso.center[2]];
    expect(Number.isFinite(sdBody(q, frame.body))).toBe(true);
  });

  it('is pure — the posed body is not mutated and two calls agree', () => {
    const snapshot = JSON.stringify(posed);
    const a = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec * 0.5));
    const b = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec * 0.5));
    expect(JSON.stringify(posed)).toBe(snapshot);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is deterministic as time advances (same age, same frame)', () => {
    const ages = [0.02, 0.05, 0.1, 0.15, 0.2];
    for (const age of ages) {
      const f1 = rupturePosed(posed, plan, tearAt(age));
      const f2 = rupturePosed(posed, plan, tearAt(age));
      expect(JSON.stringify(f1)).toBe(JSON.stringify(f2));
    }
  });
});
