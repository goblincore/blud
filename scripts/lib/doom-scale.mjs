// scripts/lib/doom-scale.mjs
//
// E1M1 poses for the doom scripts (the gate's route, the materials / emitter capture poses) are written
// as METRES AT 32 Doom units per metre: the scale the level was first converted at, so each number is a
// Doom position / 32 (start = origin, Doom +y = our -z). The converter's world scale can change
// (scripts/levels/doom_map.py --units-per-m, written into the level as `unitsPerM`); `doomScale` reads it
// from the generated level and `at32` turns a pose into this level's metres, so a rescale does not walk
// the gate into a wall. Heights, yaws and pitches are not scaled (the player is not).

import { readFileSync } from 'node:fs';

/** The scale the hard-coded poses are written at. */
export const POSE_UNITS_PER_M = 32;

/** k = POSE_UNITS_PER_M / the level's unitsPerM (a level with none is a 32 one: 1). */
export function doomScaleOf(level) {
  const u = level?.unitsPerM ?? POSE_UNITS_PER_M;
  if (!(typeof u === 'number' && Number.isFinite(u) && u > 0)) throw new Error(`doom-scale: bad unitsPerM ${u}`);
  return POSE_UNITS_PER_M / u;
}

/** doomScaleOf the generated level file (1 when it is absent: callers skip E1M1 then). */
export function doomScale(path = 'public/assets/levels/doom-e1m1.level.json') {
  try {
    return doomScaleOf(JSON.parse(readFileSync(path, 'utf8')));
  } catch (e) {
    if (e?.code === 'ENOENT') return 1;
    throw e;
  }
}

/** [x, z] written at 32 -> this level's metres (rounded to 1 mm). */
export function at32(k, x, z) {
  return [Math.round(x * k * 1000) / 1000, Math.round(z * k * 1000) / 1000];
}
