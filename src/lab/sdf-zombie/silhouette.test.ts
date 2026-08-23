// src/lab/sdf-zombie/silhouette.test.ts
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import {
  maskFromRgba, maskFromBody, subjectBounds, normalise, compareSilhouette,
  renderMask, gltfTriangles, maskFromTriangles, bandOwners, type Mask,
} from './silhouette';
import { decodePng } from './png-decode';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';

/** A white plate with filled rectangles painted on it, as RGBA. */
function plate(w: number, h: number, rects: Array<[number, number, number, number]>): Uint8Array {
  const rgba = new Uint8Array(w * h * 4).fill(255);
  for (const [x0, y0, x1, y1] of rects)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const o = (y * w + x) * 4;
        rgba[o] = 20; rgba[o + 1] = 30; rgba[o + 2] = 40;
      }
  return rgba;
}

/** A mask straight from a bit string, one line per row. */
function mask(rows: string[]): Mask {
  const h = rows.length, w = rows[0]!.length;
  const bits = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => { bits[y * w + x] = c === '#' ? 1 : 0; }));
  return { w, h, bits };
}

describe('maskFromRgba', () => {
  it('keys on distance from the sampled backdrop, not on alpha', () => {
    // Every reference plate we have is RGBA with alpha 255 everywhere — the
    // white is painted, not transparent. Keying on alpha would mark the whole
    // rectangle as subject and score the character as a square.
    const r = maskFromRgba(plate(8, 8, [[2, 2, 5, 5]]), 8, 8);
    expect(r.background).toEqual([255, 255, 255]);
    expect(r.coverage).toBeCloseTo(16 / 64, 6);
    expect(subjectBounds(r.mask)).toEqual({ x0: 2, y0: 2, x1: 5, y1: 5 });
  });

  it('counts disconnected blobs and keeps the largest', () => {
    const r = maskFromRgba(plate(16, 8, [[1, 1, 6, 6], [12, 1, 13, 2]]), 16, 8);
    expect(r.components).toBe(2);
    // The speck is gone: bounds cover the big rectangle only.
    expect(subjectBounds(r.mask)).toEqual({ x0: 1, y0: 1, x1: 6, y1: 6 });
  });

  it('can be told to keep every blob', () => {
    const r = maskFromRgba(plate(16, 8, [[1, 1, 6, 6], [12, 1, 13, 2]]), 16, 8,
      { largestComponentOnly: false });
    expect(r.components).toBe(2);
    expect(subjectBounds(r.mask)!.x1).toBe(13);
  });

  it('ignores a backdrop that is not white', () => {
    const rgba = plate(8, 8, [[3, 3, 4, 4]]);
    for (let i = 0; i < rgba.length; i += 4)
      if (rgba[i] === 255) { rgba[i] = 12; rgba[i + 1] = 40; rgba[i + 2] = 90; }
    const r = maskFromRgba(rgba, 8, 8);
    expect(r.background).toEqual([12, 40, 90]);
    expect(r.coverage).toBeCloseTo(4 / 64, 6);
  });
});

describe('normalise', () => {
  // The whole point of normalising to the subject box: two drawings of the
  // same shape at different sizes and positions must become the same mask, or
  // the score would be measuring framing rather than proportion.
  it('is invariant to scale and position', () => {
    const small = maskFromRgba(plate(32, 32, [[1, 1, 4, 8]]), 32, 32).mask;
    const big = maskFromRgba(plate(64, 64, [[30, 20, 45, 51]]), 64, 64).mask;
    expect([...normalise(small, 8, 16).bits]).toEqual([...normalise(big, 8, 16).bits]);
  });

  it('keeps a limb thinner than one output pixel', () => {
    // A one-pixel-wide leg at a 16x downscale disappears under nearest
    // sampling, and a vanished limb reads as a modelling error.
    const rows = Array.from({ length: 32 }, (_, y) => (y < 16 ? '#'.repeat(16) : '.......##.......'));
    const out = normalise(mask(rows), 8, 8);
    let bottom = 0;
    for (let i = 4 * 8; i < 64; i++) bottom += out.bits[i]!;
    expect(bottom).toBeGreaterThan(0);
  });
});

describe('compareSilhouette', () => {
  const tall = mask(['..##..', '..##..', '..##..', '..##..']);

  // THE SCHOOLGIRL LESSON (2026-08-23). A T-posed reference is 0.92 as wide as
  // it is tall; the arms-down .blob is 0.26. Normalising each to its own
  // whole-figure box before taking the window rows stretched the two by
  // different factors, and the window IoU read 0.22 on legs whose widths
  // agreed to 0.008. The window IoU must be computed in HEIGHT units on a
  // shared centreline, so rows outside the window cannot touch it.
  it('window IoU ignores the rows outside the window (T-pose arms vs arms down)', () => {
    const tpose = mask([
      '....##....',
      '##########', // arms out
      '....##....',
      '....##....',
      '....##....',
      '....##....',
    ]);
    const down = mask([
      '....##....',
      '...####...', // arms by the sides
      '....##....',
      '....##....',
      '....##....',
      '....##....',
    ]);
    const r = compareSilhouette(tpose, down, { bands: 4, range: [0.5, 1], grid: 120 });
    expect(r.iou).toBeGreaterThan(0.95);
    expect(r.meanWidthError).toBeLessThan(0.02);
  });

  // A stack of discs matches a smooth taper band for band — the width of each
  // band is right — so a per-band score cannot tell them apart. Row-to-row
  // width change can: a disc stack jumps where a taper slides.
  it('reports row jerk, which separates a disc stack from a smooth taper', () => {
    const smooth = mask([
      '....##....', '...####...', '...####...', '..######..',
      '..######..', '.########.', '.########.', '##########',
    ]);
    const discs = mask([
      '..######..', '..######..', '....##....', '....##....',
      '##########', '##########', '...####...', '...####...',
    ]);
    const r = compareSilhouette(smooth, discs, { bands: 4, grid: 16 });
    expect(r.rowJerk.got).toBeGreaterThan(r.rowJerk.ref * 2);
  });

  it('scores an identical outline perfectly', () => {
    const r = compareSilhouette(tall, tall, { bands: 4 });
    expect(r.iou).toBeCloseTo(1, 6);
    expect(r.meanWidthError).toBeCloseTo(0, 6);
  });

  it('is blind to scale, because proportion is the only question', () => {
    const doubled = mask([
      '....####....', '....####....', '....####....', '....####....',
      '....####....', '....####....', '....####....', '....####....',
    ]);
    const r = compareSilhouette(tall, doubled, { bands: 4 });
    expect(r.iou).toBeCloseTo(1, 6);
  });

  it('signs the delta so "too narrow" is readable without the render', () => {
    const wide = mask(['######', '######', '######', '######']);
    const r = compareSilhouette(wide, tall, { bands: 2 });
    // Both normalise to a full-width box, so the aspect ratio carries the
    // difference: the narrow one is a much smaller fraction of its own height.
    expect(r.gotAspect).toBeLessThan(r.refAspect);
    for (const b of r.bands) expect(b.delta).toBeLessThan(0);
  });

  // The reason `range` exists: score only where the two poses agree.
  it('confines the score to the requested height window', () => {
    // Both fixtures span the SAME bounding box on purpose. Normalising to the
    // subject box is scale-invariant, so a fixture whose box is narrower gets
    // stretched to fill the grid and the difference under test disappears —
    // which is exactly what the first version of this test fell for.
    const ref = mask(['####', '####', '#..#', '#..#']);
    const got = mask(['#..#', '#..#', '#..#', '#..#']);
    const whole = compareSilhouette(ref, got, { bands: 4 });
    const bottom = compareSilhouette(ref, got, { bands: 4, range: [0.5, 1] });
    expect(bottom.iou).toBeGreaterThan(whole.iou);
    expect(bottom.iou).toBeCloseTo(1, 2);
  });

  it('reports band heights against the WHOLE subject, not the window', () => {
    const r = compareSilhouette(tall, tall, { bands: 2, range: [0.5, 1] });
    // A window over the bottom half must report bands at ~0.6 and ~0.9, not at
    // 0.25/0.75 — otherwise a band number means something different depending
    // on which window produced it.
    for (const b of r.bands) expect(b.at).toBeGreaterThan(0.5);
  });

  // Width is the EXTENT, not the pixel count. The two differ exactly where a
  // band has a hole in it — between two legs, or two splayed shoes — and
  // extent is what the eye calls "how wide is it here".
  it('measures across a gap rather than summing the solid parts', () => {
    const split = mask(['#..#', '#..#']);
    const solid = mask(['####', '####']);
    const r = compareSilhouette(solid, split, { bands: 1 });
    expect(r.bands[0]!.delta).toBeCloseTo(0, 6);
  });
});

describe('maskFromBody', () => {
  const build = (name: string) => {
    const doc = parseBlob(readFileSync(`src/lab/sdf-zombie/characters/${name}.blob`, 'utf8'));
    return buildBody(compileBlob(doc, compileFace(doc)));
  };

  it('rasterises a real character to a plausible standing figure', () => {
    const m = maskFromBody(build('mouse'), { heightPx: 96 });
    const b = subjectBounds(m)!;
    const aspect = (b.x1 - b.x0 + 1) / (b.y1 - b.y0 + 1);
    expect(aspect).toBeGreaterThan(0.2);
    expect(aspect).toBeLessThan(1.2); // a humanoid, not a puddle or a needle
    // Coverage bounds catch the two ways the march fails silently: a figure
    // that fills its whole box (rays never terminating, so every pixel reads
    // as solid) and one that is nearly empty (rays terminating instantly).
    let on = 0;
    for (const v of m.bits) on += v;
    expect(on / (m.w * m.h)).toBeGreaterThan(0.05);
    expect(on / (m.w * m.h)).toBeLessThan(0.75);
  });

  it('sees the side view as a different shape from the front', () => {
    const body = build('mouse');
    const front = maskFromBody(body, { heightPx: 64, view: 'front' });
    const side = maskFromBody(body, { heightPx: 64, view: 'side' });
    // The mouse's ears make it far wider than it is deep; if these matched,
    // the view axis would not be wired through.
    expect(front.w).toBeGreaterThan(side.w);
  });

  it('renders to ASCII at a readable aspect', () => {
    const art = renderMask(maskFromBody(build('mouse'), { heightPx: 64 }), 20);
    const lines = art.split('\n');
    expect(lines[0]!.length).toBe(20);
    expect(lines.length).toBeGreaterThan(4);
    expect(art).toContain('#');
  });
});

describe('kit geometry', () => {
  // The goblin's kit: the mouse has none any more (its outfit is painted SDF).
  const kit = () => gltfTriangles(
    JSON.parse(new TextDecoder().decode(readFileSync('public/assets/lab/goblin-kit.gltf'))));

  it('reads triangles out of the compiled kit glTF', () => {
    const t = kit();
    expect(t.length % 9).toBe(0);
    expect(t.length / 9).toBeGreaterThan(100);
    // Bind space is rest world space: the goblin's kit sits on a standing
    // 1.30 m body, so its vertices lie between the floor and the crown. If
    // skinning were needed these would be nowhere near.
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < t.length; i += 3) { minY = Math.min(minY, t[i]!); maxY = Math.max(maxY, t[i]!); }
    expect(minY).toBeGreaterThan(-0.02);
    expect(maxY).toBeGreaterThan(0.5);
    expect(maxY).toBeLessThan(1.35);
  });

  // The bug this guards: a plate shows a DRESSED character, so scoring bare
  // flesh against it blames the sculpt for the clothes' bulk. Measured on the
  // mouse when it still had a kit, the shoe band went 0.132 -> 0.204 of body
  // height once the kit was in, against 0.345 on the plate.
  it('widens the silhouette where the clothes are', () => {
    const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/goblin.blob', 'utf8'));
    const body = buildBody(compileBlob(doc, compileFace(doc)));
    const bare = maskFromBody(body, { heightPx: 128 });
    const dressed = maskFromBody(body, { heightPx: 128, kit: kit() });
    let a = 0, b = 0;
    for (const v of bare.bits) a += v;
    for (const v of dressed.bits) b += v;
    expect(b / (dressed.w * dressed.h)).toBeGreaterThan(a / (bare.w * bare.h));
  });

  it('rejects a kit whose buffer is not embedded', () => {
    expect(() => gltfTriangles({
      buffers: [{ uri: 'kit.bin' }], bufferViews: [], accessors: [], meshes: [],
    })).toThrow(/data URI/);
  });
});

describe('the mouse against its own reference plate', () => {
  // This test was first written the other way round — pinning that the
  // shoes were LESS than 0.75 of the plate's width, "so a genuine fix trips
  // this test" — and on 2026-08-22 the painted SDF shoes tripped it: the shoe
  // band went from 0.132 of body height (flesh only) / 0.204 (kit) to 0.185
  // on the 0.85..1 window against the plate's ~0.17-0.35 profile. Now it pins
  // the fix: every band in the shoe window within 15% of the plate.
  it('has shoes that match the plate to within 15% in every band', () => {
    const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/mouse.blob', 'utf8'));
    // No kit: the mouse's shoes are painted SDF, part of the field itself.
    const got = maskFromBody(buildBody(compileBlob(doc, compileFace(doc))), { heightPx: 128 });
    const png = decodePng(readFileSync('docs/dev-notes/refs/mouse-reference.png'));
    const ref = maskFromRgba(png.rgba, png.width, png.height);
    const rep = compareSilhouette(ref.mask, got, { bands: 6, range: [0.88, 1] });
    for (const b of rep.bands)
      expect(Math.abs(b.delta) / b.refWidth, `band at ${b.at.toFixed(2)}`).toBeLessThan(0.15);
  });
});

describe('maskFromTriangles', () => {
  // A reference MESH has to become a mask on its own, without a body to hang
  // it on — that is the whole point of splitting the raster out of
  // maskFromBody, which can only union a kit onto flesh it already has.
  it('rasterises a bare triangle soup at its own aspect', () => {
    // A 0.2 x 0.4 quad, as two triangles, in the z = 0 plane.
    const tris = new Float32Array([
      0, 0, 0, 0.2, 0, 0, 0.2, 0.4, 0,
      0, 0, 0, 0.2, 0.4, 0, 0, 0.4, 0,
    ]);
    const m = maskFromTriangles(tris, { view: 'front', heightPx: 64, pad: 0 });
    expect(m.h).toBe(64);
    let on = 0;
    for (const v of m.bits) on += v;
    expect(on / (m.w * m.h)).toBeGreaterThan(0.95);
    expect(Math.abs(m.w / m.h - 0.5)).toBeLessThan(0.1);
  });
});

describe('bandOwners', () => {
  // Same grammar as build-body.test.ts's provenance fixture, cut down to the
  // two blobs under test: a fat DISC on the skull that swallows the face, and
  // a small blob low on the pelvis. Nothing else reaches either extreme, so
  // the top band can only be owned by the first and the bottom by the second.
  //
  // The disc is 0.6 in radius but 0.3 in `tall`, which makes its cluster
  // SPHERE reach ~0.4 m above any flesh — a deliberately loose superset, so a
  // band divided over the framing bounds instead of the subject box lands in
  // empty air and owns nothing.
  const SRC = `model t
skeleton
  root pelvis at 0.92
  bone spine parent=pelvis dir=up pitch=0 len=0.34
  bone skull parent=spine dir=up len=0.16

body
  blob torso on skull at=1.0 r=0.6 wide=1.0 tall=0.3 deep=0.4 blend=0.02
  blob torso on pelvis at=0.40 r=0.10 wide=1.0 blend=0.02
`;
  const discLine = 8, smallLine = 9;
  const doc = parseBlob(SRC);
  const body = buildBody(compileBlob(doc, compileFace(doc)));
  /** Index of the prim whose top is the top of the silhouette. */
  const topPrim = body.prims
    .map((p, i) => [i, Math.max(p.a[1], p.b[1]) + p.radius * p.scale[1]] as const)
    .reduce((a, b) => (b[1] > a[1] ? b : a))[0];

  it('names the primitive that forms each band of the outline', () => {
    expect(body.errors).toEqual([]);
    const owners = bandOwners(body, { view: 'front', bands: 4 });
    expect(owners.map(o => o.band)).toEqual([0, 1, 2, 3]);
    expect(owners[0]!.line).toBe(discLine);
    expect(owners[0]!.bone).toBe('skull');
    expect(owners[0]!.limb).toBe('torso');
    expect(owners[3]!.line).toBe(smallLine);
    expect(owners[3]!.bone).toBe('pelvis');
    expect(body.prims[owners[0]!.index]!.src).toBe(discLine);
  });

  it('takes its band heights from the SUBJECT, not the framing bounds', () => {
    const m = maskFromBody(body, { heightPx: 192 });
    const sb = subjectBounds(m)!;
    // The fixture only tests anything if the framing really is loose: a
    // quarter of the image must be empty air above the crown, which is where
    // band 0 would land if the cluster spheres set the band heights.
    expect(sb.y0 / m.h).toBeGreaterThan(0.15);

    const owners = bandOwners(body, { view: 'front', bands: 4 });
    const rep = compareSilhouette(m, m, { bands: 4 });
    for (let i = 0; i < 4; i++) expect(owners[i]!.at).toBeCloseTo(rep.bands[i]!.at, 6);
    // ...and the top band names the prim that actually forms the top of the
    // mask, rather than reporting the empty air above it.
    expect(owners[0]!.index).toBe(topPrim);
  });

  it('follows compareSilhouette into a height window', () => {
    const m = maskFromBody(body, { heightPx: 192 });
    const range: [number, number] = [0.25, 0.75];
    const owners = bandOwners(body, { bands: 4, range });
    const rep = compareSilhouette(m, m, { bands: 4, range });
    for (let i = 0; i < 4; i++) expect(owners[i]!.at).toBeCloseTo(rep.bands[i]!.at, 6);
    // A window is not the whole subject: these must NOT be the 0..1 bands.
    expect(owners[0]!.at).toBeGreaterThan(0.25);
  });

  it('says "kit" when the outline there is clothing rather than flesh', () => {
    // The goblin's shoes: the plate's widest point at the ankles is polygon,
    // and there is no primitive to blame for it.
    const doc2 = parseBlob(readFileSync('src/lab/sdf-zombie/characters/goblin.blob', 'utf8'));
    const goblin = buildBody(compileBlob(doc2, compileFace(doc2)));
    const k = gltfTriangles(
      JSON.parse(new TextDecoder().decode(readFileSync('public/assets/lab/goblin-kit.gltf'))));
    const dressed = bandOwners(goblin, { bands: 6, kit: k });
    expect(dressed.some(o => o.limb === 'kit')).toBe(true);
    for (const o of dressed) if (o.limb === 'kit') { expect(o.index).toBe(-1); expect(o.line).toBeNull(); }
    // Bare flesh can never be kit-owned, whatever the geometry does.
    expect(bandOwners(goblin, { bands: 6 }).some(o => o.limb === 'kit')).toBe(false);
  });
});
