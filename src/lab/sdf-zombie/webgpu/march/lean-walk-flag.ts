// src/lab/sdf-zombie/webgpu/march/lean-walk-flag.ts
//
// COMPILE-TIME switch for the CLEAN-BODY FAST PATH of the march's walk (2026-11-09;
// docs/superpowers/specs/2026-11-09-march-lean-walk-design.md). With `?leanwalk` the march gains a second field
// function, mapLean (lean-walk.wgsl.ts): the tile-list fold and the carves, none of mapBody's wound, re-fold, bone,
// volume or head-split code. The setup decides once per pixel whether mapLean is exact for every slot in the pixel's
// table, and the walk and the temporal start's probe call it there. The picture is the same to the bit. Without the
// flag the shader text is byte-identical (the march-hash golden), the same contract as shade-bound-flag.ts.
export const LEAN_WALK: boolean = (() => {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    return new URLSearchParams(search).has('leanwalk');
  } catch {
    return false;
  }
})();
