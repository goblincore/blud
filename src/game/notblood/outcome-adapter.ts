/**
 * BU/tic → m/s adapter — the unit-conversion boundary of the death-outcome pipeline.
 *
 * The pure core (`resolveDeathOutcome`) stays in native Build units (gib
 * velocities in Build-units-per-tic) so a future deterministic 120-tic netcode
 * core is a clean swap. This module is the ONLY place Build units leave that
 * core: gib launch velocities are converted to meters-per-second here, at the
 * GibSystem edge.
 *
 * Scope: VELOCITY conversion only. `buPerTicToMps` is correct for velocities
 * (e.g. dynamite throw, gib launches); it is NOT valid for accelerations or
 * Blood fixed-point particle-gravity/airdrag fields (see tuning.ts warning).
 * This adapter converts velocity vectors, so it is safe.
 *
 * Axis convention: this performs a pure unit conversion only — it preserves the
 * `{ vx, vy, vz }` field layout and the Build z-axis sign (Build -z = up).
 * Remapping into Three.js space (vz → +y, XZ plane) is an entity/GibSystem
 * concern, NOT done here, so the adapter stays a trivially-auditable edge.
 */

import { buPerTicToMps } from '../gibs/tuning';
import type { GibSpawn } from './death-outcome';

/**
 * A {@link GibSpawn} with velocities converted to meters-per-second.
 * Field layout and tile are unchanged from {@link GibSpawn}.
 */
export interface GibSpawnMps {
  /** GIBTHING tile (picnum). */
  tile: number;
  /** meters/sec (was Build-units-per-tic). */
  vx: number;
  /** meters/sec (was Build-units-per-tic). */
  vy: number;
  /** meters/sec (was Build-units-per-tic; Build -z = up, preserved). */
  vz: number;
}

/**
 * Convert a gib spawn's Build-units-per-tic velocities to meters-per-second.
 *
 * Conversion factor: `buPerTicToMps(x) = x × 120 / 256` (Blood's 120 tics/sec
 * and Blud's 256 Build-units/meter). Applied independently to each axis;
 * `tile` is passed through unchanged.
 *
 * This is where Build units leave the pure core.
 */
export function gibSpawnToMps(spawn: GibSpawn): GibSpawnMps {
  return {
    tile: spawn.tile,
    vx: buPerTicToMps(spawn.vx),
    vy: buPerTicToMps(spawn.vy),
    vz: buPerTicToMps(spawn.vz),
  };
}
