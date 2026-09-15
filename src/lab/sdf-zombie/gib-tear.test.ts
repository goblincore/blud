// src/lab/sdf-zombie/gib-tear.test.ts
//
// The pre-tear window is a LOOK effect, so what is testable about it is not
// "does it look right" but the three things that would make it a bug:
//   * the envelope ends at 0, so the hand-off to the pieces has no snap to hide;
//   * nothing NaNs, and the cull bound COVERS the bent flesh (an under-covering
//     bound does not draw a wrong shape, it deletes geometry);
//   * it does not mutate the body it was handed — the actor's own `posed()` is
//     what the resolver, the wound ring and the piece set read.
import { describe, it, expect } from 'vitest';
import zombieSrc from './characters/zombie.blob?raw';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { buildBody } from './build-body';
import { applyRig, bindRig } from './rig-bind';
import { sdBody } from './validate';
import { TEAR_TUNING, tearAmount, tearPosed, type TearState } from './gib-tear';
import { len, sub } from './vec';
import type { Vec3 } from './types';

const body = buildBody(compileBlob(parseBlob(zombieSrc)));
const posed = applyRig(body, bindRig(body), 0);
const torso = posed.clusters.find(c => c.limb === 'torso')!;
const tearAt = (age: number, falloff = 1): TearState => ({ at: torso.center, falloff, age });

describe('tearAmount', () => {
  it('snaps out, relaxes to ZERO, and is inert outside its window', () => {
    expect(tearAmount(0)).toBe(0);
    // A blast arrives as an impulse: most of the displacement is there in the
    // first fifth of the window.
    expect(tearAmount(TEAR_TUNING.sec * 0.2)).toBeGreaterThan(0.7);
    // ...and the LAST frame is the body's own shape again, so the hand-off to
    // the pieces is a continuation rather than a snap back.
    expect(tearAmount(TEAR_TUNING.sec)).toBe(0);
    expect(tearAmount(TEAR_TUNING.sec * 2)).toBe(0);
    expect(tearAmount(-1)).toBe(0);
    expect(tearAmount(0, 0)).toBe(0);
    // It never dips below zero: the flesh is pushed OUT, never sucked in.
    for (let t = 0; t <= TEAR_TUNING.sec; t += TEAR_TUNING.sec / 200) {
      expect(tearAmount(t)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('tearPosed', () => {
  it('bends the flesh AWAY from the blast, most where the blast is', () => {
    const bent = tearPosed(posed, tearAt(TEAR_TUNING.sec * 0.2));
    const before = new Map(posed.prims.map((p, i) => [i, p]));
    let maxMove = 0;
    let moved = 0;
    for (let i = 0; i < posed.prims.length; i++) {
      const a = before.get(i)!;
      const b = bent.prims[i]!;
      const d = len(sub(b.a, a.a));
      if (d > 1e-6) moved++;
      if (d > maxMove) maxMove = d;
      // Every prim moves along its own outward direction from the blast.
      const outward = sub([(a.a[0] + a.b[0]) / 2, (a.a[1] + a.b[1]) / 2, (a.a[2] + a.b[2]) / 2], torso.center);
      const motion = sub(b.a, a.a);
      if (len(outward) > 1e-4 && len(motion) > 1e-6) {
        const cos = (outward[0] * motion[0] + outward[1] * motion[1] + outward[2] * motion[2])
          / (len(outward) * len(motion));
        expect(cos).toBeGreaterThan(0.99);
      }
    }
    expect(moved).toBeGreaterThan(posed.prims.length * 0.8);
    // A few centimetres, on a body whose torso radius is ~0.19 m: a bend, not a
    // relocation.
    expect(maxMove).toBeGreaterThan(0.004);
    expect(maxMove).toBeLessThan(0.05);
  });

  it('a graze barely bends and a zero falloff does nothing', () => {
    const hard = tearPosed(posed, tearAt(TEAR_TUNING.sec * 0.2, 1));
    const graze = tearPosed(posed, tearAt(TEAR_TUNING.sec * 0.2, 0.1));
    const none = tearPosed(posed, tearAt(TEAR_TUNING.sec * 0.2, 0));
    const move = (b: typeof posed) => Math.max(...posed.prims.map((p, i) => len(sub(b.prims[i]!.a, p.a))));
    expect(move(graze)).toBeLessThan(move(hard) * 0.2);
    expect(move(none)).toBe(0);
  });

  it('the cull bound still COVERS the bent flesh', () => {
    // The trap this guards is documented in extent.ts: a bound that stops
    // covering does not draw the wrong shape, it CULLS, and the symptom is a
    // round see-through hole in the body.
    const bent = tearPosed(posed, tearAt(TEAR_TUNING.sec * 0.2));
    for (const c of bent.clusters) {
      const members = bent.prims.slice(c.start, c.start + c.count);
      for (const m of members) {
        for (const e of [m.a, m.b]) {
          expect(len(sub(e, c.center))).toBeLessThanOrEqual(c.radius + 1e-9);
        }
      }
    }
  });

  it('never NaNs, and keeps the field marching', () => {
    // A prim sitting exactly on the blast point has no outward direction; if
    // that divides by zero the prim rows go NaN and the body renders black
    // rather than bent.
    const onAPrim = posed.prims[0]!;
    const centred = tearPosed(posed, { at: onAPrim.a, falloff: 1, age: TEAR_TUNING.sec * 0.2 });
    for (const p of [...centred.prims, ...(centred.bonePrims ?? [])]) {
      for (const v of [...p.a, ...p.b]) expect(Number.isFinite(v)).toBe(true);
    }
    const q: Vec3 = [torso.center[0], torso.center[1] + 0.05, torso.center[2]];
    expect(Number.isFinite(sdBody(q, centred))).toBe(true);
  });

  it('does not mutate the body it was handed', () => {
    const snapshot = JSON.stringify(posed);
    tearPosed(posed, tearAt(TEAR_TUNING.sec * 0.2));
    expect(JSON.stringify(posed)).toBe(snapshot);
  });

  it('at the END of the window it is the body again', () => {
    const after = tearPosed(posed, tearAt(TEAR_TUNING.sec));
    expect(JSON.stringify(after)).toBe(JSON.stringify(posed));
  });
});
