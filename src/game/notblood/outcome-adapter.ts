/**
 * Raw-Build-velocity → m/s adapter — the unit-conversion boundary of the
 * death-outcome pipeline.
 *
 * The pure core (`resolveDeathOutcome`) stays in native Build units so a future
 * deterministic 120-tic netcode core is a clean swap. This module is the ONLY
 * place the raw Build gib-velocity fields leave that core: they are converted
 * to meters-per-second here, at the GibSystem edge.
 *
 * Scope: VELOCITY conversion only. `buPerTicToMps` is correct for plain
 * Build-units-per-tic velocities (e.g. dynamite throw, concussion launch); it
 * is NOT valid for accelerations or Blood fixed-point particle-gravity/airdrag
 * fields (see tuning.ts warning).
 *
 * Axis convention: this performs a pure unit conversion only — it preserves the
 * `{ vx, vy, vz }` field layout and the Build z-axis sign (Build -z = up).
 * Remapping into Three.js space (vz → +y, XZ plane) is an entity/GibSystem
 * concern, NOT done here, so the adapter stays a trivially-auditable edge.
 *
 * ── RESOLVED: gibSpawns velocity unit ────────────────────────────────────────
 * `resolveDeathOutcome`'s gibSpawns velocities come from `spread()` =
 * `(field << 18) / 120` (death-outcome.ts), a verbatim port of NotBlood
 * `gib.cpp` `GibThing`'s no-pVel branch (`xvel = Random2((atc<<18)/120)`,
 * gib.cpp:409-414). That value is the raw Build `xvel` FIELD, NOT plain
 * Build-units-per-tic.
 *
 * NotBlood integrates EVERY kThing sprite (thrown dynamite AND gib chunks alike)
 * through `MoveThing` (actor.cpp:4429), which moves the sprite by
 * `ClipMove(..., xvel >> 12, ...)` (actor.cpp:4449/4460/4464). So the true
 * per-tic position delta is `xvel / 4096`, i.e. the true Build-units-per-tic is
 * the raw field descaled by `/4096`.
 *
 * Therefore this adapter descales each axis by `/THING_VEL_INTEGRATION` (=4096)
 * BEFORE applying `buPerTicToMps` (×120/256). Pinned worked numbers (gibList[15]
 * = gibHuman, the zombie body set: 7 things, each `atc=300, at10=900`):
 *   horizontal: spread(300)=655360 → /4096=160 BU/tic → ×120/256 =  75 m/s
 *   vertical:   spread(900)=1966080 → /4096=480 BU/tic → ×120/256 = 225 m/s
 *
 * The gibSpawns now drive ChunkSystem (GibSystem.spawnExplosion gibbed branch →
 * ChunkSystem.spawnChunksFromGibs). Pre-fix, skipping the /4096 made chunks read
 * at ~300 km/s — the reason they were previously discarded.
 */

import { buPerTicToMps } from '../gibs/tuning';
import type { GibSpawn } from './death-outcome';

/**
 * NotBlood `MoveThing` (actor.cpp:4429) integrates a sprite's per-tic position
 * by `xvel >> 12` (ClipMove at actor.cpp:4449/4460/4464): the true per-tic
 * position delta is `xvel / 4096`. `spread()` emits the raw `xvel` field, so the
 * true Build-units-per-tic is `field / 4096` — descale here, before m/s.
 */
const THING_VEL_INTEGRATION = 4096;

/**
 * A {@link GibSpawn} with velocities converted to meters-per-second.
 * Field layout and tile are unchanged from {@link GibSpawn}.
 */
export interface GibSpawnMps {
  /** GIBTHING tile (picnum). */
  tile: number;
  /** meters/sec (descaled from the raw Build xvel field). */
  vx: number;
  /** meters/sec (descaled from the raw Build yvel field). */
  vy: number;
  /** meters/sec (descaled from the raw Build zvel field; Build -z = up, preserved). */
  vz: number;
}

/**
 * Convert a gib spawn's raw Build velocity fields to meters-per-second.
 *
 * `spread()` in `death-outcome.ts` emits the raw Build `xvel`/`yvel`/`zvel`
 * FIELD (e.g. ±655360 for atc=300). NotBlood's `MoveThing` integrates each
 * sprite by `xvel >> 12`, so the true per-tic delta is `field / 4096`. This
 * adapter therefore descales each axis by {@link THING_VEL_INTEGRATION} before
 * applying `buPerTicToMps` (`× 120 / 256`). `tile` is passed through unchanged.
 *
 * This is where the raw Build gib-velocity fields leave the pure core.
 */
export function gibSpawnToMps(spawn: GibSpawn): GibSpawnMps {
  return {
    tile: spawn.tile,
    vx: buPerTicToMps(spawn.vx / THING_VEL_INTEGRATION),
    vy: buPerTicToMps(spawn.vy / THING_VEL_INTEGRATION),
    vz: buPerTicToMps(spawn.vz / THING_VEL_INTEGRATION),
  };
}
