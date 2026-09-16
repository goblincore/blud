// src/lab/sdf-zombie/gib-chunks.ts
//
// Hand-rolled deterministic chunk physics. Deliberately NOT Rapier: the game's
// cosmetic ChunkSystem uses Rapier, but the lab wants a stepper whose every
// constant is a knob and whose output is pure state-in/state-out. The game's
// playtested Rapier values are the tuning TARGETS here (restitution 0.55),
// not a dependency.
//
// Motion-polish pass (severed-limb helicopter fix): limbs and gobs tumble
// differently. A severed arm launched with the game's ±9 rad/s angvel reads
// as a spinning helicopter seed; limbs now spawn with a slower tumble and
// ALL chunks bleed angular velocity in the air, so the tumble decays instead
// of spinning at full rate until the floor kills it. Gobs keep the chaotic
// spawn. Launch speeds and gravity are untouched — the arcs are game-hot and
// authoritative; only the spin was tuned.
import type { LimbId, Vec3 } from './types';
import {
  add, cross, dot, len, normalize, scale,
  qFromAxisAngle, qIdentity, qMul, qNormalize, qRotate, type Quat,
} from './vec';

/** All chunk-stepper constants in one place. */
export const CHUNK_TUNING = {
  gravity: -9.8,
  /** Game ChunkSystem capsule restitution (chunks skip off floors). */
  restitution: 0.55,
  /** Horizontal + angular velocity multiplier while in floor contact. */
  floorFriction: 0.72,
  /** WALL contact (a chunk hitting a room wall or the ceiling): the same
   *  restitution the floor uses, because a gib hitting a wall should read like
   *  the same gib hitting the floor. Friction applies to the tangential
   *  component the same way `floorFriction` does. */
  wallRestitution: 0.55,
  airDrag: 0.006,
  /** Squash decays back to zero at this rate per second. */
  squashRelax: 5.5,
  /** LIMB spawn tumble amplitude (rad/s): (rng-0.5)*2*limbTumble. Lower than
   *  the gobs' — a tumbling forearm reads heavy, not helicopter. */
  limbTumble: 4.2,
  /** GOB spawn tumble amplitude (rad/s) — the game's setAngvel((rand-0.5)*18)
   *  = ±9, kept chaotic for the amorphous hunks. */
  gobTumble: 9,
  /** Airborne angular-velocity decay (1/s) — the tumble bleeds off in flight
   *  instead of spinning at spawn rate until the floor stops it. */
  angularAirDamp: 1.9,
  /** Extra grounded spin kill per contact frame, multiplied with
   *  floorFriction for angVel only — a sliding chunk stops rolling fast. */
  angularFloorDamp: 0.55,
  /** BONE restitution (kind 'bone'): bones thud where flesh chunks skip. */
  boneRestitution: 0.2,
  /** Below this speed a grounded chunk starts easing flat. */
  toppleSpeed: 0.6,
  /** Radians/sec the long axis eases toward horizontal (~90deg in 0.4s). */
  toppleRate: 4.0,
  /** Below this speed a grounded, finished-toppling chunk counts SETTLED
   *  (close-up task 5). The freeze is invisible by construction: at 0.05 m/s
   *  a chunk moves under a millimetre per 60 Hz frame, and nothing in the
   *  lab ever pushes a chunk again once it is down (pellets do not test
   *  chunks), so a chunk that passes the settled predicate never moves
   *  again — we simply stop stepping it and bake its field into a mesh. */
  settleSpeed: 0.05,
} as const;

/** What the chunk IS — limbs tumble heavy, gobs chaotic (CHUNK_TUNING),
 *  bones THUD (the melt's released skeleton groups: dense, no bounce, no
 *  squash — a skull that squashes on impact reads as goo, and a 0.55
 *  restitution bounce keeps it airborne for seconds). */
export type ChunkKind = 'limb' | 'gob' | 'bone';

const GRAVITY = CHUNK_TUNING.gravity;
const RESTITUTION = CHUNK_TUNING.restitution;
const FLOOR_FRICTION = CHUNK_TUNING.floorFriction;
const AIR_DRAG = CHUNK_TUNING.airDrag;
const SQUASH_RELAX = CHUNK_TUNING.squashRelax;
const TOPPLE_SPEED = CHUNK_TUNING.toppleSpeed;
const TOPPLE_RATE = CHUNK_TUNING.toppleRate;

export interface Chunk {
  limb: LimbId;
  /** limb | gob — picks the spawn tumble amplitude (CHUNK_TUNING). */
  kind: ChunkKind;
  pos: Vec3;
  vel: Vec3;
  radius: number;
  /** 0 = round, 1 = fully flattened. Drives non-uniform scale in the shader. */
  squash: number;
  /** Orientation, unit quaternion [x,y,z,w]. */
  quat: Quat;
  /** Angular velocity, rad/s about each world axis. */
  angVel: Vec3;
  /** Chunk-LOCAL long axis (unit). The topple aligns this with the floor. */
  longAxis: Vec3;
}

export function makeChunk(
  limb: LimbId, pos: Vec3, vel: Vec3, radius: number,
  longAxis: Vec3, rng: () => number = Math.random,
  kind: ChunkKind = 'limb',
  /**
   * PRE-RELEASE STATE (body-to-gib task 4). A chunk born from the rupture was
   * ALREADY turning when the body was last drawn: it is handed the displayed
   * orientation and the angular velocity that produced it, so the release has
   * no orientation reset and no second angular kick. The random tumble is still
   * drawn (so the shared rngStreams.misc sequence is unchanged for every other
   * path) and then OVERRIDDEN — the pre-release state wins.
   */
  spin?: { quat?: Quat; angVel?: Vec3 },
): Chunk {
  // Tumble proportional-ish to being launched at all. Limbs tumble slower
  // than the game's ±9 rad/s (helicopter fix); gobs keep the chaotic spawn.
  const tumble = kind === 'gob' ? CHUNK_TUNING.gobTumble : CHUNK_TUNING.limbTumble;
  const tumbleVel: Vec3 = [
    (rng() - 0.5) * 2 * tumble,
    (rng() - 0.5) * 2 * tumble,
    (rng() - 0.5) * 2 * tumble,
  ];
  return {
    limb, kind, pos, vel, radius, squash: 0,
    quat: spin?.quat ? qNormalize(spin.quat) : qIdentity(),
    angVel: spin?.angVel ?? tumbleVel,
    longAxis: normalize(longAxis),
  };
}

/** A solid box a chunk bounces off. Structurally the level's own `Aabb`
 *  (`game-level.ts` `levelColliders()`), declared here as a plain shape so this
 *  module keeps no dependency on the WebGPU level. */
export interface ChunkBox { min: Vec3; max: Vec3 }

/** What a chunk collides with. BOTH fields are optional and absent by default,
 *  so the lab's stepper and every existing test keep the exact behaviour they
 *  had (a floor plane and nothing else). */
export interface ChunkColliders {
  /** Solid boxes — the level's colliders, which are the WALLS SPLIT AROUND THE
   *  DOORWAYS, so a gib flies through a door and bounces off the wall beside
   *  it. */
  boxes?: readonly ChunkBox[];
  /** Ceiling height (m) for the enclosure the chunk is in, if known. */
  ceilingY?: number;
}

/**
 * Push a chunk out of any box it overlaps and reflect its velocity.
 *
 * The owner, playing: *"it seems the gibs dont bounce off the walls/have
 * collission"* — and they did not: `stepChunk` had a floor plane at y = radius
 * and nothing else, so a piece thrown at a wall flew straight through it and out
 * of the room. This is a sphere-vs-AABB resolve (closest point on the box, push
 * out along the surface normal), which handles corners and edges without any
 * special cases and does not care what the boxes MEAN.
 *
 * A chunk whose centre is INSIDE a box is pushed out along its shallowest
 * penetration axis: the common cause is a fast piece tunnelling through a thin
 * wall in one frame, where there is no surface normal to use.
 */
function resolveBoxes(
  p: Vec3, v: Vec3, radius: number, boxes: readonly ChunkBox[],
): { pos: Vec3; vel: Vec3; hit: boolean } {
  let [x, y, z] = p;
  let [vx, vy, vz] = v;
  let hit = false;
  for (const b of boxes) {
    // Broad phase: a box further than (radius) from the centre on any axis
    // cannot touch it.
    if (x + radius < b.min[0] || x - radius > b.max[0]) continue;
    if (y + radius < b.min[1] || y - radius > b.max[1]) continue;
    if (z + radius < b.min[2] || z - radius > b.max[2]) continue;

    const qx = Math.min(Math.max(x, b.min[0]), b.max[0]);
    const qy = Math.min(Math.max(y, b.min[1]), b.max[1]);
    const qz = Math.min(Math.max(z, b.min[2]), b.max[2]);
    let nx = x - qx, ny = y - qy, nz = z - qz;
    const d = Math.hypot(nx, ny, nz);
    if (d >= radius) continue;
    hit = true;
    if (d > 1e-6) {
      const inv = 1 / d;
      nx *= inv; ny *= inv; nz *= inv;
      const push = radius - d;
      x += nx * push; y += ny * push; z += nz * push;
    } else {
      // Centre inside the box: push out along the shallowest axis.
      const dxMin = x - b.min[0], dxMax = b.max[0] - x;
      const dyMin = y - b.min[1], dyMax = b.max[1] - y;
      const dzMin = z - b.min[2], dzMax = b.max[2] - z;
      const m = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
      nx = 0; ny = 0; nz = 0;
      if (m === dxMin) { nx = -1; x = b.min[0] - radius; }
      else if (m === dxMax) { nx = 1; x = b.max[0] + radius; }
      else if (m === dyMin) { ny = -1; y = b.min[1] - radius; }
      else if (m === dyMax) { ny = 1; y = b.max[1] + radius; }
      else if (m === dzMin) { nz = -1; z = b.min[2] - radius; }
      else { nz = 1; z = b.max[2] + radius; }
    }
    const vn = vx * nx + vy * ny + vz * nz;
    if (vn < 0) {
      // Reflect the NORMAL component with restitution, then damp the
      // TANGENTIAL component by the floor's friction: a gib skids along a wall
      // exactly like it skids along the floor. Decomposed rather than scaled
      // per-axis, because the normal is not axis-aligned at a corner.
      const j = -(1 + CHUNK_TUNING.wallRestitution) * vn;
      vx += j * nx; vy += j * ny; vz += j * nz;
      const vnAfter = vx * nx + vy * ny + vz * nz;
      const tx = vx - vnAfter * nx, ty = vy - vnAfter * ny, tz = vz - vnAfter * nz;
      vx = tx * FLOOR_FRICTION + vnAfter * nx;
      vy = ty * FLOOR_FRICTION + vnAfter * ny;
      vz = tz * FLOOR_FRICTION + vnAfter * nz;
    }
  }
  return { pos: [x, y, z], vel: [vx, vy, vz], hit };
}

export function stepChunk(c: Chunk, dt: number, colliders?: ChunkColliders): Chunk {
  let [x, y, z] = c.pos;
  let [vx, vy, vz] = c.vel;
  let { squash } = c;
  let quat = c.quat;
  let angVel = c.angVel;

  vy += GRAVITY * dt;
  const drag = 1 - AIR_DRAG;
  vx *= drag; vy *= drag; vz *= drag;

  x += vx * dt; y += vy * dt; z += vz * dt;

  // Integrate orientation from angular velocity.
  const w = len(angVel);
  if (w > 1e-6) {
    quat = qNormalize(qMul(qFromAxisAngle(scale(angVel, 1 / w), w * dt), quat));
  }

  // Airborne angular damping: the tumble DECAYS in flight (helicopter fix).
  angVel = scale(angVel, Math.max(0, 1 - CHUNK_TUNING.angularAirDamp * dt));

  // WALLS AND CEILING, before the floor: the floor is a plane and should have
  // the last word on y (a wall resolve can push a chunk downward).
  if (colliders?.boxes?.length) {
    const r = resolveBoxes([x, y, z], [vx, vy, vz], c.radius, colliders.boxes);
    x = r.pos[0]; y = r.pos[1]; z = r.pos[2];
    vx = r.vel[0]; vy = r.vel[1]; vz = r.vel[2];
  }
  // The ceiling is not one of `levelColliders()`' boxes (they are walls up to
  // WALL_H), so it comes in as an explicit height for the enclosure the chunk is
  // in. Without it a blast can throw a piece up through the room's roof.
  const ceilingY = colliders?.ceilingY;
  if (ceilingY !== undefined && y + c.radius > ceilingY) {
    y = ceilingY - c.radius;
    if (vy > 0) vy = -vy * CHUNK_TUNING.wallRestitution;
    vx *= FLOOR_FRICTION; vz *= FLOOR_FRICTION;
  }

  let grounded = false;
  if (y < c.radius) {
    y = c.radius;
    grounded = true;
    if (vy < 0) {
      // Squash scales with impact speed — this is what sells wetness. BONES
      // do not squash: they are the rigid thing inside the wet thing.
      if (c.kind !== 'bone') {
        squash = Math.min(1, squash + Math.min(Math.abs(vy) * 0.16, 0.9));
      }
      const rest = c.kind === 'bone' ? CHUNK_TUNING.boneRestitution : RESTITUTION;
      vy = -vy * rest;
      if (Math.abs(vy) < 0.35) vy = 0;
    }
    vx *= FLOOR_FRICTION; vz *= FLOOR_FRICTION;
    angVel = scale(angVel, FLOOR_FRICTION * CHUNK_TUNING.angularFloorDamp);
    if (len(angVel) < 0.05) angVel = [0, 0, 0];
  }

  // Topple: a grounded, slow chunk eases its long axis toward horizontal, so
  // limbs lie flat instead of standing on end. Handcrafted substitute for a
  // collision mesh; deterministic and tunable.
  const speed = Math.hypot(vx, vy, vz);
  if (grounded && speed < TOPPLE_SPEED) {
    const worldLong = qRotate(quat, c.longAxis);
    const horizLen = Math.hypot(worldLong[0], worldLong[2]);
    // A perfectly vertical axis has no horizontal shadow to fall toward — give
    // it a nudge direction deterministically from the quat's x component sign.
    const target: Vec3 = horizLen < 1e-3
      ? [quat[0] >= 0 ? 1 : -1, 0, 0]
      : normalize([worldLong[0], 0, worldLong[2]]);
    const cosA = Math.min(1, Math.max(-1, dot(worldLong, target)));
    const angle = Math.acos(cosA);
    if (angle > 0.01) {
      const rawAxis = cross(worldLong, target);
      const axis = len(rawAxis) < 1e-6 ? ([0, 0, 1] as Vec3) : normalize(rawAxis);
      const step = Math.min(angle, TOPPLE_RATE * dt);
      quat = qNormalize(qMul(qFromAxisAngle(axis, step), quat));
    }
  }

  squash = Math.max(0, squash - SQUASH_RELAX * dt);

  const out: Chunk = { ...c, pos: [x, y, z], vel: [vx, vy, vz], squash, quat, angVel };
  return finite(out) ? out : {
    ...c, vel: [0, 0, 0], angVel: [0, 0, 0], squash: 0,
  };
}

/**
 * How far the chunk's long axis still is from lying flat, in radians — the
 * SAME quantity stepChunk's topple block eases toward zero, recomputed read-
 * only. The topple loop runs while `angle > 0.01`, so a chunk whose angle is
 * at or below that bound will never rotate again unless it speeds back up.
 * Exported for chunkSettled (and its tests) so the predicate cannot drift
 * from the integrator's own stopping condition.
 */
export function toppleAngleToFlat(c: Chunk): number {
  const worldLong = qRotate(c.quat, c.longAxis);
  const horizLen = Math.hypot(worldLong[0], worldLong[2]);
  const target: Vec3 = horizLen < 1e-3
    ? [c.quat[0] >= 0 ? 1 : -1, 0, 0]
    : normalize([worldLong[0], 0, worldLong[2]]);
  const cosA = Math.min(1, Math.max(-1, dot(worldLong, target)));
  return Math.acos(cosA);
}

/**
 * TRUE when the chunk is done moving and will never move again. The close-up
 * task 5 bake fires on this, so every clause is a "has already stopped"
 * test, never a prediction:
 *
 *   grounded        — y is pinned to radius only while in floor contact;
 *                     an airborne chunk always has y > radius.
 *   angVel == 0     — stepChunk zeroes angVel EXACTLY (the len < 0.05 clamp)
 *                     when grounded, so this is the integrator's own
 *                     "spin has stopped" flag, not an epsilon.
 *   squash == 0     — the squash decay clamps at exactly 0; a non-zero squash
 *                     is still relaxing (the field is still changing shape).
 *   topple finished — angle <= the topple loop's own exit bound (0.01, + a
 *                     float margin). A chunk mid-topple is still rotating.
 *   speed < settleSpeed — sub-millimetre creep; freezing it is invisible.
 *
 * NOT settleSpeed < TOPPLE_SPEED alone: between 0.6 and 0.05 m/s the topple
 * is still easing the axis flat, so both gates must agree. A chunk still
 * SLIDING (grounded but fast) fails the speed clause; an airborne chunk
 * fails grounded; one mid-topple fails the angle.
 */
export function chunkSettled(c: Chunk): boolean {
  if (!(c.pos[1] <= c.radius + 1e-4)) return false;              // grounded
  if (c.angVel[0] !== 0 || c.angVel[1] !== 0 || c.angVel[2] !== 0) return false;
  if (c.squash > 0) return false;                                 // still relaxing
  if (toppleAngleToFlat(c) > 0.011) return false;                 // still toppling
  const speed = Math.hypot(c.vel[0], c.vel[1], c.vel[2]);
  return speed < CHUNK_TUNING.settleSpeed;
}

/** Squash factors: flatten y, bulge xz — applied in WORLD axes after rotation. */
export function squashFactors(c: Chunk): { sx: number; sy: number; sz: number } {
  const s = Math.min(1, Math.max(0, c.squash));
  return { sx: 1 + s * 0.35, sy: 1 - s * 0.5, sz: 1 + s * 0.35 };
}

/**
 * World position of a chunk-local point: rotate by the chunk quat, squash in
 * world axes, translate to the chunk. THE one transform both renderer paths'
 * apply() must use — hand-rolling it twice is how the paths drift.
 */
export function chunkPoint(
  c: Chunk, local: Vec3, sx: number, sy: number, sz: number,
): Vec3 {
  const r = qRotate(c.quat, local);
  return [c.pos[0] + r[0] * sx, c.pos[1] + r[1] * sy, c.pos[2] + r[2] * sz];
}

function finite(c: Chunk): boolean {
  return [...c.pos, ...c.vel, ...c.angVel, ...c.quat, c.squash]
    .every(n => Number.isFinite(n) && Math.abs(n) < 1e6);
}
