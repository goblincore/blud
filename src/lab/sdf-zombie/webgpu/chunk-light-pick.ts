// src/lab/sdf-zombie/webgpu/chunk-light-pick.ts
//
// GIB CHUNKS PICK THEIR LIGHTS (shared light list, plan 1, Task 12). Pure: no `three`, plain data
// in and out. The game glue reads the scene's pieces and writes the uniforms; this module only
// decides WHERE a chunk is judged and WHAT it picks.
//
// Every gib picks at its OWN position (spec §4):
//  - BAKED chunks (settled bakes, soldier corpses, carved/asset sprite pieces drawn as meshes, the
//    gore showcase) share a BakedChunkMaterial per kind, but the list terms are bound PER OBJECT
//    (baked-chunks.ts chunkObjectLight): each drawn mesh carries its own picks in its userData.
//    One mesh is one piece for every source (a corpse is one mesh: the whole corpse).
//  - Live marched chunk VIEWS own a record slot each, so they pick at their own position.
//
// A chunk has no front, and it tumbles: facing is [0, 0], so every light sees it side-on
// (light-pick facingDot 0 -> the profile's backKey + half the rest), whatever its direction.

import type { ListLight } from './light-list';
import { pickLights, type Pick, type PickBody } from './light-pick';

/** THE CHUNK TRIM on every list term of a BAKED gib (each piece's record cfg.y; Task 12,
 *  measured). The list's profile gains are calibrated for the MARCH's compose (a body's dominant
 *  runs through the key path, and the soft shoulder flattens a big key). The baked-chunk compose is
 *  a plain lambert, so at the list's full level a gib lying face-up in the beam blows out.
 *  History (gib-pixel mean, the light gate's section 9 scene):
 *   - Task 12: 0.4, with per-MATERIAL picks and the fresnel/back-rim terms. Anchor: the MARCHED gib
 *     under the list, 0.316 tube / 0.482 torch; baked 0.4 split the tube (0.5) and torch (0.3) matches.
 *   - Task 12 review: per-PIECE picks, facing [0, 0], and no fresnel or back rim on gibs (owner,
 *     2026-09-27). With the pile in the tube's pool (the gate's blast now throws it there), baked at
 *     0.4 read 0.167-0.190 tube (9.2% dark) against the marched views' 0.327-0.368 in the same pool;
 *     sweep 0.5 0.194 / 0.433 torch (4.1% blown), 0.6 0.220 / 0.462 (5.9%), 0.7 0.243 / 0.487
 *     (7.4%), 0.8 0.264 / 0.507 (8.8%). The marched views themselves blow out in the beam (0.70,
 *     28-32% over 0.95), so the torch anchor is no target now; 0.6 takes back some of what the rim
 *     removal and the per-piece picks cost under the tube and keeps the beam at <= 6% blown. */
export const CHUNK_LIST_GAIN = 0.6;
/** The live value (booted from CHUNK_LIST_GAIN). Module state ON PURPOSE: it is a tuning seam
 *  (`__sdfGame.setChunkListGain(x)`, the gate's GIB_SWEEP), not game state, so it lives beside the
 *  constant it trims rather than on the GameContext. */
let chunkListGain = CHUNK_LIST_GAIN;
export const chunkListGainNow = (): number => chunkListGain;
export function setChunkListGain(g: number): number {
  chunkListGain = Number.isFinite(g) ? Math.max(0, g) : CHUNK_LIST_GAIN;
  return chunkListGain;
}

/** The pick body of a chunk at `pos`: the chunk itself is the centre and the feet; facing [0, 0]
 *  (orientation-free: every light side-on). `out` is rewritten in place (no allocation). */
export function chunkPickBody(pos: readonly number[], room: number, out?: PickBody): PickBody {
  const b = out ?? { pos: [0, 0, 0], feetY: 0, room: -1, facing: [0, 0] };
  b.pos[0] = pos[0]!; b.pos[1] = pos[1]!; b.pos[2] = pos[2]!;
  b.feetY = pos[1]!;
  b.room = room;
  b.facing[0] = 0; b.facing[1] = 0;
  return b;
}

export function pickChunk(list: readonly ListLight[], pos: readonly number[], room: number, body?: PickBody, out?: Pick): Pick {
  return pickLights(list, chunkPickBody(pos, room, body), out);
}

export const hasPicks = (p: Pick): boolean => p.idx[0]! >= 0;

/** List-mode ambient of one piece, per channel. Today's per-frame chunk ambient is
 *  `fill x key + bounce` with `fill` body 0's lightCfg.y, which applyRoomFill has scaled by BODY
 *  0's room factor. List mode re-bases only the fill onto the piece's own room (the bone fill rule,
 *  Task 11b): body 0's factor divided out, the piece's applied. The bounce is left as today (no
 *  room factor touches it), so a piece in body 0's room gets exactly today's ambient. Scalars in,
 *  one channel out: the per-piece loop allocates nothing. */
export function chunkListAmbient(fill: number, key: number, bounce: number, bodyFactor: number, chunkFactor: number): number {
  return fill / Math.max(bodyFactor, 1e-4) * chunkFactor * key + bounce;
}
