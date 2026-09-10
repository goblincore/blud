// src/lab/sdf-zombie/webgpu/field-render.ts
//
// INTERLACED FIELD RENDERING — the pure math. See
// docs/superpowers/specs/2026-09-09-interlaced-field-rendering-design.md
//
// The march is 75-83% of the GPU frame and its cost is COVERED PIXELS. The
// one lever with a MEASURED large number in this project is pixel count:
// quartering the pixels (`setSdfScale(0.5)`) bought -54%, while a 6x cut in
// the step budget bought only -6..-31%, mostly single-digit — see
// docs/dev-notes/2026-08-31-game-perf-baseline/notes.md:204-238, whose own
// conclusion is "cost is dominated by per-pixel work, not per-step work".
// Interlacing attacks the term that actually pays.
//
// Marching alternate scanlines halves that. Unlike half-rate, every pixel
// drawn this frame is drawn NOW at the current camera, so there is no held
// camera and no reprojection — which is the error class that made half-rate
// desync from the full-rate skeleton meshes whenever the player strafed.
//
// THE SAVING COMES FROM THE TARGET BEING SHORTER, NOT FROM A DISCARD. GPUs
// shade in 2x2 quads, so discarding alternate rows inside a full-res pass
// still executes every quad and saves nothing. Nothing in this module or its
// callers may reintroduce a per-pixel row test in the march.
//
// N-FIELD GENERALISATION (2026-09-10). Every function here takes an optional
// `fields` divisor, defaulting to 2. `fields = 2` reproduces the shipped
// two-field behaviour EXACTLY — bit-identical, and pinned by the tests. The
// point of the generalisation is `fields = 3` or 4: the march target becomes a
// third or a quarter as tall, so the dominant pass pays a third or a quarter
// of the pixels — the -54%-class lever rather than the -6..-31% one.
//
// ⚠ THE COMPOSITE SHADER IS STILL TWO-FIELD. `sdf-layer.ts`'s COMPOSITE_WGSL
// and FIELD_INTERLEAVE_WGSL hardcode `outRow % 2` and `outRow / 2`, and
// `uOutHeight` is wired as the full height. Passing `fields > 2` from any
// caller BEFORE those two shaders are generalised in the same commit will
// mis-weave rows silently — no error, just wrong scanlines. Keep every call
// site at the default until that lands.
//
// Pure on purpose (no three, no GPU) so the coverage invariant — every output
// row fresh exactly once per `fields` frames — is pinned in vitest.

/** The shipped field divisor. Two fields: alternating scanlines. */
export const FIELD_COUNT = 2;

/**
 * Which field this frame renders. Field `f` owns every output row where
 * `row % fields === f`.
 *
 * `fields = 2` is `frameIndex % 2`: field 0 owns even output rows, exactly as
 * it always has.
 */
export function fieldParity(frameIndex: number, fields: number = FIELD_COUNT): number {
  return ((frameIndex % fields) + fields) % fields;
}

/**
 * Target height for `fields` fields: the full height divided by `fields`,
 * rounded UP so an indivisible height does not drop its last row.
 *
 * `fields = 2` is the shipped half-height target.
 */
export function fieldTargetHeight(fullHeight: number, fields: number = FIELD_COUNT): number {
  return Math.max(1, Math.ceil(fullHeight / fields));
}

/**
 * Vertical projection jitter, in NDC, for one field of `fields`.
 *
 * Full-res rows are 2/H apart in NDC (H = full height), so the `fields`
 * sub-positions inside one target row must be spaced exactly 2/H apart and
 * centred on it. The spread is (fields - 1) * 2/H, so field f sits at
 *
 *     (f - (fields - 1) / 2) * 2 / H
 *
 * Symmetric about zero, so no field is the biased one — an asymmetric jitter
 * makes the image crawl vertically as the fields cycle.
 *
 * `fields = 2` gives -1/H and +1/H, exactly the shipped pair.
 */
export function fieldJitterNdcY(field: number, fullHeight: number, fields: number = FIELD_COUNT): number {
  return (field - (fields - 1) / 2) * (2 / fullHeight);
}

/**
 * Where output row `y` reads from this frame.
 * `fresh` = sample this frame's shortened target at `targetRow`.
 * `!fresh` = reconstruct from an earlier field (see `fieldHeldNeighbours`).
 */
export function fieldRowSource(
  y: number,
  field: number,
  fields: number = FIELD_COUNT,
): { fresh: boolean; targetRow: number } {
  return { fresh: (y % fields) === field, targetRow: Math.floor(y / fields) };
}

/**
 * The two target rows whose FRESH samples bracket held output row `y`.
 *
 * Fresh target row `r` is output row `r * fields + field`, so the held row
 * lies strictly between `rHi - 1` and `rHi` where
 *
 *     rHi = ceil((y - field) / fields)
 *
 * i.e. the first field-owned row at or below `y`. Callers clamp to the
 * target, as they always have.
 *
 * DOMAIN: HELD ROWS ONLY. Both the old `floor(y/2) - field` form and this one
 * are derivations for a row the current field did NOT draw, and for a FRESH
 * row they legitimately disagree (y = 0, field = 0: old {0, 1}, new {-1, 0}).
 * Nothing calls this about a fresh row — the shader tests `outRow % fields`
 * first — so the difference has never been observable. Do not "fix" it by
 * making fresh rows agree: there is no correct answer for a row that was
 * drawn, and inventing one would hide a caller that skipped the row test.
 *
 * `fields = 2` reproduces the shipped pair for both fields:
 *   field 0, y = 1 -> fresh rows are even; rHi = ceil(0.5) = 1 -> {0, 1}
 *   field 1, y = 4 -> fresh rows are odd;  rHi = ceil(1.5) = 2 -> {1, 2}
 * which is what the hand-derived `floor(y/2) - field` form gave.
 */
export function fieldHeldNeighbours(
  y: number,
  field: number,
  fields: number = FIELD_COUNT,
): { above: number; below: number } {
  // The `+ 0` normalises NEGATIVE ZERO. Math.ceil(-0.5) is -0, and the
  // pre-generalisation form (`floor(y / 2) - field`, then +1) produced +0 for
  // the same input. -0 behaves as 0 in every arithmetic and indexing use, but
  // an Object.is / deep-equality consumer sees the difference — so bit
  // identity with the shipped two-field answer requires the normalisation.
  const rHi = Math.ceil((y - field) / fields) + 0;
  return { above: rHi - 1, below: rHi };
}

/**
 * How many PREVIOUS field buffers must be retained to reconstruct a held row
 * from real samples rather than by interpolation.
 *
 * With only the current field plus one retained buffer, `fields - 2` of the
 * missing rows have no source and can only be interpolated from the bracketing
 * fresh rows — which is what `comb` already does, and which is why a deeper
 * field goes soft without a ring. Two fields need 1 retained buffer (the
 * shipped case); three need 2; four need 3.
 */
export function fieldRingDepth(fields: number = FIELD_COUNT): number {
  return Math.max(1, fields - 1);
}

/**
 * The march's covered pixels as a fraction of the full-res frame, for a given
 * field count. This is the whole point of the technique and the number to
 * quote when predicting a win: the march is charged per covered pixel.
 */
export function fieldPixelFraction(fields: number = FIELD_COUNT): number {
  return 1 / fields;
}
