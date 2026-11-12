// src/lab/sdf-zombie/webgpu/march/probe-lean-flag.ts
//
// COMPILE-TIME switch for THE AO AND SCATTER PROBES ON THE LEAN FIELD (2026-11-12, a try;
// docs/dev-notes/2026-11-11-frame-breakdown/NOTES.md).
//
// After a hit the march calls the whole body field twice more: once 6 cm along the normal (ambient occlusion) and
// once 6 cm toward the light (scatter through thin flesh). On the heavy mob those two calls are about 7 ms of a
// 42 ms march. With the switch on they read mapLean (lean-walk.wgsl.ts): the bodies' union without wounds, bones,
// head splits or the baked volumes. LOOSE: inside a crater the probe then sees the flesh that was there before the
// wound, so a crater's floor reads as fully occluded and as thin as the scatter allows. Outside wounds the two
// fields agree.
//
// Only where the pixel is on the tile path (mapLean walks the tile's list); elsewhere the probes are mapBody's.
//
//   (no parameter), ?probelean=0   off: the shader text of before the switch, byte for byte
//   ?probelean, ?probelean=1       on
import { LEAN_WALK } from './lean-walk-flag';

export function probeLeanOn(search: string): boolean {
  const v = new URLSearchParams(search).get('probelean');
  return v !== null && v !== '0';
}

export const PROBE_LEAN: boolean = LEAN_WALK && (() => {
  try {
    return probeLeanOn((globalThis as { location?: { search?: string } }).location?.search ?? '');
  } catch {
    return false;
  }
})();
