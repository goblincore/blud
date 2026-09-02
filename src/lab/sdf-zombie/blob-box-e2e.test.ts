// src/lab/sdf-zombie/blob-box-e2e.test.ts
//
// END-TO-END proof that a `box` primitive works — parse -> compile -> build
// -> CPU field -> re-emit — for a single fixture, `characters/box-fixture.blob`.
// Tasks 1-6 each landed with unit tests at their own layer (parsing, compile
// rejections, the CPU field, boxReach, GPU packing, WGSL); none of those
// proves the layers AGREE with each other end to end, or that a box actually
// LOOKS like a box rather than a rounded lozenge wearing a box's flag. This
// file is the first: the visual proof lives in blob:shot/blob:render-check,
// documented under docs/dev-notes/2026-09-02-box-primitive/.
import { describe, it, expect } from 'vitest';
import { parseBlob } from './blob-parse';
import { emitBlob } from './blob-emit';
import { compileBlob } from './blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from './build-body';
import { sdBody } from './validate';
import src from './characters/box-fixture.blob?raw';

/**
 * Binary search for the surface crossing of `sdBody` along the ray
 * `lo*dir .. hi*dir`, `iters` halvings (60 gives ~1e-18 of the initial
 * bracket — vastly tighter than anything asserted below needs).
 *
 * Assumes `dir(lo)` is INSIDE (negative) and `dir(hi)` is OUTSIDE (positive) —
 * true for every probe below, since `lo=0` sits on the bone axis deep inside
 * the slab and `hi` is chosen well past its widest measured extent.
 */
function findSurface(f: (t: number) => number, lo: number, hi: number, iters = 60): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < iters; i++) {
    const m = (a + b) / 2;
    if (f(m) < 0) a = m; else b = m;
  }
  return (a + b) / 2;
}

describe('box-fixture: end-to-end box primitive', () => {
  const doc = parseBlob(src);
  const built: BuildResult = buildBody(compileBlob(doc), DEFAULT_BUILD_OPTS, {});

  it('validates as a closed, connected body', () => {
    // buildBody runs validateBody internally and never throws — `errors` is
    // the panel-facing report. Empty is the pass.
    expect(built.errors).toEqual([]);
  });

  // FLAT SIDES. The fixture's spine bone resolves to head=(0,0.64,0),
  // tail=(0,1.04,0) — pelvis's default 0.14 length puts the spine's own head
  // above the authored `root pelvis at 0.50`. The slab (`bar ... from=0.10
  // to=0.60`) therefore spans world y in [0.68, 0.88]. Two probe heights,
  // y=0.71 and y=0.80, sit 0.03 and 0.08 inside that span respectively —
  // comfortably clear of both the slab's own rounded caps (round=0.05 of
  // r=0.06 is a 3mm inset) and the soft blob sitting above at y=0.94 whose
  // blend=0.010 could otherwise bleed into a probe taken too close to y=0.88.
  const Y_LO = 0.71;
  const Y_HI = 0.80;

  it('has a constant half-width along the slab at two heights well inside its span', () => {
    // On-axis (z=0) probe: the surface crossing in x for a point directly
    // above the bone. A straight, untapered sweep — box OR capsule — puts
    // this at a fixed offset from the axis for every y strictly between the
    // segment's own endpoints, so agreement here is necessary (no
    // unintended taper/bulge along the length) but NOT sufficient to prove
    // BOX-ness — see the corner probe below for that. Both assertions
    // together are what "flat sides" means: flat along the LENGTH (this
    // one) and flat across the CROSS-SECTION (the corner probe).
    const wLo = findSurface((x) => sdBody([x, Y_LO, 0], built), 0, 0.3);
    const wHi = findSurface((x) => sdBody([x, Y_HI, 0], built), 0, 0.3);
    expect(wLo).toBeCloseTo(0.078, 6);
    expect(wHi).toBeCloseTo(0.078, 6);
  });

  // THE ASSERTION THAT ACTUALLY PROVES A BOX IS A BOX. `round=` is defined
  // so the axis-aligned extreme point of a rounded box always lands at
  // exactly `radius` — the same place a capsule's would (round=1 IS a
  // capsule) — which is precisely why the on-axis probe above can't tell a
  // box from a capsule by itself: they're built to agree there.
  //
  // They do NOT agree off-axis. Probing along the world direction
  // (wide, deep) = (1.30, 0.80) maps to the 45-degree corner in the
  // primitive's own unit (scale-divided) frame. Worked by hand and checked
  // against this file's own field:
  //   box:     local corner = e + round*r/sqrt2 = 0.0570 + 0.0021 = 0.0591
  //            -> world x = 0.0591 * 1.30 = 0.0769
  //   capsule: local corner = r/sqrt2 = 0.0424 -> world x = 0.0424 * 1.30 = 0.0552
  // i.e. the corner sits at ~98.5% of the on-axis width for a box, and only
  // ~70.7% (1/sqrt2, the sphere's constant) for a capsule — a ratio no
  // amount of tolerance-widening on the on-axis check would ever expose.
  // Confirmed by hand: dropping `box` from the slab's line (falling back to
  // the plain capsule branch, since this bar has no r2=) moves the measured
  // ratio from ~0.985 to exactly 1/sqrt(2) =~ 0.7071, while leaving the
  // on-axis widths above completely unchanged — restored after checking.
  it('reads square in cross-section — the corner sits near the face, not tucked in like a sphere', () => {
    const WIDE = 1.30;
    const DEEP = 0.80;
    const corner = (y: number) =>
      findSurface((s) => sdBody([s * WIDE, y, s * DEEP], built), 0, 0.3);
    const axis = (y: number) => findSurface((x) => sdBody([x, y, 0], built), 0, 0.3);

    for (const y of [Y_LO, Y_HI]) {
      const ratio = (corner(y) * WIDE) / axis(y);
      // Box predicts ~0.985; a capsule/sphere predicts exactly 1/sqrt(2) =
      // ~0.707. 0.9 sits well clear of both with wide margin either way.
      expect(ratio, `at y=${y}`).toBeGreaterThan(0.9);
    }
  });

  it('round-trips byte-for-byte through the emitter', () => {
    // Proves `box`/`round=` survive a re-emit unmangled — the path tuned
    // values take back into the character file.
    expect(emitBlob(doc)).toBe(src);
  });
});
