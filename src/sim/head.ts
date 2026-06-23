// src/sim/head.ts
import { fpFromMeters, metersPerSecToFp, FP_PER_BU, mulfp, approxDist } from './fp';
import { yawRotate } from './trig';
import type { PlayerState } from './player';
import { TICS_PER_SEC } from './units';
import { stepThing, type ThingState } from './thing';
import type { SimAABB } from './geometry';

/** A severed zombie head: a deterministic kThing (gravity + floor/wall bounce)
 *  that the player can kick. Shared/interactable — lives on SimState so co-op
 *  peers see the same head land in the same place. */
export interface HeadState extends ThingState {
  kickCooldownTics: number; // ticks until the head can be kicked again (anti-pin)
  spawnTic: number;         // tic of spawn, for age-despawn
}

export const HEAD_RADIUS = fpFromMeters(0.18);  // matches the old ball collider (0.18 m)
export const HEAD_ELASTIC = 40960;              // Blood thingInfo[kThingZombieHead].elastic = 40960 (0.625 in 16.16)
export const HEAD_MAX_AGE_TICS = Math.round(30 * TICS_PER_SEC); // 30 s, then despawn

/** Floor friction — port of Blood `MoveThing`'s grounded-velocity bleed
 *  (`xvel -= mulscale16(min(nVel,0x11111)/nVel, xvel)`). At 120 tic/s this is a
 *  constant per-tic speed loss (Coulomb-style, μ·g with μ≈0.6 against the sim's
 *  25 m/s² gravity), stopping the head dead once below the clip. Without it a
 *  grounded head slides forever like a hockey puck. Applied only on floor contact,
 *  so an airborne/bouncing head keeps its horizontal speed and arcs across the
 *  room before skidding to rest. */
const FRICTION_CLIP = metersPerSecToFp(15 / TICS_PER_SEC); // ≈0.125 m/s shed per grounded tic
function applyFloorFriction(h: HeadState): void {
  const speed = approxDist(h.vx, h.vz);
  if (speed <= 0) return;
  if (speed <= FRICTION_CLIP) { h.vx = 0; h.vz = 0; return; }
  const remain = speed - FRICTION_CLIP;
  h.vx = Math.floor((h.vx * remain) / speed);
  h.vz = Math.floor((h.vz * remain) / speed);
}

/** Spawn a head into the sim. Position is fp (y = bottom; floor = 0); velocity is fp/tic. */
export function spawnHead(
  heads: HeadState[],
  x: number, y: number, z: number,
  vx: number, vy: number, vz: number,
  tic: number,
): void {
  heads.push({
    x, y, z, vx, vy, vz,
    radius: HEAD_RADIUS, elastic: HEAD_ELASTIC, resting: false,
    kickCooldownTics: 0, spawnTic: tic,
  });
}

/** Advance all heads one tic: decay kick cooldown, integrate physics, age-despawn.
 *  `tic` is the current SimState.tic. Mutates `heads`. */
export function stepHeads(heads: HeadState[], geo: SimAABB[], tic: number): void {
  for (let i = heads.length - 1; i >= 0; i--) {
    const h = heads[i]!;
    if (h.kickCooldownTics > 0) h.kickCooldownTics--;
    stepThing(h, geo);
    if (h.y <= 0) applyFloorFriction(h); // bleed horizontal speed while in floor contact
    if (tic - h.spawnTic >= HEAD_MAX_AGE_TICS) heads.splice(i, 1);
  }
}

// ——— Kick tuning ———
// Blood actKickObject: zvel = nSpeed * 0.5 upward (mulscale14(nSpeed, -0x2000)) —
// the vertical pop is half the horizontal kick, which is what makes a punted head
// sail up like a kicked soccer ball rather than skid along the floor.
export const KICK_SPEED = metersPerSecToFp(15);    // horizontal punt speed (fp/tic) — a big NotBlood-style boot
export const KICK_UP = metersPerSecToFp(9);        // vertical pop ≈ ½ horizontal (Blood ratio); ~1.6 m apex at g=25
export const KICK_CONTACT_DIST = fpFromMeters(0.65); // player radius (0.3) + head (0.18) + slop
const KICK_CONTACT_DIST_SQ = KICK_CONTACT_DIST * KICK_CONTACT_DIST;
export const KICK_MAX_HEIGHT = fpFromMeters(0.7);  // only boot heads near the floor
export const KICK_COOLDOWN_TICS = 18;              // ~0.15 s between kicks (anti-pin)

/** Punt any grounded head the player is touching: impulse along the player's
 *  facing (you kick the head where you look/walk), plus a small upward pop. Pure;
 *  deterministic (no sqrt — direction is the player yaw forward, same basis as
 *  movement and the dynamite throw). Mutates `heads`. */
export function kickHeads(player: PlayerState, heads: HeadState[]): void {
  // Unit forward in the SAME basis the player moves along (local forward = (0,-1)).
  const fwd = yawRotate(0, -FP_PER_BU, player.yaw);
  for (const h of heads) {
    if (h.kickCooldownTics > 0) continue;
    if (h.y > KICK_MAX_HEIGHT) continue;
    const dx = h.x - player.x;
    const dz = h.z - player.z;
    if (dx * dx + dz * dz > KICK_CONTACT_DIST_SQ) continue;
    h.vx = mulfp(KICK_SPEED, fwd.x);
    h.vz = mulfp(KICK_SPEED, fwd.z);
    h.vy = KICK_UP;
    h.resting = false;
    h.kickCooldownTics = KICK_COOLDOWN_TICS;
  }
}
