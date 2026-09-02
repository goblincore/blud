// src/lab/sdf-zombie/explosion-aoe.test.ts
//
// Pure-unit tests for the explosion AOE resolver: falloff endpoints, wound
// bounding, impulse direction/magnitude, air-vs-ground burst selection,
// meter credit scaling, hand-splash
// gating, determinism, and input immutability.
import { describe, it, expect } from 'vitest';
import {
  resolveExplosion, explosionRadiusM, linearFalloff, blastDamage,
  concussionVelocity, EXPLOSION_TUNING,
} from './explosion-aoe';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from './build-body';
import { ZOMBIE } from './body';
import { WOUND_PROFILES } from './damage';
import { sdPrimitive } from './validate';
import { cutChains, cutLimbs } from './connectivity';
import { COLLAPSE_TUNING } from './collapse';
import { HAND_PRIMS } from './hands';
import type { ClusterInfo, Primitive, Vec3 } from './types';
import { add } from './vec';
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
