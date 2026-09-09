// src/lab/sdf-zombie/explosion-aoe.ts
//
// PURE explosion AOE resolver (spec §4, task X1.23-3): turns a detonation
// point into the complete effect bundle the lab's gore stack already
// understands — blast wounds, rig/chunk launch impulses, damage-meter
// credit, sever/chain-cut checks, the gib decision, the air-vs-ground burst
// visual, the FPV camera kick, and the hand-splash flourish (spec §2).
// No mutation, no rendering, no Date.now/Math.random: identical inputs
// produce bit-identical bundles; the wiring task applies the effects.
//
// The game's AOE model is mirrored THROUGH CONSTANTS, not imported:
// EXPLOSION_STANDARD / EXPLOSION_LAUNCH / GIB_THRESHOLD /
// GROUND_BURST_THRESHOLD_M / EXPLOSION_VFX_HEIGHT_SCALE / BU_PER_METER come
// from src/game/gibs/tuning.ts (pure data — imported). The behavioural
// formulas live in src/game/gibs/index.ts (GibSystem), which owns Rapier,
// THREE and the dude registry — a SIM module the lab never imports. The
// sim-local calibration literals that have no exported home are mirrored
// below as documented constants (RADIUS_SCALE_FACTOR, DAMAGE_TICK_STACK,
// QUAKE_MAG_SCALE); if index.ts retunes them, retune the mirrors.
//
// THE MODEL (mirroring GibSystem.spawnExplosion):
//   radiusM     = (info.radius / BU_PER_METER) × RADIUS_SCALE_FACTOR
//   linearFall  = 1 − dist/radiusM            (full at the epicentre, 0 at edge)
//   damage      = (info.damage + info.damageRange) × DAMAGE_TICK_STACK × fall
//   gib         = damage ≥ GIB_THRESHOLD      (single-hit rule)
//   launch      = concussionVelocity: radial dir + EXPLOSION_LAUNCH.upwardBias,
//                 speed = impulse × velocityScale × launchFall where launchFall
//                 floors at EXPLOSION_LAUNCH.falloffFloor (edge survivors still
//                 fly — the slapstick window), y floored at minUpKickMps.
//
// WHERE THE GAME MEASURES A DUDE, THE LAB MEASURES SURFACES. Blood sprites
// are flat: `dist` is sprite-centre distance. The lab body is volumetric
// flesh, so every effect is measured to SURFACE points — found by
// sphere-tracing from the blast toward each live prim's midpoint, the exact
// sampler the click-shoot path uses (raycastBody in lab-main: sdBody field,
// 0.002 hit epsilon, d-step march). Spec §4's "every body point within
// radius" becomes one wound per live additive prim whose surface the blast
// reaches (nearest prims first, capped at the wound-ring size), each stamped
// where its own trace lands with radius scaled by ITS falloff — a close
// blast craters the whole blast-facing side (which is what lets
// cutLimbs/cutChains take pieces off), an edge blast only grazes it.
// Body-level damage/meter/gib use the nearest-surface distance, the honest
// analog of the game's dude distance.
import type { BuildResult } from './build-body';
import type { LimbId, Primitive, Vec3 } from './types';
import { add, len, scale, sub } from './vec';
import { WOUND_PROFILES, worldHitToWound, MAX_WOUNDS, type Wound } from './damage';
import { cutChains, cutLimbs, type ChainCut } from './connectivity';
import { COLLAPSE_TUNING } from './collapse';
import { sdBody, sdPrimitive, smin } from './validate';
import {
  BU_PER_METER,
  EXPLOSION_LAUNCH,
  EXPLOSION_STANDARD,
  EXPLOSION_VFX_HEIGHT_SCALE,
  GIB_THRESHOLD,
  GROUND_BURST_THRESHOLD_M,
} from '../../game/gibs/tuning';

// ——— Mirrored sim-local calibrations (src/game/gibs/index.ts) ———————————
// NOT in tuning.ts — empirical constants the sim module owns privately.

/** Spatial radius scale — index.ts RADIUS_SCALE_FACTOR: "bumps spatial
 *  radius to ~4.7m without disturbing velocity" (150 BU / 256 ≈ 0.59 m is
 *  far too small to cover a body). */
const RADIUS_SCALE_FACTOR = 8;

/** Damage multiplier — index.ts DAMAGE_TICK_STACK: Blood applies 20 damage
 *  over 60 tics (=1200 raw); Blud collapses multi-tick into one hit at 12×
 *  ⇒ point-blank ≈ 360, past the 160 gib threshold. */
const DAMAGE_TICK_STACK = 12;

/** quake → screenshake magnitude — index.ts spawnExplosion:
 *  `screenshake.shake(info.quake / 40, 0.3)`. */
const QUAKE_MAG_SCALE = 40;

// ——— Lab-owned knobs ————————————————————————————————————————————————

export const EXPLOSION_TUNING = {
  /** Sphere-trace step budget — lab-main raycastBody's 128-iteration cap. */
  traceSteps: 128,
  /** Surface-hit epsilon — raycastBody's 0.002 (also its minimum step). */
  traceEps: 0.002,
  /** Hard cap on wounds per body: the shader's wound-ring size — a blast
   *  can fill the ring but never needs more than it can hold. */
  maxWoundsPerBody: MAX_WOUNDS,
  /** Hand-splash band as a fraction of radiusM — a FLOURISH, not the game's
   *  player damage: hands scar when the blast is genuinely too close
   *  (or the stick overcooks in-hand). 0.35 × 4.69 m ≈ 1.6 m. */
  handSplashBandFrac: 0.35,
} as const;

// ——— Types —————————————————————————————————————————————————————————

/** One body the blast can touch. `body` is the POSED BuildResult — wounds
 *  land where its flesh is this frame, so pass the post-rig pose. */
export interface ExplosionBody {
  /** Stable identity for the wiring to route the effects back. */
  id: string;
  body: BuildResult;
  /** The yaw `body` is POSED at (the game's actors hand in applyRig output,
   *  turned by the walk). Wounds are stamped in the body frame — de-yawed
   *  by this — so the actor can upload them at its live yaw and resolve
   *  severing on the rest body at yaw 0. Omit (0) for a body in its own
   *  frame: the rest body, the hero hands. */
  bodyYaw?: number;
}

/** A live flying chunk near the blast (a severed limb/piece). */
export interface LiveChunkRef {
  /** The wiring's chunk id (lab-main's chunk wrapper id). */
  id: number;
  /** Chunk centre, world space. */
  pos: Vec3;
}

/** World-space hand prims for the splash check — the wiring camera-transforms
 *  hands.ts's camera-local prims for this frame; the resolver stays pure. */
export interface HandSplashInput {
  prims: readonly Primitive[];
}

export interface ResolveExplosionOpts {
  /** Live chunks to concussion-launch (impulse toward/away from the blast). */
  chunks?: readonly LiveChunkRef[];
  /** FPV eye position — drives the camera kick. Absent ⇒ kick 0. */
  eye?: Vec3;
  /** Hand-splash input; absent ⇒ no hand wounds. */
  hands?: HandSplashInput;
  /** Floor distance below the blast (m). Default: the lab floor plane y=0.
 *  `null` = no floor below (forced air burst). */
  floorDistM?: number | null;
}

/** The rig shove for one body: a world point plus a concussion VELOCITY
 *  (m/s). The wiring turns it into an impulseAt displacement (or a rig
 *  prev-pos kick) — this module stays position/velocity-agnostic. */
export interface RigImpulse {
  at: Vec3;
  vel: Vec3;
}

/** Everything the blast does to ONE body (empty when out of radius). */
export interface BodyExplosionEffect {
  bodyId: string;
  /** Nearest-surface distance to the blast (m). */
  distM: number;
  /** The game's linearFall at distM (0..1). */
  falloff: number;
  /** Game damage number at distM — ≥ GIB_THRESHOLD ⇒ gibbed. */
  damage: number;
  /** damage ≥ GIB_THRESHOLD: the wiring runs gibAll/gibAllPieces instead of
   *  applying wounds/cuts (the game's single-hit direct-gib rule). */
  gibbed: boolean;
  /** Falloff-scaled blast wounds — one per live prim the blast reaches
   *  (nearest first, ring-capped); they are the meter fuel AND the carve
   *  spheres the cut checks ran against. */
  wounds: Wound[];
  /** Σ wound radii × COLLAPSE_TUNING.meterRadiusWeight, falloff-scaled with
   *  the wounds. THE WIRING MUST CREDIT THE METER WITH THIS NUMBER, not pass
   *  these wounds as stepCollapse freshWounds: the collapse meter weights
   *  wounds by their PROFILE radius, so the freshWounds path would collapse
   *  a body from a single edge-of-radius blast. */
  meterCredit: number;
  /** Full-limb severs implied by the wounds (cutLimbs). Empty when gibbed. */
  severedLimbs: LimbId[];
  /** Mid-limb joint cuts implied by the wounds (cutChains). Empty when gibbed. */
  chainCuts: ChainCut[];
  /** Concussion shove for the rig, at the nearest surface point. Null when
   *  the body is out of radius. */
  rigImpulse: RigImpulse | null;
}

/** Concussion velocity for a flying chunk. */
export interface ChunkImpulse {
  chunkId: number;
  vel: Vec3;
}

/** Which explosion atlas to play + where — as data; the wiring owns billboards. */
export interface BurstVisual {
  kind: 'air' | 'ground';
  /** Detonation point (air anchors centre, ground anchors bottom). */
  at: Vec3;
  /** Rendered half-height (m): radiusM × EXPLOSION_VFX_HEIGHT_SCALE — the
   *  game's visual-only scale, decoupled from the gameplay radius. */
  heightM: number;
}

/** The full effect bundle — everything one detonation does. */
export interface ExplosionEffect {
  /** Effective AOE radius (m) after the spatial scale. */
  radiusM: number;
  perBody: BodyExplosionEffect[];
  chunkImpulses: ChunkImpulse[];
  burst: BurstVisual;
  /** FPV camera-kick magnitude from eye proximity (quake/40 × falloff). */
  cameraKick: number;
  /** Hand-splash wounds (bound to the hand prims). Empty outside the band. */
  handWounds: Wound[];
}

// ——— Pure AOE math (exported for tests) ————————————————————————————

/** Effective AOE radius in metres for an explosion profile. */
export function explosionRadiusM(
  info: { radius: number } = EXPLOSION_STANDARD,
): number {
  return (info.radius / BU_PER_METER) * RADIUS_SCALE_FACTOR;
}

/** The game's linear falloff: 1 at the epicentre, 0 at (or past) the edge. */
export function linearFalloff(distanceM: number, radiusM: number): number {
  if (distanceM >= radiusM) return 0;
  return distanceM <= 0 ? 1 : 1 - distanceM / radiusM;
}

/** Single-hit damage at a distance — falloffDamage × DAMAGE_TICK_STACK
 *  (mirrors index.ts spawnExplosion's damage line). */
export function blastDamage(
  distanceM: number,
  radiusM: number,
  info: { damage: number; damageRange: number } = EXPLOSION_STANDARD,
): number {
  return (info.damage + info.damageRange) * DAMAGE_TICK_STACK
    * linearFalloff(distanceM, radiusM);
}

/**
 * Concussion launch velocity — a faithful mirror of index.ts
 * concussionVelocity (NotBlood ConcussSprite, actor.cpp:2677): radial
 * direction with an upward bias (a ground blast kicks dudes up), speed =
 * impulseMag × velocityScale, the y-component floored at minUpKickMps so
 * every launch reads as an arc. A point-blank target (degenerate direction)
 * goes straight up.
 */
export function concussionVelocity(
  origin: Vec3, target: Vec3, impulseMag: number,
): Vec3 {
  const L = EXPLOSION_LAUNCH;
  const speed = impulseMag * L.velocityScale;
  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  const dz = target[2] - origin[2];
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (l < 1e-6) return [0, Math.max(speed, L.minUpKickMps), 0];
  const ux = dx / l;
  const uy = dy / l + L.upwardBias;
  const uz = dz / l;
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
  return [
    (ux / ul) * speed,
    Math.max((uy / ul) * speed, L.minUpKickMps),
    (uz / ul) * speed,
  ];
}

// ——— Surface tracing (the click-shoot sampler, parameterised) ——————————

/** Sphere-trace `sample` from `from` toward `target`, stopping at the first
 *  surface (d < eps) — lab-main raycastBody's march, capped at maxDist =
 *  the target so a shadowed/absent surface simply misses. Starting inside
 *  the field returns `from` immediately (a blast buried in flesh). */
function traceSurface(
  from: Vec3, target: Vec3, sample: (p: Vec3) => number,
): Vec3 | null {
  const T = EXPLOSION_TUNING;
  const dir = sub(target, from);
  const maxDist = len(dir);
  if (maxDist < 1e-6) return sample(from) < T.traceEps ? from : null;
  const u = scale(dir, 1 / maxDist);
  let t = 0;
  for (let i = 0; i < T.traceSteps && t < maxDist; i++) {
    const p: Vec3 = add(from, scale(u, t));
    const d = sample(p);
    if (d < T.traceEps) return p;
    t += Math.max(d, T.traceEps);
  }
  return null;
}

// ——— The resolver —————————————————————————————————————————————————————

/**
 * Resolves one detonation into its full effect bundle. Pure: nothing in
 * `bodies`/`opts` is mutated (wounds are fresh objects; the input bodies
 * keep their wound rings untouched), and there is no RNG — the bundle is a
 * deterministic function of the geometry alone.
 */
export function resolveExplosion(
  at: Vec3,
  bodies: readonly ExplosionBody[],
  opts: ResolveExplosionOpts = {},
): ExplosionEffect {
  const T = EXPLOSION_TUNING;
  const radiusM = explosionRadiusM();

  // — Burst visual: air vs ground via the floor distance (NotBlood florhit).
  //   The lab floor is the y=0 plane (dynamite-flight.ts), so the default
  //   floor distance is the blast's height; callers with real geometry pass
  //   floorDistM. At-or-under the threshold reads as ground — isAirBurst's
  //   rule, mirrored.
  const floorDistM = opts.floorDistM !== undefined ? opts.floorDistM : Math.max(0, at[1]);
  const air = floorDistM === null || floorDistM > GROUND_BURST_THRESHOLD_M;
  const burst: BurstVisual = {
    kind: air ? 'air' : 'ground',
    at: [at[0], at[1], at[2]],
    heightM: radiusM * EXPLOSION_VFX_HEIGHT_SCALE,
  };

  // — Per-body effects: nearest-surface distance gates everything. —
  const perBody: BodyExplosionEffect[] = [];
  for (const entry of bodies) {
    const body = entry.body;
    const bodyYaw = entry.bodyYaw ?? 0;

    // One trace per live additive prim toward its midpoint; each hit is a
    // candidate wound site at its own falloff-scaled distance.
    interface Hit { point: Vec3; distM: number; falloff: number }
    const hits: Hit[] = [];
    for (const c of body.clusters) {
      if (!c.alive) continue; // severed limbs fly as chunks — see opts.chunks
      for (const prim of body.prims.slice(c.start, c.start + c.count)) {
        if (prim.op === 'sub' || prim.dead) continue; // holes have no surface
        const mid: Vec3 = [
          (prim.a[0] + prim.b[0]) / 2, (prim.a[1] + prim.b[1]) / 2,
          (prim.a[2] + prim.b[2]) / 2,
        ];
        const p = traceSurface(at, mid, pt => sdBody(pt, body));
        if (!p) continue;
        const distM = len(sub(p, at));
        const fall = linearFalloff(distM, radiusM);
        if (fall <= 0) continue; // prim surface outside the AOE
        hits.push({ point: p, distM, falloff: fall });
      }
    }
    if (hits.length === 0) continue; // not in radius
    hits.sort((a, b) => a.distM - b.distM);

    const distM = hits[0]!.distM;
    const falloff = hits[0]!.falloff; // nearest surface — gates damage/gib
    const damage = blastDamage(distM, radiusM);
    const gibbed = damage >= GIB_THRESHOLD;

    // Wounds: nearest prims first, ring-capped; each carries its own falloff
    // so the far side of the body grazes shallower than the near side.
    const wounds: Wound[] = hits.slice(0, T.maxWoundsPerBody).map(h =>
      worldHitToWound(
        body.prims, h.point,
        WOUND_PROFILES.blast.radius * h.falloff, 'blast', bodyYaw,
        p => sdBody(p, body),
      ));
    // Entrails (2026-09-02): a blast over the TORSO opens a body cavity —
    // the same gate the slug path applies, read off the prim
    // worldHitToWound bound each wound to (its arg-min prim IS the struck
    // prim). Limb blasts are wall-of-meat wounds; pellets never cavity at
    // all (woundFromPellet sets nothing, game-weapon.ts).
    for (const w of wounds) {
      w.shot = { weapon: 'explosion' };
      w.cavity = body.prims[w.primIdx]!.limb === 'torso';
    }
    const meterCredit = wounds.reduce(
      (m, w) => m + w.radius * COLLAPSE_TUNING.meterRadiusWeight, 0);

    // Rig shove at the nearest surface: direction from the blast centre,
    // magnitude with the launch floor (edge survivors still fly).
    const launchFall = EXPLOSION_LAUNCH.falloffFloor
      + (1 - EXPLOSION_LAUNCH.falloffFloor) * falloff;
    const rigImpulse: RigImpulse = {
      at: hits[0]!.point,
      vel: concussionVelocity(at, hits[0]!.point, EXPLOSION_STANDARD.impulse * launchFall),
    };

    // Sever/chain-cut checks run on THIS blast's wounds — the carve union is
    // what saws limbs off (a well-placed bundle takes them). Moot when
    // gibbed: gibAll supersedes severing, so the wiring checks that first.
    let severedLimbs: LimbId[] = [];
    let chainCuts: ChainCut[] = [];
    if (!gibbed && wounds.length > 0) {
      const torso = body.clusters.find(c => c.limb === 'torso');
      if (torso) severedLimbs = cutLimbs(body, wounds, torso.center, bodyYaw);
      chainCuts = cutChains(body, wounds, bodyYaw);
    }

    perBody.push({
      bodyId: entry.id,
      distM, falloff, damage, gibbed, wounds, meterCredit,
      severedLimbs, chainCuts, rigImpulse,
    });
  }

  // — Chunks: pure concussion, alive or dead, decoupled from damage. —
  const chunkImpulses: ChunkImpulse[] = [];
  for (const ch of opts.chunks ?? []) {
    const distM = len(sub(ch.pos, at));
    const fall = linearFalloff(distM, radiusM);
    if (fall <= 0) continue;
    const launchFall = EXPLOSION_LAUNCH.falloffFloor
      + (1 - EXPLOSION_LAUNCH.falloffFloor) * fall;
    chunkImpulses.push({
      chunkId: ch.id,
      vel: concussionVelocity(at, ch.pos, EXPLOSION_STANDARD.impulse * launchFall),
    });
  }

  // — FPV camera kick: the game's quake→magnitude mapping scaled by the
  //   eye's proximity to the blast (quake/40 ≈ 4 at the epicentre).
  const cameraKick = opts.eye
    ? (EXPLOSION_STANDARD.quake / QUAKE_MAG_SCALE)
      * linearFalloff(len(sub(opts.eye, at)), radiusM)
    : 0;

  return {
    radiusM,
    perBody,
    chunkImpulses,
    burst,
    cameraKick,
    handWounds: opts.hands ? handSplashWounds(at, opts.hands.prims, radiusM) : [],
  };
}

// ——— Hand splash (spec §2 flourish) ————————————————————————————————

/** Signed distance over a hand's prim set — sdBody's fold over prims that
 *  have no cluster wrapper (the hands are a loose prim list, not a body). */
function primSetField(prims: readonly Primitive[]): (p: Vec3) => number {
  return (p: Vec3): number => {
    let d = 1e9;
    for (const prim of prims) {
      if (prim.op === 'sub' || prim.dead) continue;
      d = smin(d, sdPrimitive(p, prim), prim.blendK);
    }
    return d;
  };
}

/**
 * Splash marks for the hands: one blast wound per hand whose surface is
 * inside the splash band (a fraction of the AOE radius — this is the
 * flourish, not the game's player damage). Wound radius falls off over the
 * band, so an overcooked in-hand detonation scars both hands at the full
 * blast profile while a just-outside-the-band blast leaves them clean.
 * Wounds bind to the hand prims via the ordinary wound pipeline
 * (worldHitToWound) — the hands are just another small body.
 */
function handSplashWounds(
  at: Vec3, prims: readonly Primitive[], radiusM: number,
): Wound[] {
  const bandM = radiusM * EXPLOSION_TUNING.handSplashBandFrac;
  const sides = new Set(prims.map(p => p.limb));
  const out: Wound[] = [];
  for (const side of sides) {
    const sidePrims = prims.filter(p => p.limb === side);
    // Hand centre: mean of the side's prim midpoints — the trace target.
    let cx = 0, cy = 0, cz = 0;
    for (const p of sidePrims) {
      cx += (p.a[0] + p.b[0]) / 2;
      cy += (p.a[1] + p.b[1]) / 2;
      cz += (p.a[2] + p.b[2]) / 2;
    }
    const n = sidePrims.length;
    if (n === 0) continue;
    const centre: Vec3 = [cx / n, cy / n, cz / n];
    const field = primSetField(sidePrims);
    const hit = traceSurface(at, centre, field);
    if (!hit) continue;
    const distM = len(sub(hit, at));
    const radius = WOUND_PROFILES.blast.radius * linearFalloff(distM, bandM);
    if (radius <= 0) continue; // outside the band — hands stay clean
    out.push(worldHitToWound(prims as Primitive[], hit, radius, 'blast'));
  }
  return out;
}
