// scripts/lib/upscale-framing.mjs — seeded capture planning for neural upscale P3
// (spec docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md §1;
//  dataset contract docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §1).

export const CLASS_SHARES = { close: 0.2, medium: 0.45, far: 0.35 };
export const LOOK_AT_MIX = {
  close: { head: 0.5, wound: 0.3, torso: 0.2 },
  medium: { head: 0.3, wound: 0.3, torso: 0.4 },
  far: { head: 0.3, wound: 0, torso: 0.7 },
};
export const DISTANCE_M = { close: [0.6, 1.5], medium: [1.5, 3.5], far: [3.5, 7.0] };
export const ORBIT_DEG = { close: 75, medium: 120, far: 180 };
/** close: eye at the look-at height ± 0.2 m; medium and far: an absolute eye height range. */
export const EYE_M = { close: { relative: 0.2 }, medium: { absolute: [1.2, 1.8] }, far: { absolute: [1.3, 1.8] } };
export const WOUNDED_SHARE = 0.5;
export const BLAST_SHARE_OF_WOUNDED = 0.2;
export const VAL_EVERY = 10;
export const SHOWCASE_COUNTS = { close: 3, medium: 5, far: 4 };
/** +1 when a body's facing is (sin yaw, −cos yaw), the page's own forward convention. Flip to −1
 *  if the capture's face check (plan Task 7) shows the back of the head. */
export const BODY_FACING_SIGN = -1;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick a key from `weights` with a uniform sample u in [0, 1). Zero weights never win. */
export function pickWeighted(u, weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [k, w] of entries) {
    acc += w / total;
    if (u < acc) return k;
  }
  return entries[entries.length - 1][0];
}

const lerp = (a, b, u) => a + (b - a) * u;

/**
 * One sequence's plan. Always draws exactly 12 random numbers, whatever the branches, so a
 * resumed capture can replay the stream for finished sequences and stay in step.
 */
export function planSequence(rng, index, characters, rooms) {
  const u = Array.from({ length: 12 }, () => rng());
  const cls = pickWeighted(u[0], CLASS_SHARES);
  const lookAt = pickWeighted(u[1], LOOK_AT_MIX[cls]);
  const [d0, d1] = DISTANCE_M[cls];
  const eye = EYE_M[cls];
  const wounded = u[5] < WOUNDED_SHARE;
  return {
    index,
    class: cls,
    lookAt,
    distance: lerp(d0, d1, u[2]),
    orbitDeg: (u[3] * 2 - 1) * ORBIT_DEG[cls],
    eyeOffset: eye.relative !== undefined ? (u[4] * 2 - 1) * eye.relative : null,
    eyeHeight: eye.absolute ? lerp(eye.absolute[0], eye.absolute[1], u[4]) : null,
    character: characters[index % characters.length],
    room: rooms[Math.min(rooms.length - 1, Math.floor(u[10] * rooms.length))],
    wounds: wounded
      ? { shots: 1 + Math.floor(u[6] * 4), slug: u[7] < 0.5, blast: u[8] < BLAST_SHARE_OF_WOUNDED, blastAngle: u[9] * Math.PI * 2 }
      : null,
    lightPhase: 1000 + Math.floor(u[11] * 1_000_000),
  };
}

/**
 * Camera for a look-at point. The body's facing is (sin bodyYaw, −cos bodyYaw) × facingSign (the
 * page's forward convention, game-main.ts aimAtNearestSurface), orbited by orbitDeg around +Y.
 * The camera stands `distance` m out along that direction at eye height eyeY and looks at the
 * target. Returns setPose's (x, z, yaw, pitch) plus eyeY.
 */
export function cameraPose(target, bodyYaw, distance, orbitDeg, eyeY, facingSign = BODY_FACING_SIGN) {
  const fx = Math.sin(bodyYaw) * facingSign;
  const fz = -Math.cos(bodyYaw) * facingSign;
  const t = (orbitDeg * Math.PI) / 180;
  const dx = fx * Math.cos(t) - fz * Math.sin(t);
  const dz = fx * Math.sin(t) + fz * Math.cos(t);
  const x = target[0] + dx * distance;
  const z = target[2] + dz * distance;
  const vx = target[0] - x;
  const vz = target[2] - z;
  return { x, z, yaw: Math.atan2(vx, -vz), pitch: Math.atan2(target[1] - eyeY, Math.hypot(vx, vz)), eyeY };
}

/** The page's forward vector for a yaw/pitch. */
export function forwardOf(yaw, pitch) {
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

/** 'val' for about one sequence in VAL_EVERY, by a seeded integer hash of (seed, index). */
export function splitFor(seed, index) {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h % VAL_EVERY === 0 ? 'val' : 'train';
}

/**
 * The 12 fixed showcase ids: SHOWCASE_COUNTS per class from validation pairs, preferring pairs with
 * a head (2) and a wound (1), then id order. Short classes are filled from the rest.
 */
export function pickShowcase(pairs) {
  const val = pairs.filter((p) => p.split === 'val').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const score = (p) => (p.regions.heads.length > 0 ? 2 : 0) + (p.regions.wounds.length > 0 ? 1 : 0);
  const byScore = (list) => [...list].sort((a, b) => score(b) - score(a));
  const chosen = new Set();
  for (const [cls, n] of Object.entries(SHOWCASE_COUNTS)) {
    for (const p of byScore(val.filter((q) => q.class === cls)).slice(0, n)) chosen.add(p.id);
  }
  for (const p of byScore(val)) {
    if (chosen.size >= 12) break;
    chosen.add(p.id);
  }
  return [...chosen];
}
