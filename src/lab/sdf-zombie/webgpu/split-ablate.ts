// src/lab/sdf-zombie/webgpu/split-ablate.ts
//
// THE OPEN HEAD'S COST, TAKEN APART (docs/dev-notes/2026-10-06-open-head-cost/NOTES.md; scripts/open-head-cost.mjs is
// the driver). Dev switches that price the parts of an open head split against each other inside ONE page, so the
// legs can be interleaved in one session. Every one of them draws a WRONG frame on purpose: cost only.
//
// Two kinds:
//   * RUNTIME SHADER SWITCHES (`mask`), compiled into the march ONLY when the page is opened with `?splitablate`
//     (the limbs-flag.ts rule: the shipped text must not carry an unshipped mode, and with the flag off every
//     string below is empty, so the shipped shader is the same to the byte). The mask rides the split record's
//     spare lane (crowd-records.ts REC_SPLIT_R .y), which an open slot already loads.
//   * CPU BOUNDS SWITCHES (`boundsOff`): which of the split's bounds stay the CLOSED head's (the tree before B5).
//     No shader text: they work on any page.
// `?splitfilm=0` is the third, compile-time only: the wet film's block is not written (SPLIT_SHADE.glisten.gain 0).
//
// Nothing here is read by a shipped path unless a driver moves it: mask 0 and boundsOff 0 are the defaults.

const param = (name: string): string | null => {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    return new URLSearchParams(search).get(name);
  } catch {
    return null;
  }
};

/** COMPILE-TIME: the march carries the runtime switches below (`?splitablate`). */
export const SPLIT_ABLATE: boolean = param('splitablate') !== null;
/** COMPILE-TIME: the wet film's block is left out of the march (`?splitfilm=0`). */
export const SPLIT_FILM_OFF: boolean = param('splitfilm') === '0';

/** The runtime shader switches (bits of `splitAblate.mask`). */
export const SPLIT_ABL = {
  /** mapBody stops after the first piece it evaluates: one field evaluation per sample, the piece set-up kept. */
  oneEval: 1,
  /** The shading normal takes the analytic gradient inside the region too (wrong on a turned half and on a cap). */
  analyticNormal: 2,
  /** The wet film's block is skipped. */
  noFilm: 4,
  /** mapBody folds the slot as a closed one: no piece set-up, no caps, no shell. Bounds, normals and the film's gate
   *  still see an open slot. */
  closedField: 8,
  /** The post-hit split state stays the closed body's: no un-warp, no cut-face gate. */
  noPostHit: 16,
  /** applyWounds folds no wound into the field (closed slots too: an ablation build loads the mask for every slot).
   *  The wound masks after the hit are not touched. */
  noFieldWounds: 32,
} as const;

/** The CPU bounds switches (bits of `splitAblate.boundsOff`): the bound named stays the closed head's. */
export const SPLIT_BOUND = {
  /** The proxy box (zombie-gpu.ts fit). */
  box: 1,
  /** The tile groups and the cluster row (zombie-gpu.ts upload). */
  tiles: 2,
  /** The outer hull's turned copies (shell-hull-outer.ts). */
  hullOuter: 4,
  /** The occluder hull keeps its spheres in turning flesh (occluder-hull.ts). */
  hullInner: 8,
  /** The tile groups carry no per-step cull sphere of their own (tile-cull.ts cullOffset): mapBody culls a grown
   *  group with its grown sphere, as before 2026-10-06. The frame is the same; only the work differs. */
  tileCull: 16,
  /** The outer hull turns copies of its own loose spheres with a half, not of a plain ellipsoid's tight chain
   *  (shell-hull-outer.ts ellipsoidChain): the hull before 2026-10-06. */
  hullOld: 32,
  /** The tight chain without the face cut's lip in its pad (shell-hull-outer.ts SPLIT_HULL_LIP): what the pad
   *  costs. */
  hullNoLip: 64,
} as const;

export const splitAblate = { mask: 0, boundsOff: 0 };

/** The split a BOUND reads: the body's, or none while that bound is switched to the closed head's. */
export function boundsSplit<T>(split: T | null | undefined, bit: number): T | null {
  return (splitAblate.boundsOff & bit) !== 0 ? null : (split ?? null);
}

/** WGSL written only into an ablation build. */
export const ablWgsl = (text: string): string => (SPLIT_ABLATE ? text : '');
