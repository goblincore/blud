// src/lab/sdf-zombie/webgpu/march/lean-walk-flag.ts
//
// COMPILE-TIME switch for the CLEAN-BODY FAST PATH of the march's walk (2026-11-09;
// docs/superpowers/specs/2026-11-09-march-lean-walk-design.md, numbers in docs/dev-notes/2026-11-09-march-lean-walk/).
// The march has a second field function, mapLean (lean-walk.wgsl.ts): the tile-list fold and the carves, none of
// mapBody's wound, re-fold, bone, volume or head-split code. The setup decides once per pixel whether mapLean is exact
// for every slot in the pixel's table, and the walk calls it there. The picture is the same to the bit.
//
// ON BY DEFAULT since 2026-11-09 (owner's call), in the WALK-ONLY form:
//   (no parameter), ?leanwalk=walk   the walk takes mapLean; the temporal start's probe stays on mapBody
//   ?leanwalk, ?leanwalk=probe       the walk and the probe (one more inlined copy of the fold in every march
//                                    program: the loader's program compiles cold in 47 s against 45 s)
//   ?leanwalk=0                      off: the shader text of before the lean walk, byte for byte
const leanWalkParam: string | null = (() => {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    return new URLSearchParams(search).get('leanwalk');
  } catch {
    return null;
  }
})();
export const LEAN_WALK: boolean = leanWalkParam !== '0';
/** The temporal start's probe on mapLean too: only when asked for (`?leanwalk` or `?leanwalk=probe`). Each mapLean
 *  call site is one more inlined copy of the fold and the carves in every march program's cold compile (2026-11-09,
 *  the loader's program: off 42.0 s, walk only 44.9 s, walk and probe 46.8 to 48.0 s), and the probe is one to four
 *  calls a pixel against the walk's many. */
export const LEAN_WALK_PROBE: boolean = LEAN_WALK && (leanWalkParam === '' || leanWalkParam === 'probe');
