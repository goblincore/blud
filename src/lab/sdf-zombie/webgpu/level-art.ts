// src/lab/sdf-zombie/webgpu/level-art.ts
//
// LEVEL ART (the mesh key, spec 2026-09-24-level-mesh-key-design.md) as pure decisions:
// where a level's art file lives, which room lights a mesh, the draw/frame budget,
// and reading a GLB's JSON chunk (tests and the gate inspect the export with it).
// Pure: no three.js, no DOM.

/** `levelParam` is the ?level= value (may include a folder, e.g. fixtures/x). */
export function artUrl(levelParam: string, file: string): string {
  const dir = levelParam.includes('/') ? levelParam.slice(0, levelParam.lastIndexOf('/') + 1) : '';
  return `/assets/levels/${dir}${file}`;
}

/** Room id from the mesh's own userData, then its ancestors' (self first). */
export function artRoomOf(chain: readonly Record<string, unknown>[]): number | null {
  for (const u of chain) if (typeof u.room === 'number') return u.room;
  return null;
}

/** Blender's emission strengths (5-12 on the Wake) are calibrated for Cycles and blow out
 *  under the game's exposure; art emission is capped here (owner, 2026-09-24). The game's
 *  own window planes run at 1. */
export const ART_EMISSIVE_CAP = 1;
export function capEmissive(intensity: number): number {
  return Math.min(intensity, ART_EMISSIVE_CAP);
}

export interface ArtCost { drawCalls: number; frameMs: number }
/** Overruns of `after` over `before`, as messages; empty = within budget. */
export function checkArtBudget(before: ArtCost, after: ArtCost, budget: ArtCost): string[] {
  const out: string[] = [];
  const dc = after.drawCalls - before.drawCalls, ms = after.frameMs - before.frameMs;
  if (dc > budget.drawCalls) out.push(`draw calls +${dc} > +${budget.drawCalls}`);
  if (ms > budget.frameMs) out.push(`frame +${ms.toFixed(2)} ms > +${budget.frameMs} ms`);
  return out;
}

/** The JSON chunk of a binary glTF. */
export function glbJson(bytes: Uint8Array): unknown {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const len = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB: first chunk is not JSON');
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
}

/** What a placed art mesh is, for batching (optimisation pass, 2026-09-26). */
export interface ArtBatchInfo {
  room: number | null;
  /** The material's identity (its uuid) and name. */
  materialId: string;
  materialName: string;
  shadow: boolean;
  /** `sway` extras: a moving piece (lamp, curtain, spin, piston) or a steam vent. */
  sway: string | null;
  /** The geometry's attribute names, sorted and joined (merging needs the same set). */
  attributes: string;
  /** Indexed or not (merging needs one or the other throughout). */
  indexed: boolean;
}

/** The batch a static art mesh merges into (one draw per room, material, shadow flag and
 *  vertex layout), or null for a mesh that must stay on its own: anything that moves or spawns
 *  from its own transform (`sway`), the train's window glass (its material is swapped per pane),
 *  and a mesh with no room (the per-room light lists need one). */
export function artBatchKey(m: ArtBatchInfo): string | null {
  if (m.room === null || m.sway !== null) return null;
  if (m.materialName.startsWith('window:')) return null;
  return `${m.room}|${m.materialId}|${m.shadow ? 1 : 0}|${m.indexed ? 'i' : 'n'}|${m.attributes}`;
}
