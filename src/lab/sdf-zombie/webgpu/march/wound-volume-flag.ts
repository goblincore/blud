// src/lab/sdf-zombie/webgpu/march/wound-volume-flag.ts
//
// COMPILE-TIME switch for THE BAKED WOUND VOLUME (2026-11-11;
// docs/superpowers/specs/2026-11-11-baked-wound-volume-design.md, "Revision 2").
//
// A body keeps its newest MAX_WOUNDS wounds on the exact list. Today the wound that overflows the list is MERGED into
// a neighbour (damage.ts pushWound), so a body shot many times ends with a few large craters. With the switch on
// that wound is STAMPED into a voxel box that rides its primitive (../../wound-volume-stamp.ts,
// ../wound-volume-store.ts) and the march reads the box before it walks the list (fields/wound-volume.wgsl.ts), so
// the count of craters a body shows is not capped. A stamped crater is rounder and coarser than a listed one.
//
// The boxes live in the 3D texture the shader already takes for the skeleton's segment volumes (`segVolumeAtlas`,
// unused unless `?skeleton=volume`), so the switch adds no binding. The two do not combine: that mode turns this off.
//
// Under the switch the list no longer merges at its cap, which changes what the wound-driven rules see (a merged
// crater grows and can sever; a stamped one has left the list).
//
// ON BY DEFAULT since 2026-11-11 (owner's call, after playing it on E1M1 and MAP28: "you can make it default").
//   (no parameter), ?woundvol, ?woundvol=1   on, 2 cm voxels
//   ?woundvol=<cm>                           on, voxels of that many centimetres (1 to 4; 1.5 for finer than 2 cm)
//   ?woundvol=0                              off: the shader text of before the switch, byte for byte
//   ?skeleton=volume                         off too: that mode needs the 3D texture for its own volumes
export function woundVolumeVoxel(search: string): number {
  const q = new URLSearchParams(search);
  if (q.get('skeleton') === 'volume') return 0;
  const v = q.get('woundvol');
  if (v === '0') return 0;
  const cm = Number(v);
  return v === null || v === '' || v === '1' || !Number.isFinite(cm) ? 0.02 : Math.min(4, Math.max(1, cm)) / 100;
}

/** The voxel's edge in metres; 0 = the switch is off. */
export const WOUND_VOL_VOXEL: number = (() => {
  try {
    return woundVolumeVoxel((globalThis as { location?: { search?: string } }).location?.search ?? '');
  } catch {
    return 0.02;
  }
})();
export const WOUND_VOL: boolean = WOUND_VOL_VOXEL > 0;

/** Wounded primitives a body can carry a box for, and the data-texture column their table starts at: the wound rows
 *  (ROW_WOUND, ROW_WOUND_META, ROW_WOUND_CAP, ROW_WOUND_FLAGS) are used up to column MAX_WOUNDS only. */
export const WV_MAX_ENTRIES = 24;
export const WV_TABLE_COL = 32;

/** A TRY (2026-11-11): how many of a body's newest BAKEABLE wounds stay on the exact list (`?woundlist=<n>`, 0 to
 *  32; default 32, the list's own cap, which changes nothing). Past it the oldest bakeable wound is baked into the
 *  volume at once, so the march walks a shorter list. Wounds the volume does not take (cuts, decals, cloth holes,
 *  the melee head craters) are not counted and stay on the list as before. Off with the volume. */
export function woundListKeep(search: string): number {
  const v = new URLSearchParams(search).get('woundlist');
  const n = v === null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(32, Math.max(0, Math.floor(n))) : 32;
}
export const WV_LIST_KEEP: number = (() => {
  try {
    return woundListKeep((globalThis as { location?: { search?: string } }).location?.search ?? '');
  } catch {
    return 32;
  }
})();
