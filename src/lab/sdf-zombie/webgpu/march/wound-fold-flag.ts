// src/lab/sdf-zombie/webgpu/march/wound-fold-flag.ts
//
// COMPILE-TIME switch for the OWNER RE-FOLD (2026-11-11; docs/superpowers/specs/2026-11-11-baked-wound-volume-design.md,
// stage 1; measured in docs/dev-notes/2026-11-10-silhouette-spike/WOUND-VOLUME.md).
//
// A wound belongs to one limb cluster. Where a crater on one limb reaches the flesh of another, mapBody folds that
// other limb again without the foreign crater, so a hole in an arm does not eat the torso beside it. On the wounded
// 22-body mob that re-fold was about 10 ms of a 58 ms march pass in the replay.
//
// With the switch OFF the re-fold's condition starts `false &&`: the block is dead and a crater carves whatever
// flesh it reaches. LOOSE, not exact (the owner's rule, 2026-11-10: a speed-up that loosens the look is fine where
// it is not noticed). The owner bookkeeping in applyWounds stays: the inside-flesh fold's gate reads it.
//
//   (no parameter), ?woundfold, ?woundfold=1   on: today's shader text, byte for byte
//   ?woundfold=0                               off
export function woundFoldOn(search: string): boolean {
  return new URLSearchParams(search).get('woundfold') !== '0';
}

export const WOUND_FOLD: boolean = (() => {
  try {
    return woundFoldOn((globalThis as { location?: { search?: string } }).location?.search ?? '');
  } catch {
    return true;
  }
})();
