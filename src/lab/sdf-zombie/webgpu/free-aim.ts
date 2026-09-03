// src/lab/sdf-zombie/webgpu/free-aim.ts
//
// REALMS-OF-THE-HAUNTING FREE AIM (owner reference: realms.mov, 1996).
//
// Standard FPS mouse-look welds the aim point to screen centre and turns the
// camera with every mouse pixel. ROTH decouples them: the mouse drives a
// RETICLE around the viewport, the weapon swings to point at it, and the camera
// only turns once the reticle pushes past a large central dead zone. The result
// is that you can flick onto something beside you without the whole world
// yawing, and the weapon visibly leads your aim.
//
// Everything here is pure -- screen-space numbers only, no Three.js, no DOM --
// so the feel can be pinned by tests instead of by squinting at the screen.

export const FREE_AIM = {
  /** Half-width of the dead zone, as a fraction of the half-viewport. Inside
   *  this box the camera does not turn at all; the reticle just moves. */
  deadzoneX: 0.45,
  deadzoneY: 0.38,
  /** Peak camera turn, radians/second, reached when the reticle is jammed
   *  fully into a corner. Measured in-engine: 2.4 rad/s is 137 deg/s at full
   *  push, which overshoots badly on a flick; 1.9 is ~109 deg/s. Tunable,
   *  because this is exactly the number that has to be felt rather than
   *  reasoned about -- __sdfGame.setAimTuning({ turnRateX }). */
  turnRateX: 1.9,
  turnRateY: 1.25,
  /** Reticle travel per mouse pixel, in half-viewport units. */
  sensitivity: 0.0042,
  /** How much of the reticle's TRUE angle the weapon takes up, 0..1. 1 = the
   *  barrel points exactly at the reticle.
   *
   *  These were absolute degree caps (15 and 10). A cap cannot track a reticle
   *  whose own excursion depends on the aspect ratio: at 790x555 the reticle
   *  reaches 47.5 deg off-axis, so the gun was pointing 32.5 deg away from
   *  where the player was aiming, worst exactly at the edges. As a FRACTION
   *  the knob still tunes the feel but can no longer reintroduce a mismatch --
   *  1.0 is "aimed", and there is nothing above it. */
  weaponYawFrac: 1.0,
  weaponPitchFrac: 1.0,
  /** How fast the weapon catches up to the reticle, 1/seconds. Lag is the
   *  point -- an instant weapon reads as a cursor with a gun sprite glued on. */
  weaponLag: 9.0,
  /** Reticle drift back to centre, units/second. 0 keeps it where you put it,
   *  which is what the reference does. */
  recentreRate: 0.0,
};

/** Reticle position in NORMALISED screen space: 0,0 centre, ±1 at the edges. */
export interface AimPoint { x: number; y: number; }

const clamp1 = (v: number) => Math.min(1, Math.max(-1, v));

/** Apply raw mouse motion to the reticle, clamped to the viewport. */
export function moveAim(aim: AimPoint, dxPx: number, dyPx: number): AimPoint {
  return {
    x: clamp1(aim.x + dxPx * FREE_AIM.sensitivity),
    // Screen y grows downward; aim y grows upward, matching pitch.
    y: clamp1(aim.y - dyPx * FREE_AIM.sensitivity),
  };
}

/** How far past the dead zone the reticle is pushing, -1..1 per axis. */
export function deadzonePush(aim: AimPoint): { x: number; y: number } {
  const past = (v: number, dz: number) => {
    if (Math.abs(v) <= dz) return 0;
    const over = (Math.abs(v) - dz) / Math.max(1e-6, 1 - dz);
    return Math.sign(v) * Math.min(1, over);
  };
  return { x: past(aim.x, FREE_AIM.deadzoneX), y: past(aim.y, FREE_AIM.deadzoneY) };
}

/**
 * Camera turn for this frame, radians. Zero anywhere inside the dead zone --
 * that flat region IS the mechanic. Squared response so the edge of the zone is
 * a gentle drift and only the extremes whip round.
 */
export function turnFromAim(aim: AimPoint, dt: number): { yaw: number; pitch: number } {
  const p = deadzonePush(aim);
  return {
    yaw: Math.sign(p.x) * p.x * p.x * FREE_AIM.turnRateX * dt,
    pitch: Math.sign(p.y) * p.y * p.y * FREE_AIM.turnRateY * dt,
  };
}

/** Half-angle tangents of the live camera frustum. tanV = tan(fovY/2),
 *  tanH = tanV * aspect. The caller owns the camera, so it passes these in
 *  rather than this module importing Three.js. */
export interface Frustum { tanH: number; tanV: number; }

/**
 * Where the weapon must point to be aimed AT the reticle, degrees.
 *
 * The reticle is a SCREEN position, so its angle off the view axis is
 * atan(normalised * tan(halfFov)) -- not a linear fraction of some fixed
 * maximum. That distinction is the whole bug: a linear 15 deg cap and a
 * genuinely 47.5 deg reticle disagree most exactly where the player is
 * looking hardest.
 */
export function weaponAngles(aim: AimPoint, f: Frustum): { yawDeg: number; pitchDeg: number } {
  const deg = 180 / Math.PI;
  // Clamped so a runtime tuning call (__sdfGame.setAimTuning) cannot push the
  // fraction above 1 and reintroduce the original mismatch -- FREE_AIM's
  // fields have no validation of their own, so this function has to hold the
  // promise its own doc comment makes.
  const yawFrac = Math.min(1, Math.max(0, FREE_AIM.weaponYawFrac));
  const pitchFrac = Math.min(1, Math.max(0, FREE_AIM.weaponPitchFrac));
  return {
    yawDeg: -Math.atan(aim.x * f.tanH) * deg * yawFrac,
    pitchDeg: Math.atan(aim.y * f.tanV) * deg * pitchFrac,
  };
}

/** Exponential catch-up toward `target`, framerate-independent. */
export function approachAngle(current: number, target: number, dt: number): number {
  const k = 1 - Math.exp(-FREE_AIM.weaponLag * dt);
  return current + (target - current) * k;
}

export interface V3 { x: number; y: number; z: number; }

/**
 * Translation that turns a rotation-about-the-origin into a
 * rotation-about-`pivot`: `pivot - R * pivot`.
 *
 * The view-model rig's origin is the EYE, so rotating it swings the whole
 * weapon around the player's head -- at the reticle's true 47.5 deg that puts
 * the muzzle at screen-x 1.54, clean off the viewport, which is why the angle
 * used to be capped at 15 instead. Pivoting at the GRIP puts it at 0.66 with
 * the grip itself barely moving (0.12). An arm swings the barrel about the
 * hands, not about the eyeball.
 *
 * Three.js's default Euler order is 'XYZ', which composes as R = Rx * Ry * Rz
 * -- so applied to a vector, Rz (roll) happens FIRST, then Ry (yaw), then
 * Rx (pitch) LAST. Getting this backwards (Rx then Ry, ignoring roll) is
 * invisible under a pure yaw or a pure pitch, where the two conventions
 * coincide, and only shows up as grip drift once yaw, pitch and roll (the
 * walk bob) are combined -- see pivotOffset's test for the corner case that
 * actually catches it.
 *
 * Argument order mirrors the call site's `rotation.set(pitch, yaw, roll)`.
 */
export function pivotOffset(pivot: V3, pitchRad: number, yawRad: number, rollRad = 0): V3 {
  const cy = Math.cos(yawRad), sy = Math.sin(yawRad);
  const cp = Math.cos(pitchRad), sp = Math.sin(pitchRad);
  const cr = Math.cos(rollRad), sr = Math.sin(rollRad);
  // Rz (roll) applied to the pivot first...
  let x = pivot.x * cr - pivot.y * sr;
  let y = pivot.x * sr + pivot.y * cr;
  let z = pivot.z;
  // ...then Ry (yaw)...
  const x2 = x * cy + z * sy, z2 = -x * sy + z * cy;
  x = x2; z = z2;
  // ...then Rx (pitch) last.
  const y3 = y * cp - z * sp, z3 = y * sp + z * cp;
  y = y3; z = z3;
  return { x: pivot.x - x, y: pivot.y - y, z: pivot.z - z };
}

/** Optional drift of the reticle back toward centre. */
export function recentre(aim: AimPoint, dt: number): AimPoint {
  if (FREE_AIM.recentreRate <= 0) return aim;
  const k = Math.min(1, FREE_AIM.recentreRate * dt);
  return { x: aim.x * (1 - k), y: aim.y * (1 - k) };
}

// ——— Weapon bob ————————————————————————————————————————————————————————

export const BOB = {
  /** Cycles per metre walked. A stride is ~0.75 m, and the weapon dips twice
   *  per stride (once per footfall), so ~1.33 cycles/m. */
  cyclesPerMetre: 1.33,
  /** Lateral swing, metres, at full speed. */
  amountX: 0.017,
  /** Vertical bounce, metres, at full speed. Twice the lateral frequency,
   *  which is what makes it read as footfalls rather than a sway. */
  amountY: 0.011,
  /** Roll, degrees, at full speed. */
  amountRollDeg: 1.4,
  /** How fast the bob amplitude follows the player's speed, 1/seconds. */
  ramp: 6.0,
};

export interface BobPose { x: number; y: number; rollDeg: number; }

/**
 * Weapon bob from distance walked rather than elapsed time, so it stays locked
 * to footfalls when the player speeds up, slows down or stops -- a time-driven
 * bob keeps swinging while you stand still and slides out of phase with the
 * stride the moment speed changes.
 *
 * `amount` is the smoothed 0..1 speed envelope; see approachBob.
 */
export function bobPose(distanceWalked: number, amount: number): BobPose {
  const phase = distanceWalked * BOB.cyclesPerMetre * Math.PI * 2;
  const a = Math.min(1, Math.max(0, amount));
  return {
    x: Math.sin(phase) * BOB.amountX * a,
    // Doubled frequency and offset so the low point lands with each footfall.
    y: -Math.abs(Math.sin(phase)) * BOB.amountY * a,
    rollDeg: Math.sin(phase) * BOB.amountRollDeg * a,
  };
}

/** Smooth the speed envelope so the bob fades in and out instead of snapping. */
export function approachBob(current: number, targetSpeed01: number, dt: number): number {
  const k = 1 - Math.exp(-BOB.ramp * dt);
  return current + (Math.min(1, Math.max(0, targetSpeed01)) - current) * k;
}
