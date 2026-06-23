// src/sim/render.ts
import { fpToMeters } from './fp';
import { bloodAngleToRadians } from './units';
import type { PlayerState } from './player';
import type { ProjectileState } from './projectile';
import type { HeadState } from './head';
import { type DudeAi, type DudeState } from './dude';

const EYE_HEIGHT_M = 1.75; // eye above feet (matches the legacy player feel)

export interface PlayerRender {
  xMeters: number; zMeters: number; eyeYMeters: number;
  yawRad: number; pitchRad: number;
}

/** Shortest-arc lerp of a Blood angle (handles 2048 wraparound). */
function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a + 1024 + 2048) % 2048) - 1024; // shortest arc in [-1024, 1024)
  const r = a + d * t;
  return ((r % 2048) + 2048) % 2048;               // keep in [0, 2048)
}

export interface ProjectileRender {
  xMeters: number; yMeters: number; zMeters: number;
  /** Remaining fuse in tics (from current state — not interpolated, cosmetic only). */
  fuseTics: number;
  /** Max fuse in tics at spawn (for fuse-frame cycle math). */
  fuseMaxTics: number;
}

/** Interpolate projectile positions between the previous and current tic, in meters.
 *  Match by index — a projectile detonated this tic (in prev but not cur) is dropped.
 *  The runner uses the same prev/cur snapshots it already keeps for the player.
 *  NOTE: index-matching assumes projectiles are append-only + removed-on-detonation;
 *  if multiple projectiles detonate in the same tic the surviving indices shift and
 *  one frame may interpolate slightly wrong — cosmetic only (render path). */
export function renderProjectiles(prev: ProjectileState[], cur: ProjectileState[], alpha: number): ProjectileRender[] {
  const n = Math.min(prev.length, cur.length);
  const out: ProjectileRender[] = [];
  for (let i = 0; i < n; i++) {
    const a = prev[i]!, b = cur[i]!;
    out.push({
      xMeters: fpToMeters(a.x + (b.x - a.x) * alpha),
      yMeters: fpToMeters(a.y + (b.y - a.y) * alpha),
      zMeters: fpToMeters(a.z + (b.z - a.z) * alpha),
      fuseTics: b.fuseTics,
      fuseMaxTics: b.fuseMaxTics,
    });
  }
  return out;
}

export interface HeadRender {
  xMeters: number; yMeters: number; zMeters: number;
}

/** Interpolate head positions between the previous and current tic, in meters.
 *  Match by index (append-only + removed-on-despawn, same convention as projectiles).
 *  Cosmetic only — the billboard always faces the camera, so no orientation is sent. */
export function renderHeads(prev: HeadState[], cur: HeadState[], alpha: number): HeadRender[] {
  const n = Math.min(prev.length, cur.length);
  const out: HeadRender[] = [];
  for (let i = 0; i < n; i++) {
    const a = prev[i]!, b = cur[i]!;
    out.push({
      xMeters: fpToMeters(a.x + (b.x - a.x) * alpha),
      yMeters: fpToMeters(a.y + (b.y - a.y) * alpha),
      zMeters: fpToMeters(a.z + (b.z - a.z) * alpha),
    });
  }
  return out;
}

export interface DudeRender {
  xMeters: number; yMeters: number; zMeters: number;
  /** Facing yaw in radians (interpolated across the 0/2048 wrap via lerpAngle). */
  yawRad: number;
  /** Current AI state (from `cur`) — drives the cosmetic anim-state mapping. */
  ai: DudeAi;
  /** Current health (from `cur`) — drives the health bar + death cue. */
  health: number;
}

/** Interpolate cultist transforms between the previous and current tic, in
 *  meters + radians, passing `ai`/`health` from `cur` for the cosmetic anim-state
 *  + health bar. Match by index (append-only + skipped-when-dead, same convention
 *  as heads/projectiles). Position interpolates linearly; the facing uses
 *  `lerpAngle` so it takes the shortest arc across the 0/2048 boundary. */
export function renderDudes(prev: DudeState[], cur: DudeState[], alpha: number): DudeRender[] {
  const n = Math.min(prev.length, cur.length);
  const out: DudeRender[] = [];
  for (let i = 0; i < n; i++) {
    const a = prev[i]!, b = cur[i]!;
    out.push({
      xMeters: fpToMeters(a.x + (b.x - a.x) * alpha),
      yMeters: fpToMeters(a.y + (b.y - a.y) * alpha),
      zMeters: fpToMeters(a.z + (b.z - a.z) * alpha),
      yawRad: bloodAngleToRadians(lerpAngle(a.ang, b.ang, alpha)),
      ai: b.ai,
      health: b.health,
    });
  }
  return out;
}

/** Interpolate the player between the previous and current tic for smooth
 *  rendering, and convert to meters/radians. This is the sim→render boundary. */
export function renderPlayer(prev: PlayerState, cur: PlayerState, alpha: number): PlayerRender {
  const lx = prev.x + (cur.x - prev.x) * alpha;
  const ly = prev.y + (cur.y - prev.y) * alpha;
  const lz = prev.z + (cur.z - prev.z) * alpha;
  const feetY = fpToMeters(ly);
  return {
    xMeters: fpToMeters(lx),
    zMeters: fpToMeters(lz),
    eyeYMeters: feetY + EYE_HEIGHT_M,
    yawRad: bloodAngleToRadians(lerpAngle(prev.yaw, cur.yaw, alpha)),
    pitchRad: bloodAngleToRadians(lerpAngle(prev.pitch, cur.pitch, alpha)),
  };
}
