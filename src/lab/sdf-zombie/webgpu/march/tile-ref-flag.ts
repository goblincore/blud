// src/lab/sdf-zombie/webgpu/march/tile-ref-flag.ts
//
// COMPILE-TIME switch for the TILE REFERENCE LIST (2026-11-09; docs/dev-notes/2026-11-09-sdf-perf-research/ONE-CALL.md).
//
// The tile preload copies each pixel's tile entries into private arrays, and builds a slot table beside them: seven
// arrays of TILE_MAX_ENTRIES, 3.3 KB a fragment. That memory is the march's largest fixed cost. Every rasterised
// fragment pays for it, discarded or not, and the cost follows the arrays' SIZE, not how many entries the tile has:
// sized to 16 the shipped pass measured 37 to 40 % faster on a clean close-up and 13 to 16 % on wounded ones, the
// same picture to the bit (ladder rungs `arrN`).
//
// With `?tileref` a pixel keeps ONE array: a u32 a kept entry, (slot << 8) | the group's index in its body. The
// fold reads the group's bound and range from the body's data rows (ROW_GROUP_BOUNDS, ROW_GROUP_RANGE), which is
// where the tile entry's copy of them came from, and a slot's run is found by walking the list (entries are sorted
// by slot). 256 bytes.
//
// What differs from the copy, and why the picture should not: a body with an open head split names its per-step
// cull sphere by an offset from a GROWN sphere (tile-cull.ts cullOffset), which the copy rebuilt in float32 with a
// pad. The data row is that group's own closed sphere exactly, the one the cluster walk has always culled with.
// Both are sound, and a group a sound cull drops is one whose fold is exactly min.
//
// The group's index rides the entry's meta lane as a fraction (tile-cull.ts tileMetaX), so this is a boot switch
// for the CPU's packers as well as the shader. Off (the default), the shader text and the records are byte-identical.
export const TILE_REF: boolean = (() => {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    return new URLSearchParams(search).has('tileref');
  } catch {
    return false;
  }
})();

/** Group indices a body can name in a reference: the meta lane's fraction is index / TILE_REF_GROUPS. */
export const TILE_REF_GROUPS = 256;
