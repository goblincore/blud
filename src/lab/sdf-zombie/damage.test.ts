// src/lab/sdf-zombie/damage.test.ts
import { describe, it, expect } from 'vitest';
import { worldHitToWound, woundWorldPos, woundCarveNormal, pushWound, MAX_WOUNDS, WOUND_PROFILES, WOUND_CARVE_DEPTH_FRAC, rimScaleFor } from './damage';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { sdBody } from './validate';
import { rotateYaw } from './gait';
import type { Primitive, Vec3 } from './types';
import { add, len, qFromAxisAngle, qMul, qRotate, sub } from './vec';

const capsule = (a: [number, number, number], b: [number, number, number]): Primitive =>
  ({ a, b, radius: 0.1, scale: [1, 1, 1], blendK: 0.05, limb: 'armL', cluster: 2 });

const sphere = (c: Vec3): Primitive =>
  ({ a: c, b: c, radius: 0.14, scale: [1, 1, 1], blendK: 0.02, limb: 'torso', cluster: 1 });

/** Rigid body turn: rotate p by `yaw` about the root pivot's vertical axis —
 *  the same transform motion.ts's heading rotation puts every rest target
 *  (and so every posed prim endpoint) through. */
const rotAbout = (p: Vec3, pivot: Vec3, yaw: number): Vec3 =>
  add(pivot, rotateYaw(sub(p, pivot), yaw));

describe('worldHitToWound / woundWorldPos', () => {
  const prims = [capsule([0, 1, 0], [0, 1.4, 0]), capsule([1, 1, 0], [1, 1.4, 0])];

  it('binds the wound to the nearest primitive', () => {
    expect(worldHitToWound(prims, [0.95, 1.2, 0], 0.06, 'pellet').primIdx).toBe(1);
    expect(worldHitToWound(prims, [0.05, 1.2, 0], 0.06, 'pellet').primIdx).toBe(0);
  });

  it('round-trips the hit point back to the same world position', () => {
    const hit: [number, number, number] = [0.09, 1.2, 0.02];
    const w = worldHitToWound(prims, hit, 0.06, 'pellet');
    const back = woundWorldPos(prims, w);
    expect(len(sub(back, hit))).toBeCloseTo(0, 8);
  });

  it('follows its primitive when the body moves — the crater stays on the flesh', () => {
    const hit: [number, number, number] = [0.09, 1.2, 0.02];
    const w = worldHitToWound(prims, hit, 0.06, 'pellet');
    const offset: [number, number, number] = [0.5, -0.3, 0.2];
    const moved = [{ ...prims[0]!, a: add(prims[0]!.a, offset), b: add(prims[0]!.b, offset) }, prims[1]!];
    const back = woundWorldPos(moved, w);
    expect(len(sub(back, add(hit, offset)))).toBeCloseTo(0, 8);
  });

  it('follows its primitive when the limb rotates', () => {
    const hit: [number, number, number] = [0.09, 1.2, 0.0];
    const w = worldHitToWound(prims, hit, 0.06, 'pellet');
    // Rotate the capsule 90° about its own head, from +Y to +X.
    const rotated = [{ ...prims[0]!, b: [0.4, 1, 0] as const }, prims[1]!];
    const back = woundWorldPos(rotated as Primitive[], w);
    // Still the same distance from the capsule axis head.
    expect(len(sub(back, rotated[0]!.a))).toBeCloseTo(len(sub(hit, prims[0]!.a)), 6);
  });

  it('records the wound type and radius', () => {
    const w = worldHitToWound(prims, [0.09, 1.2, 0], 0.09, 'burn');
    expect(w.type).toBe('burn');
    expect(w.radius).toBe(0.09);
    expect(w.ageSec).toBe(0);
  });
});

describe('wounds ride the heading rotation (motion-polish regression)', () => {
  // Owner playtest: a wound stamped on the turning body stayed fixed
  // relative to the VIEWER — the wound frame was world-axis-locked for
  // sphere prims (no axis) and vertical capsules (degenerate basis). The
  // world mapping must go through the SAME yaw the heading rotation applies.
  const pivot: Vec3 = [0, 0.92, 0]; // the pelvis line the body turns about
  const YAW = Math.PI / 2;

  it('sphere prim (torso blob): a 90° turn carries the crater with the flesh', () => {
    const atRest = sphere([0.05, 1.25, 0.12]);
    const hit: Vec3 = [0.14, 1.3, 0.2];
    const w = worldHitToWound([atRest], hit, 0.05, 'pellet', 0);
    const turned = [sphere(rotAbout(atRest.a, pivot, YAW))];
    const back = woundWorldPos(turned, w, YAW);
    expect(len(sub(back, rotAbout(hit, pivot, YAW)))).toBeCloseTo(0, 8);
  });

  it('vertical capsule (thigh, degenerate axis basis): same 90° guarantee', () => {
    const atRest = capsule([0.1, 1.3, 0.02], [0.1, 0.9, 0.02]); // axis exactly ±y
    const hit: Vec3 = [0.16, 1.1, 0.08];
    const w = worldHitToWound([atRest], hit, 0.05, 'pellet', 0);
    const turned = [capsule(
      rotAbout(atRest.a as Vec3, pivot, YAW) as [number, number, number],
      rotAbout(atRest.b as Vec3, pivot, YAW) as [number, number, number],
    )];
    const back = woundWorldPos(turned, w, YAW);
    expect(len(sub(back, rotAbout(hit, pivot, YAW)))).toBeCloseTo(0, 8);
  });

  it('oriented prim (rigid head sphere): the crater rides the orient quat', () => {
    const neck: Vec3 = [0, 1.5, 0.1];
    const q1 = qFromAxisAngle([0, 1, 0], 0.3);
    const atRest: Primitive = { ...sphere(add(neck, [0, 0.1, 0.05])), orient: q1 };
    const hit: Vec3 = add(atRest.a, [0.06, 0.03, 0.02]);
    const w = worldHitToWound([atRest], hit, 0.05, 'pellet');
    // The head turns 90° more about the neck: origin swings, quat composes.
    const dq = qFromAxisAngle([0, 1, 0], YAW);
    const turned: Primitive = {
      ...atRest,
      a: add(neck, qRotate(dq, sub(atRest.a, neck))),
      b: add(neck, qRotate(dq, sub(atRest.b, neck))),
      orient: qMul(dq, q1),
    };
    const back = woundWorldPos([turned], w);
    expect(len(sub(back, add(neck, qRotate(dq, sub(hit, neck)))))).toBeCloseTo(0, 8);
  });

  it('round-trips exactly at a nonzero yaw (stamp frame === upload frame)', () => {
    const turned = [sphere(rotAbout([0.05, 1.25, 0.12], pivot, YAW))];
    const hit: Vec3 = [0.0, 1.28, 0.2];
    const w = worldHitToWound(turned, hit, 0.05, 'blast', YAW);
    expect(len(sub(woundWorldPos(turned, w, YAW), hit))).toBeCloseTo(0, 8);
  });
});

describe('a crater on a swaying near-vertical limb does not jump (flicker regression)', () => {
  // The thigh is exactly vertical at rest and the forearm is 6 degrees off;
  // under the walk both sway a few degrees in x AND z. The owner's recording
  // (flickerzombie.mov, 2026-08-22) showed craters snapping between positions
  // on the lower torso: a live probe measured 14 basis flips and 18.6 cm
  // single-frame jumps in 2.6 s for a thigh-bound wound. The crater must move
  // with the flesh it sits on — continuously.
  const pivot: Vec3 = [0, 0.92, 0];
  const YAW = Math.PI / 2;
  const swayed = (t: number): Primitive => {
    const ax = 0.03 * Math.sin(t), az = 0.03 * Math.cos(t * 1.3); // ~6 deg tilt, rotating
    return capsule([0.1, 1.3, 0.02], [0.1 + ax, 0.9, 0.02 + az]);
  };
  it('moves the crater by no more than the flesh moved, every step of the sway', () => {
    const hit: Vec3 = [0.16, 1.1, 0.08]; // on the outer-front surface
    const w = worldHitToWound([swayed(0)], hit, 0.13, 'blast', 0);
    let prev = woundWorldPos([swayed(0)], w, 0);
    let worst = 0;
    for (let i = 1; i <= 400; i++) {
      const t = i * 0.02;
      const pos = woundWorldPos([swayed(t)], w, 0);
      // The far end moves at most 0.03 m per unit of t; per 0.02 step the
      // flesh anywhere on the capsule moves under 1 mm.
      worst = Math.max(worst, len(sub(pos, prev)));
      prev = pos;
    }
    expect(worst).toBeLessThan(0.002);
  });
  it('still rides a rigid turn exactly while swaying (the de-yaw contract holds)', () => {
    const hit: Vec3 = [0.16, 1.1, 0.08];
    const w = worldHitToWound([swayed(0)], hit, 0.13, 'blast', 0);
    const p = swayed(0.7);
    const turned = [capsule(
      rotAbout(p.a as Vec3, pivot, YAW) as [number, number, number],
      rotAbout(p.b as Vec3, pivot, YAW) as [number, number, number],
    )];
    const expected = rotAbout(woundWorldPos([p], w, 0), pivot, YAW);
    expect(len(sub(woundWorldPos(turned, w, YAW), expected))).toBeCloseTo(0, 8);
  });
});

describe('binding picks the primitive whose SURFACE the hit is on', () => {
  // The zombie's forearms hang beside its torso. Nearest-ENDPOINT binding
  // put over half of all surface hits — the whole lower torso and both
  // flanks — on a forearm or thigh, so a crater on the belly swung with the
  // arm (live probe: 6 cm per frame) and flickered with the thigh basis. A
  // hit on the torso's skin must ride the torso.
  it('a flank hit next to a hanging forearm binds to the torso blob it sits on', () => {
    const torso = sphere([0, 1.0, 0]);                         // r 0.14: skin at x 0.14
    const forearm: Primitive = { ...capsule([0.20, 1.06, 0], [0.24, 0.70, 0]), radius: 0.05 };
    const hit: Vec3 = [0.135, 1.03, 0.03];                     // on the torso skin
    // Endpoint distances: forearm top 0.078 < torso centre 0.140 — the old rule
    // picked the forearm. Surface distances: torso ≈ 0, forearm +0.03 outside.
    expect(worldHitToWound([torso, forearm], hit, 0.13, 'blast').primIdx).toBe(0);
  });
  it('a hit on the forearm itself still binds to the forearm', () => {
    const torso = sphere([0, 1.0, 0]);
    const forearm: Primitive = { ...capsule([0.20, 1.06, 0], [0.24, 0.70, 0]), radius: 0.05 };
    const hit: Vec3 = [0.27, 0.90, 0.0];                       // outer surface of the forearm
    expect(worldHitToWound([torso, forearm], hit, 0.06, 'pellet').primIdx).toBe(1);
  });
});

describe('the everted rim is scaled by the flesh behind the hit (no floating rings)', () => {
  // The cyclops (2026-08-23): a blast on a claw drew a glossy ball from one
  // angle and a dark ring from another. The rim is a Gaussian shell gated by
  // distance to the ORIGINAL skin, so on a feature thinner than the lip it
  // adds material in empty space — 36% of the rim's cells sat outside the
  // flesh in a CPU cross-section. A lip is peeled material: scale it by how
  // much flesh there was to peel.
  const field = (prims: Primitive[]) => (p: Vec3) => Math.min(...prims.map(q => {
    // capsule distance, enough for these fixtures
    const ab = sub(q.b, q.a), ap = sub(p, q.a);
    const t = Math.max(0, Math.min(1, len(ab) === 0 ? 0 : (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (len(ab) * len(ab))));
    return len(sub(p, add(q.a, [ab[0] * t, ab[1] * t, ab[2] * t]))) - q.radius;
  }));
  it('a blast on a fat torso blob keeps its full lip', () => {
    const torso = sphere([0, 1.0, 0]); // r 0.14, 0.28 m of flesh behind the hit
    const w = worldHitToWound([torso], [0.14, 1.0, 0], 0.13, 'blast', 0, field([torso]));
    expect(w.rimScale).toBeCloseTo(1, 6);
  });
  it('a blast on a claw-thin capsule gets a lip scaled to its thickness', () => {
    const claw: Primitive = { ...capsule([0.3, 0.5, 0], [0.3, 0.3, 0]), radius: 0.02 }; // 4 cm across
    const w = worldHitToWound([claw], [0.32, 0.4, 0], 0.13, 'blast', 0, field([claw]));
    expect(w.rimScale).toBeLessThan(0.7);
    expect(w.rimScale).toBeGreaterThan(0.05);
  });
  it('without a field the scale is absent and treated as 1', () => {
    const torso = sphere([0, 1.0, 0]);
    expect(worldHitToWound([torso], [0.14, 1.0, 0], 0.13, 'blast').rimScale).toBeUndefined();
  });
});

describe('the carve depth is slab-capped (no far-side punch-through)', () => {
  // Owner-verified artifact (2026-08-24): applyWounds carves r - depth at the
  // SURFACE hit with depth = the full wound radius, so on thin flesh the
  // sphere reaches through and opens the far side. The 2026-08-24 fix SHIFTED
  // the sphere centre outward — which (with hit points later found to sit on
  // the trace's hitEps shell, 1 cm outside the skin, probing zero flesh)
  // degenerated to a tangent sphere: the owner's pale/invisible-wound report
  // (2026-08-27). The slab cap instead keeps the sphere ON the anchor (the
  // lab's deep-bowl look) and clips its REACH to 45% of the measured flesh
  // along the inward normal; march.wgsl APPLY_WOUNDS applies the max().
  const capsuleField = (prims: Primitive[]) => (p: Vec3) => Math.min(...prims.map(q => {
    const ab = sub(q.b, q.a), ap = sub(p, q.a);
    const t = Math.max(0, Math.min(1, len(ab) === 0 ? 0 : (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (len(ab) * len(ab))));
    return len(sub(p, add(q.a, [ab[0] * t, ab[1] * t, ab[2] * t]))) - q.radius;
  }));

  it('thin flesh: the slab caps penetration at 45% of the thickness, sphere still on the anchor', () => {
    // A 6 cm limb vs the 13 cm blast: uncapped it would open the far side.
    const thin: Primitive = { ...capsule([0, 1, 0], [0, 1.4, 0]), radius: 0.03 };
    const hit: Vec3 = [0.03, 1.2, 0];
    const w = worldHitToWound([thin], hit, 0.13, 'blast', 0, capsuleField([thin]));
    // The probe quantises to its 4 mm step: the chord is 0.06, the last
    // inside sample lands at 0.056.
    expect(w.carveDepth).toBeCloseTo(WOUND_CARVE_DEPTH_FRAC * 0.056, 6);
    expect(w.carveDepth).toBeLessThan(0.13); // the slab genuinely binds
    // The normal points INWARD (toward the axis): the hit is on the +x face,
    // so inward is -x.
    const n = woundCarveNormal([thin], w, 0)!;
    expect(n[0]).toBeLessThan(-0.99);
    // The carve sphere centre IS the anchor — the lab's deep bowl.
    expect(len(sub(woundWorldPos([thin], w), hit))).toBeCloseTo(0, 8);
  });

  it('thick flesh: the slab never binds — carveDepth exceeds the radius', () => {
    const torso: Primitive = { ...sphere([0, 1.0, 0]), radius: 0.16 }; // 0.32 m of flesh; 45% = 0.144 > 0.13
    const hit: Vec3 = [0.16, 1.0, 0];
    const w = worldHitToWound([torso], hit, 0.13, 'blast', 0, capsuleField([torso]));
    expect(w.carveDepth).toBeDefined();
    expect(w.carveDepth!).toBeGreaterThan(0.13);
  });

  it('a hit on the hitEps shell (outside the skin) still measures the flesh behind it', () => {
    // THE pale-wound root cause: traceProjectile used to return points on
    // its 1 cm hitEps shell; probeFlesh's first 4 mm sample was still in the
    // air, thick read 0, and the old centre-shift ate the whole radius. The
    // seek must measure the real limb from the surface.
    const thin: Primitive = { ...capsule([0, 1, 0], [0, 1.4, 0]), radius: 0.03 };
    const outside: Vec3 = [0.03 + 0.01, 1.2, 0]; // 1 cm off the skin, trace-shell style
    const w = worldHitToWound([thin], outside, 0.13, 'blast', 0, capsuleField([thin]));
    // Same depth the on-skin hit measures (quantised identically) — the seek
    // snapped to the surface, not to the air.
    expect(w.carveDepth).toBeCloseTo(WOUND_CARVE_DEPTH_FRAC * 0.056, 6);
    // The anchor stays where the trace said the hit was (placement gates
    // key off it); only the measured depth snaps to the flesh.
    expect(len(sub(woundWorldPos([thin], w), outside))).toBeCloseTo(0, 8);
  });

  it('without a field there is no slab — old wounds and chunk torn-ends carve uncapped', () => {
    const prims = [capsule([0, 1, 0], [0, 1.4, 0])];
    const w = worldHitToWound(prims, [0.09, 1.2, 0], 0.13, 'blast');
    expect(w.carveN).toBeUndefined();
    expect(w.carveDepth).toBeUndefined();
    expect(woundCarveNormal(prims, w)).toBeNull();
  });

  it('the slab normal rides the body yaw exactly like the anchor does', () => {
    const pivot: Vec3 = [0, 0.92, 0];
    const YAW = Math.PI / 2;
    const thin: Primitive = { ...capsule([0, 1, 0], [0, 1.4, 0]), radius: 0.03 };
    const hit: Vec3 = [0.03, 1.2, 0];
    const w = worldHitToWound([thin], hit, 0.13, 'blast', 0, capsuleField([thin]));
    const turned: Primitive = {
      ...thin,
      a: rotAbout(thin.a, pivot, YAW) as [number, number, number],
      b: rotAbout(thin.b, pivot, YAW) as [number, number, number],
    };
    const n0 = woundCarveNormal([thin], w, 0)!;
    const tip0 = rotAbout([hit[0] + n0[0], hit[1], hit[2]], pivot, YAW);
    const base0 = rotAbout(hit, pivot, YAW);
    const expected: Vec3 = [tip0[0] - base0[0], tip0[1] - base0[1], tip0[2] - base0[2]];
    const nT = woundCarveNormal([turned], w, YAW)!;
    expect(len(sub(nT, expected))).toBeCloseTo(0, 8);
  });
});

describe('WOUND_PROFILES — per-type "weapon calibre" knobs', () => {
  it('covers all three wound types', () => {
    expect(Object.keys(WOUND_PROFILES).sort()).toEqual(['blast', 'burn', 'pellet']);
  });

  it('radii match the previous local RADIUS tables exactly', () => {
    // The lab-mains used to carry `const RADIUS = { pellet: 0.055, blast: 0.13,
    // burn: 0.08 }`. Drifting these silently retunes every wound pipeline term.
    expect(WOUND_PROFILES.pellet.radius).toBe(0.055);
    expect(WOUND_PROFILES.blast.radius).toBe(0.13);
    expect(WOUND_PROFILES.burn.radius).toBe(0.08);
  });

  it('tames the blast lip — the default splay welded the arm to the torso', () => {
    // Playtest 2026-08-16: at splay 1 the blast rim bridged the armpit gap.
    expect(WOUND_PROFILES.blast.rimSplayScale).toBeLessThan(1);
    expect(WOUND_PROFILES.blast.rimOffsetScale).toBeLessThanOrEqual(1);
  });

  it('scales are positive so the rim never inverts', () => {
    for (const p of Object.values(WOUND_PROFILES)) {
      expect(p.rimSplayScale).toBeGreaterThan(0);
      expect(p.rimOffsetScale).toBeGreaterThan(0);
    }
  });
});

describe('pushWound', () => {
  const w = (r: number) => worldHitToWound([capsule([0, 1, 0], [0, 1.4, 0])], [0.09, 1.2, 0], r, 'pellet');

  it('appends below capacity', () => {
    expect(pushWound([w(0.01), w(0.02)], w(0.03), MAX_WOUNDS)).toHaveLength(3);
  });

  it('evicts the oldest at capacity and keeps length fixed', () => {
    const full = Array.from({ length: MAX_WOUNDS }, (_, i) => w(i / 1000));
    const out = pushWound(full, w(0.99), MAX_WOUNDS);
    expect(out).toHaveLength(MAX_WOUNDS);
    expect(out[out.length - 1]!.radius).toBe(0.99);
    expect(out[0]!.radius).toBe(1 / 1000); // index 0 evicted
  });
});

it('never binds a wound to a carve', () => {
  const solid: Primitive = {
    a: [0, 0, 0], b: [0, 0, 0], radius: 0.2,
    scale: [1, 1, 1], blendK: 0.01, limb: 'head', cluster: 0,
  };
  // The carve is nearer the hit, so a naive nearest-primitive search picks it.
  const carve: Primitive = { ...solid, a: [0.5, 0, 0], b: [0.5, 0, 0], op: 'sub' };
  expect(worldHitToWound([solid, carve], [0.49, 0, 0], 0.05, 'pellet').primIdx).toBe(0);
});


// ——— The flesh probe's cap is EXACT (2026-09-10) ————————————————————————
// `probeFlesh` marches PROBE_MAX 0.6 m in PROBE_STEP 0.004 m samples — 150
// `sdBody` folds PER WOUND — and `rimScaleFor` only ever reads
// `min(1, thick / (2 * lip))`, so everything past `2 * lip` is the same answer.
// Capping the march there is what took the arena blast's wound stamping from
// 50 ms to single figures; these pin that it did not change a single rim.
//
// The reference below is the UNCAPPED probe, reimplemented here from the same
// constants, so the claim "the cap changes nothing" is checked rather than
// asserted.
describe('the flesh probe cap is exact', () => {
  const PROBE_STEP = 0.004, PROBE_MAX = 0.6, PROBE_SEEK_MAX = 0.04;

  /** probeFlesh with NO cap — the pre-2026-09-10 behaviour, verbatim. */
  function uncappedThick(field: (p: Vec3) => number, hit: Vec3, prim: Primitive): number | null {
    const ab = sub(prim.b, prim.a);
    const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const ap = sub(hit, prim.a);
    const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2));
    const axisPt = add(prim.a, [ab[0] * t, ab[1] * t, ab[2] * t]);
    const inward = sub(axisPt, hit);
    const n = len(inward);
    if (n < 1e-6) return null;
    const dir: Vec3 = [inward[0] / n, inward[1] / n, inward[2] / n];
    const measure = (from: number): number => {
      let thick = 0;
      for (let d = from; d <= PROBE_MAX; d += PROBE_STEP) {
        if (field(add(hit, [dir[0] * d, dir[1] * d, dir[2] * d])) > 0) break;
        thick = d;
      }
      return thick;
    };
    let thick = measure(PROBE_STEP);
    if (thick > 0) return thick;
    let seek = 0, entered = false;
    for (let d = PROBE_STEP; d <= PROBE_SEEK_MAX; d += PROBE_STEP) {
      seek = d;
      if (field(add(hit, [dir[0] * d, dir[1] * d, dir[2] * d])) <= 0) { entered = true; break; }
    }
    if (!entered) return 0;
    return measure(seek + PROBE_STEP) - seek;
  }

  it('rimScaleFor equals the uncapped rim at every sampled hit, on real flesh', () => {
    const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
    const field = (p: Vec3) => sdBody(p, body);
    const live = body.prims.filter(p => p.op !== 'sub' && !p.dead);
    const lips = [0.0165, 0.0715, 0.13];      // pellet-ish, blast-ish, big blast
    let checked = 0;
    for (const prim of live) {
      // Hits marching along the prim's own axis, pulled out to its surface.
      for (let u = 0; u <= 1.0001; u += 0.25) {
        const onAxis: Vec3 = [
          prim.a[0] + (prim.b[0] - prim.a[0]) * u,
          prim.a[1] + (prim.b[1] - prim.a[1]) * u,
          prim.a[2] + (prim.b[2] - prim.a[2]) * u,
        ];
        for (const off of [0.5, 1.0, 1.4]) {
          const hit: Vec3 = [onAxis[0] + prim.radius * off, onAxis[1], onAxis[2]];
          for (const lip of lips) {
            const radius = lip / (0.55 * WOUND_PROFILES.blast.rimSplayScale);
            const got = rimScaleFor(field, hit, prim, radius, 'blast');
            const thick = uncappedThick(field, hit, prim);
            if (thick === null) { expect(got).toBe(1); continue; }
            const want = Math.max(0, Math.min(1, thick / (2 * lip)));
            expect(got, `prim ${prim.limb} u=${u} off=${off} lip=${lip}: got ${got} want ${want}`)
              .toBeCloseTo(want, 12);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('a rim already at the cap stays at the cap', () => {
    // The direction the cap clamps to: thick flesh, rim full.
    const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
    const field = (p: Vec3) => sdBody(p, body);
    const torso = body.prims.find(p => p.limb === 'torso' && p.op !== 'sub')!;
    const c: Vec3 = [(torso.a[0] + torso.b[0]) / 2, (torso.a[1] + torso.b[1]) / 2, (torso.a[2] + torso.b[2]) / 2];
    const hit: Vec3 = [c[0] + torso.radius, c[1], c[2]];
    // A pellet-sized lip makes 2*lip tiny, so any real flesh fills the rim.
    const r = 0.03 / (0.55 * WOUND_PROFILES.pellet.rimSplayScale);
    expect(rimScaleFor(field, hit, torso, r, 'pellet')).toBe(1);
  });
});
