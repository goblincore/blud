// src/lab/sdf-zombie/blob-face-sheet.test.ts
import { describe, it, expect } from 'vitest';
import { generateFaceSheet, DEFAULT_SHEET, type FaceSheetParams } from './blob-face-sheet';

/** Greyscale value at a uv position, for asserting a feature landed somewhere. */
const at = (s: ReturnType<typeof generateFaceSheet>, u: number, v: number) =>
  s.pixels[Math.floor(v * s.size) * s.size + Math.floor(u * s.size)]!;

describe('generateFaceSheet', () => {
  it('fills the whole buffer at the requested size', () => {
    const s = generateFaceSheet(DEFAULT_SHEET, 64);
    expect(s.pixels).toHaveLength(64 * 64);
    expect(s.size).toBe(64);
  });

  // The mean is what the shader divides out. A hardcoded or stale value shifts
  // the entire head's brightness, so it has to come off the pixels produced.
  it('measures the mean off its own pixels rather than assuming one', () => {
    const s = generateFaceSheet(DEFAULT_SHEET, 64);
    const actual = s.pixels.reduce((n, b) => n + b, 0) / (64 * 64 * 255);
    expect(s.mean).toBeCloseTo(actual, 10);
    expect(s.mean).toBeGreaterThan(0.2);
    expect(s.mean).toBeLessThan(0.95);
  });

  it('is deterministic for a seed, and different across seeds', () => {
    const a = generateFaceSheet({ ...DEFAULT_SHEET, seed: 7 });
    const b = generateFaceSheet({ ...DEFAULT_SHEET, seed: 7 });
    const c = generateFaceSheet({ ...DEFAULT_SHEET, seed: 8 });
    expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
    expect(Array.from(a.pixels)).not.toEqual(Array.from(c.pixels));
  });

  // The eyes are the one feature that LIGHTENS, because the shader's emissive
  // mask is smoothstep(threshold, 1, luma(tex)) — brightness is what glows.
  // This test was originally written the other way round, asserting the eyes
  // were darker; the generated face then lit up red across its whole surface,
  // because a bright base cleared the glow threshold everywhere. Keep the
  // direction of this assertion.
  it('puts the eyes BRIGHTER than the cheek beside them, so they key the glow', () => {
    const s = generateFaceSheet({ ...DEFAULT_SHEET, grain: 0 });
    const eye = at(s, 0.5 - DEFAULT_SHEET.eyeGap / 2, DEFAULT_SHEET.eyeRise);
    const cheek = at(s, 0.5 - DEFAULT_SHEET.eyeGap / 2, DEFAULT_SHEET.eyeRise + 0.18);
    expect(eye).toBeGreaterThan(cheek + 60);
  });

  // Everything that is not an eye must sit BELOW the glow threshold, or the
  // face glows in patches. The zombie sheet's measured mean is 0.406; a
  // generated sheet that drifts far above that is bright enough to bloom.
  it('keeps the sheet dark overall so only the eyes can glow', () => {
    const s = generateFaceSheet(DEFAULT_SHEET);
    expect(s.mean).toBeLessThan(0.6);
    const bright = [...s.pixels].filter(b => b > 200).length;
    expect(bright / s.pixels.length).toBeLessThan(0.06);
  });

  it('puts a bright catchlight in each eye when eyeGlint is on, and none when off', () => {
    // The glint is drawn at eyeDX + 0.32*eyeSize in u, eyeRise - 0.34*eyeSize
    // in v (upper-outer corner); the opposite (lower-inner) corner stays dark.
    const e = DEFAULT_SHEET.eyeSize;
    const u = 0.5 + DEFAULT_SHEET.eyeGap / 2;
    const on = generateFaceSheet({ ...DEFAULT_SHEET, eyeGlow: 0.05, eyeGlint: 0.82, grain: 0 });
    const glint = at(on, u + 0.32 * e, DEFAULT_SHEET.eyeRise - 0.34 * e);
    const dark = at(on, u - 0.30 * e, DEFAULT_SHEET.eyeRise + 0.20 * e);
    expect(glint).toBeGreaterThan(dark + 40);
    // With glint off the same upper-outer corner stays as dark as the eye.
    const off = generateFaceSheet({ ...DEFAULT_SHEET, eyeGlow: 0.05, eyeGlint: 0, grain: 0 });
    expect(at(off, u + 0.32 * e, DEFAULT_SHEET.eyeRise - 0.34 * e)).toBeLessThan(60);
  });

  it('puts the mouth darker than the chin below it', () => {
    const s = generateFaceSheet({ ...DEFAULT_SHEET, grain: 0 });
    const mouth = at(s, 0.5, DEFAULT_SHEET.mouthRise);
    const chin = at(s, 0.5, Math.min(0.97, DEFAULT_SHEET.mouthRise + 0.15));
    expect(mouth).toBeLessThan(chin - 20);
  });

  it('is symmetric about the vertical axis once grain is off', () => {
    const s = generateFaceSheet({ ...DEFAULT_SHEET, grain: 0 }, 64);
    for (let y = 0; y < 64; y += 7)
      for (let x = 0; x < 32; x += 5)
        expect(s.pixels[y * 64 + x]).toBe(s.pixels[y * 64 + (63 - x)]);
  });

  // Grain exists so the two halves are not identical — a perfectly symmetric
  // face reads as a mask rather than a creature.
  it('breaks that symmetry once grain is on', () => {
    const s = generateFaceSheet({ ...DEFAULT_SHEET, grain: 0.2 }, 64);
    let differing = 0;
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 32; x++)
        if (s.pixels[y * 64 + x] !== s.pixels[y * 64 + (63 - x)]) differing++;
    expect(differing).toBeGreaterThan(64 * 32 * 0.5);
  });

  it('removes a feature entirely when its amplitude is zero', () => {
    // jawShade off too: it darkens a band near the chin, which is exactly
    // where this samples. A feature being removable is the property under
    // test, so every feature overlapping the probe has to be off.
    const off: FaceSheetParams = {
      ...DEFAULT_SHEET, grain: 0, mouthOpen: 0, nostril: 0, jawShade: 0, noseRidge: 0,
    };
    const s = generateFaceSheet(off);
    const mouth = at(s, 0.5, DEFAULT_SHEET.mouthRise);
    const chin = at(s, 0.5, Math.min(0.97, DEFAULT_SHEET.mouthRise + 0.15));
    expect(Math.abs(mouth - chin)).toBeLessThan(3);
  });

  it('darkens the brow band as browHeavy rises', () => {
    const browAt = (h: number) => {
      const s = generateFaceSheet({ ...DEFAULT_SHEET, grain: 0, browHeavy: h });
      return at(s, 0.5 - DEFAULT_SHEET.eyeGap / 2, DEFAULT_SHEET.eyeRise - 0.085);
    };
    expect(browAt(0.9)).toBeLessThan(browAt(0.1) - 20);
  });

  it('never produces a value outside a byte', () => {
    const wild = generateFaceSheet({
      ...DEFAULT_SHEET, grain: 5, browHeavy: 9, nostril: 9, eyeSize: 0.4,
    });
    for (const b of wild.pixels) expect(b).toBeGreaterThanOrEqual(0), expect(b).toBeLessThanOrEqual(255);
  });
});

import { sheetToRgba } from './blob-face-sheet';

describe('eyeLid', () => {
  const GLOW = 224; // 0.88 * 255: the shader's emissive threshold
  const lit = (s: ReturnType<typeof generateFaceSheet>) => s.pixels.reduce((n, b) => n + (b >= GLOW ? 1 : 0), 0);

  it('defaults to 0, and a closed lid shrinks the lit eye without removing it', () => {
    expect(DEFAULT_SHEET.eyeLid).toBe(0);
    const open = generateFaceSheet(DEFAULT_SHEET);
    const shut = generateFaceSheet({ ...DEFAULT_SHEET, eyeLid: 0.9 });
    expect(lit(open)).toBeGreaterThan(0);
    expect(lit(shut)).toBeGreaterThan(0);
    expect(lit(shut)).toBeLessThan(lit(open));
  });

  it('eyeLid 0 is the same sheet as before the param existed', () => {
    const a = generateFaceSheet(DEFAULT_SHEET);
    const b = generateFaceSheet({ ...DEFAULT_SHEET, eyeLid: 0 });
    expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
  });
});

describe('sheetToRgba', () => {
  it('writes four equal channels, opaque, rows flipped so the buffer reads bottom-up', () => {
    const s = generateFaceSheet(DEFAULT_SHEET, 16);
    const rgba = sheetToRgba(s);
    expect(rgba).toHaveLength(16 * 16 * 4);
    for (const [x, y] of [[0, 0], [5, 3], [15, 15]] as const) {
      const src = s.pixels[(15 - y) * 16 + x]!;
      const o = (y * 16 + x) * 4;
      expect([rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]]).toEqual([src, src, src, 255]);
    }
  });

  it('fills a caller-supplied buffer in place', () => {
    const s = generateFaceSheet(DEFAULT_SHEET, 16);
    const buf = new Uint8Array(16 * 16 * 4);
    expect(sheetToRgba(s, buf)).toBe(buf);
    expect(buf[3]).toBe(255);
  });
});

// GOBLIN EXPRESSIONS TASK 15 (the smile's eyes): `eyeCheek` (the cheek pushes the lower lid up into an arch) and `browDrop`
// (the painted brow slides toward the eye). Both default to 0 and must leave every authored sheet bit-identical.
import { compileSheet } from './blob-compile';
import { parseBlob } from './blob-parse';

describe('eyeCheek and browDrop (Task 15)', () => {
  const GLOW = 224;
  const litPx = (s: ReturnType<typeof generateFaceSheet>) => {
    const out: Array<[number, number]> = [];
    s.pixels.forEach((b, i) => { if (b >= GLOW) out.push([i % s.size, Math.floor(i / s.size)]); });
    return out;
  };
  const flat: FaceSheetParams = { ...DEFAULT_SHEET, grain: 0 };

  it('default to 0', () => {
    expect(DEFAULT_SHEET.eyeCheek).toBe(0);
    expect(DEFAULT_SHEET.browDrop).toBe(0);
    expect(DEFAULT_SHEET.eyeLidTop).toBe(0);
  });

  it('eyeCheek eats the eye from BELOW: fewer lit texels, the top edge kept, the lit centroid higher', () => {
    const open = litPx(generateFaceSheet(flat, 128));
    const cheek = litPx(generateFaceSheet({ ...flat, eyeCheek: 0.6 }, 128));
    expect(cheek.length).toBeGreaterThan(0);
    expect(cheek.length).toBeLessThan(open.length * 0.75);
    const top = (px: Array<[number, number]>) => Math.min(...px.map(p => p[1]));
    const meanY = (px: Array<[number, number]>) => px.reduce((n, p) => n + p[1], 0) / px.length;
    expect(top(cheek)).toBe(top(open));          // the upper lid did not move
    expect(meanY(cheek)).toBeLessThan(meanY(open)); // what is left sits higher: the lower lid rose
  });

  it('eyeCheek shrinks the eye monotonically', () => {
    const n = [0, 0.3, 0.6, 1].map(c => litPx(generateFaceSheet({ ...flat, eyeCheek: c }, 128)).length);
    for (let i = 1; i < n.length; i++) expect(n[i]!).toBeLessThan(n[i - 1]!);
  });

  it('eyeCheek arches the lower lid: the middle of the eye loses more height than its sides', () => {
    // Column heights of lit texels across the left eye, rest vs cheek: the drop is largest at the eye's centre column.
    const size = 128;
    const colHeight = (s: ReturnType<typeof generateFaceSheet>, u: number) => {
      const x = Math.floor(u * size);
      let n = 0;
      for (let y = 0; y < size; y++) if (s.pixels[y * size + x]! >= GLOW) n++;
      return n;
    };
    const rest = generateFaceSheet({ ...flat, eyeTilt: 0 }, size);
    const cheek = generateFaceSheet({ ...flat, eyeTilt: 0, eyeCheek: 0.7 }, size);
    const cx = 0.5 - DEFAULT_SHEET.eyeGap / 2;
    const side = DEFAULT_SHEET.eyeSize * 0.6;
    const loss = (u: number) => colHeight(rest, u) - colHeight(cheek, u);
    expect(loss(cx)).toBeGreaterThan(loss(cx - side));
    expect(loss(cx)).toBeGreaterThan(loss(cx + side));
  });

  it('eyeLidTop eats the eye from ABOVE, more at the inner corner: the bottom kept, the inner side shorter than the outer', () => {
    const size = 128;
    const f = { ...flat, eyeTilt: 0 };
    const open = litPx(generateFaceSheet(f, size));
    const top = litPx(generateFaceSheet({ ...f, eyeLidTop: 0.5 }, size));
    expect(top.length).toBeGreaterThan(0);
    expect(top.length).toBeLessThan(open.length * 0.8);
    const bottom = (px: Array<[number, number]>) => Math.max(...px.map(p => p[1]));
    expect(bottom(top)).toBe(bottom(open));
    // Left eye (x < 0.5): its inner corner is the right-hand side.
    const cx = 0.5 - DEFAULT_SHEET.eyeGap / 2, side = DEFAULT_SHEET.eyeSize * 0.55;
    const colH = (px: Array<[number, number]>, u: number) => px.filter(p => p[0] === Math.floor(u * size)).length;
    expect(colH(top, cx + side)).toBeLessThan(colH(top, cx - side));
  });

  it('browDrop moves the brow band down the sheet', () => {
    const browRow = (drop: number) => {
      const s = generateFaceSheet({ ...flat, browDrop: drop, eyeSize: 0, noseRidge: 0, nostril: 0, mouthOpen: 0, jawShade: 0 }, 128);
      const x = Math.floor((0.5 - DEFAULT_SHEET.eyeGap / 2) * 128);
      let best = 0, dark = 255;
      for (let y = 0; y < 128; y++) { const b = s.pixels[y * 128 + x]!; if (b < dark) { dark = b; best = y; } }
      return best / 128;
    };
    expect(browRow(0.03)).toBeGreaterThan(browRow(0) + 0.02);
  });

  // TASK 19 (the evil grin's furrow): `browFurrow` paints two short vertical creases between the brows, above the nose bridge, and
  // pulls the painted brows' inner ends down toward them. Default 0: every authored sheet bit-identical (the FNV pins below).
  describe('browFurrow (Task 19)', () => {
    const size = 128;
    const bare: FaceSheetParams = { ...flat, eyeSize: 0, noseRidge: 0, nostril: 0, mouthOpen: 0, jawShade: 0 };
    const px = (s: ReturnType<typeof generateFaceSheet>, u: number, v: number) =>
      s.pixels[Math.floor(v * size) * size + Math.floor(u * size)]!;
    // The glabella: between the brows' inner ends and above the nose bridge.
    const eyeY = DEFAULT_SHEET.eyeRise;
    const rows = Array.from({ length: 6 }, (_, k) => eyeY - 0.10 + k * 0.01);

    it('defaults to 0, and 0 is the sheet without it', () => {
      expect(DEFAULT_SHEET.browFurrow).toBe(0);
      expect(Array.from(generateFaceSheet({ ...DEFAULT_SHEET, browFurrow: 0 }).pixels))
        .toEqual(Array.from(generateFaceSheet(DEFAULT_SHEET).pixels));
    });

    it('paints two vertical creases either side of the midline: darker than the skin between them and than the rest sheet', () => {
      const off = generateFaceSheet(bare, size), on = generateFaceSheet({ ...bare, browFurrow: 1 }, size);
      for (const v of rows) for (const side of [-1, 1]) {
        const crease = 0.5 + side * 0.026;
        expect(px(on, crease, v), `v ${v} side ${side}`).toBeLessThan(px(off, crease, v) - 40);
        expect(px(on, crease, v), `v ${v} side ${side}: a crease, not one dark patch`).toBeLessThan(px(on, 0.5, v) - 40);
      }
    });

    it('the creases are short: nothing changes well above the brows or below the nose bridge', () => {
      const off = generateFaceSheet(bare, size), on = generateFaceSheet({ ...bare, browFurrow: 1 }, size);
      for (const v of [eyeY - 0.22, eyeY + 0.06, eyeY + 0.15])
        for (const u of [0.474, 0.5, 0.526]) expect(px(on, u, v), `u ${u} v ${v}`).toBe(px(off, u, v));
    });

    it('pulls the painted brows\' inner ends down (the outer ends stay)', () => {
      const browRow = (furrow: number, sx: number) => {
        const s = generateFaceSheet({ ...bare, browFurrow: furrow }, size);
        const x = Math.floor((0.5 - sx) * size);
        let best = 0, dark = 255;
        for (let y = 0; y < Math.floor(eyeY * size); y++) { const b = s.pixels[y * size + x]!; if (b < dark) { dark = b; best = y; } }
        return best / size;
      };
      const inner = DEFAULT_SHEET.eyeGap / 2 - 0.06, outer = DEFAULT_SHEET.eyeGap / 2 + 0.08;
      expect(browRow(1, inner)).toBeGreaterThan(browRow(0, inner) + 0.012);
      expect(Math.abs(browRow(1, outer) - browRow(0, outer))).toBeLessThan(0.008);
    });

    it('is monotonic: more furrow, darker creases', () => {
      const at = (f: number) => px(generateFaceSheet({ ...bare, browFurrow: f }, size), 0.526, eyeY - 0.07);
      expect(at(0.5)).toBeLessThan(at(0));
      expect(at(1)).toBeLessThan(at(0.5));
    });
  });

  // Hashes of every character's generated sheet taken BEFORE eyeCheek/browDrop existed (FNV-1a over the 64x64 pixels).
  it('every authored sheet is bit-identical to before the params existed', () => {
    const RAW = import.meta.glob('./characters/*.blob', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const fnv = (b: Uint8Array) => {
      let h = 0x811c9dc5;
      for (const x of b) { h ^= x; h = Math.imul(h, 0x01000193) >>> 0; }
      return h.toString(16).padStart(8, '0');
    };
    // goblin-home (PR #47) copies the goblin's sheet block, so it renders the goblin's sheet exactly; goblin-cinematic-home the cinematic's.
    const PINNED: Record<string, string> = {
      DEFAULT: '4a05bb6b', 'clown.blob': 'c165a082', 'clown-alt.blob': 'c165a082', 'cyclops.blob': '2e2a5e7e',
      'goblin.blob': 'a004a128', 'goblin-home.blob': 'a004a128', 'goblin-cinematic.blob': '56d68e7f', 'goblin-cinematic-home.blob': '56d68e7f', 'mouse.blob': 'd07a38f1',
    };
    expect(fnv(generateFaceSheet(DEFAULT_SHEET).pixels)).toBe(PINNED.DEFAULT);
    for (const [path, src] of Object.entries(RAW)) {
      const s = compileSheet(parseBlob(src));
      if (!s || s.decal >= 0.5) continue;
      const name = path.replace('./characters/', '');
      expect(fnv(generateFaceSheet(s).pixels), name).toBe(PINNED[name] ?? PINNED.DEFAULT);
    }
  });
});
