// src/lab/sdf-zombie/soft-death.ts
//
// SOFT-TARGET DEATH THROW (cultist, owner playtest 2026-09-24): "if they get
// hit they fly back/ragdoll and the outfit does some interesting distortion".
// A soft target (MotionProfile.soft) dies to its first hit. The collapse
// releases the rest pull and gravity takes the Verlet rig; this module gives
// that ragdoll its first velocity so the body is THROWN along the shot
// instead of folding on the spot (it used to crumple toward the shooter).
//
// Per rig point: v = dir * (base + tilt * h) + up * lift, where h is the
// point's height in the body, 0 at the lowest joint and 1 at the highest.
// The top travels further than the feet, so the body topples BACK over its
// heels. The cloth pendulum (the hem point) gets only `hemShare` of it, so
// the robe hangs back and trails the body before it follows.
//
// VARIETY (owner playtest 2026-09-24: "the death animations are boring and
// repetitive"): `planDeath` picks a STYLE from where the round landed, the
// weapon and a seeded roll, then jitters its numbers, so two identical shots
// do not play the same:
//   thrown ... the throw above, along the shot (slugs, most chest hits);
//   crumple .. drops where he stands, head snapping back (head shots);
//   faceplant  feet swept along the shot, the top pitches forward onto his
//              face (low hits — the skirt is where his legs are);
//   spin ..... twisted round by an arm/shoulder hit, then down;
//   stagger .. stays up for a beat (0.35-0.7 s), reeling, then goes down;
//              may clench the trigger: a short burst sprayed high.
// Decapitation and arm loss are not styles: the sever system already cuts a
// head or an arm off on the hit (cloth decals only block TORSO cuts), and
// whichever style plays then plays on what is left.
//
// Pure: randomness comes in as a function; no clock.
import type { RigPoint } from './rig';
import type { LimbId, Vec3 } from './types';

export interface DeathThrow {
  /** m/s along the shot at the lowest joint. */
  base: number;
  /** Extra m/s along the shot at the highest joint. */
  tilt: number;
  /** m/s straight up, every joint. */
  lift: number;
}

/** Heavy rounds throw; light ones tip. Eyeballed against the game capture
 *  (.lab-tmp shoot-cultist, 2026-09-24): the rig damps ~6% per sub-step, so
 *  these are launch speeds, not flight speeds. */
export const DEATH_THROW: Record<'slug' | 'pellet' | 'blast', DeathThrow> = {
  slug: { base: 2.2, tilt: 3.2, lift: 1.1 },
  blast: { base: 3.0, tilt: 3.0, lift: 2.0 },
  pellet: { base: 1.0, tilt: 2.2, lift: 0.5 },
};

export type DeathStyle = 'thrown' | 'crumple' | 'faceplant' | 'spin' | 'stagger';

export interface DeathPlan {
  style: DeathStyle;
  throw: DeathThrow;
  /** Angular velocity about the vertical through the body's centre, rad/s
   *  (+ = counter-clockwise seen from above). */
  spin: number;
  /** Seconds he stays up before the collapse (stagger only). */
  delaySec: number;
  /** Rounds of the trigger-clench burst fired during the delay (0 = none). */
  burst: number;
}

/** What the killing hit was: the struck prim's limb and bone, the weapon. */
export interface DeathHit {
  limb: LimbId | undefined;
  bone: string | undefined;
  weapon: 'slug' | 'pellet' | 'blast';
}

const pick = <T>(r: number, table: readonly (readonly [T, number])[]): T => {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [v, w] of table) { if ((x -= w) < 0) return v; }
  return table[table.length - 1]![0];
};

/** Style weights per hit. Eyeballed; the point is variety. */
export function deathStyleWeights(hit: DeathHit): readonly (readonly [DeathStyle, number])[] {
  if (hit.weapon === 'blast') return [['thrown', 1]];
  if (hit.limb === 'head') return [['crumple', 5], ['thrown', 2], ['stagger', 1]];
  if (hit.limb === 'armL' || hit.limb === 'armR') return [['spin', 5], ['stagger', 3], ['thrown', 1]];
  if (hit.bone === 'hem' || hit.limb === 'legL' || hit.limb === 'legR')
    return [['faceplant', 5], ['crumple', 2], ['stagger', 1]];
  return hit.weapon === 'slug'
    ? [['thrown', 6], ['stagger', 2], ['spin', 1]]
    : [['thrown', 3], ['stagger', 3], ['faceplant', 2], ['spin', 1]];
}

/** Base throws per style (before jitter); `thrown` uses DEATH_THROW. */
const STYLE_THROW: Record<Exclude<DeathStyle, 'thrown'>, DeathThrow> = {
  crumple: { base: 0.25, tilt: 0.6, lift: 0.0 },
  faceplant: { base: 1.3, tilt: -2.4, lift: 0.3 },
  spin: { base: 0.6, tilt: 1.0, lift: 0.3 },
  stagger: { base: 0.5, tilt: 1.2, lift: 0.1 },
};

/** Chance a stagger clenches the trigger, and the burst size range. */
export const DEATH_BURST = { chance: 0.45, min: 3, max: 7 } as const;

/**
 * Plan one death. `rand` returns [0, 1); it is called a fixed number of times
 * in a fixed order, so a seeded stream replays the same death.
 */
export function planDeath(hit: DeathHit, rand: () => number): DeathPlan {
  const style = pick(rand(), deathStyleWeights(hit));
  const j = () => 0.75 + 0.5 * rand(); // +-25% jitter
  const t0 = style === 'thrown' ? DEATH_THROW[hit.weapon] : STYLE_THROW[style];
  const throwJ: DeathThrow = { base: t0.base * j(), tilt: t0.tilt * j(), lift: t0.lift * j() };
  const side = rand() < 0.5 ? -1 : 1;
  const spinMag = style === 'spin' ? 5 + 4 * rand() : 1.2 * rand();
  // An arm hit twists him AWAY from the arm struck.
  const spinSign = hit.limb === 'armL' ? -1 : hit.limb === 'armR' ? 1 : side;
  const delaySec = style === 'stagger' ? 0.35 + 0.35 * rand() : 0;
  const burstRoll = rand();
  const burstN = DEATH_BURST.min + Math.floor(rand() * (DEATH_BURST.max - DEATH_BURST.min + 1));
  return {
    style, throw: throwJ, spin: spinSign * spinMag, delaySec,
    burst: style === 'stagger' && burstRoll < DEATH_BURST.chance ? burstN : 0,
  };
}

/** Adds a spin about the vertical through the points' centroid to `vel`. */
export function addSpin(points: readonly RigPoint[], vel: readonly Vec3[], omega: number): Vec3[] {
  if (omega === 0) return vel.map(v => [...v] as Vec3);
  let cx = 0, cz = 0;
  for (const p of points) { cx += p.pos[0]; cz += p.pos[2]; }
  cx /= points.length; cz /= points.length;
  // omega (0, w, 0) x r = (w * rz, 0, -w * rx)
  return points.map((p, i) => {
    const v = vel[i]!;
    return [v[0] + omega * (p.pos[2] - cz), v[1], v[2] - omega * (p.pos[0] - cx)];
  });
}

/** The hem pendulum's share of the throw: cloth lags the body. */
export const HEM_THROW_SHARE = 0.3;

/**
 * Per-point launch velocities for a death throw along `dirWorld` (only its
 * horizontal part is used; a zero direction throws straight up only).
 * `hemIndex` is the cloth pendulum point, or -1.
 */
export function deathThrowVelocities(
  points: readonly RigPoint[], dirWorld: Vec3, t: DeathThrow, hemIndex = -1,
): Vec3[] {
  const l = Math.hypot(dirWorld[0], dirWorld[2]);
  const dx = l > 1e-6 ? dirWorld[0] / l : 0;
  const dz = l > 1e-6 ? dirWorld[2] / l : 0;
  let lo = Infinity, hi = -Infinity;
  for (const p of points) { lo = Math.min(lo, p.pos[1]); hi = Math.max(hi, p.pos[1]); }
  const span = hi - lo > 1e-6 ? hi - lo : 1;
  return points.map((p, i) => {
    const h = (p.pos[1] - lo) / span;
    const k = i === hemIndex ? HEM_THROW_SHARE : 1;
    const along = (t.base + t.tilt * h) * k;
    return [dx * along, t.lift * k, dz * along];
  });
}

/** Verlet launch: velocity is (pos - prev) / dt, so set prev behind pos. */
export function launchPoints(points: readonly RigPoint[], vel: readonly Vec3[], dt: number): RigPoint[] {
  return points.map((p, i) => {
    const v = vel[i]!;
    return { ...p, pinned: false, prev: [p.pos[0] - v[0] * dt, p.pos[1] - v[1] * dt, p.pos[2] - v[2] * dt] };
  });
}
