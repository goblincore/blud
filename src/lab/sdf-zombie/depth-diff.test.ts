// src/lab/sdf-zombie/depth-diff.test.ts
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';
import { depthFromBody, maskFromBody, maskFromTriangles, normalise, compareSilhouette } from './silhouette';
import { diffDepth, resampleDepth } from './depth-diff';

// Same builder idiom as silhouette.test.ts's describe blocks — local rather
// than hoisted, since nothing outside this file builds bodies.
const build = (src: string) => buildBody(compileBlob(parseBlob(src), compileFace(parseBlob(src))));

// Skeleton both fixtures share. The head ball is big enough to swallow the
// face prims compileFace always emits on `skull` (cranium half-extents are
// ~0.14 from HEAD_AT, against this ball's 0.25), so the silhouette stays the
// clean disc the depth claims below are about.
const SKELETON = `model t
skeleton
  root pelvis at 0.92
  bone spine parent=pelvis dir=up pitch=0 len=0.34
  bone skull parent=spine dir=up len=0.16

body
`;

describe('diffDepth', () => {
  it('reports zero error when a body is compared against itself', () => {
    // Both sides run the identical raster through the identical path, so
    // every both-occupied pixel has EXACTLY 0 difference — not approximately:
    // any asymmetry in how the two sides are normalised or offset shows up
    // here first.
    const src = SKELETON + `  blob head on skull at=0.45 r=0.25 blend=0.02\n`;
    const body = build(src);
    expect(body.errors).toEqual([]);
    const rep = diffDepth(body, body, { heightPx: 64 });
    expect(rep.samples).toBeGreaterThan(0);
    expect(rep.meanErr).toBe(0);
    expect(rep.signedErr).toBe(0);
    for (const b of rep.bands) {
      expect(b.samples).toBeGreaterThan(0);
      expect(b.meanErr).toBe(0);
      expect(b.signedErr).toBe(0);
    }
  });

  it('IGNORES pixels occupied by only one side', () => {
    // A pixel the body fills and the reference does not is a SILHOUETTE
    // difference — blob:measure reports those, better. This tool's numbers
    // must come from the overlap alone.
    //
    // The case: one body, and the same body with a lump fused on at the
    // lower right that pokes OUTSIDE the disc (centre 0.17 from the ball
    // centre + r 0.12 reaches 0.29, against the ball's 0.25) but stays
    // INSIDE the ball's bounding box (x/y reach 0.24, against 0.25). Inside
    // the box matters: both subjects then normalise to the SAME grid, so the
    // shared disc lands on identical pixels and the only thing that can move
    // the score is the lump being counted.
    const base = `  blob head on skull at=0.45 r=0.25 blend=0.02\n`;
    const lumped = SKELETON + base + `  blob torso on skull at=0.45 r=0.12 blend=0.02 offset=(0.12,-0.12,0)\n`;
    const plain = SKELETON + base;
    const a = build(lumped);
    const b = build(plain);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);

    // The mismatch is real: the lump adds mask pixels.
    const ma = maskFromBody(a, { heightPx: 64 });
    const mb = maskFromBody(b, { heightPx: 64 });
    const count = (m: typeof ma) => { let n = 0; for (const v of m.bits) n += v; return n; };
    expect(count(ma)).toBeGreaterThan(count(mb));

    const rep = diffDepth(a, b, { heightPx: 64 });

    // `samples` counts BOTH-occupied pixels only, on the normalised grid.
    // The lump cannot be part of that set (the plain body has nothing
    // there), so the count must equal the shared footprint exactly — one
    // cell more and a one-sided pixel leaked in.
    const na = normalise(ma, 128, 128), nb = normalise(mb, 128, 128);
    const countG = (m: typeof na) => { let n = 0; for (const v of m.bits) n += v; return n; };
    let overlap = 0;
    for (let i = 0; i < na.bits.length; i++) if (na.bits[i] && nb.bits[i]) overlap++;
    // The lump adds grid cells (it is real at every level)...
    expect(rep.samples).toBe(overlap);
    // ...and none of its cells are counted as samples. (The equality above
    // is computed from the masks INDEPENDENTLY of diffDepth, so it is the
    // real leak check; these two only prove the lump exists in the grids.)
    expect(countG(na)).toBeGreaterThan(countG(nb));
    expect(rep.samples).toBeLessThan(countG(na));

    // The shared disc is the SAME geometry seen twice, so the depth error
    // over the overlap is alignment jitter only: the lump's cluster sphere
    // perturbs A's march phase at the rim, its subject bounds shift by a
    // pixel, and the two normalise mappings then differ by about one source
    // pixel across the disc. MEASURED at 0.0057 m for this fixture at 64
    // rows. The threshold is set just above that: its job is to catch a
    // LOST normalisation (which would read centimetres of fake disagreement
    // on every shared pixel), not to be the leak detector — the exact
    // samples equality above is that.
    expect(rep.meanErr).toBeLessThan(0.01);
  });

  it('catches a surface difference the SILHOUETTE cannot see', () => {
    // THE POINT OF THE WHOLE TOOL. A flat slab against a domed body of equal
    // outline: every existing check scores them identically, because an
    // outline cannot see relief — which is exactly how the minotaur's
    // featureless torso passed blob:measure, blob:rings and nine test pins
    // and still got rejected on sight.
    //
    // Body: a 0.25 ball (the dome). Reference: a flat 24-gon disc of the same
    // radius (the slab). Front view: camera side is -z, so the ball's front
    // surface is at -sqrt(r^2-u^2) and the disc sits at a constant 0.
    const body = build(SKELETON + `  blob head on skull at=0.45 r=0.25 blend=0.02\n`);
    const r = 0.25, n = 24;
    const disc: number[] = [];
    for (let k = 0; k < n; k++) {
      const t0 = (k / n) * 2 * Math.PI, t1 = ((k + 1) / n) * 2 * Math.PI;
      // Centre vertex, then the rim arc — all at z = 0.
      disc.push(0, 1.332, 0, r * Math.cos(t0), 1.332 + r * Math.sin(t0), 0, r * Math.cos(t1), 1.332 + r * Math.sin(t1), 0);
    }
    const ref = new Float32Array(disc);

    // FIRST: prove the silhouettes agree — otherwise a depth error here
    // proves nothing, it would just be an outline difference wearing a
    // different name.
    const sil = compareSilhouette(maskFromBody(body, { heightPx: 64 }), maskFromTriangles(ref, { heightPx: 64 }), {});
    expect(sil.iou).toBeGreaterThan(0.95);

    // NOW the depth: the ball's surface falls away from its crest, the slab
    // does not, so there is a real metres-scale error. Analytic value for
    // this geometry is r/4 = 0.0625 mean |body' - ref'| over the disc.
    const rep = diffDepth(body, ref, { heightPx: 64 });
    expect(rep.samples).toBeGreaterThan(0);
    expect(rep.meanErr).toBeGreaterThan(0.045);
    expect(rep.meanErr).toBeLessThan(0.085);
    // And the SIGN is the plan's convention: positive = the body sits NEARER
    // the camera than the mesh. The dome protrudes toward the viewer, the
    // slab does not — flipping this sign in the implementation must fail
    // this line.
    expect(rep.signedErr).toBeGreaterThan(0.02);
  });

  it('names the .blob line that owns each band', () => {
    // Two masses far apart in height, one line each: the crown band can only
    // be owned by the skull mass and the sole band by the pelvis mass. A
    // band index has to mean the same height here that it means to
    // bandOwners, or the attribution points at the wrong line.
    const src = SKELETON
      + `  blob head on skull at=0.45 r=0.25 blend=0.02\n`
      + `  blob torso on spine at=1.0 r=0.30 wide=1.2 blend=0.02\n`;
    const body = build(src);
    expect(body.errors).toEqual([]);
    const rep = diffDepth(body, body, { heightPx: 64 });
    // Bands come back worst-first, so find them by their height span rather
    // than by index.
    const crown = rep.bands.find((b) => b.y0 === 0)!;
    const sole = rep.bands.find((b) => b.y1 === 1)!;
    // Line numbers in the .blob text above (1-based): head = 8, torso = 9.
    expect(crown.owner).toBeDefined();
    expect(crown.owner!.line).toBe(8);
    expect(crown.owner!.label).toBe('head on skull');
    expect(sole.owner).toBeDefined();
    expect(sole.owner!.line).toBe(9);
    expect(sole.owner!.label).toBe('torso on spine');
  });
});

describe('resampleDepth', () => {
  // The depth resampler walks the SAME source boxes normalise walks — it has
  // to, or the depths and the mask they are read through would disagree by
  // up to a source pixel. normalise does not expose that walk, so it is
  // duplicated here, and this test is the pin: if the two ever drift, the
  // bits stop matching and every depth band in diffDepth is quietly reading
  // the wrong height.
  it('occupies exactly the pixels normalise does', () => {
    const body = build(SKELETON + `  blob head on skull at=0.45 r=0.25 blend=0.02\n`);
    const { mask, depth } = depthFromBody(body, { view: 'front', heightPx: 96 });
    const out = resampleDepth(mask, depth, 128, 128);
    expect(Array.from(out.mask.bits)).toEqual(Array.from(normalise(mask, 128, 128).bits));
    // No kit was passed, so every occupied pixel has a marched depth behind
    // it: finite where occupied, NaN where not. (A kit-supplied pixel would
    // be occupied-but-NaN — that case is diffDepth's to skip, documented
    // there.)
    for (let i = 0; i < out.mask.bits.length; i++) {
      if (out.mask.bits[i]) expect(Number.isFinite(out.depth[i]!)).toBe(true);
      else expect(Number.isNaN(out.depth[i]!)).toBe(true);
    }
  });
});
