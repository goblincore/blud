// src/lab/sdf-zombie/zap-look.ts
//
// THE ZAP'S LOOK VARIANTS (look spike 2026-11-18, docs/dev-notes/2026-11-18-zap-look-spike/NOTES.md). The owner
// played the first zap and found it short of a cartoon electrocution; this is the A/B switch for what was tried:
//   a  the look as built on 2026-11-17, untouched: the baseline;
//   b  "cartoon": a hard, steady strobe; thinned bones that keep their shading; eyes that stay readable; crackle
//      on the flesh; crawl arcs; the kit flashes with the body;
//   c  "burst": the strobe comes in fast bursts; bones drawn as dark outlines the body's glow shows through; a
//      halo round the whole body; the rest as b.
// Pure data and arithmetic: which variant is live, each variant's strobe timing (zap.ts steps it), and the code a
// body's record carries so the shaders know which look to draw. No renderer, no clock.

export type ZapLookId = 'a' | 'b' | 'c';

/** The strobe: a jolt is the NEGATIVE frame (dark body, bright bones). Seconds; a pair is a seeded range. */
export interface ZapStrobe {
  /** How long a jolt holds. */
  joltSec: readonly [number, number];
  /** The gap from the end of a burst to the next jolt. */
  gapSec: readonly [number, number];
  /** Jolts in a burst (1: no bursts), and the gap between two jolts of one burst. */
  burst: readonly [number, number];
  burstGapSec: number;
}

export interface ZapLookDef {
  id: ZapLookId;
  /** What the body's record carries (encodeZapLane): 0 is the baseline's lane exactly. */
  code: number;
  strobe: ZapStrobe;
  /** The overlay (webgpu/game-zap-fx.ts): crawl arcs at once on one body (0: none), the kit's flash, the halo. */
  arcs: number;
  kitFlash: boolean;
  halo: boolean;
}

export const ZAP_LOOKS: Readonly<Record<ZapLookId, ZapLookDef>> = Object.freeze({
  // The 2026-11-17 timing: 0.08 s jolts, 0.25 to 0.7 s apart.
  a: { id: 'a', code: 0, strobe: { joltSec: [0.08, 0.08], gapSec: [0.25, 0.7], burst: [1, 1], burstGapSec: 0 }, arcs: 0, kitFlash: false, halo: false },
  // About 3 jolts a second, the negative frame up about 40% of the time.
  b: { id: 'b', code: 1, strobe: { joltSec: [0.10, 0.14], gapSec: [0.16, 0.26], burst: [1, 1], burstGapSec: 0 }, arcs: 10, kitFlash: true, halo: false },
  // Bursts of 3 to 5 jolts at 10 a second, then a breath.
  c: { id: 'c', code: 2, strobe: { joltSec: [0.05, 0.05], gapSec: [0.3, 0.6], burst: [3, 5], burstGapSec: 0.05 }, arcs: 14, kitFlash: true, halo: true },
});

export const ZAP_LOOK_IDS = Object.freeze(Object.keys(ZAP_LOOKS) as ZapLookId[]);
export const isZapLookId = (v: unknown): v is ZapLookId => typeof v === 'string' && (ZAP_LOOK_IDS as readonly string[]).includes(v);

/** The look the game starts in: c, the owner's pick after playing all three (2026-11-18). */
export const ZAP_LOOK_DEFAULT: ZapLookId = 'c';
/** The live variant. Plain module state: a dev A/B switch, read by the actor's zap step and the renderer glue. */
let live: ZapLookId = ZAP_LOOK_DEFAULT;
/**
 * THE REDUCED-FLASHES STROBE (`?flashes=reduced`, the repo's setting; lamp-moods.ts has the lamps' side). Look c's
 * bursts run at 10 jolts a second and b sits at 3: under the setting every variant strobes with single, longer
 * jolts no more than 3 to a second, whatever the seed. The look is otherwise the same.
 */
export const ZAP_STROBE_REDUCED: ZapStrobe = { joltSec: [0.12, 0.12], gapSec: [0.4, 0.6], burst: [1, 1], burstGapSec: 0 };
let reduced = false;
export function setZapReducedFlashes(on: boolean): boolean { reduced = !!on; return reduced; }
const REDUCED_LOOKS: Readonly<Record<ZapLookId, ZapLookDef>> = Object.freeze({
  a: ZAP_LOOKS.a,   // the baseline is already under 2 jolts a second
  b: { ...ZAP_LOOKS.b, strobe: ZAP_STROBE_REDUCED },
  c: { ...ZAP_LOOKS.c, strobe: ZAP_STROBE_REDUCED },
});
export const zapLook = (): ZapLookDef => (reduced ? REDUCED_LOOKS : ZAP_LOOKS)[live];
/** Set the live variant; anything that is not a variant's name leaves it as it was. Returns the live id. */
export function setZapLook(id: unknown): ZapLookId {
  if (isZapLookId(id)) live = id;
  return live;
}

/** The mean jolts a second a strobe gives under a held arc, and the share of the time the negative frame is up. */
export function strobeRate(s: ZapStrobe): { joltsPerSec: number; negativeShare: number } {
  const mid = (r: readonly [number, number]) => (r[0] + r[1]) / 2;
  const n = mid(s.burst), jolt = mid(s.joltSec);
  const cycle = n * jolt + (n - 1) * s.burstGapSec + mid(s.gapSec);
  return { joltsPerSec: n / cycle, negativeShare: (n * jolt) / cycle };
}

/**
 * THE LANE a body's record (REC_BURN.w) and its bone instances (iZap) carry: the glow, the strobe state and the
 * variant in one float. Zero: no zap. Otherwise the magnitude is 2 x code + glow (glow in (0, 1]) and the sign is
 * negative on a jolt. Code 0 is the 2026-11-17 lane (the signed glow) to the bit.
 */
export function encodeZapLane(glow: number, invert: boolean, code: number): number {
  if (!(glow > 0)) return 0;
  const g = Math.min(1, glow);
  const m = code > 0 ? 2 * code + Math.max(g, 1e-3) : g;
  return invert ? -m : m;
}

export function decodeZapLane(lane: number): { glow: number; invert: boolean; code: number } {
  const m = Math.abs(lane);
  if (m === 0) return { glow: 0, invert: false, code: 0 };
  const code = Math.floor(m / 2);
  return { glow: m - 2 * code, invert: lane < 0, code };
}

/** The decode, in WGSL: `zapLaneCode(lane)` and `zapLaneGlow(lane)`. */
export const ZAP_LANE_CODE_EXPR = (lane: string) => `floor(abs(${lane}) * 0.5)`;
export const ZAP_LANE_GLOW_EXPR = (lane: string) => `(abs(${lane}) - 2.0 * floor(abs(${lane}) * 0.5))`;
