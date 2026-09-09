// src/lab/sdf-zombie/webgpu/field-render.ts
//
// INTERLACED FIELD RENDERING — the pure math. See
// docs/superpowers/specs/2026-09-09-interlaced-field-rendering-design.md
//
// The march is 75-83% of the GPU frame and its cost is covered PIXELS (fill
// bound, 18.6 ms + 0.237 ms per 1k px). Marching alternate scanlines halves
// that. Unlike half-rate, every pixel drawn this frame is drawn NOW at the
// current camera, so there is no held camera and no reprojection — which is
// the error class that made half-rate desync from the full-rate skeleton
// meshes whenever the player strafed.
//
// THE SAVING COMES FROM THE TARGET BEING HALF HEIGHT, NOT FROM A DISCARD.
// GPUs shade in 2x2 quads, so discarding alternate rows inside a full-res
// pass still executes every quad and saves nothing. Nothing in this module or
// its callers may reintroduce a per-pixel row test in the march.
//
// Pure on purpose (no three, no GPU) so the coverage invariant — every output
// row fresh exactly once per two frames — is pinned in vitest.

/** Which field this frame renders. Field 0 owns even output rows. */
export function fieldParity(frameIndex: number): 0 | 1 {
  return (frameIndex % 2 === 0 ? 0 : 1);
}

/** Half height, rounded UP: an odd full height must not drop its last row. */
export function fieldTargetHeight(fullHeight: number): number {
  return Math.max(1, Math.ceil(fullHeight / 2));
}

/**
 * Vertical projection jitter, in NDC, for a field.
 *
 * Full-res rows are 2/H apart in NDC. The two fields must land exactly one
 * full-res row apart, so each sits half that from centre: -1/H and +1/H.
 * Symmetric so neither field is the biased one — an asymmetric jitter makes
 * the image crawl vertically as the fields alternate.
 */
export function fieldJitterNdcY(parity: 0 | 1, fullHeight: number): number {
  return (parity === 0 ? -1 : 1) / fullHeight;
}

/**
 * Where output row `y` reads from this frame.
 * `fresh` = sample this frame's half-height target at `targetRow`.
 * `!fresh` = sample the retained previous field at `targetRow`.
 */
export function fieldRowSource(y: number, parity: 0 | 1): { fresh: boolean; targetRow: number } {
  return { fresh: (y % 2) === parity, targetRow: Math.floor(y / 2) };
}

/**
 * The two half-target rows whose FRESH samples bracket held output row `y`
 * (a row `fieldRowSource` says is not fresh this frame). Fresh row r is
 * output row 2r+parity, so the held row is between r and r+1 for parity 0
 * and between r-1 and r for parity 1. Callers clamp to the target.
 */
export function fieldHeldNeighbours(y: number, parity: 0 | 1): { above: number; below: number } {
  const base = Math.floor(y / 2) - parity;
  return { above: base, below: base + 1 };
}
