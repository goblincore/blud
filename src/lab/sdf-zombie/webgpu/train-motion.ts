// src/lab/sdf-zombie/webgpu/train-motion.ts
//
// The train's motion (carriage kit spec §6), as pure functions of SIM time and speed:
// camera roll and bob, rail-joint jolts, lamp and curtain swing. The carriages never move;
// this is what makes them feel like they do. Deterministic: same inputs, same outputs.

export const RAIL_LENGTH_M = 18;
const DEG = Math.PI / 180;
const ROLL_DEG = 0.6, BOB_M = 0.006, JOLT_S = 0.25, JOLT_ROLL_DEG = 0.4, JOLT_BOB_M = 0.01;
const LAMP_DEG = 4;

/** 1 at a rail joint, decaying linearly to 0 over JOLT_S; 0 when stopped. */
export function joltAt(t: number, speed: number): number {
  if (speed <= 0) return 0;
  const period = RAIL_LENGTH_M / speed;
  const since = ((t % period) + period) % period;
  return since < JOLT_S ? 1 - since / JOLT_S : 0;
}

/** Camera roll (radians) and bob (metres). Two incommensurate sines, plus the jolt. */
export function cameraSway(t: number, speed: number): { roll: number; bob: number } {
  if (speed <= 0) return { roll: 0, bob: 0 };
  const k = Math.min(1, speed / 20), j = joltAt(t, speed);
  const roll = (Math.sin(t * 1.1) * 0.7 + Math.sin(t * 1.73 + 1) * 0.3) * ROLL_DEG * DEG * k + j * JOLT_ROLL_DEG * DEG * Math.sign(Math.sin(t * 0.5) || 1);
  const bob = Math.sin(t * 7.3) * BOB_M * k - j * JOLT_BOB_M;
  return { roll, bob };
}

/** A lamp's swing angle (radians): lags the roll by its phase, kicked by jolts. */
export function lampSwing(t: number, speed: number, phase: number): number {
  if (speed <= 0) return 0;
  const k = Math.min(1, speed / 20), j = joltAt(t - 0.1, speed);
  const a = (Math.sin(t * 1.1 - phase) * 0.75 + j * 0.25 * Math.cos(t * 9 + phase)) * LAMP_DEG * DEG * k;
  return Math.max(-LAMP_DEG * DEG, Math.min(LAMP_DEG * DEG, a));
}

/** A curtain's sway amount 0..1 (the leaf layer maps it to a small swing). */
export function curtainSway(t: number, speed: number, phase: number): number {
  if (speed <= 0) return 0;
  const k = Math.min(1, speed / 20);
  return Math.max(0, Math.min(1, (0.5 + 0.35 * Math.sin(t * 0.9 + phase) + 0.15 * joltAt(t - 0.15, speed)) * k));
}

/** Boiler Room machinery (layout draft 2): a pneumatic hammer's stroke, 0 (up) .. 1 (down).
 *  A slow lift and a fast slam, one cycle per PISTON_PERIOD_S, offset by phase (seconds). */
export const PISTON_PERIOD_S = 1.6;
export const PISTON_STROKE_M = 0.35;
export function pistonStroke(t: number, phase: number): number {
  const k = ((((t + phase) / PISTON_PERIOD_S) % 1) + 1) % 1;
  return k < 0.8 ? 1 - k / 0.8 : Math.pow((k - 0.8) / 0.2, 2);
}

/** The disco ball's turn (radians): a steady spin. */
export const DISCO_RAD_PER_S = 0.7;
export function discoSpin(t: number): number {
  return t * DISCO_RAD_PER_S;
}
