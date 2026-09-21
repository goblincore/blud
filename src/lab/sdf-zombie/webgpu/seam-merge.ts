// src/lab/sdf-zombie/webgpu/seam-merge.ts
//
// Assembles `window.__sdfGame` from the seam factories WITHOUT flattening
// their getters.
//
// WHY THIS EXISTS. The game-main decomposition (2026-09-17..20) lifted the
// __sdfGame members into game-seams-*.ts byte-for-byte and put them back as
// `{ ...createXSeams(ctx), ... }`. The code did not change; what it MEANT
// did. An object spread reads each accessor ONCE and copies the value, so
// every `get shells()`, `get flashVisible()`, `get gunReady()` — 95 of them,
// every top-level getter in every factory — became a snapshot taken the
// moment the literal was built, and read that boot value for the rest of
// the session. The migration gate proved all 400 seams were PRESENT, which
// they were; nothing proved they were LIVE.
//
// Consequences ranged from loud (a gate expecting flashVisible to go true on
// the shot frame) to silent (the shorty gate's "reload finished" wait for
// `shells === 2 && hingeOpenRad === 0` was satisfied by the boot values
// before the reload ever started).
//
// mergeSeams copies property DESCRIPTORS instead of values, so accessors
// arrive as accessors. Everything else a spread promised is kept: later
// parts win on a name clash, exactly as a later spread would, and own
// enumerable keys keep their insertion order.

/**
 * Merge seam objects into one, left to right, preserving getters/setters.
 * The drop-in for `{ ...a, ...b, ...c }` wherever any part may carry an
 * accessor. Later parts override earlier ones, as with spread.
 */
export function mergeSeams<T extends object[]>(...parts: T): UnionToIntersection<T[number]> {
  const out = {};
  for (const part of parts) {
    // getOwnPropertyDescriptors, not Object.keys + assignment: assignment
    // would invoke the getter and store its result — the exact bug.
    Object.defineProperties(out, Object.getOwnPropertyDescriptors(part));
  }
  return out as UnionToIntersection<T[number]>;
}

type UnionToIntersection<U> =
  (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
