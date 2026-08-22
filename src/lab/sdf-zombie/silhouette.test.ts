// src/lab/sdf-zombie/silhouette.test.ts
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import {
  maskFromRgba, maskFromBody, subjectBounds, normalise, compareSilhouette,
  renderMask, gltfTriangles, type Mask,
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
  const kit = () => gltfTriangles(
    JSON.parse(new TextDecoder().decode(readFileSync('public/assets/lab/mouse-kit.gltf'))));

  it('reads triangles out of the compiled kit glTF', () => {
    const t = kit();
    expect(t.length % 9).toBe(0);
    expect(t.length / 9).toBeGreaterThan(100);
    // Bind space is rest world space: the soles sit on y=0 and the kit stops
    // below the ears. If skinning were needed these would be nowhere near.
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < t.length; i += 3) { minY = Math.min(minY, t[i]!); maxY = Math.max(maxY, t[i]!); }
    expect(minY).toBeGreaterThan(-0.01);
    expect(minY).toBeLessThan(0.01);
    expect(maxY).toBeGreaterThan(0.5);
  });

  // The bug this guards: a plate shows a DRESSED character, so scoring bare
  // flesh against it blames the sculpt for the clothes' bulk. Measured on the
  // mouse, the shoe band goes 0.132 -> 0.204 of body height once the kit is
  // in, against 0.345 on the plate.
  it('widens the silhouette where the clothes are', () => {
    const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/mouse.blob', 'utf8'));
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
  // The finding this whole module was built to make legible, pinned so a
  // future proportion pass cannot quietly undo it: the mouse's shoes are less
  // than HALF the width the reference's are, measured below the arms where the
  // two poses agree. Loosened to 0.75 of reference width so a genuine fix
  // trips this test and a rounding change does not.
  it('still has shoes far narrower than the plate', () => {
    const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/mouse.blob', 'utf8'));
    const got = maskFromBody(buildBody(compileBlob(doc, compileFace(doc))), { heightPx: 128 });
    const png = decodePng(readFileSync('docs/dev-notes/refs/mouse-reference.png'));
    const ref = maskFromRgba(png.rgba, png.width, png.height);
    const rep = compareSilhouette(ref.mask, got, { bands: 6, range: [0.85, 1] });
    const worst = rep.worst[0]!;
    expect(worst.delta).toBeLessThan(0);
    expect(worst.gotWidth).toBeLessThan(worst.refWidth * 0.75);
  });
});
