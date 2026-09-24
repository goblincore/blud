// src/lab/sdf-zombie/webgpu/march-step-soundness.test.ts
//
// Is the near-wound step SHORT ENOUGH? MARCH_BODY steps `d * WOUND_STEP_MUL`
// wherever applyWounds raises its nearWound flag, because the wounded field is
// not a distance bound there (the smax fillet overstates, the lip understates,
// and rimLocal makes the lip's magnitude swing with the pre-wound field). A
// sphere-trace step of `mul * d` only stays outside the surface when
// `mul <= 1 / max|grad d|`, so the multiplier is only as good as that gradient
// — and nothing checked it until 2026-09-04, when the shipped 0.6 was measured
// against it and found 25% too long for a SINGLE stock wound.
//
// Two tests, deliberately different in kind:
//
//   1. The analytic bound. Content-independent: planar flesh, one stock wound,
//      numerically maximised |grad| over the flagged zone. This is the one that
//      generalises — it holds for every body, every pose.
//   2. A production fixture. The real ZOMBIE, wounds stamped by the real
//      damage code, and ONE recorded ray that at 0.6 shaded 16 mm inside the
//      flesh. Analytic bounds can be argued with; a ray that lands in the meat
//      cannot.
//
// THIS FILE MIRRORS applyWounds IN TYPESCRIPT, which is a drift hazard — so it
// also pins the WGSL lines it mirrors. Change applyWounds and these fail
// loudly, which is the point: the mirror must be updated in the same commit.
// (Nothing in this repo compiles WGSL — see march.wgsl.test.ts's header.)

import { describe, it, expect } from 'vitest';
import { MARCH_BODY, APPLY_WOUNDS, WOUND_STEP_MUL } from './march.wgsl';
import { ZOMBIE } from '../body';
import { buildBody } from '../build-body';
import { sdBody, smax } from '../validate';
import { worldHitToWound, woundWorldPos, woundCarveNormal, WOUND_PROFILES, CLOTH_BULLET_HOLE_RADIUS, type WoundType } from '../damage';
import type { Vec3 } from '../types';

/** woundCfg (y, z, w) and woundCfg2.x as zombie-gpu.ts binds them. */
const BLEND_K = 0.015, RIM_SPLAY = 0.55, RIM_OFFSET = 1.15, RIM_WIDTH = 0.42;
/** aaCfg.x at the game's 75-degree fov and a 1080-row SDF pass, aaCfg.y = 1. */
const PIXEL_CONE_K = Math.tan((75 * Math.PI) / 360) / 1080;
/** The 1.2 mm literal floor under the AA epsilon. */
const HIT_EPS_BASE = 0.0012;

interface WoundRow {
  pos: Vec3; radius: number; type: number; age: number;
  splayScale: number; offsetScale: number; capN: Vec3 | null; capDepth: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** applyWounds, line for line. Returns [field, nearWound]. */
function applyWounds(dIn: number, p: Vec3, ws: readonly WoundRow[]): [number, number] {
  let d = dIn, near = 0;
  for (const w of ws) {
    const dx = p[0] - w.pos[0], dy = p[1] - w.pos[1], dz = p[2] - w.pos[2];
    const r = Math.hypot(dx, dy, dz);
    const capEff = w.capN && w.capDepth > 0 ? w.capDepth : 1.0e5;
    const cn = w.capN ?? ([0, 0, 0] as Vec3);
    const isBurn = w.type > 1.5;
    const depth = isBurn ? w.radius * 0.35 * Math.min(1, Math.max(0, w.age)) : w.radius;
    // Size-scaled fillet (cloth bullet holes): k = BLEND_K * clamp(r / 0.05, 0.1, 1).
    const kW = BLEND_K * Math.min(1, Math.max(0.1, w.radius / 0.05));
    d = smax(d, Math.min(-(r - depth), capEff - (dx * cn[0] + dy * cn[1] + dz * cn[2])), kW);
    if (r < depth * 2) near = 1;
    const x = (r - depth * RIM_OFFSET * w.offsetScale) / Math.max(depth * RIM_WIDTH, 1e-4);
    const amp = depth * RIM_SPLAY * w.splayScale * (isBurn ? 0.25 : 1);
    d = d - Math.exp(-x * x) * amp * (1 - smoothstep(-amp * 0.3, amp * 0.7, dIn));
  }
  return [d, near];
}

/** MARCH_BODY's loop at the game's settings: omega 1.0 (GAME_OMEGA), shellAmp
 *  0 so `conservative` never fires, relax off so neither retraction exists. */
function march(cam: Vec3, rd: Vec3, tStart: number, tMax: number,
               field: (p: Vec3) => [number, number], mul: number) {
  let t = Math.min(Math.max(tStart, 0), tMax);
  for (let i = 0; i < 96; i++) {
    const p: Vec3 = [cam[0] + rd[0] * t, cam[1] + rd[1] * t, cam[2] + rd[2] * t];
    const [d, near] = field(p);
    const hitEps = Math.max(HIT_EPS_BASE, t * PIXEL_CONE_K);
    if (d < hitEps) return { hit: true, t, d, hitEps, steps: i + 1 };
    t += d * (near > 0.5 ? mul : 1.0);
    if (t > tMax) break;
  }
  return { hit: false, t, d: 0, hitEps: Math.max(HIT_EPS_BASE, t * PIXEL_CONE_K), steps: 96 };
}

describe('near-wound step multiplier', () => {
  it('records the field gradient the multiplier is being chosen against', () => {
    // Planar flesh (d = p.z) and one wound at the origin, so the only thing
    // bending the field is applyWounds itself. Central differences over the
    // flagged zone (r < 2 * radius), sampled where a marching ray can actually
    // be — outside the surface and within a step of it.
    //
    // Measured 2026-09-04, converged by N = 60 (N = 90 moves it < 1%):
    //   blast  max|grad| 2.06  ->  the largest sound multiplier is 0.49
    //   pellet max|grad| 2.09  ->                                   0.48
    // The peak sits on the everted lip's inner wall, where rimLocal is fading
    // the bump out as dIn rises: the lip term's magnitude tracks the field it
    // is being subtracted from, and that feedback is most of the gradient.
    const cases: [string, WoundRow][] = [
      ['blast', { pos: [0, 0, 0], radius: WOUND_PROFILES.blast.radius, type: 1, age: 1,
        splayScale: WOUND_PROFILES.blast.rimSplayScale,
        offsetScale: WOUND_PROFILES.blast.rimOffsetScale,
        capN: [0, 0, -1], capDepth: WOUND_PROFILES.blast.radius * 0.45 }],
      ['pellet', { pos: [0, 0, 0], radius: WOUND_PROFILES.pellet.radius, type: 0, age: 1,
        splayScale: WOUND_PROFILES.pellet.rimSplayScale,
        offsetScale: WOUND_PROFILES.pellet.rimOffsetScale,
        capN: [0, 0, -1], capDepth: WOUND_PROFILES.pellet.radius * 0.45 }],
      // A small-calibre bullet hole in cloth (damage.ts CLOTH_BULLET_HOLE_RADIUS):
      // the size-scaled fillet makes its k 0.1x, so it must stay sound too.
      ['cloth hole', { pos: [0, 0, 0], radius: CLOTH_BULLET_HOLE_RADIUS, type: 0, age: 1,
        splayScale: WOUND_PROFILES.pellet.rimSplayScale,
        offsetScale: WOUND_PROFILES.pellet.rimOffsetScale,
        capN: [0, 0, -1], capDepth: CLOTH_BULLET_HOLE_RADIUS }],
    ];
    for (const [name, w] of cases) {
      const field = (p: Vec3) => applyWounds(p[2], p, [w])[0];
      const R = 2 * w.radius, h = 1e-4, N = 60;
      let maxGrad = 0;
      for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) for (let k = 0; k <= N; k++) {
        const p: Vec3 = [(i / N - 0.5) * 2 * R, (j / N - 0.5) * 2 * R, (k / N - 0.5) * 2 * R];
        if (Math.hypot(p[0], p[1], p[2]) > R) continue;
        const d0 = field(p);
        if (d0 < 0 || d0 > 0.08) continue;
        const g = Math.hypot(
          (field([p[0] + h, p[1], p[2]]) - field([p[0] - h, p[1], p[2]])) / (2 * h),
          (field([p[0], p[1] + h, p[2]]) - field([p[0], p[1] - h, p[2]])) / (2 * h),
          (field([p[0], p[1], p[2] + h]) - field([p[0], p[1], p[2] - h])) / (2 * h),
        );
        if (g > maxGrad) maxGrad = g;
      }
      // The field really is non-conservative here — if this ever collapses
      // toward 1 the mirror has gone trivial and this file proves nothing.
      expect(maxGrad, `${name} gradient`).toBeGreaterThan(1.5);
      expect(maxGrad, `${name} gradient`).toBeLessThan(3);
      // THE SHIPPED MULTIPLIER IS DELIBERATELY ABOVE 1 / maxGrad. Sphere
      // tracing is only guaranteed not to overshoot below that bound, and 0.6
      // is ~24% over it — the owner A/B'd the sound value on screen, could not
      // see the difference, and kept the steps. So this asserts the direction
      // that would be a REGRESSION rather than the bound: nobody may lengthen
      // the wound step past what shipped. Tightening it toward
      // ${(1 / maxGrad).toFixed(2)} is always allowed and needs no change here.
      expect(WOUND_STEP_MUL, `sound bound is ${(1 / maxGrad).toFixed(3)}`)
        .toBeLessThanOrEqual(0.6);
    }
  });

  it('takes a live override so the old value can be A/B tested on screen', () => {
    // perfCfg.z, and ZERO KEEPS THE COMPILED CONSTANT — every view that never
    // writes the lane marches bit-identically, which is the same identity rule
    // perfCfg's other seams follow.
    //
    // perfCfg and not counts2's spare lanes: counts2 is re-set wholesale on
    // every pack (`u.counts2.value.set(boneCount, bareBones, 0, 0)`), so an
    // override parked there would vanish the next time the body was rebuilt —
    // the silent-reset bug this codebase keeps re-learning. perfCfg is a
    // settings uniform, written per-lane and copied into chunk views from the
    // template, so a gib carries the same setting its body had.
    expect(MARCH_BODY).toContain(
      `let woundMul = select(${WOUND_STEP_MUL}, perfCfg.z, perfCfg.z > 0.0);`);
  });

  it('pins the WGSL this file mirrors', () => {
    // The step rule itself: two independent reasons to under-relax, and the
    // stricter one wins.
    expect(MARCH_BODY).toContain(
      'stepLen = d * min(select(omega, 0.6, conservative), select(omega, woundMul, nearWound));');
    // The three applyWounds lines the mirror above reproduces. Edit any of
    // them and update the mirror in the same commit, or this file is lying.
    expect(APPLY_WOUNDS).toContain(
      'let kW = woundCfg.y * clamp(w.w / 0.05, 0.1, 1.0);');
    expect(APPLY_WOUNDS).toContain(
      'd = smax(d, min(-(rN - depth) * carveK, capEff - dot(p - w.xyz, wCap.xyz)), kW);'); // rN = r, carveK = 1 for round wounds
    expect(APPLY_WOUNDS).toContain('if (rN < depth * 2.0) { near = 1.0; }');
    expect(APPLY_WOUNDS).toContain('d = d - exp(-x * x) * amp * rimLocal;');
    expect(APPLY_WOUNDS).toContain('let rimLocal = 1.0 - smoothstep(-amp * 0.3, amp * 0.7, dIn);');
  });
});
