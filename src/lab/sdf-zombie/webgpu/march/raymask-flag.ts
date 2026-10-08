// src/lab/sdf-zombie/webgpu/march/raymask-flag.ts
//
// COMPILE-TIME switch for the per-ray primitive mask PROBE (2026-10-08). With
// `?raymask` the march gains a counter, read back through debug mode 21: of the
// primitives the walk folds, how many have a bounding box the pixel's ray never
// crosses — the folds a finer, per-ray cull would have skipped. Counts only; no
// field value and no pixel changes. Without the flag the shader text is
// byte-identical (the march-hash golden), the same contract as limbs-flag.ts.
//
// The mask itself was built and measured once and removed: on the tile-list
// path it cost more than it saved (docs/dev-notes/2026-10-08-native-wgpu-spike,
// part 3). The probe stays as the cheap way to ask the question of a new scene.
export const RAY_MASK_PROBE: boolean = (() => {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    return new URLSearchParams(search).has('raymask');
  } catch {
    return false;
  }
})();
