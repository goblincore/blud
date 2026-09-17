// src/lab/sdf-zombie/webgpu/boot-params.ts
//
// URL boot-parameter parsing, as a PURE function, because getting it wrong is
// not a crash — it is a silent wrong-frame.
//
// THE BUG THIS EXISTS TO KILL (2026-09-10, owner-reported visual regression).
// The probe-gather diagnostic seams were written as:
//
//     const p = Number(new URLSearchParams(location.search).get('dynrays'));
//     let boot = Number.isFinite(p) && p >= 0 ? clamp(p) : null;
//
// `URLSearchParams.get` returns **null** for an absent parameter, and
// `Number(null)` is **0** — which passes both `isFinite` and `>= 0`, because 0
// is a LEGITIMATE value for that seam (0 rays is the diagnostic mode). So every
// unparameterised page booted with zero rays and an empty light list, the
// dynamic probe layer went entirely zero, and characters in the player's room
// rendered as black silhouettes while characters in other rooms stayed lit.
//
// Two lessons are encoded here:
//   1. `null` and "explicitly 0" MUST be distinguishable. That is what the
//      raw-string check below does.
//   2. A default is not "the value the number parses to", it is what you get
//      when the parameter is ABSENT OR UNPARSEABLE. Both cases return null and
//      the caller supplies the shipped default.
//
// Pure (no `location`, no three) so it can be pinned in vitest — which is the
// whole point: this was untestable while it lived inline in the game closure.

/**
 * Parse an integer boot parameter.
 *
 * @returns the clamped integer, or `null` when the parameter is absent, empty,
 *          non-numeric, or NaN. `null` means "the caller's shipped default",
 *          and is deliberately NOT the same as a parsed `0`.
 *
 * `min` guards the lower bound (0 for a count, 1 for a divisor); `max` the
 * upper. A value outside the range is clamped rather than rejected, matching
 * how the existing `?proberate` / `?dynrays` seams behave.
 */
export function parseIntParam(
  raw: string | null,
  opts: { min: number; max: number },
): number | null {
  // ABSENT is not zero. Check the raw string BEFORE any numeric coercion,
  // because `Number(null) === 0` and `Number('') === 0` are exactly the trap.
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const v = Math.floor(n);
  if (v < opts.min) return null;
  return Math.min(opts.max, v);
}

/**
 * Whether a parameter is present at all, for the flags that are switches
 * rather than numbers (`?frozen`, `?slug`, `?sscs=on`). Trivial, but having it
 * beside `parseIntParam` is a reminder that presence and value are separate
 * questions — the confusion between them is what produced the bug above.
 */
export function hasParam(raw: string | null): boolean {
  return raw !== null;
}

/**
 * Parse a FRACTIONAL boot parameter. Same contract as `parseIntParam` — absent
 * or unparseable is `null`, meaning "the caller's shipped default" — because the
 * `Number(null) === 0` trap does not care whether the value has a fractional
 * part. A separate function rather than a flag on `parseIntParam`, so a caller
 * cannot silently floor a seam that needs its fraction (`?dynblend=0.5` is a
 * meaningful value; `?dynrays=32.7` is not).
 */
export function parseFloatParam(
  raw: string | null,
  opts: { min: number; max: number },
): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < opts.min) return null;
  return Math.min(opts.max, n);
}
