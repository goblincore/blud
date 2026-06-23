// src/sim/trig.ts
import { FP_PER_BU, mulfp } from './fp';

/** Blood angle units: a full turn is 2048. */
export const BANGLE_FULL = 2048;
export const BANGLE_QUARTER = 512;

/**
 * cos/sin tables in 16.16 fixed-point (65536 = 1.0), indexed by Blood angle.
 * Built once at load by rounding Math.cos/sin to integers — the rounding makes
 * the table identical across peers in practice (this is what Blood does). If a
 * future cross-platform desync ever traces here, bake the table via codegen.
 */
const COS: Int32Array = (() => {
  const t = new Int32Array(BANGLE_FULL);
  for (let i = 0; i < BANGLE_FULL; i++) {
    t[i] = Math.round(Math.cos((i / BANGLE_FULL) * Math.PI * 2) * FP_PER_BU);
  }
  return t;
})();

function wrap(a: number): number {
  return ((a % BANGLE_FULL) + BANGLE_FULL) % BANGLE_FULL;
}

/** cos(angle) in 16.16. */
export function bcos(angle: number): number { return COS[wrap(angle)]!; }
/** sin(angle) in 16.16 — sin(a) = cos(a - 90°) = cos(a - 512). */
export function bsin(angle: number): number { return COS[wrap(angle - BANGLE_QUARTER)]!; }

/**
 * Rotate a local-space horizontal vector `(lx, lz)` (16.16) into world space by
 * `yaw` (Blood angle). THE single source of "yaw → world direction" — both
 * player movement (stepPlayer) and the dynamite throw (throwVelocity) MUST use
 * this so they never disagree. Convention: local forward `(0, -1)` at yaw 0 maps
 * to world `(-sin, -cos)` = the camera's facing.
 */
export function yawRotate(lx: number, lz: number, yaw: number): { x: number; z: number } {
  const cos = bcos(yaw);
  const sin = bsin(yaw);
  return {
    x: mulfp(lx, cos) + mulfp(lz, sin),
    z: -mulfp(lx, sin) + mulfp(lz, cos),
  };
}

/**
 * Deterministic integer atan2 → Blood angle [0, 2048) pointing toward (dx,dz),
 * in the SIM facing convention. A sprite facing yaw θ moves toward
 * (-sin θ, -cos θ) in (x,z) (see `yawRotate` + the mover tests), so the angle
 * that AIMS facing θ at a target at delta (dx,dz) satisfies
 * (-sin θ, -cos θ) ∝ (dx,dz) → θ = atan2(-dx, -dz).
 *
 * This DIFFERS from Blood's raw `getangle(x,y)` (engine.cpp:12525, which is
 * atan2-style with angle 0 = +x) because the sim's sprite facing is the
 * camera-style forward = -z at yaw 0. Port note: Blood derives getangle from the
 * `radarang` table + `scale`; here we derive from `Math.atan2` — deterministic
 * IEEE-754 on integer fp inputs, the same determinism envelope as the `COS`
 * table (built via `Math.round(Math.cos(...))`). Inputs are fp integers; the
 * result is an integer angle in [0, 2048). Used by the cultist targeting /
 * chase brain (dude.ts) to set goalAng and compute Δangle vs periphery.
 */
export function getangle(dx: number, dz: number): number {
  if (dx === 0 && dz === 0) return 0;
  const a = (Math.atan2(-dx, -dz) / (Math.PI * 2)) * BANGLE_FULL;
  return wrap(Math.round(a));
}
