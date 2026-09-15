// src/lab/sdf-zombie/explosion-aoe.test.ts
//
// Pure-unit tests for the explosion AOE resolver: falloff endpoints, wound
// bounding, impulse direction/magnitude, air-vs-ground burst selection,
// meter credit scaling, hand-splash
// gating, determinism, and input immutability.
import { describe, it, expect } from 'vitest';
import {
  resolveExplosion, explosionRadiusM, linearFalloff, blastDamage,
  concussionVelocity, EXPLOSION_TUNING, primLowerBoundM, segmentDistanceM,
} from './explosion-aoe';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from './build-body';
import { ZOMBIE } from './body';
import { WOUND_PROFILES } from './damage';
import { sdBody, sdPrimitive } from './validate';
import { cutChains, cutLimbs } from './connectivity';
import { COLLAPSE_TUNING } from './collapse';
import { HAND_PRIMS } from './hands';
import type { ClusterInfo, Primitive, Vec3 } from './types';
import { add, len, sub } from './vec';
import { rotateYaw } from './gait';
import { woundWorldPos, worldHitToWound } from './damage';
import {
  EXPLOSION_STANDARD, EXPLOSION_LAUNCH, EXPLOSION_VFX_HEIGHT_SCALE,
  GROUND_BURST_THRESHOLD_M, GIB_THRESHOLD,
} from '../../game/gibs/tuning';

// ——— Fixtures —————————————————————————————————————————————————————————

const R = explosionRadiusM(); // (150/256)×8 = 4.6875 m
const FULL_DMG = (EXPLOSION_STANDARD.damage + EXPLOSION_STANDARD.damageRange) * 12;

/** A one-prim sphere body at a chosen point — exact surface distances. */
function ballBody(center: Vec3, radius = 0.3): BuildResult {
  const prim: Primitive = {
    a: center, b: center, radius, scale: [1, 1, 1], blendK: 0.01,
    limb: 'torso', cluster: 1,
  };
  const cluster: ClusterInfo = {
    id: 1, limb: 'torso', start: 0, count: 1,
    center: [center[0], center[1], center[2]], radius, alive: true,
  };
  return { prims: [prim], clusters: [cluster], bones: new Map(), bonePrims: [], errors: [] };
}

/** The real zombie, built once — wound/sever behaviour against authored flesh. */
const zombie = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);

/** World-space hand prims anchored at `anchor` (hands.prims are camera-local). */
function handsAt(anchor: Vec3): Primitive[] {
  return [...HAND_PRIMS.left, ...HAND_PRIMS.right].map(p => ({
    ...p,
    a: add(p.a, anchor) as Vec3,
    b: add(p.b, anchor) as Vec3,
  }));
}

// ——— Falloff endpoints ———————————————————————————————————————————————

describe('falloff endpoints', () => {
  it('radius converts via BU → m × the sim scale', () => {
    expect(R).toBeCloseTo(4.6875, 10);
  });

  it('linear falloff is full at the epicentre, zero at the radius edge', () => {
    expect(linearFalloff(0, R)).toBe(1);
    expect(linearFalloff(R, R)).toBe(0);
    expect(linearFalloff(R + 1, R)).toBe(0);
    expect(linearFalloff(R / 2, R)).toBeCloseTo(0.5, 12);
  });

  it('damage is the game formula: full stack at the epicentre, zero at the edge', () => {
    expect(blastDamage(0, R)).toBe(FULL_DMG); // 30 × 12 = 360
    expect(blastDamage(R, R)).toBe(0);
    expect(FULL_DMG).toBeGreaterThanOrEqual(GIB_THRESHOLD); // point-blank gibs
  });

  it('a body with its surface at the epicentre is gibbed; at the edge, untouched', () => {
    const centre: Vec3 = [0, 1, 0];
    const pointBlank = resolveExplosion(centre, [{ id: 'a', body: ballBody(centre) }]);
    expect(pointBlank.perBody[0]!.distM).toBeCloseTo(0, 6);
    expect(pointBlank.perBody[0]!.damage).toBeCloseTo(FULL_DMG, 6);
    expect(pointBlank.perBody[0]!.gibbed).toBe(true);

    // Surface exactly at the radius edge → no effect entry at all.
    const edge = resolveExplosion([0, 1, 0], [{ id: 'a', body: ballBody([R + 0.3, 1, 0]) }]);
    expect(edge.perBody).toHaveLength(0);
  });
});

// ——— Wounds ———————————————————————————————————————————————————————————

describe('wound stamping', () => {
  it('stamps one falloff-scaled blast wound per live prim, ring-bounded', () => {
    const torso = zombie.clusters.find(c => c.limb === 'torso')!;
    const fx = resolveExplosion(torso.center, [{ id: 'z', body: zombie }]);
    const e = fx.perBody[0]!;
    const liveAddPrims = zombie.prims.filter(p => p.op !== 'sub' && !p.dead).length;
    expect(liveAddPrims).toBeGreaterThan(EXPLOSION_TUNING.maxWoundsPerBody);
    expect(e.wounds.length).toBe(EXPLOSION_TUNING.maxWoundsPerBody); // nearest prims fill the ring
    for (const w of e.wounds) {
      expect(w.type).toBe('blast');
      expect(w.radius).toBeLessThanOrEqual(WOUND_PROFILES.blast.radius + 1e-12);
      expect(w.ageSec).toBe(0);
    }
  });

  it('far-side grazes are shallower than the near side (per-wound falloff)', () => {
    // Blast 2 m to +x of a wide body: the +x surfaces are nearer than the
    // -x ones, so not every wound can sit at the maximum radius.
    const fx = resolveExplosion([2, 1, 0], [{ id: 'z', body: zombie }]);
    const e = fx.perBody[0]!;
    expect(e.wounds.length).toBeGreaterThan(0);
    const radii = e.wounds.map(w => w.radius);
    expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii));
  });

  it('feeds the sever/chain-cut checks with exactly its own wounds', () => {
    const torso = zombie.clusters.find(c => c.limb === 'torso')!;
    // Mid-ring blast: no gib, so the cut checks run on the stamped wounds.
    const fx = resolveExplosion([3, 1.2, 0.5], [{ id: 'z', body: zombie }]);
    const e = fx.perBody[0]!;
    expect(e.gibbed).toBe(false);
    expect(e.severedLimbs).toEqual(cutLimbs(zombie, e.wounds, torso.center));
    expect(e.chainCuts).toEqual(cutChains(zombie, e.wounds));
  });

  it('sever checks are skipped when the blast gibs outright', () => {
    const torso = zombie.clusters.find(c => c.limb === 'torso')!;
    const fx = resolveExplosion(torso.center, [{ id: 'z', body: zombie }]);
    expect(fx.perBody[0]!.gibbed).toBe(true);
    expect(fx.perBody[0]!.severedLimbs).toEqual([]);
    expect(fx.perBody[0]!.chainCuts).toEqual([]);
  });

  it('skips a gibbed body\u2019s wounds only when the caller says they are unread', () => {
    // The default is the historical contract: every in-range body is stamped,
    // gibbed or not, because the lab and the gates read `wounds` off the
    // resolve result.
    const torso = zombie.clusters.find(c => c.limb === 'torso')!;
    const withWounds = resolveExplosion(torso.center, [{ id: 'z', body: zombie }]);
    expect(withWounds.perBody[0]!.gibbed).toBe(true);
    expect(withWounds.perBody[0]!.wounds.length).toBe(EXPLOSION_TUNING.maxWoundsPerBody);

    // A caller that gibs instead of damaging (the active game) passes FALSE and
    // gets none — a pure saving, since it never reads them. Everything else
    // about the effect is untouched, including the shove the gib branch uses.
    const skipped = resolveExplosion(torso.center, [{ id: 'z', body: zombie }], {
      woundsOnGibbed: false,
    });
    const e = skipped.perBody[0]!;
    expect(e.gibbed).toBe(true);
    expect(e.wounds).toEqual([]);
    expect(e.meterCredit).toBe(0);
    expect(e.damage).toBeCloseTo(withWounds.perBody[0]!.damage, 12);
    expect(e.falloff).toBeCloseTo(withWounds.perBody[0]!.falloff, 12);
    expect(e.rigImpulse?.vel).toEqual(withWounds.perBody[0]!.rigImpulse?.vel);
    // ...and the shove is a real one, so the skip cannot silently take it with
    // it: a gibbed body still flies.
    expect(e.rigImpulse?.vel.some(v => Math.abs(v) > 1)).toBe(true);
  });

  it('a blast over the TORSO opens cavities; limb wounds never do (entrails)', () => {
    const torso = zombie.clusters.find(c => c.limb === 'torso')!;
    const fx = resolveExplosion(torso.center, [{ id: 'z', body: zombie }]);
    const e = fx.perBody[0]!;
    expect(e.wounds.length).toBeGreaterThan(0);
    const torsoWounds = e.wounds.filter(w => zombie.prims[w.primIdx]!.limb === 'torso');
    const limbWounds = e.wounds.filter(w => zombie.prims[w.primIdx]!.limb !== 'torso');
    // Point-blank at the belly: the near side is all torso, so the flag is
    // genuinely exercised, not vacuously true.
    expect(torsoWounds.length).toBeGreaterThan(0);
    for (const w of torsoWounds) expect(w.cavity).toBe(true);
    // Whatever limb wounds the ring caught stay non-cavity — a thigh is a
    // wall of meat, same gate as the slug path.
    for (const w of limbWounds) expect(w.cavity).toBeFalsy();
  });

  it('a blast grazing a LEG never opens a cavity (entrails)', () => {
    // A point just off a legL prim's surface whose arg-min prim IS that leg
    // (the same ownership rule worldHitToWound applies): hits are sorted
    // nearest-first, so wound 0 binds to the leg — a wall of meat. Array
    // order is NOT enough: the first legL prim in the array sits under the
    // hanging arm, whose surface is nearer to its outer-x station.
    const at = legSurfacePoint(zombie, 'legL');
    const fx = resolveExplosion(at, [{ id: 'z', body: zombie }]);
    const e = fx.perBody[0]!;
    expect(e.wounds.length).toBeGreaterThan(0);
    const first = e.wounds[0]!;
    expect(zombie.prims[first.primIdx]!.limb).toBe('legL');
    expect(first.cavity).toBeFalsy();
  });
});

/** A point 0.1 m off some live prim of `limb` whose arg-min prim (the rule
 *  worldHitToWound stamps by: live additive prims, sdPrimitive arg-min) is
 *  that prim — the blast there genuinely grazes `limb` first. */
function legSurfacePoint(
  body: ReturnType<typeof buildBody>, limb: string,
): Vec3 {
  for (let i = 0; i < body.prims.length; i++) {
    const p = body.prims[i]!;
    if (p.op === 'sub' || p.op === 'groove' || p.dead) continue;
    if (p.limb !== limb) continue;
    const ab: Vec3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
    for (const t of [0.35, 0.5, 0.65]) {
      const probe: Vec3 = [
        p.a[0] + ab[0] * t + p.radius * p.scale[0] + 0.1,
        p.a[1] + ab[1] * t,
        p.a[2] + ab[2] * t,
      ];
      let bestIdx = -1;
      let best = Infinity;
      body.prims.forEach((q, j) => {
        if (q.op === 'sub' || q.op === 'groove' || q.dead) return;
        const d = sdPrimitive(probe, q);
        if (d < best) { best = d; bestIdx = j; }
      });
      if (bestIdx === i) return probe;
    }
  }
  throw new Error(`no self-owned surface point found on limb ${limb}`);
}

// ——— Impulses ——————————————————————————————————————————————————————————

describe('launch impulses', () => {
  const pointBlankSpeed = EXPLOSION_STANDARD.impulse * EXPLOSION_LAUNCH.velocityScale;

  it('concussion velocity at point-blank goes straight up at full speed', () => {
    const v = concussionVelocity([0, 0, 0], [0, 0, 0], EXPLOSION_STANDARD.impulse);
    expect(v[0]).toBe(0);
    expect(v[1]).toBeCloseTo(pointBlankSpeed, 10); // 25.2 m/s
    expect(v[2]).toBe(0);
  });

  it('rig impulse points away from the blast, magnitude following the launch floor', () => {
    // Ball 2 m to +x: surface at 1.7 m → falloff known exactly.
    const fx = resolveExplosion([0, 1, 0], [{ id: 'a', body: ballBody([2, 1, 0]) }]);
    const imp = fx.perBody[0]!.rigImpulse!;
    expect(imp.at[0]).toBeCloseTo(1.7, 2); // the nearest surface point

    const dist = 1.7;
    const fall = 1 - dist / R;
    const launchFall = EXPLOSION_LAUNCH.falloffFloor
      + (1 - EXPLOSION_LAUNCH.falloffFloor) * fall;
    const speed = EXPLOSION_STANDARD.impulse * launchFall * EXPLOSION_LAUNCH.velocityScale;
    // Radial +x with the upward bias added then re-normalised.
    const uy = EXPLOSION_LAUNCH.upwardBias;
    const ul = Math.hypot(1, uy);
    expect(imp.vel[0]).toBeCloseTo((1 / ul) * speed, 6);
    expect(imp.vel[1]).toBeCloseTo((uy / ul) * speed, 6);
    expect(imp.vel[2]).toBeCloseTo(0, 9);
    expect(imp.vel[0]).toBeGreaterThan(0);
    expect(Math.hypot(...imp.vel)).toBeGreaterThanOrEqual(speed - 1e-9);
  });

  it('edge-of-radius launches keep the falloff floor (survivors still fly)', () => {
    // Surface at R - ε: launchFall → falloffFloor.
    const dist = R - 0.01;
    const fx = resolveExplosion([0, 1, 0], [{ id: 'a', body: ballBody([dist + 0.3, 1, 0]) }]);
    const speed = Math.hypot(...fx.perBody[0]!.rigImpulse!.vel);
    const floorSpeed = EXPLOSION_STANDARD.impulse * EXPLOSION_LAUNCH.falloffFloor
      * EXPLOSION_LAUNCH.velocityScale;
    expect(speed).toBeGreaterThanOrEqual(floorSpeed - 0.5);
    expect(speed).toBeLessThanOrEqual(pointBlankSpeed + 1e-9);
  });

  it('every launch clears the vertical-kick floor', () => {
    for (const d of [0.5, 1.5, 3, 4.5]) {
      const fx = resolveExplosion([0, 1, 0], [{ id: 'a', body: ballBody([d, 1, 0]) }]);
      for (const e of fx.perBody) {
        expect(e.rigImpulse!.vel[1]).toBeGreaterThanOrEqual(EXPLOSION_LAUNCH.minUpKickMps - 1e-9);
      }
    }
  });

  // ——— THE FOCUS KNOBS (owner, 2026-09-11: "the area of effect should be abit
  // more focused", plus a body at the far edge being thrown off screen). ——————
  it('radiusScale focuses every distance-gated term together', () => {
    // A ball whose SURFACE sits at 3 m: inside the reference 4.6875 m radius,
    // outside a 0.5-scaled one (2.34 m).
    const at: [number, number, number] = [0, 1, 0];
    const body = () => [{ id: 'a', body: ballBody([3.3, 1, 0]) }]; // surface 3.0 m
    const full = resolveExplosion(at, body());
    expect(full.perBody).toHaveLength(1);
    expect(full.radiusM).toBeCloseTo(R, 9);
    expect(full.perBody[0]!.wounds.length).toBeGreaterThan(0);

    const tight = resolveExplosion(at, body(), { radiusScale: 0.5 });
    expect(tight.radiusM).toBeCloseTo(R / 2, 9);
    expect(tight.perBody).toHaveLength(0); // out of the focused blast entirely

    // ...and the FIREBALL DID NOT MOVE. The visual was tuned and judged on its
    // own (`?fxsize`, explosion-vfx.ts); a gameplay-focus slider that silently
    // resized it would invalidate that pass.
    expect(tight.burst.heightM).toBeCloseTo(full.burst.heightM, 9);
  });

  it('launchFloor scales how hard the radius EDGE is flung', () => {
    // Surface at R − 0.01 → falloff ~0 → launchFall is the floor exactly.
    const near = () => [{ id: 'a', body: ballBody([R - 0.01 + 0.3, 1, 0]) }];
    const withFloor = Math.hypot(...resolveExplosion([0, 1, 0], near()).perBody[0]!.rigImpulse!.vel);
    const noFloor = Math.hypot(...resolveExplosion(
      [0, 1, 0], near(), { launchFloor: 0 },
    ).perBody[0]!.rigImpulse!.vel);
    // 0.45 of point-blank by default (NotBlood's comic edge fling). With the
    // floor at 0 the radial launch is gone entirely and only the VERTICAL kick
    // floor survives — which is why this is a ~2x difference and not "no motion
    // at all": minUpKickMps is documented as a guaranteed readable slapstick arc
    // on EVERY concussion launch, and that contract is older than this knob.
    expect(withFloor).toBeGreaterThan(noFloor * 1.5);
    // 4 digits is too fine: the ball's surface sits at R − 0.01, not exactly R,
    // so a sliver of radial launch survives the floor.
    expect(noFloor).toBeCloseTo(EXPLOSION_LAUNCH.minUpKickMps, 2);
    // The epicentre is unaffected by the floor: launchFall is 1 either way.
    const point = () => [{ id: 'a', body: ballBody([0.3, 1, 0]) }];
    expect(Math.hypot(...resolveExplosion([0, 1, 0], point(), { launchFloor: 0 })
      .perBody[0]!.rigImpulse!.vel)).toBeCloseTo(pointBlankSpeed, 6);
  });

  it('chunks in radius get concussion velocity, chunks beyond get nothing', () => {
    const fx = resolveExplosion(
      [0, 0.5, 0], [],
      { chunks: [{ id: 1, pos: [3, 0.5, 0] }, { id: 2, pos: [R + 1, 0.5, 0] }] },
    );
    expect(fx.chunkImpulses).toHaveLength(1);
    expect(fx.chunkImpulses[0]!.chunkId).toBe(1);
    expect(fx.chunkImpulses[0]!.vel[0]).toBeGreaterThan(0); // away from the blast
    expect(fx.chunkImpulses[0]!.vel[1]).toBeGreaterThanOrEqual(EXPLOSION_LAUNCH.minUpKickMps - 1e-9);
  });
});

// ——— Burst visual —————————————————————————————————————————————————————

describe('air-vs-ground burst selection', () => {
  it('a low burst is ground, a chest-height burst is air', () => {
    const ground = resolveExplosion([0, 0.2, 0], []);
    expect(ground.burst.kind).toBe('ground');
    const air = resolveExplosion([0, 1.5, 0], []);
    expect(air.burst.kind).toBe('air');
  });

  it('the threshold itself reads as ground (strictly-above is air)', () => {
    expect(resolveExplosion([0, GROUND_BURST_THRESHOLD_M, 0], []).burst.kind).toBe('ground');
    expect(resolveExplosion([0, GROUND_BURST_THRESHOLD_M + 0.01, 0], []).burst.kind).toBe('air');
  });

  it('floorDistM override wins, and null (no floor) forces air', () => {
    expect(resolveExplosion([0, 5, 0], [], { floorDistM: 0.1 }).burst.kind).toBe('ground');
    expect(resolveExplosion([0, 0.1, 0], [], { floorDistM: null }).burst.kind).toBe('air');
  });

  it('carries the detonation point and the VFX height scale', () => {
    const fx = resolveExplosion([1, 2, 3], []);
    expect(fx.burst.at).toEqual([1, 2, 3]);
    expect(fx.burst.heightM).toBeCloseTo(R * EXPLOSION_VFX_HEIGHT_SCALE, 12);
  });
});

// ——— Damage meter ——————————————————————————————————————————————————————

describe('damage-meter credit', () => {
  it('is the falloff-scaled sum of its wound radii at the meter weight', () => {
    // Far blast so the credit stays under the meter's 1.0 clamp.
    const fx = resolveExplosion([3.5, 1.2, 0.5], [{ id: 'z', body: zombie }]);
    const e = fx.perBody[0]!;
    expect(e.meterCredit).toBeLessThan(1);
    const expected = e.wounds.reduce(
      (m, w) => m + w.radius * COLLAPSE_TUNING.meterRadiusWeight, 0);
    expect(e.meterCredit).toBeCloseTo(expected, 12);
  });

  it('scales with proximity — a closer blast earns more credit', () => {
    const near = resolveExplosion([1.2, 1.2, 0], [{ id: 'z', body: zombie }]).perBody[0]!;
    const far = resolveExplosion([3, 1.2, 0], [{ id: 'z', body: zombie }]).perBody[0]!;
    expect(near.meterCredit).toBeGreaterThan(far.meterCredit);
    expect(far.meterCredit).toBeGreaterThan(0);
  });
});

// ——— Camera kick ———————————————————————————————————————————————————————

describe('FPV camera kick', () => {
  it('peaks at quake/40 on top of the blast, zero outside the radius', () => {
    const at: Vec3 = [0, 1.6, 0];
    const onTop = resolveExplosion(at, [], { eye: at });
    expect(onTop.cameraKick).toBeCloseTo(EXPLOSION_STANDARD.quake / 40, 12);
    const away = resolveExplosion(at, [], { eye: [at[0] + R + 1, at[1], at[2]] });
    expect(away.cameraKick).toBe(0);
  });

  it('no eye supplied → no kick', () => {
    expect(resolveExplosion([0, 1, 0], []).cameraKick).toBe(0);
  });
});

// ——— Hand splash (spec §2) —————————————————————————————————————————————

describe('hand splash', () => {
  // Hands sit around y≈0.77–1.15, z≈0.30–0.55 after this anchor.
  const anchor: Vec3 = [2, 1.0, 0.4];

  it('a blast within the band scars each hand once', () => {
    const fx = resolveExplosion([2, 1.0, 1.0], [], { hands: { prims: handsAt(anchor) } });
    expect(fx.handWounds).toHaveLength(2); // one per hand
    for (const w of fx.handWounds) {
      expect(w.type).toBe('blast');
      expect(w.radius).toBeGreaterThan(0);
      expect(w.radius).toBeLessThanOrEqual(WOUND_PROFILES.blast.radius);
    }
  });

  it('a blast outside the band leaves the hands clean', () => {
    const far = resolveExplosion([2, 1.0, 3.4], [], { hands: { prims: handsAt(anchor) } });
    expect(far.handWounds).toHaveLength(0);
  });

  it('an overcooked in-hand detonation scars both hands at nearly the full profile', () => {
    // Blast in the grip volume between the mittens — the overcook case.
    const fx = resolveExplosion([2.05, 0.68, 0.9], [], { hands: { prims: handsAt(anchor) } });
    expect(fx.handWounds).toHaveLength(2);
    for (const w of fx.handWounds) {
      expect(w.radius).toBeGreaterThan(WOUND_PROFILES.blast.radius * 0.8);
    }
  });
});

// ——— Purity ———————————————————————————————————————————————————————————

describe('purity', () => {
  const bodies = [{ id: 'z', body: zombie }];
  const opts = {
    chunks: [{ id: 7, pos: [1, 0.5, 1] as Vec3 }],
    eye: [0, 1.6, 0] as Vec3,
    hands: { prims: handsAt([2, 1.4, 0]) },
  };

  it('is deterministic — identical inputs give an identical bundle', () => {
    const a = resolveExplosion([1, 1, 0], bodies, opts);
    const b = resolveExplosion([1, 1, 0], bodies, opts);
    expect(b).toEqual(a);
  });

  it('never mutates its inputs', () => {
    const before = JSON.stringify({
      prims: zombie.prims, clusters: zombie.clusters,
      chunks: opts.chunks, hands: opts.hands.prims, eye: opts.eye,
    });
    resolveExplosion([1, 1, 0], bodies, opts);
    const after = JSON.stringify({
      prims: zombie.prims, clusters: zombie.clusters,
      chunks: opts.chunks, hands: opts.hands.prims, eye: opts.eye,
    });
    expect(after).toBe(before);
  });
});

describe('a turned body (bodyYaw) resolves the same blast as the rest body', () => {
  // The game passes POSED bodies (world space, turned by the walk yaw) and
  // pushes the wounds into the actor ring, where they are uploaded at the
  // live yaw and connectivity resolves them on the rest body at yaw 0. The
  // resolver must therefore stamp in the body frame: given the yaw, its
  // wounds map back to the rotated impact points and its cuts match.
  const YAW = -1.9;
  const turn = (p: Vec3): Vec3 => rotateYaw(p, YAW);
  const turned: BuildResult = {
    ...zombie,
    prims: zombie.prims.map(p => ({ ...p, a: turn(p.a), b: turn(p.b) })),
    clusters: zombie.clusters.map(c => ({ ...c, center: turn(c.center) })),
  };
  const at: Vec3 = [3, 1.2, 0.5];

  it('stamps in the body frame: each wound is the same wound the rest body would take at that point', () => {
    const fx = resolveExplosion(turn(at), [{ id: 'z', body: turned, bodyYaw: YAW }]).perBody[0]!;
    expect(fx.wounds.length).toBeGreaterThan(0);
    // At least one wound must ride a SPHERE prim — the shape with no axis to
    // carry the turn, which is where a missing yaw shows.
    expect(fx.wounds.some(w => {
      const p = turned.prims[w.primIdx]!;
      return p.a[0] === p.b[0] && p.a[1] === p.b[1] && p.a[2] === p.b[2];
    })).toBe(true);
    for (const tw of fx.wounds) {
      // Un-turn the wound's world anchor into rest space and stamp THERE on
      // the rest body: same prim, same body-frame local.
      const world = woundWorldPos(turned.prims, tw, YAW);
      const restPt = rotateYaw(world, -YAW);
      const rw = worldHitToWound(zombie.prims, restPt, tw.radius, 'blast');
      expect(rw.primIdx).toBe(tw.primIdx);
      for (let k = 0; k < 3; k++) expect(rw.local[k]).toBeCloseTo(tw.local[k]!, 6);
    }
    // And the game's contract holds: the SAME wounds resolved on the rest
    // body at yaw 0 (what the actor's runSeverChecks does) give the cuts the
    // resolver reported from the turned body at its yaw.
    const torso = zombie.clusters.find(c => c.limb === 'torso')!;
    expect(fx.severedLimbs).toEqual(cutLimbs(zombie, fx.wounds, torso.center));
    expect(fx.chainCuts).toEqual(cutChains(zombie, fx.wounds));
  });
});

// ——— The prune, and why it is a BODY-level one (2026-09-10) ————————————————
// `resolveExplosion` is handed EVERY body the caller knows about and, before
// this, sphere-traced every prim of every one of them — each trace step folding
// every prim of that body. On the arena's 23 bodies that measured 81-122 ms per
// detonation, ~95% of the entire blast: the owner's "noticeable pause when the
// explosion and the gib happens".
//
// The first version of this optimisation pruned PRIMS, on the reasoning that a
// prim whose own surface is outside the radius cannot contribute. THE TEST BELOW
// FALSIFIED IT, and the failure is worth keeping: the resolver's per-prim hit is
// the distance to the BODY's surface along the ray, so a prim behind other flesh
// reports a near hit — measured, a bound of 0.668 m against a reported hit at
// 0.598 m, and a prim that was "provably outside" reporting a hit 4.15 m INSIDE
// the radius. Only whole bodies can be pruned soundly.

/** The same sphere-trace `traceSurface` runs (128 steps, 2 mm epsilon), against
 *  the whole body — so this is the sampler the resolver actually uses. */
function marchToPrim(at: Vec3, prim: Primitive, body: BuildResult): Vec3 | null {
  const mid: Vec3 = [
    (prim.a[0] + prim.b[0]) / 2, (prim.a[1] + prim.b[1]) / 2, (prim.a[2] + prim.b[2]) / 2,
  ];
  const dir = sub(mid, at);
  const maxDist = len(dir);
  if (maxDist < 1e-6) return sdBody(at, body) < 0.002 ? at : null;
  const u = [dir[0] / maxDist, dir[1] / maxDist, dir[2] / maxDist] as Vec3;
  let t = 0;
  for (let i = 0; i < 128 && t < maxDist; i++) {
    const p: Vec3 = [at[0] + u[0] * t, at[1] + u[1] * t, at[2] + u[2] * t];
    const d = sdBody(p, body);
    if (d < 0.002) return p;
    t += Math.max(d, 0.002);
  }
  return null;
}

/** The UNPRUNED hit set: every live prim traced, exactly as before the change.
 *  The independent reference the pruned resolver is compared against. */
function referenceHits(at: Vec3, body: BuildResult, radiusM: number) {
  const hits: number[] = [];
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (const prim of body.prims.slice(c.start, c.start + c.count)) {
      if (prim.op === 'sub' || prim.dead) continue;
      const p = marchToPrim(at, prim, body);
      if (!p) continue;
      const distM = len(sub(p, at));
      if (linearFalloff(distM, radiusM) <= 0) continue;
      hits.push(distM);
    }
  }
  hits.sort((a, b) => a - b);
  return hits;
}

describe('resolve prunes whole bodies it provably cannot reach', () => {
  const R_ = explosionRadiusM();
  const blasts: Vec3[] = [
    [0, 1, 0], [0.6, 1.1, 0.3], [1.6, 0.9, -0.5], [2.6, 1.2, 0.7],
    [-1.1, 0.5, 0.9], [3.9, 1.0, 0.0], [0.0, 0.2, 0.0], [0.3, 1.7, -0.2],
    [R_ - 0.2, 1, 0], [R_ - 0.2, 1.3, 0.3], [-(R_ - 0.3), 1, 0], [R_ + 0.05, 0.9, 0.2],
  ];

  it('the bound is a true lower bound on the PRIM OWN surface distance', () => {
    // The property the bound actually claims. Sampled against the prim's OWN
    // field (sdPrimitive), because the union's surface is a different thing —
    // see this block's header for the falsified prim-level prune.
    let checked = 0;
    for (const at of blasts) {
      for (const prim of zombie.prims) {
        if (prim.op === 'sub' || prim.dead) continue;
        const bound = primLowerBoundM(at, prim);
        // March toward the prim's midpoint against that prim alone.
        const mid: Vec3 = [
          (prim.a[0] + prim.b[0]) / 2, (prim.a[1] + prim.b[1]) / 2, (prim.a[2] + prim.b[2]) / 2,
        ];
        const d0 = sdPrimitive(at, prim);
        if (d0 < 0.002) continue;                // inside this prim: no bound claim
        const dir = sub(mid, at), maxDist = len(dir);
        if (maxDist < 1e-6) continue;
        const u = [dir[0] / maxDist, dir[1] / maxDist, dir[2] / maxDist] as Vec3;
        let t = 0, surface: number | null = null;
        for (let i = 0; i < 256 && t < maxDist; i++) {
          const p: Vec3 = [at[0] + u[0] * t, at[1] + u[1] * t, at[2] + u[2] * t];
          const d = sdPrimitive(p, prim);
          if (d < 0.002) { surface = t; break; }
          t += Math.max(d, 0.002);
        }
        if (surface === null) continue;
        expect(bound, `bound ${bound} vs own surface ${surface}`).toBeLessThanOrEqual(surface + 1e-9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);         // the test is doing real work
  });

  it('a blast BURIED in the flesh stamps the same wounds as before the prune', () => {
    // Inside the body every live prim yields a distance-0, full-falloff hit, so
    // the wound count is the ring cap and the damage is point-blank. A prune
    // that skipped far prims here would have quietly reduced the wound count of
    // the most lethal case in the game.
    const inside = zombie.clusters.find(c => c.limb === 'torso')!.center;
    const fx = resolveExplosion(inside, [{ id: 'z', body: zombie }]);
    const e = fx.perBody[0]!;
    expect(e.distM).toBe(0);
    expect(e.falloff).toBe(1);
    expect(e.damage).toBeCloseTo(FULL_DMG, 6);
    expect(e.gibbed).toBe(true);
    const live = zombie.prims.filter(p => p.op !== 'sub' && !p.dead).length;
    expect(e.wounds.length).toBe(Math.min(live, EXPLOSION_TUNING.maxWoundsPerBody));
  });

  it('AGREES WITH THE UNPRUNED REFERENCE at every blast position', () => {
    // The load-bearing test: for each position, the pruned resolver's nearest
    // distance, damage, gib verdict and wound count must equal what tracing
    // EVERY prim produces. This is the gate the prim-level prune failed.
    for (const at of blasts) {
      const fx = resolveExplosion(at, [{ id: 'z', body: zombie }]);
      const ref = referenceHits(at, zombie, R_);
      const e = fx.perBody[0];
      const label = `at ${at.map(v => v.toFixed(2)).join(',')}`;
      if (ref.length === 0) {
        expect(e, `${label}: expected no entry`).toBeUndefined();
        continue;
      }
      expect(e, `${label}: expected an entry`).toBeDefined();
      expect(e!.distM, `${label} nearest`).toBeCloseTo(ref[0]!, 9);
      expect(e!.damage, `${label} damage`).toBeCloseTo(blastDamage(ref[0]!, R_), 9);
      expect(e!.gibbed, `${label} gib`).toBe(e!.damage >= GIB_THRESHOLD);
      expect(e!.wounds.length, `${label} wounds`)
        .toBe(Math.min(ref.length, EXPLOSION_TUNING.maxWoundsPerBody));
      // The shove rides the nearest surface too, so a prune that moved the hit
      // would move the impulse.
      expect(len(sub(e!.rigImpulse!.at, at)), `${label} impulse anchor`)
        .toBeCloseTo(ref[0]!, 9);
    }
  });

  it('a body wholly out of range contributes no effect entry at all', () => {
    const off = 60;
    const far: BuildResult = {
      ...zombie,
      prims: zombie.prims.map(p => ({ ...p, a: add(p.a, [off, 0, 0]) as Vec3, b: add(p.b, [off, 0, 0]) as Vec3 })),
      clusters: zombie.clusters.map(c => ({ ...c, center: add(c.center, [off, 0, 0]) as Vec3 })),
    };
    const both = resolveExplosion([0, 1, 0], [
      { id: 'near', body: zombie }, { id: 'far', body: far },
    ]);
    expect(both.perBody.map(b => b.bodyId)).toEqual(['near']);
  });

  it('the prune does not fire for a body that is genuinely in range', () => {
    // Guards the other direction: a bound that was too eager would silently drop
    // in-range bodies, and the agreement test above would then compare against a
    // reference that also found nothing. This asserts the near case still yields
    // an entry with a real distance.
    for (const at of blasts) {
      if (referenceHits(at, zombie, R_).length === 0) continue;
      const e = resolveExplosion(at, [{ id: 'z', body: zombie }]).perBody[0];
      expect(e, `at ${at.join(',')}`).toBeDefined();
    }
  });

  it('segmentDistanceM clamps to the endpoints, not the infinite line', () => {
    expect(segmentDistanceM([0, 0, 0], [1, 0, 0], [2, 0, 0])).toBeCloseTo(1, 12);
    expect(segmentDistanceM([0, 1, 0], [1, 0, 0], [2, 0, 0])).toBeCloseTo(Math.SQRT2, 12);
    // Collinear beyond the far end: the extended line would say 0.
    expect(segmentDistanceM([5, 0, 0], [1, 0, 0], [2, 0, 0])).toBeCloseTo(3, 12);
    // Degenerate (a === b) is a point, not a NaN.
    expect(segmentDistanceM([0, 3, 0], [0, 0, 0], [0, 0, 0])).toBeCloseTo(3, 12);
  });
});
