// src/sim/player.ts
import { metersPerSecToFp, mulfp, FP_PER_BU, fpFromMeters } from './fp';
import { yawRotate } from './trig';
import { clipMoveXZ, type SimAABB } from './geometry';
import { BTN_JUMP, BTN_SPRINT, type InputCommand } from './types';

/** Plain-data player record inside SimState. Position in fp (16.16 BU); y is the
 *  FEET height (floor = 0). yaw/pitch are absolute Blood angles copied from input. */
export interface PlayerState {
  x: number; y: number; z: number; // fp
  vy: number;                      // fp/tic (vertical only; horizontal is instant)
  yaw: number; pitch: number;      // Blood angle units
  grounded: boolean;
  prevButtons: number;             // for deterministic jump edge-detection
  hp: number;                      // hit points (added plan 3: explosion-vs-player target)
}

export function createPlayerState(): PlayerState {
  return { x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0, grounded: true, prevButtons: 0, hp: 100 };
}

const WALK = metersPerSecToFp(6);
const RUN = metersPerSecToFp(9);
const JUMP_VY = metersPerSecToFp(8.5);
const GRAVITY_DV = metersPerSecToFp(25 / 120); // Δvy per tic (25 m/s² at 120 tic/s)
const RADIUS = fpFromMeters(0.3); // 0.3 m player radius in fp
const DIAG = Math.round(0.70710678 * FP_PER_BU);  // 1/√2 in 16.16

/** Advance the player one tic. Pure: mutates `p`, reads `cmd` + `geo`. */
export function stepPlayer(p: PlayerState, cmd: InputCommand, geo: SimAABB[]): void {
  // — Look: aim is input —
  p.yaw = cmd.aimYaw;
  p.pitch = cmd.aimPitch;

  // — Horizontal: instant velocity in the yaw frame —
  // local axes: +X = strafe right, -Z = forward (matches movement-direction conv).
  let lx = cmd.moveStrafe;
  let lz = -cmd.moveForward;
  if (lx !== 0 && lz !== 0) { lx = lx * DIAG; lz = lz * DIAG; } // normalize diagonal (×1/√2, in 16.16)
  else { lx = lx * FP_PER_BU; lz = lz * FP_PER_BU; }            // unit in 16.16
  // rotate (lx, lz) by yaw into world space (shared with throwVelocity — see trig.yawRotate)
  const { x: wx, z: wz } = yawRotate(lx, lz, p.yaw);
  const speed = (cmd.buttons & BTN_SPRINT) ? RUN : WALK;
  const dx = mulfp(wx, speed);
  const dz = mulfp(wz, speed);

  const moved = clipMoveXZ({ x: p.x, z: p.z }, dx, dz, RADIUS, geo);
  p.x = moved.x; p.z = moved.z;

  // — Vertical: jump (edge-triggered) + gravity + floor clamp —
  const jumpPressed = (cmd.buttons & BTN_JUMP) && !(p.prevButtons & BTN_JUMP);
  if (p.grounded && jumpPressed) { p.vy = JUMP_VY; p.grounded = false; }
  p.vy -= GRAVITY_DV;
  p.y += p.vy;
  if (p.y <= 0) { p.y = 0; p.vy = 0; p.grounded = true; }

  p.prevButtons = cmd.buttons;
}

/** Clamp player hp at 0 — the player-as-target damage sources (dynamite
 *  explosion via applyExplosionToPlayer, cultist shotgun pellets via stepDudes)
 *  subtract from `hp`; this keeps it from going negative so the hash and the
 *  HUD always see a non-negative value. Called once at the end of stepSim. */
export function clampPlayerHp(p: PlayerState): void {
  if (p.hp < 0) p.hp = 0;
}
