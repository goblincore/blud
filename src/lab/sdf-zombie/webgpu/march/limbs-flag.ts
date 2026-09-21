// src/lab/sdf-zombie/webgpu/march/limbs-flag.ts
//
// COMPILE-TIME switch for the per-limb fold accumulators (owner re-fold mode 4,
// 2026-09-21 wound-cost work). The accumulator code is emitted into the march
// shader ONLY when the page is opened with `?limbs` — with it compiled in, the
// cold compile rose 137 -> 181 s, and the shipped text must not pay for an
// unshipped mode. With `?limbs`, counts2.z still selects mode 0..4 at runtime,
// so ship vs mode 4 is A/B'd inside one page (both legs run the same module).
export const LIMB_ACCUMULATORS: boolean = (() => {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    return new URLSearchParams(search).has('limbs');
  } catch {
    return false;
  }
})();
