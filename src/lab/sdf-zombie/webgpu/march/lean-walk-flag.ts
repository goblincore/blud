// src/lab/sdf-zombie/webgpu/march/lean-walk-flag.ts
//
// COMPILE-TIME switch for the CLEAN-BODY FAST PATH of the march's walk (2026-11-09;
// docs/superpowers/specs/2026-11-09-march-lean-walk-design.md). With `?leanwalk` the march gains a second field
// function, mapLean (lean-walk.wgsl.ts): the tile-list fold and the carves, none of mapBody's wound, re-fold, bone,
// volume or head-split code. The setup decides once per pixel whether mapLean is exact for every slot in the pixel's
// table, and the walk and the temporal start's probe call it there. The picture is the same to the bit. Without the
// flag the shader text is byte-identical (the march-hash golden), the same contract as shade-bound-flag.ts.
const leanWalkParam: string | null = (() => {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    return new URLSearchParams(search).get('leanwalk');
  } catch {
    return null;
  }
})();
export const LEAN_WALK: boolean = leanWalkParam !== null;
/** `?leanwalk=walk`: the walk only; the temporal start's probe stays on mapBody. Each mapLean call site is one more
 *  inlined copy of the fold and the carves in every march program's cold compile (2026-11-09: both sites cost the
 *  loader's program +4.8 s cold, 42 -> 47 s), and the probe is one to four calls a pixel against the walk's many. */
export const LEAN_WALK_PROBE: boolean = LEAN_WALK && leanWalkParam !== 'walk';
