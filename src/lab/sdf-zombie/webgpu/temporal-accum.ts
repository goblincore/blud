// src/lab/sdf-zombie/webgpu/temporal-accum.ts
//
// The PURE half of the temporal accumulation (plan
// docs/superpowers/plans/2026-09-10-temporal-accumulation.md): the blend rate
// and the jitter sequence. Pure so the sequencing rules can be pinned without a
// GPU — the same split as temporal-start.ts, whose test file is the precedent.
//
// WHY THE JITTER IS THE FEATURE. Accumulating a low-resolution march into its own
// grid averages the sub-positions into the same texels: a box blur, no new
// detail. Accumulating at OUTPUT resolution, where each output pixel reads one
// low-res texel per frame and the jitter changes WHICH one, gives that pixel a
// different sample of the underlying image every frame — supersampling. So the
// sequence must be low-discrepancy (cover the sub-pixel square evenly and
// quickly) and it must ADVANCE.
//
// ⚠ AND IT MUST NOT BE FROZEN FOR RECORDINGS, which is where this file
// deliberately contradicts an existing precedent. The probe gather pins its
// ray-set rotation while a demo is held (`frameSeed: demoHold ? 0 : ...`) so a
// recording is not at the mercy of a moving sample pattern. Doing that here would
// freeze convergence and turn the scheme back into the interlaced hold it
// replaces: a constant jitter samples one sub-position forever. Determinism comes
// from indexing the sequence by frames-since-epoch instead — reproducible AND
// progressing. See the frame-hash decision note
// (docs/dev-notes/2026-09-10-temporal-accumulation-frame-hash-DECISION.md).

/** The march scale the accumulation is designed around. MEASURED: 0.5 is a
 *  quarter of the marched pixels for HALF the march cost (8.18 -> 4.12 ms room 4),
 *  and below it there is nothing left to take (0.35 buys 0.2 ms of frame). The
 *  reconstruction is what makes a quarter-res march acceptable at all, so this is
 *  the pair the boot param defaults to; accumulating at full scale is a temporal
 *  AA with none of the win. */
export const TEMPORAL_ACCUM_DEFAULT_SCALE = 0.5;

/** Weight of the NEW sample against the accumulated history. 0.25 settles to
 *  ~94% of a converged value in ten frames (~0.17 s at 60 Hz), which is inside
 *  the window where the owner reads ghosting as CRT wear rather than as smearing.
 *  Lower is smoother and reconstructs more but lingers; higher reconverges faster
 *  and reconstructs less. The seam takes an override. */
export const TEMPORAL_ACCUM_DEFAULT_ALPHA = 0.25;

/** Frames of history after which an accumulation is treated as converged, for
 *  reporting only. At alpha 0.25 the residual after n frames is 0.75^n: 16 frames
 *  leaves 0.01002 — just OVER 1%, which the test caught — so the honest figure is
 *  17 (0.0075). */
export const TEMPORAL_ACCUM_CONVERGED_FRAMES = 17;

/**
 * Van der Corput radical inverse in `base` — one dimension of a Halton
 * sequence. `index` is clamped to a non-negative integer; index 0 is 0 by
 * convention, which is what makes the first frame after a reset an unbiased
 * sample rather than an offset one.
 */
export function radicalInverse(index: number, base: number): number {
  let n = Math.max(0, Math.floor(index));
  let denom = 1;
  let result = 0;
  while (n > 0) {
    denom *= base;
    const digit = n % base;
    n = Math.floor(n / base);
    result += digit / denom;
  }
  return result;
}

/**
 * The sub-pixel jitter for a frame, in FULL-RESOLUTION PIXELS, each component in
 * [0, 1). Bases 2 and 3 are the standard Halton pair (coprime, so the 2D sequence
 * fills the square evenly rather than collapsing onto a diagonal).
 *
 * The value is a frustum offset, so any real number is legal; keeping it in
 * [0, 1) means the sampled grid stays centred on the pixel it belongs to (the
 * mean of the sequence is 0.5) rather than drifting a whole pixel away.
 */
export function accumJitter(framesSinceEpoch: number): [number, number] {
  const i = Math.max(0, Math.floor(framesSinceEpoch)) + 1;
  return [radicalInverse(i, 2), radicalInverse(i, 3)];
}

/** The blend rate for a frame, given the history length. A frame right after a
 *  reset takes the current sample outright (alpha 1): that re-seeds the history
 *  without a clear pass, and it is the only value that makes frame 0 of an epoch
 *  independent of whatever the buffer happened to contain. */
export function accumAlpha(framesSinceEpoch: number, alpha = TEMPORAL_ACCUM_DEFAULT_ALPHA): number {
  if (framesSinceEpoch <= 0) return 1;
  return Math.min(1, Math.max(0.01, alpha));
}
