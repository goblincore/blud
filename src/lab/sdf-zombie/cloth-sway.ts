// CLOTH SWAY (2026-10-26; eased 2026-10-27). The shell folds' lattice (and a ruffled edge, ShellParams.ruffle) is offset
// by the view's windDrift, in metres. In game that offset SWINGS back from the way the body moves and settles when it
// stops: a damped spring chasing a target set by the body's walk velocity and turn rate. It used to ACCUMULATE a fixed
// fraction of every step, which streamed the folds at walking pace with no ease ("like a hamster", owner 2026-10-27),
// and a body turning on the spot to face a strafing player set it off too.

/** Seconds of lag per m/s of walk: the target offset is -velocity * this. */
export const CLOTH_WALK_LAG = 0.03;
/** Metres of offset per rad/s of turning, across the body. Small: a body tracking the player turns a lot. */
export const CLOTH_TURN_LAG = 0.005;
/** The target never exceeds this, metres (about a sixth of a fold at the hood's 30 rad/m). */
export const CLOTH_SWAY_MAX = 0.035;
/** The spring's natural frequency (Hz) and damping ratio: slow and a little under-damped, a heavy cloth swing. */
export const CLOTH_SWAY_HZ = 0.7;
export const CLOTH_SWAY_ZETA = 0.55;
/** A root move longer than this between two calls is a jump (spawn, teleport), not a step. */
export const CLOTH_DRIFT_MAX_STEP = 0.5;

export interface ClothSway { x: number; z: number; vx: number; vz: number }

/** One step of the sway spring, from the body's previous root (x, z, yaw) to its current one over `dt` seconds. */
export function stepClothSway(s: ClothSway, prev: readonly [number, number, number], cur: readonly [number, number, number], dt: number): ClothSway {
  if (!(dt > 0)) return s;
  let tx = 0, tz = 0;
  const dx = cur[0] - prev[0], dz = cur[1] - prev[1];
  if (Math.hypot(dx, dz) < CLOTH_DRIFT_MAX_STEP) { tx -= dx / dt * CLOTH_WALK_LAG; tz -= dz / dt * CLOTH_WALK_LAG; }
  const dy = Math.atan2(Math.sin(cur[2] - prev[2]), Math.cos(cur[2] - prev[2]));
  if (Math.abs(dy) < 1) { tx += Math.cos(cur[2]) * dy / dt * CLOTH_TURN_LAG; tz -= Math.sin(cur[2]) * dy / dt * CLOTH_TURN_LAG; }
  const tl = Math.hypot(tx, tz);
  if (tl > CLOTH_SWAY_MAX) { tx *= CLOTH_SWAY_MAX / tl; tz *= CLOTH_SWAY_MAX / tl; }
  const w = 2 * Math.PI * CLOTH_SWAY_HZ, k = w * w, c = 2 * CLOTH_SWAY_ZETA * w;
  let { x, z, vx, vz } = s;
  // Semi-implicit Euler in sub-steps of at most 1/120 s: stable at this stiffness for any frame time.
  const t = Math.min(dt, 0.25), n = Math.max(1, Math.ceil(t * 120)), h = t / n;
  for (let i = 0; i < n; i++) {
    vx += (k * (tx - x) - c * vx) * h; vz += (k * (tz - z) - c * vz) * h;
    x += vx * h; z += vz * h;
  }
  return { x, z, vx, vz };
}
