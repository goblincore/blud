// src/sim/types.ts
/** Generic integer kinematic body: position (BU) + velocity (BU/tic). Player,
 *  projectiles, and dudes compose this in later plans. */
export interface KinematicBody {
  x: number; y: number; z: number;    // position, Build units (integer)
  vx: number; vy: number; vz: number; // velocity, BU/tic (integer)
}

/** Per-tic input — the ONLY thing a future lockstep transport sends. Aim is
 *  absolute Blood angle [0, 2048); the input sampler accumulates mouse delta and
 *  clamps pitch before quantizing into these per-tic values. */
export interface InputCommand {
  moveForward: number; // -1 | 0 | 1
  moveStrafe: number;  // -1 | 0 | 1
  aimYaw: number;      // absolute Blood angle units [0, 2048)
  aimPitch: number;    // absolute Blood angle units, clamped to the pitch limit
  buttons: number;     // bitfield of BTN_*
}

export const BTN_FIRE = 1 << 0;
export const BTN_SWITCH = 1 << 1;
export const BTN_JUMP = 1 << 2;
export const BTN_SPRINT = 1 << 3;

export const EMPTY_INPUT: InputCommand = {
  moveForward: 0, moveStrafe: 0, aimYaw: 0, aimPitch: 0, buttons: 0,
};

/** Sim → cosmetic notifications. Discriminated union; later plans add variants
 *  (e.g. { kind: 'explosion'; x; y; z }, { kind: 'gib'; ... }). The cosmetic
 *  layer consumes these; the sim never reads them back. */
export type SimEvent =
  | { kind: 'noop' };
