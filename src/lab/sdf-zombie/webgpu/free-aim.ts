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
  /** Dead-zone scale at full STRAFE speed, per axis (1 = unchanged).
   *
   *  Standing still, the big zone is the mechanic. Strafing, it fights you:
   *  everything in view slides sideways across the screen, and a target you
   *  are tracking drifts out to the edge before the camera starts following
   *  (owner report). Shrinking the zone with lateral speed lets the camera
   *  pick up sooner exactly when the world is sliding. Only sideways motion
   *  counts -- walking forward or back moves things outward slowly and
   *  radially, which the full zone handles fine. Y is left alone: strafing
   *  drifts nothing vertically. */
  strafeDeadzoneScaleX: 0.4,
  strafeDeadzoneScaleY: 1.0,
  /** How fast the strafe envelope follows the player's lateral speed,
   *  1/seconds, so the zone eases in and out instead of popping. */
  strafeRamp: 5.0,
  /** Peak camera turn, radians/second, reached when the reticle is jammed
   *  fully into a corner. Measured in-engine: 2.4 rad/s is 137 deg/s at full
   *  push, which overshoots badly on a flick; 1.9 is ~109 deg/s. Tunable,
   *  because this is exactly the number that has to be felt rather than
   *  reasoned about -- __sdfGame.setAimTuning({ turnRateX }). */
  turnRateX: 1.9,
  turnRateY: 1.25,
  /** Camera turn per mouse pixel, radians, for mouse motion that OVERFLOWS
   *  the reticle's turn edge (see moveAimOverflow). Same rate as plain
   *  mouse-look with free aim off. */
  overflowTurn: 0.0022,
  /** How fast a reticle left OUTSIDE the turn edge eases back onto it,
   *  1/seconds, with the camera turning to match (see settleToEdge). */
  edgeSettle: 6.0,
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
  /** How far the weapon SLIDES across the frame at full reticle deflection,
   *  metres in camera space.
   *
   *  Rotation alone is not the reference's motion. Pivoting about the grip
   *  keeps that grip nailed at screen-x 0.12 however far the reticle goes, so
   *  the weapon reads as bolted to the centre of the screen with only the
   *  barrel free -- the owner's report. Realms of the Haunting carries the
   *  whole weapon across the frame and angles it, so the gun travels toward
   *  what you are aiming at rather than merely nodding at it.
   *
   *  Linear in the reticle, unlike the ANGLES, which are atan of it: the slide
   *  is a screen-space follow, not a projection of anything, so the gun should
   *  track the cursor's position rather than its angle off the view axis.
   *
   *  0.10 m at z = -0.300 is ~0.33 of a half-viewport, which carries the grip
   *  from screen-x 0.12 out to ~0.45. Y is deliberately smaller: vertical
   *  travel reads as the weapon sinking rather than leading. */
  weaponSlideX: 0.10,
  weaponSlideY: 0.045,
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

/** Dead-zone half-extents for a 0..1 strafe envelope (see strafeDeadzoneScaleX). */
export function deadzoneSize(strafe01 = 0): { x: number; y: number } {
  const s = Math.min(1, Math.max(0, strafe01));
  const lerp = (scale: number) => 1 + (scale - 1) * s;
  return {
    x: FREE_AIM.deadzoneX * lerp(FREE_AIM.strafeDeadzoneScaleX),
    y: FREE_AIM.deadzoneY * lerp(FREE_AIM.strafeDeadzoneScaleY),
  };
}

/**
 * Where mouse motion stops moving the reticle and starts turning the camera,
 * per axis, for a 0..1 strafe envelope.
 *
 * Standing still the edge is the SCREEN edge (1), so free aim is untouched --
 * the only change is that shoving past the edge now turns the camera instead
 * of doing nothing. While strafing it pulls in to the strafe-shrunk dead zone.
 * That is what makes circle-strafing work: keeping a target in view needs a
 * constant turn of strafe-speed / radius (~0.85 rad/s at 3.4 m/s and 4 m),
 * and the squared dead-zone push only delivers that with the reticle -- and
 * so the target -- out at ~0.7-0.8 of the half-screen. With the edge pulled
 * in, the mouse steers the camera directly and the target stays near centre.
 */
export function turnEdge(strafe01 = 0): { x: number; y: number } {
  const s = Math.min(1, Math.max(0, strafe01));
  const dz = deadzoneSize(s);
  return { x: 1 + (dz.x - 1) * s, y: 1 + (dz.y - 1) * s };
}

/**
 * Apply raw mouse motion with OVERFLOW: the reticle moves as moveAim does
 * until it reaches the turn edge (or stays where it is, if a shrinking zone
 * has already left it outside), and whatever motion would carry it further
 * out turns the camera instead, radians. Inward motion always moves the
 * reticle.
 */
export function moveAimOverflow(
  aim: AimPoint, dxPx: number, dyPx: number, strafe01 = 0,
): { aim: AimPoint; yaw: number; pitch: number } {
  const edge = turnEdge(strafe01);
  const axis = (v: number, d: number, e: number) => {
    const n = v + d * FREE_AIM.sensitivity;
    const limit = Math.min(1, Math.max(Math.abs(v), e));
    if (Math.abs(n) <= limit) return { pos: n, turn: 0 };
    const over = Math.abs(n) - limit;
    return { pos: Math.sign(n) * limit, turn: Math.sign(n) * over / FREE_AIM.sensitivity * FREE_AIM.overflowTurn };
  };
  // Screen y grows downward; aim y (and pitch) grow upward.
  const x = axis(aim.x, dxPx, edge.x);
  const y = axis(aim.y, -dyPx, edge.y);
  return { aim: { x: x.pos, y: y.pos }, yaw: x.turn, pitch: y.turn };
}

/**
 * Ease a reticle that sits OUTSIDE the turn edge back onto it, turning the
 * camera by exactly the angle that keeps the reticle on the same world point.
 *
 * The edge pulls in when strafing starts, but the strafe envelope takes a
 * moment to build, and a player who starts strafing and turning together has
 * usually pushed the reticle out past it by then. Left alone it would stay
 * out there (moveAimOverflow never moves it further out, but nothing brings it
 * in), so the target sits near the screen edge -- the very thing the edge is
 * meant to stop. Here the CAMERA does the work: the target stays under the
 * reticle while both swing in toward the edge. Standing still the edge is the
 * screen edge, so this never runs.
 *
 * Angles are atan(normalised * tan(halfFov)), the same projection the shot ray
 * and weaponAngles use, so the compensation is exact per axis.
 */
export function settleToEdge(
  aim: AimPoint, strafe01: number, dt: number, f: Frustum,
): { aim: AimPoint; yaw: number; pitch: number } {
  const edge = turnEdge(strafe01);
  const k = 1 - Math.exp(-FREE_AIM.edgeSettle * dt);
  const axis = (v: number, e: number, tan: number) => {
    if (Math.abs(v) <= e) return { pos: v, turn: 0 };
    const n = v + (Math.sign(v) * e - v) * k;
    return { pos: n, turn: Math.atan(v * tan) - Math.atan(n * tan) };
  };
  const x = axis(aim.x, edge.x, f.tanH);
  const y = axis(aim.y, edge.y, f.tanV);
  return { aim: { x: x.pos, y: y.pos }, yaw: x.turn, pitch: y.turn };
}

/** How far past the dead zone the reticle is pushing, -1..1 per axis.
 *  `strafe01` shrinks the zone while the player moves sideways. */
export function deadzonePush(aim: AimPoint, strafe01 = 0): { x: number; y: number } {
  const dz = deadzoneSize(strafe01);
  const past = (v: number, dz: number) => {
    if (Math.abs(v) <= dz) return 0;
    const over = (Math.abs(v) - dz) / Math.max(1e-6, 1 - dz);
    return Math.sign(v) * Math.min(1, over);
  };
  return { x: past(aim.x, dz.x), y: past(aim.y, dz.y) };
}

/**
 * Camera turn for this frame, radians. Zero anywhere inside the dead zone --
 * that flat region IS the mechanic. Squared response so the edge of the zone is
 * a gentle drift and only the extremes whip round.
 */
export function turnFromAim(aim: AimPoint, dt: number, strafe01 = 0): { yaw: number; pitch: number } {
  const p = deadzonePush(aim, strafe01);
  return {
    yaw: Math.sign(p.x) * p.x * p.x * FREE_AIM.turnRateX * dt,
    pitch: Math.sign(p.y) * p.y * p.y * FREE_AIM.turnRateY * dt,
  };
}

/**
 * 0..1 SIDEWAYS speed for one frame of player motion: the component of the
 * ground displacement (dx, dz) along the player's right vector, over
 * `fullSpeed`. Right is [cos yaw, 0, sin yaw], matching fpv.ts. Taken from the
 * actual displacement rather than the keys, so sliding along a wall or
 * standing against one reads as what the screen is actually doing.
 */
export function strafeSpeed01(dx: number, dz: number, yaw: number, dt: number, fullSpeed: number): number {
  if (dt <= 0 || fullSpeed <= 0) return 0;
  const lateral = Math.abs(dx * Math.cos(yaw) + dz * Math.sin(yaw));
  return Math.min(1, lateral / dt / fullSpeed);
}

/** Smooth the strafe envelope so the dead zone eases in and out. */
export function approachStrafe(current: number, target01: number, dt: number): number {
  const k = 1 - Math.exp(-FREE_AIM.strafeRamp * dt);
  return current + (Math.min(1, Math.max(0, target01)) - current) * k;
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

/**
 * How far the weapon slides across the frame for a given reticle, METRES in
 * camera space (x right, y up).
 *
 * This is the other half of "the gun points where you aim". `weaponAngles`
 * turns the barrel; this carries the weapon. With only the rotation the grip
 * stays pinned near screen centre at every reticle position, which reads as a
 * gun bolted to the camera with a hinged barrel rather than a weapon being
 * swung across the body.
 *
 * Deliberately LINEAR in the reticle rather than atan of it: the angles are a
 * projection question (where must the barrel point to be aimed at that pixel),
 * the slide is a framing one (how far across the frame should the gun ride).
 */
export function weaponSlide(aim: AimPoint): { x: number; y: number } {
  return {
    x: aim.x * FREE_AIM.weaponSlideX,
    y: aim.y * FREE_AIM.weaponSlideY,
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
