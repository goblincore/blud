// src/lab/sdf-zombie/webgpu/march/shade-bound-flag.ts
//
// COMPILE-TIME switch for the POST-HIT UPPER-BOUND CULL (SDF-cloth cost spike, 2026-10-26;
// docs/dev-notes/2026-10-26-sdf-cloth-cost/). The walk hands every sample's fold an upper bound (gCullRef), so the
// group culls bite from the first cluster folded. The shading's field calls (the finite-difference normal's taps,
// the AO and scatter probes, the wound soft shadow) had none: d starts at 1e9, the first cluster (the head) folds
// whole and every later cluster within reach of it does too. With `?shadebound` the walk leaves its accepting
// sample's fold, point, slot and piece behind, and every later mapBody of the pixel culls against
// fold + 3 x |p - sample| + 2 mm, the walk's own rule. Off (the default while it is a spike), the shader text is
// byte-identical (the march-hash golden), the same contract as limbs-flag.ts and raymask-flag.ts.
export const SHADE_BOUND: boolean = (() => {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    return new URLSearchParams(search).has('shadebound');
  } catch {
    return false;
  }
})();

/** `?ngcount`: count the ANALYTIC NORMAL's own prim evaluations (normal-gradient.wgsl.ts ngGroup, and the shaped
 *  groups ngExcluded walks) into the census's prim counter, which only foldGroup fed. Debug-mode only. */
export const NG_COUNT: boolean = (() => {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    return new URLSearchParams(search).has('ngcount');
  } catch {
    return false;
  }
})();
