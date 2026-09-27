// src/lab/sdf-zombie/webgpu/chunk-light-pick.ts
//
// GIB CHUNKS PICK THEIR LIGHTS (shared light list, plan 1, Task 12). Pure: no `three`, plain data
// in and out. The game glue reads the scene's pieces and writes the uniforms; this module only
// decides WHERE a chunk is judged and WHAT it picks.
//
// Two kinds of gib:
//  - BAKED chunks (settled pieces, carved/asset gib meshes, the gore showcase) draw with a
//    BakedChunkMaterial whose lighting uniforms are SHARED by every mesh on that material (one
//    pipeline, N meshes). Picks can therefore only differ per MATERIAL, so an entry picks at the
//    CENTROID of its drawn pieces (deviation from spec §4, "pick at the chunk's own position").
//  - Live marched chunk VIEWS own a record slot each, so they pick at their own position.
//
// A chunk has no front. Facing is [0, 1] as the plan says. That is not neutral: a light on the -z
// side of a chunk takes its profile's backKey falloff (noted in the Task 12 dev-note).

import type { Vec3, ListLight } from './light-list';
import { pickLights, type Pick, type PickBody } from './light-pick';

/** THE CHUNK TRIM on every list term of a BAKED gib (lightListCfg.y of its material; Task 12,
 *  measured). The list's profile gains are calibrated for the MARCH's compose (a body's dominant
 *  runs through the key path, and the soft shoulder flattens a big key). The baked-chunk compose is
 *  a plain lambert, so at the list's full level a gib lying face-up under a tube or in the beam
 *  reads well above the MARCHED gib it replaces (gib-pixel mean, the light gate's section 9 scene):
 *  marched pieces under the list 0.316 (tube) / 0.482 (torch); baked at gain 1 0.440 / 0.691
 *  (19.8% blown), 0.5 0.324 / 0.578, 0.3 0.255 / 0.485. 0.4 splits the two anchors (tube match
 *  at 0.5, torch at 0.3): look parity with the marched piece is the bake's own rule. */
export const CHUNK_LIST_GAIN = 0.4;
/** The live value (booted from CHUNK_LIST_GAIN; `__sdfGame.setChunkListGain(x)` tunes it). */
let chunkListGain = CHUNK_LIST_GAIN;
export const chunkListGainNow = (): number => chunkListGain;
export function setChunkListGain(g: number): number {
  chunkListGain = Number.isFinite(g) ? Math.max(0, g) : CHUNK_LIST_GAIN;
  return chunkListGain;
}

/** The key-side uniform values of one gib material (or view) for this frame. */
export interface ChunkLightState { on: 0 | 1; packed: [number, number, number, number] }

/** Per material entry, list mode: no pieces drawn -> off (nothing to light); pieces -> on and
 *  the picks at their centroid (all -1 when nothing reaches it: then fill + fresnel only, as a
 *  body with no picks). `pos` null = no pieces. List off -> off, picks untouched (-1s). */
export function chunkLightState(
  listOn: boolean, list: readonly ListLight[], pos: readonly number[] | null, room: number, out: ChunkLightState,
): ChunkLightState {
  const p = out.packed;
  p[0] = p[1] = p[2] = p[3] = -1;
  if (!listOn || !pos) { out.on = 0; return out; }
  const pick = pickChunk(list, pos, room, scratchBody, scratchPick);
  p[0] = pick.packed[0]; p[1] = pick.packed[1]; p[2] = pick.packed[2]; p[3] = pick.packed[3];
  out.on = 1;
  return out;
}
const scratchBody: PickBody = { pos: [0, 0, 0], feetY: 0, room: -1, facing: [0, 1] };
const scratchPick: Pick = { idx: [-1, -1, -1, -1], weight: [0, 0, 0, 0], packed: [-1, -1, -1, -1] };

/** A running centroid: (sum x, sum y, sum z, count). */
export type Centroid = [number, number, number, number];

export function addToCentroid<K>(acc: Map<K, Centroid>, key: K, x: number, y: number, z: number): void {
  const c = acc.get(key);
  if (c) { c[0] += x; c[1] += y; c[2] += z; c[3]++; } else acc.set(key, [x, y, z, 1]);
}

export function centroidPos(c: Centroid | undefined, out: Vec3): Vec3 | null {
  if (!c || c[3] <= 0) return null;
  out[0] = c[0] / c[3]; out[1] = c[1] / c[3]; out[2] = c[2] / c[3];
  return out;
}

export function chunkPickBody(pos: readonly number[], room: number, out?: PickBody): PickBody {
  const b = out ?? { pos: [0, 0, 0], feetY: 0, room: -1, facing: [0, 1] };
  b.pos[0] = pos[0]!; b.pos[1] = pos[1]!; b.pos[2] = pos[2]!;
  b.feetY = pos[1]!;
  b.room = room;
  b.facing[0] = 0; b.facing[1] = 1;
  return b;
}

export function pickChunk(list: readonly ListLight[], pos: readonly number[], room: number, body?: PickBody, out?: Pick): Pick {
  return pickLights(list, chunkPickBody(pos, room, body), out);
}

export const hasPicks = (p: Pick): boolean => p.idx[0]! >= 0;

/** List-mode ambient. Today's per-frame chunk ambient is `fill x key + bounce` with `fill` body 0's
 *  lightCfg.y, which applyRoomFill has scaled by BODY 0's room factor. List mode re-bases only
 *  the fill onto the chunks' own room (the bone fill rule, Task 11b): body 0's factor divided out,
 *  the chunks' applied. The bounce is left as today (no room factor touches it), so a gib in body
 *  0's room gets exactly today's ambient. */
export function chunkListAmbient(
  fill: number, key: readonly number[], bounce: readonly number[], bodyFactor: number, chunkFactor: number, out: Vec3,
): Vec3 {
  const f = fill / Math.max(bodyFactor, 1e-4) * chunkFactor;
  for (let i = 0; i < 3; i++) out[i] = f * key[i]! + bounce[i]!;
  return out;
}
