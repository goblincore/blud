// src/lab/sdf-zombie/gib-tear.test.ts
//
// The rupture window is a LOOK effect, so what is testable about it is not
// "does it look right" but the properties that make it a coherent transition
// rather than a second death scheduler:
//   * progress is MONOTONIC 0..1 and STOPS at 1 — the old envelope relaxed back
//     to the clean pose, which is the "the body just becomes chunks" bug;
//   * progress 0 is bit-identical to the posed body (the onset silhouette);
//   * regions move rigidly, flesh leads bone, the head rides the upper torso and
//     the neck opens, cuts open;
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
import { gibPlan, gibTierPlan } from './gib-parts';
import {
  TEAR_TUNING, rotatePrimAbout, ruptureGore, rupturePosed, ruptureProgress,
  ruptureOffsets, ruptureSpins, type TearState,
} from './gib-tear';
import { qFromAxisAngle, qMul, qRotate, add, cross, dot, len, normalize, sub } from './vec';
import type { Primitive, Vec3 } from './types';

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

describe('ruptureGore', () => {
  it('is exactly 0 through the recoil and exactly 1 at release', () => {
    // The release material pop is the jump from the body's goreStrength 0 to a
    // chunk's 1 (march.wgsl.ts's gore block). The ramp must therefore start at
    // the body's own value and END at the chunk's, or the switch just moves.
    expect(ruptureGore(0)).toBe(0);
    expect(ruptureGore(0.05)).toBe(0);
    expect(ruptureGore(0.1)).toBe(0);
    expect(ruptureGore(1)).toBe(1);
    expect(ruptureGore(2)).toBe(1);
    let prev = 0;
    for (let p = 0; p <= 1; p += 0.05) {
      const g = ruptureGore(p);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
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

  it('carries the head with the upper torso and opens the neck seam', () => {
    // Owner report 2026-09-16: "the chest peel currently moves upward into the
    // head, giving a false swollen/big head." The head is NOT an independently
    // damped region; it is attached to the upper torso. These are the two
    // observable consequences: the head tracks the chest's travel, and the neck
    // opens by at least `neckGapM` along the body's own axis, so the chest is
    // never above it.
    expect(TEAR_TUNING.headFollow).toBeGreaterThan(0.5);
    expect(TEAR_TUNING.neckGapM).toBeGreaterThan(0.02);
    const { offsets } = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec));
    const hi = plan.pieces.findIndex(p => p.part === 'head');
    const ci = plan.pieces.findIndex(p => p.part === 'torso.chest');
    expect(hi).toBeGreaterThanOrEqual(0);
    expect(ci).toBeGreaterThanOrEqual(0);
    const head = offsets[hi]!, chest = offsets[ci]!;
    // The head is carried by the upper torso rather than left behind under it.
    expect(len(head)).toBeGreaterThan(len(chest) * 0.5);
    // ...and the neck gap is guaranteed, not merely whatever is left over.
    const up = plan.up!;
    const along = (o: Vec3) => o[0] * up[0] + o[1] * up[1] + o[2] * up[2];
    expect(along(head) - along(chest)).toBeGreaterThanOrEqual(TEAR_TUNING.neckGapM * 0.9 - 1e-9);
    expect(along(head) - along(chest)).toBeGreaterThan(0);
  });

  it('the detached control IS the reproduced defect: the chest out-travels the head', () => {
    // `?tearhead=0&tearneck=0` is the honest A/B control for the owner's report:
    // it restores the pre-task independent-damped head. This pins that the
    // control really does reproduce the defect (the chest band climbs ~0.3 m
    // past the head along the body's own axis) so a normal-speed comparison
    // against the default is comparing the fix to the thing that broke.
    const detached = { ...TEAR_TUNING, headFollow: 0, neckGapM: 0 };
    const { offsets } = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec), detached);
    const head = offsets[plan.pieces.findIndex(p => p.part === 'head')]!;
    const chest = offsets[plan.pieces.findIndex(p => p.part === 'torso.chest')]!;
    const up = plan.up!;
    const along = (o: Vec3) => o[0] * up[0] + o[1] * up[1] + o[2] * up[2];
    // Negative: the chest is ABOVE the head along the body axis — the geometry
    // that reads as the head being swallowed / the chest becoming a big head.
    expect(along(head) - along(chest)).toBeLessThan(-0.05);
  });

  it('keeps the head coherent with the torso from onset — no independent lag', () => {
    // The failure the owner saw was relative motion: the chest travelled a third
    // of a metre more than the head. Across the whole window the head's offset
    // must stay close to the upper torso's (its own residual push plus the neck
    // gap), never the ~0.3 m shortfall the independent damping produced.
    for (const age of [0.02, 0.06, 0.12, TEAR_TUNING.sec]) {
      const { offsets } = rupturePosed(posed, plan, tearAt(age));
      const head = offsets[plan.pieces.findIndex(p => p.part === 'head')]!;
      const chest = offsets[plan.pieces.findIndex(p => p.part === 'torso.chest')]!;
      expect(len(sub(head, chest))).toBeLessThan(TEAR_TUNING.neckGapM + 0.03);
    }
  });

  it('adds a UNIFORM root recoil away from the blast', () => {
    expect(TEAR_TUNING.recoilM).toBeGreaterThan(0.01);
    const still = { ...TEAR_TUNING, recoilM: 0 };
    const { offsets: base } = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec), still);
    const { offsets: withRecoil } = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec));
    const jolt = sub(withRecoil[0]!, base[0]!);
    expect(len(jolt)).toBeGreaterThan(0.005);
    // Uniform: every region got exactly the same displacement, so the recoil
    // opens no seam (that is the seams' and the peel's job).
    for (let r = 0; r < withRecoil.length; r++) {
      expect(len(sub(sub(withRecoil[r]!, base[r]!), jolt))).toBeLessThan(1e-9);
    }
    // ...and it points away from the epicentre.
    let cx = 0, cy = 0, cz = 0;
    for (const piece of plan.pieces) { cx += piece.origin[0]; cy += piece.origin[1]; cz += piece.origin[2]; }
    const bodyC: Vec3 = [cx / plan.pieces.length, cy / plan.pieces.length, cz / plan.pieces.length];
    const away = sub(bodyC, torso.center);
    expect(jolt[0] * away[0] + jolt[1] * away[1] + jolt[2] * away[2]).toBeGreaterThan(0);
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

  it('opens the SEAMS ahead of the global push (Task-2 tuning)', () => {
    // The push is an ease-out and reads as inflation if the cuts open at the
    // same rate; the seam has its own sqrt ramp so the gap is legible in the
    // middle of the window. At the 67 ms third of a 0.2 s window the cut must
    // already be most of the way open even though the push is only ~56%.
    const cutAlong = (age: number) => {
      const { offsets } = rupturePosed(posed, plan, tearAt(age));
      let m = 0;
      for (const cut of plan.cuts) {
        const rel = sub(offsets[cut.b]!, offsets[cut.a]!);
        m = Math.max(m, rel[0] * cut.n[0] + rel[1] * cut.n[1] + rel[2] * cut.n[2]);
      }
      return m;
    };
    const early = cutAlong(TEAR_TUNING.sec * (1 / 3));
    const end = cutAlong(TEAR_TUNING.sec);
    expect(end).toBeGreaterThan(0.02);
    expect(early / end).toBeGreaterThan(0.55);
  });

  it('the skeleton lags the flesh far enough to be exposed', () => {
    // Task-2 tuning: 0.15 rather than 0.3. The cage must stay near the body's
    // own pose while the chest leaves, or there is no gap for it to sit in.
    expect(TEAR_TUNING.boneLag).toBeLessThan(0.25);
    const { offsets } = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec));
    const flesh = offsets[plan.pieces.findIndex(p => p.part === 'torso.chest')]!;
    const cage = offsets[plan.pieces.findIndex(p => p.part === 'bone.cage')]!;
    expect(len(cage)).toBeLessThan(len(flesh) * 0.5);
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
    // round see-through hole in the body. Carve (`sub`) prims are excluded on
    // purpose — a carve is a hole, not a surface, and `assignClusters` has
    // never let one inflate a cluster sphere (the cut caps' centres sit a
    // metre from the plane by design).
    const frame = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec));
    for (const c of frame.body.clusters) {
      for (let i = c.start; i < c.start + c.count; i++) {
        const m = frame.body.prims[i]!;
        if (m.op === 'sub') continue;
        for (const e of [m.a, m.b]) {
          expect(len(sub(e, c.center))).toBeLessThanOrEqual(c.radius + 1e-9);
        }
      }
    }
  });

  it('peels the ribcage-bearing chest band along the body axis', () => {
    // Task 3: the chest band lifts along the plan's own cranial axis, which is
    // what opens a real gap over the cage independent of where the bundle
    // landed. The abdominal band gets none of it.
    expect(TEAR_TUNING.chestPeelM).toBeGreaterThan(0.05);
    const { offsets } = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec));
    const chest = plan.pieces.findIndex(p => p.part === 'torso.chest');
    const abdomen = plan.pieces.findIndex(p => p.part === 'torso.abdomen');
    expect(plan.up).toBeDefined();
    const up = plan.up!;
    const along = (o: Vec3) => o[0] * up[0] + o[1] * up[1] + o[2] * up[2];
    // The chest is lifted at least the peel beyond the abdomen's own travel.
    expect(along(offsets[chest]!) - along(offsets[abdomen]!)).toBeGreaterThan(TEAR_TUNING.chestPeelM * 0.7);
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

// ---------------------------------------------------------------------------
// TASK 4 — the blast-driven rotation. The owner's correction: before this the
// regions only TRANSLATED and every piece stayed upright, so the breakup read
// as an exploded assembly diagram. These pin the observable outcomes: identity
// at onset, a nonzero VARIED pose by release, flesh > skeleton > head, rigid
// prim transforms, determinism, and the finite degenerate blast.
// ---------------------------------------------------------------------------
describe('ruptureSpins (blast-driven rotation)', () => {
  it('is identity at onset and nonzero across the body by release', () => {
    const at0 = rupturePosed(posed, plan, tearAt(0));
    for (const q of at0.quats) expect(q).toEqual([0, 0, 0, 1]);
    for (const w of at0.angVels) expect(w).toEqual([0, 0, 0]);
    const end = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec));
    const spun = end.quats.filter(q => !(q[0] === 0 && q[1] === 0 && q[2] === 0 && q[3] === 1));
    expect(spun.length).toBeGreaterThan(plan.pieces.length * 0.5);
    expect(end.angVels.length).toBe(plan.pieces.length);
  });

  it('gives the regions DIFFERENT axes and rates, not one synchronous spin', () => {
    const { angVels } = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec));
    const axes = angVels.filter(w => len(w) > 1e-6).map(w => normalize(w));
    expect(axes.length).toBeGreaterThan(4);
    let dotSum = 0, pairs = 0;
    for (let i = 0; i < axes.length; i++) {
      for (let j = i + 1; j < axes.length; j++) {
        dotSum += Math.abs(dot(axes[i]!, axes[j]!));
        pairs++;
      }
    }
    // A fully synchronous spin would average |dot| ~ 1; independent axes ~ 0.
    expect(dotSum / pairs).toBeLessThan(0.95);
    const rates = angVels.map(len).filter(r => r > 1e-6);
    expect(Math.max(...rates) - Math.min(...rates)).toBeGreaterThan(0.1);
  });

  it('turns flesh more than the skeleton and the head least', () => {
    const { angVels } = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec));
    const rate = (part: string) => len(angVels[plan.pieces.findIndex(p => p.part === part)]!);
    const chest = rate('torso.chest');
    const cage = rate('bone.cage');
    const head = rate('head');
    expect(chest).toBeGreaterThan(0);
    expect(cage).toBeGreaterThan(0);
    expect(head).toBeGreaterThan(0);
    expect(cage).toBeLessThan(chest);
    expect(head).toBeLessThan(cage);
  });

  it('does not rotate on a zero falloff, and is finite on a degenerate blast', () => {
    const none = rupturePosed(posed, plan, tearAt(TEAR_TUNING.sec, 0));
    for (const q of none.quats) expect(q).toEqual([0, 0, 0, 1]);
    for (const w of none.angVels) expect(w).toEqual([0, 0, 0]);

    const p0 = posed.prims[0]!;
    const onAPrim = rupturePosed(posed, plan, { at: p0.a, falloff: 1, age: TEAR_TUNING.sec });
    for (const q of onAPrim.quats) for (const v of q) expect(Number.isFinite(v)).toBe(true);
    for (const w of onAPrim.angVels) {
      for (const v of w) expect(Number.isFinite(v)).toBe(true);
      expect(len(w)).toBeLessThanOrEqual(TEAR_TUNING.spinRadPerSec * 2.2 + 1e-9);
    }
  });

  it('rotates rigidly and deterministically as the window advances', () => {
    for (const age of [0.03, 0.08, 0.15, 0.2]) {
      const a = rupturePosed(posed, plan, tearAt(age));
      const b = rupturePosed(posed, plan, tearAt(age));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      // Rigid: a prim's distance to its own region pivot is preserved (compare
      // against the DISPLACED pivot, since the region is also translated).
      for (let r = 0; r < plan.pieces.length; r++) {
        const piece = plan.pieces[r]!;
        const i = piece.srcPrims?.[0];
        if (i === undefined) continue;
        const before = len(sub(posed.prims[i]!.a, piece.origin));
        const pivot = add(piece.origin, a.offsets[r]!);
        const after = len(sub(a.body.prims[i]!.a, pivot));
        expect(after).toBeCloseTo(before, 4);
      }
    }
  });

  it('spins tight-budget CLUSTER plans, which use cluster centres as pivots', () => {
    const clusterPlan = gibTierPlan(posed, 9, { mode: 'clusters', at: torso.center }).plan;
    expect(clusterPlan.pieces.length).toBeGreaterThan(0);
    const at0 = rupturePosed(posed, clusterPlan, tearAt(0));
    for (const q of at0.quats) expect(q).toEqual([0, 0, 0, 1]);
    const end = rupturePosed(posed, clusterPlan, tearAt(TEAR_TUNING.sec));
    expect(end.quats.length).toBe(clusterPlan.pieces.length);
    for (const w of end.angVels) {
      expect(Number.isFinite(len(w))).toBe(true);
      expect(len(w)).toBeLessThanOrEqual(TEAR_TUNING.spinRadPerSec * 2.2 + 1e-9);
    }
  });

  it('plans no spin for a previously severed limb (the representation differs)', () => {
    const severed = {
      ...posed,
      clusters: posed.clusters.map(c => c.limb === 'armL' ? { ...c, alive: false } : c),
    };
    const sPlan = gibPlan(severed);
    // The flesh representation drops the arm entirely (gib-parts); the bones
    // are released as their own pieces and are outside this task's scope.
    expect(sPlan.pieces.some(p => p.part.startsWith('armL.'))).toBe(false);
    const end = rupturePosed(severed, sPlan, tearAt(TEAR_TUNING.sec));
    expect(end.quats.length).toBe(sPlan.pieces.length);
    for (const w of end.angVels) expect(Number.isFinite(len(w))).toBe(true);
  });
});

describe('rotatePrimAbout (region prim transform)', () => {
  it('turns endpoints, composes orient, rotates bend and the shell clip', () => {
    const pivot: Vec3 = [0, 1, 0];
    const q = qFromAxisAngle([0, 1, 0], Math.PI / 2);
    const orient: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    const p: Primitive = {
      a: [0.3, 1, 0], b: [0.3, 1.5, 0], radius: 0.05, scale: [2, 1, 0.5], blendK: 0,
      limb: 'head', cluster: 0, orient,
      bend: [0, 0, 0.1],
      shell: { thickness: 0.01, clipNormal: [1, 0, 0], clipOffset: 0, rim: 0 },
    };
    const r = rotatePrimAbout(p, q, pivot);
    const expectA = add(pivot, qRotate(q, sub(p.a, pivot)));
    const expectB = add(pivot, qRotate(q, sub(p.b, pivot)));
    expect(len(sub(r.a, expectA))).toBeLessThan(1e-9);
    expect(len(sub(r.b, expectB))).toBeLessThan(1e-9);
    // The local scale basis is unchanged; `orient` carries the rotation.
    expect(r.scale).toEqual(p.scale);
    const expectO = qMul(q, orient);
    for (let k = 0; k < 4; k++) expect(r.orient![k]).toBeCloseTo(expectO[k]!, 9);
    expect(len(sub(r.bend!, qRotate(q, p.bend!)))).toBeLessThan(1e-9);
    expect(len(sub(r.shell!.clipNormal, qRotate(q, p.shell!.clipNormal)))).toBeLessThan(1e-9);
  });

  it('leaves a uniform sphere orientless so the cheap shader path survives', () => {
    const q = qFromAxisAngle([0, 1, 0], 0.5);
    const sphere: Primitive = {
      a: [0, 1, 0], b: [0, 1, 0], radius: 0.1, scale: [1, 1, 1], blendK: 0,
      limb: 'torso', cluster: 0,
    };
    const r = rotatePrimAbout(sphere, q, [0, 1, 0]);
    expect(r.orient).toBeUndefined();
    expect(len(sub(r.a, sphere.a))).toBeLessThan(1e-9);
  });
});
