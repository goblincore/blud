// src/lab/sdf-zombie/webgpu/game-weapon.ts
//
// Pure grapeshot logic for sdf-game.html — everything about the gun that can
// be unit-tested without a renderer or a DOM. The DOM/scene wiring lives in
// game-main.ts; the per-actor wound application lives in game-actor.ts.
//
// Fire model per docs/superpowers/specs/2026-08-16-sdf-lab-grapeshot-design.md
// §2 (Blood sawed-off homage), as trimmed by the dispatch brief: click fires
// ONE barrel, alt-fire dumps both, ~8 LARGE travelling pellets per barrel,
// fire-rate limit + camera kick are in. Break-open reload animation and muzzle
// smoke are deliberately not here.

import type { Vec3 } from '../types';
import { worldHitToWound, type Wound } from '../damage';

export const GRAPESHOT = {
  /** Pellets per barrel. The brief says ~8 and "err chunky". */
  pelletsPerBarrel: 8,
  /** Muzzle speed, m/s — the spec's 35 m/s dodgeable band. */
  speed: 35,
  /** Cone HALF-angle, radians (~3.2°). Tight enough to group at room range,
   *  wide enough that a double-barrel at 2 m strays across a torso. */
  spreadRad: 0.055,
  /** Pellet drop, m/s² — a nod to gravity, not a mortar. */
  gravity: -6,
  /** Pellet visual/collision radius, metres. A 10 cm ball reads as an object
   *  crossing the room at game scale; smaller read as a hitscan flash. */
  radius: 0.05,
  /** Wound (crater) radius stamped per impact, metres — the VISUAL carve.
   *  The stock pellet profile's 0.055: a crater that reads as a crater on a
   *  limb whose radius is 0.055–0.082. It was swept UP to 0.10 by the
   *  grapeshot dispatch because the carve sphere was ALSO the sever test's
   *  sphere, and one-directional volleys never cover a joint's section disc
   *  with anything smaller — but a 0.10 sphere is wider than a forearm, so
   *  the thickness cap (depth-only) still let it remove the whole
   *  cross-section laterally: the owner's see-through-hole report
   *  (2026-08-26). Severing now reads `severRadius` instead — the crater is
   *  tuned by eye, not by whether it severs. */
  woundRadius: 0.055,
  /** The radius connectivity's carve-union test (cutLimbs/cutChains) uses
   *  for grapeshot pellet wounds, via Wound.severRadius. MEASURED, not a
   *  guess: pellets arriving from ONE direction only ever carve the near
   *  side of a joint's cross-section disc, so at the visual 0.055 (also
   *  0.07/0.085) no number of point-blank pellets ever severs; 0.10 severs
   *  a shoulder in ~8, 0.13 in 1. Keeping the proven 0.10 preserves the
   *  sever feel exactly while the crater shrinks back to the stock pellet
   *  calibre. */
  severRadius: 0.10,
  /** Pellets despawn after this long (or on any impact). */
  lifeSec: 2.0,
  /** Minimum time between trigger pulls, seconds — two barrels is a
   *  hand-laid zip gun, not a semi-auto. */
  fireCooldownSec: 0.45,
  /** Instant camera pitch kick per barrel, radians. Decays in game-main. */
  kickRadPerBarrel: 0.035,
  /** Hit epsilon for the pellet trace, metres (surface within this = hit). */
  hitEps: 0.01,
  /** Max travel per trace sample, metres — under half a limb girth so a
   *  35 m/s pellet cannot step over an arm between frames. */
  substepLen: 0.05,
} as const;

/** Deterministic 32-bit RNG (mulberry32) — fixed-seed spread patterns. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * `count` directions uniformly spread over a cone of half-angle
 * GRAPESHOT.spreadRad around `dir`. Deterministic under `seed`: same seed,
 * same pattern — the unit tests pin it and the headless driver relies on it.
 * Uniform-in-disc sampling (r = θ_max·sqrt(u)) keeps density flat, not
 * centre-crowded.
 */
export function spreadDirections(dir: Vec3, count: number, seed: number): Vec3[] {
  const axis = normalize(dir);
  // Orthonormal basis around the axis.
  const helper = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] as Vec3 : [1, 0, 0] as Vec3;
  const right = normalize([
    axis[1] * helper[2] - axis[2] * helper[1],
    axis[2] * helper[0] - axis[0] * helper[2],
    axis[0] * helper[1] - axis[1] * helper[0],
  ]);
  const up: Vec3 = [
    axis[1] * right[2] - axis[2] * right[1],
    axis[2] * right[0] - axis[0] * right[2],
    axis[0] * right[1] - axis[1] * right[0],
  ];
  const rng = mulberry32(seed);
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const r = GRAPESHOT.spreadRad * Math.sqrt(rng());
    const theta = rng() * Math.PI * 2;
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    out.push(normalize([
      axis[0] * cr + (right[0] * Math.cos(theta) + up[0] * Math.sin(theta)) * sr,
      axis[1] * cr + (right[1] * Math.cos(theta) + up[1] * Math.sin(theta)) * sr,
      axis[2] * cr + (right[2] * Math.cos(theta) + up[2] * Math.sin(theta)) * sr,
    ]));
  }
  return out;
}

export interface Projectile {
  pos: Vec3;
  vel: Vec3;
  ageSec: number;
  /** Visual ball radius, m — drawn by the mesh pool at this scale. The
   *  collision trace keeps its own fixed epsilon; only the DRAWN ball and
   *  the wound this projectile stamps differ between pellet and slug. */
  radius: number;
  /** Which crater this projectile stamps on impact. */
  kind: 'pellet' | 'slug';
}

/**
 * SLUG MODE (2026-08-26): one large projectile leaving one large,
 * unmistakable crater. Built as a diagnostic first — eight barely-visible
 * 5.5 cm craters gave the owner no signal at all — and kept as a weapon
 * variant: a hand-laid zip gun firing a waxed lump of lead.
 *
 * The crater is deliberately ~3x the pellet calibre and uses the BLAST
 * profile ('blast' rim splay is the tamed lip that reads as a dish, which
 * is also exactly the lab reference look for a big crater). Severing stays
 * governed by Wound.severRadius per the damage.ts contract; a slug carries
 * full-power blast sever calibre so aimed joint shots do what the blast
 * sphere measurably does at 0.13 (sever in ~1).
 */
export const SLUG = {
  /** Visual/collision ball radius, m — a fat thumb-sized lump. */
  radius: 0.055,
  /** Muzzle speed, m/s — heavier feel than the pellet volley. */
  speed: 30,
  /** Same nod to gravity as the pellets. */
  gravity: -6,
  /** Crater radius stamped on impact, m (~the lab's blast craters). */
  woundRadius: 0.16,
  /** Connectivity carve-union calibre via Wound.severRadius: the measured
   *  "severs a shoulder in ~1" value. A deliberate hand-cannon. */
  severRadius: 0.13,
} as const;

/**
 * One volley from the muzzle at `origin` along `aimDir`.
 * barrels 1 → one seed's pattern; barrels 2 → twice the pellets from two
 * independent patterns (never mirrored twins).
 */
export function spawnPellets(
  origin: Vec3, aimDir: Vec3, barrels: 1 | 2, seed: number,
): Projectile[] {
  const n = GRAPESHOT.pelletsPerBarrel;
  const dirs = barrels === 1
    ? spreadDirections(aimDir, n, seed)
    : [...spreadDirections(aimDir, n, seed), ...spreadDirections(aimDir, n, seed ^ 0x9e3779b9)];
  return dirs.map((d) => ({
    pos: [...origin] as Vec3,
    vel: [d[0] * GRAPESHOT.speed, d[1] * GRAPESHOT.speed, d[2] * GRAPESHOT.speed],
    ageSec: 0,
    radius: GRAPESHOT.radius,
    kind: 'pellet' as const,
  }));
}

/**
 * One slug from the muzzle along `dir`. No spread — the whole point is a
 * single known ray the owner (and the placement gate) can trust.
 */
export function spawnSlug(origin: Vec3, dir: Vec3): Projectile {
  return {
    pos: [...origin] as Vec3,
    vel: [dir[0] * SLUG.speed, dir[1] * SLUG.speed, dir[2] * SLUG.speed],
    ageSec: 0,
    radius: SLUG.radius,
    kind: 'slug',
  };
}

/**
 * Slug hit → wound: one BIG crater riding the struck prim. Reuses the blast
 * profile's rim character (tamed lip) at slug size — 'pellet' would put a
 * volcano lip this size reads wrong beside, and there is no third shader
 * character worth adding for a diagnostic. The surface anchor drives
 * gameplay/debug readback; the carve centre rides carveLocal as ever.
 */
export function woundFromSlug(
  prims: import('../types').Primitive[],
  hit: Vec3,
  field: (p: Vec3) => number,
): Wound {
  const w = worldHitToWound(prims, hit, SLUG.woundRadius, 'blast', 0, field);
  w.severRadius = SLUG.severRadius;
  return w;
}

/** Integrate one frame: ballistic arc + ageing. Mutates in place.
 *  Semi-implicit Euler — gravity first, THEN move — which is the stable
 *  order for the arc we want. */
export function stepProjectiles(list: Projectile[], dt: number): void {
  for (const p of list) {
    const vel: Vec3 = [p.vel[0], p.vel[1] + GRAPESHOT.gravity * dt, p.vel[2]];
    p.pos = [
      p.pos[0] + vel[0] * dt,
      p.pos[1] + vel[1] * dt,
      p.pos[2] + vel[2] * dt,
    ];
    p.vel = vel;
    p.ageSec += dt;
  }
}

export function expired(p: Projectile): boolean {
  return p.ageSec > GRAPESHOT.lifeSec || p.pos[1] < -0.5;
}

/**
 * March a pellet's frame segment [from → to] against one signed-distance
 * field. Substeps no longer than GRAPESHOT.substepLen so a full-speed pellet
 * cannot tunnel a limb between frames; a bracketed hit is bisected to surface
 * precision. Returns the impact point, or null when the segment misses.
 */
export function traceProjectile(
  from: Vec3, to: Vec3, field: (p: Vec3) => number,
): Vec3 | null {
  const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-9) return field(from) <= GRAPESHOT.hitEps ? [...from] as Vec3 : null;
  const dir: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
  const steps = Math.max(1, Math.ceil(len / GRAPESHOT.substepLen));
  const stepLen = len / steps;

  let tPrev = 0;
  if (field(from) <= GRAPESHOT.hitEps) return [...from] as Vec3; // spawned inside flesh
  for (let i = 1; i <= steps; i++) {
    const t = i * stepLen;
    const p: Vec3 = [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t];
    if (field(p) <= GRAPESHOT.hitEps) {
      // Bisect [tPrev, t] down to millimetre precision.
      let lo = tPrev;
      let hi = t;
      for (let k = 0; k < 5; k++) {
        const mid = (lo + hi) / 2;
        const m: Vec3 = [from[0] + dir[0] * mid, from[1] + dir[1] * mid, from[2] + dir[2] * mid];
        if (field(m) <= GRAPESHOT.hitEps) hi = mid; else lo = mid;
      }
      return [from[0] + dir[0] * hi, from[1] + dir[1] * hi, from[2] + dir[2] * hi];
    }
    tPrev = t;
  }
  return null;
}

/**
 * Hit → wound mapping glue: a pellet impact becomes a 'pellet'-profile wound
 * bound to the posed prim it actually struck, with the rim scaled to the
 * flesh behind the hit. The wound rides the body from here on (prim-local
 * frame) — that is damage.ts's contract, unchanged.
 */
export function woundFromPellet(
  prims: import('../types').Primitive[],
  hit: Vec3,
  bodyYaw: number,
  field: (p: Vec3) => number,
): Wound {
  const w = worldHitToWound(prims, hit, GRAPESHOT.woundRadius, 'pellet', bodyYaw, field);
  // Severing reads its own calibre, not the crater's — see GRAPESHOT above.
  w.severRadius = GRAPESHOT.severRadius;
  return w;
}

// ---------------------------------------------------------------------------
// Rest→posed placement for severed pieces.
//
// severLimb/severDistal hand back chunk prims in BODY space (the translated
// rest pose). The rendered limb hangs off rig points that have wandered with
// gait AND rotated by bodyYaw, so spawning the piece untransformed would drop
// the arm where the zombie was spawned, not where its arm is. We fit a
// centroid + yaw-only rigid transform from the limb's rest endpoints to their
// current posed endpoints — motion is walk-cycle yaw + translation, so yaw is
// the whole rotation to first order.
// ---------------------------------------------------------------------------

export interface RigidYaw {
  /** Rest-space pivot (the limb's rest centroid). */
  c: Vec3;
  /** Posed-space image of the pivot. */
  cP: Vec3;
  yaw: number;
}

export function fitRestToPose(restPts: Vec3[], posedPts: Vec3[]): RigidYaw {
  const n = Math.min(restPts.length, posedPts.length);
  const c: [number, number, number] = [0, 0, 0];
  const cP: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const r = restPts[i]!;
    const q = posedPts[i]!;
    c[0] += r[0] / n; c[1] += r[1] / n; c[2] += r[2] / n;
    cP[0] += q[0] / n; cP[1] += q[1] / n; cP[2] += q[2] / n;
  }
  let sinSum = 0;
  let cosSum = 0;
  for (let i = 0; i < n; i++) {
    const rx = restPts[i]![0] - c[0];
    const rz = restPts[i]![2] - c[2];
    const px = posedPts[i]![0] - cP[0];
    const pz = posedPts[i]![2] - cP[2];
    // rotateYaw's convention: px = rx·cos + rz·sin, pz = -rx·sin + rz·cos.
    // Summing rz·px − rx·pz extracts +sin·|r|² so atan2 returns +yaw.
    sinSum += rz * px - rx * pz;
    cosSum += rx * px + rz * pz;
  }
  const yaw = Math.atan2(sinSum, cosSum);
  return { c: [...c] as Vec3, cP: [...cP] as Vec3, yaw };
}

export function applyRigidYaw(t: RigidYaw, p: Vec3): Vec3 {
  const x = p[0] - t.c[0];
  const z = p[2] - t.c[2];
  const cy = Math.cos(t.yaw);
  const sy = Math.sin(t.yaw);
  return [
    t.cP[0] + x * cy + z * sy,
    t.cP[1] + (p[1] - t.c[1]),
    t.cP[2] - x * sy + z * cy,
  ];
}
