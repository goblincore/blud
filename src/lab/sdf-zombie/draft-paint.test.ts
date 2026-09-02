// src/lab/sdf-zombie/draft-paint.test.ts
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:zlib available in vitest via happy-dom/node
import { deflateSync } from 'node:zlib';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync, existsSync } from 'node:fs';
import type { Vec3 } from './types';
import { readRefSkin } from './ref-skin';
import { detectRig, groupByBone, refBones } from './ref-align';
import type { MedialLine, Band } from './draft-fit';
import {
  bandColour, bodyPaint, readRefImage, inferStance, unmappedCloud,
  pairAsymmetry, type Rgb, type RgbImage, type PaintedPt,
} from './draft-paint';

// ---------------------------------------------------------------------------
// Fixtures. Synthetic where the measurement is the point; the real minotaur
// only for the two facts the plan pins to that mesh (the prosthetic pair and
// the unmapped head/hand clouds).

/** Pack a glTF JSON object plus a binary chunk into GLB container bytes.
 *  Same builder idiom as ref-skin.test.ts. */
function makeGlb(json: unknown, bin: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  let jsonBytes: Uint8Array = enc.encode(JSON.stringify(json));
  const padTo4 = (b: Uint8Array, filler: number) => {
    const pad = (4 - (b.length % 4)) % 4;
    if (pad === 0) return b;
    const out = new Uint8Array(b.length + pad);
    out.set(b); out.fill(filler, b.length);
    return out;
  };
  jsonBytes = padTo4(jsonBytes, 0x20);
  const binBytes = padTo4(bin, 0);
  const total = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binOff = 20 + jsonBytes.length;
  dv.setUint32(binOff, binBytes.length, true); dv.setUint32(binOff + 4, 0x004e4942, true);
  out.set(binBytes, binOff + 8);
  return out;
}

/** Builds a real 8-bit RGBA PNG (filter 0), so the texture path is tested
 *  against the format rather than a stub. Same idiom as png-decode.test.ts. */
function encodeRgbaPng(w: number, h: number, px: number[]): Uint8Array {
  const stride = w * 4;
  const raw = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = px[y * stride + x]!;
  }
  const idat = deflateSync(raw);
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    return out; // CRC left zero: the decoder does not verify it, by design
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0)),
  ];
  let n = 0; for (const p of parts) n += p.length;
  const buf = new Uint8Array(n);
  let at = 0; for (const p of parts) { buf.set(p, at); at += p.length; }
  return buf;
}

/** Binary chunk holding [data..., png] with 4-byte alignment, returning the
 *  byte offsets of every part (for bufferViews). */
function binChunk(parts: Uint8Array[]): { bin: Uint8Array; offs: number[] } {
  let off = 0; const offs: number[] = [];
  for (const p of parts) { offs.push(off); off += p.length + ((4 - (p.length % 4)) % 4); }
  const bin = new Uint8Array(off);
  parts.forEach((p, i) => bin.set(p, offs[i]!));
  return { bin, offs };
}

const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];

/** 2x1 image, red then blue: one texel each, so uv picks a colour exactly. */
function redBlueImage(): RgbImage {
  return { width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) };
}

/** Axis-aligned vertical medial line, hand-built — bandColour assigns points
 *  to bands by t along THIS, so the tests control membership directly rather
 *  than inheriting bandCloud's segmentation (already pinned in draft-fit). */
const LINE: MedialLine = { dir: [0, 1, 0], origin: [0, 0, 0], t0: -1, t1: 1, residual: 0 };

function band(t0: number, t1: number): Band {
  return { t0, t1, r: 0.1, wide: 1, deep: 1, rotated: 0, samples: 0 };
}

/** A painted point at height `y` sampling uv (null uv = the unpainted case). */
function pt(y: number, uv: readonly [number, number] | null): PaintedPt {
  return { position: [0, y, 0], uv };
}

describe('bandColour', () => {
  it('returns the dominant texel colour of a band', () => {
    // Two bands, each painted one flat colour through distinct uvs. The
    // dominant colour must come back EXACT (mean over identical texels), and
    // a single-paint band must not flag as a paint boundary.
    const pts: PaintedPt[] = [];
    for (let i = 0; i < 8; i++) pts.push(pt(-0.9 + i * 0.1, [0.25, 0.5])); // band 0: red
    for (let i = 0; i < 8; i++) pts.push(pt(0.1 + i * 0.1, [0.75, 0.5]));  // band 1: blue

    const paints = bandColour(pts, LINE, [band(-1, 0), band(0, 1)], redBlueImage());
    expect(paints).toHaveLength(2);
    expect(paints[0]!.color).toEqual(RED);
    expect(paints[1]!.color).toEqual(BLUE);
    for (const p of paints) {
      expect(p.samples).toBe(8);
      expect(p.split).toBe(0);
      expect(p.bimodal).toBe(false);
      expect(p.second).toBeUndefined();
    }
  });

  it('flags a BIMODAL band as a paint boundary', () => {
    // Half-ish the band's verts one colour, half another, INTERLEAVED in the
    // array (a mode must not depend on sample order). The draft must split
    // there — a paint boundary IS a primitive boundary in this format — so
    // the split measure must read large and name the second colour.
    const pts: PaintedPt[] = [];
    for (let i = 0; i < 16; i++) {
      pts.push(pt(i * 0.1, i % 2 === 0 ? [0.25, 0.5] : [0.75, 0.5]));
    }
    // 8 red + 8 blue is an exact tie; skew it one point so the dominant side
    // is decided by COUNT, not by map iteration order.
    pts[0] = pt(0, [0.75, 0.5]);

    const paints = bandColour(pts, LINE, [band(0, 2)], redBlueImage());
    const p = paints[0]!;
    expect(p.samples).toBe(16);
    // 7 of 16 sit outside the dominant colour: ~0.44, far over the bar.
    expect(p.split).toBeGreaterThan(0.4);
    expect(p.bimodal).toBe(true);
    expect(p.color).toEqual(BLUE);   // 9 blues dominate 8 reds
    expect(p.second).toEqual(RED);
  });
});

describe('bodyPaint', () => {
  it('means the body colour and spreads for the palette block', () => {
    // A half-red/half-blue body: the mean sits between the two, and the RMS
    // distance from that mean is material — that spread is what the palette
    // block's mottle comes off. A flat body must read spread ~0 so the draft
    // does not invent mottle that is not on the mesh.
    const mixed: PaintedPt[] = [];
    for (let i = 0; i < 8; i++) mixed.push(pt(i * 0.1, i % 2 === 0 ? [0.25, 0.5] : [0.75, 0.5]));
    const m = bodyPaint(mixed, redBlueImage());
    expect(m.samples).toBe(8);
    expect(m.mean![0]).toBeCloseTo(127.5, 0);
    expect(m.mean![1]).toBeCloseTo(0, 0);
    expect(m.mean![2]).toBeCloseTo(127.5, 0);
    // Every sample sits |[127.5, 0, 127.5]| = ~180 from the mean.
    expect(m.spread).toBeGreaterThan(150);

    const flat: PaintedPt[] = [];
    for (let i = 0; i < 8; i++) flat.push(pt(i * 0.1, [0.25, 0.5]));
    const f = bodyPaint(flat, redBlueImage());
    expect(f.mean).toEqual(RED);
    expect(f.spread).toBeLessThan(1);
  });
});

describe('readRefImage', () => {
  it('reaches the texture THROUGH the primitive material, not image 0', () => {
    // The trap: a GLB can carry several images. The colour pass must sample
    // the one the SKINNED PRIMITIVE's material names — grabbing images[0]
    // would read plausible-looking garbage on any file where a decal or an
    // ORM map ships first.
    const png = encodeRgbaPng(2, 1, [255, 0, 0, 255, 0, 0, 255, 255]);
    const decoy = encodeRgbaPng(1, 1, [1, 2, 3, 255]);
    const { bin, offs } = binChunk([new Uint8Array([9, 9, 9, 9]), png, decoy]);
    const glb = makeGlb({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }], scene: 0,
      nodes: [{ name: 'MeshNode', mesh: 0, skin: 0 }],
      skins: [{ joints: [0] }],
      meshes: [{
        primitives: [{
          attributes: { POSITION: 0 },
          material: 0,
        }],
      }],
      materials: [
        // material 0 IS the primitive's: texture 0 -> image 1, the red/blue
        // atlas. image 0 is a decoy shipping FIRST in the file that must NOT
        // be read — an implementation that grabs images[0] decodes 1x1 [1,2,3]
        // and fails the assertions below.
        { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
      ],
      textures: [{ source: 1 }, { source: 0 }],
      images: [{ mimeType: 'image/png', bufferView: 2 }, { mimeType: 'image/png', bufferView: 1 }],
      buffers: [{ byteLength: bin.length }],
      bufferViews: [
        { buffer: 0, byteOffset: offs[0], byteLength: 4 },
        { buffer: 0, byteOffset: offs[1], byteLength: png.length },
        { buffer: 0, byteOffset: offs[2], byteLength: decoy.length },
      ],
      accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }],
    }, bin);

    const img = readRefImage(glb);
    expect(img).not.toBeNull();
    expect([img!.width, img!.height]).toEqual([2, 1]);
    expect([...img!.rgba.slice(0, 8)]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });

  it('returns null when the primitive carries no texture', () => {
    // An untextured reference is not an error — the draft simply cannot
    // paint, and reports that — so absence must come back as null, not a
    // thrown decode of some unrelated buffer.
    const { bin, offs } = binChunk([new Uint8Array([1, 2, 3, 4])]);
    const glb = makeGlb({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }], scene: 0,
      nodes: [{ name: 'MeshNode', mesh: 0, skin: 0 }],
      skins: [{ joints: [0] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      materials: [{ pbrMetallicRoughness: {} }],
      buffers: [{ byteLength: bin.length }],
      bufferViews: [{ buffer: 0, byteOffset: offs[0], byteLength: 4 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }],
    }, bin);
    expect(readRefImage(glb)).toBeNull();
  });
});

describe('inferStance', () => {
  // A splayed leg, so "forward" has to be measured perpendicular to the
  // hip-ankle line, not read off a vertical: the line runs hip
  // [0.10, 1, 0] -> ankle [0.20, 0, -0.05], i.e. it drifts +x and -z.
  const HIP: Vec3 = [0.1, 1, 0];
  const ANKLE: Vec3 = [0.2, 0, -0.05];

  it('calls a knee forward of the hip-ankle line humanoid', () => {
    // Knee at mid-line height, pushed toward +z — the sign convention is the
    // rig's own: Meshy rigs face +z (the minotaur's toes and headfront joint
    // both sit +z of their centres), so +z is forward.
    const fit = inferStance(HIP, [0.13, 0.5, 0.06], ANKLE);
    expect(fit.stance).toBe('humanoid');
    expect(fit.forwardOffset).toBeGreaterThan(0);
  });

  it('calls a knee behind it digitigrade', () => {
    const fit = inferStance(HIP, [0.13, 0.5, -0.11], ANKLE);
    expect(fit.stance).toBe('digitigrade');
    expect(fit.forwardOffset).toBeLessThan(0);
  });
});

describe('unmappedCloud', () => {
  // MESHY_BIPED maps no .blob bone to Head/LeftHand/RightHand, so
  // groupByBone reports them in `unmapped` as COUNTS with no points. The
  // draft still needs a cranium mass and hand masses (blob:rings never did —
  // ring-fit explicitly cannot see the head or hands), so the clouds must be
  // readable off the skin directly, by joint name.
  const skin = {
    verts: [
      { joint: 'Head', position: [0, 1.0, 0] as Vec3 },
      { joint: 'Head', position: [0.02, 1.1, 0.01] as Vec3 },
      { joint: 'Head', position: [-0.01, 1.05, -0.02] as Vec3 },
      { joint: 'LeftHand', position: [0.3, 0.9, 0] as Vec3 },
      { joint: 'RightHand', position: [-0.3, 0.9, 0] as Vec3 },
      { joint: 'Hips', position: [0, 0.5, 0] as Vec3 },
    ],
    jointWorld: new Map(), total: 6, dropped: 0,
  };

  it('returns the Head cloud, which groupByBone does NOT map', () => {
    const head = unmappedCloud(skin, 'Head');
    expect(head).toHaveLength(3);
    expect(head[0]).toEqual([0, 1.0, 0]);
  });

  it('returns both hand clouds', () => {
    // One mass each — no fingers are derivable (the rig lumps the whole hand
    // into one joint), so a sized mitten is the honest output.
    expect(unmappedCloud(skin, 'LeftHand')).toHaveLength(1);
    expect(unmappedCloud(skin, 'RightHand')).toHaveLength(1);
  });
});

describe('asymmetry', () => {
  function mirrorPair(): [Vec3[], Vec3[]] {
    // A truly mirrored pair: same counts, same radius, reflected in x. The
    // radius is measured about each cloud's OWN medial line, so the mirror
    // must not matter — only a genuine size/count difference may.
    const one: Vec3[] = [];
    for (let i = 0; i < 12; i++) {
      const t = -0.5 + i / 11;
      for (let j = 0; j < 8; j++) {
        const th = (2 * Math.PI * j) / 8;
        one.push([0.3 + 0.05 * Math.cos(th), t, 0.05 * Math.sin(th)]);
      }
    }
    const other = one.map((p) => [-p[0], p[1], p[2]] as Vec3);
    return [one, other];
  }

  it('reports LOW for a mirrored pair', () => {
    const [l, r] = mirrorPair();
    const a = pairAsymmetry(l, r);
    expect(a.mirrorable).toBe(true);
    expect(a.score).toBeLessThan(0.05);
    expect(a.countSkew).toBe(0);
  });

  it('reports HIGH for the minotaur prosthetic pair', () => {
    // Real mesh: shin.r carries 18,032 verts against shin.l's 6,724 — the
    // case that motivated side=l|r. It must be DETECTED, not mirrored away.
    const bytes = new Uint8Array(readFileSync('docs/dev-notes/refs/minotaur-mesh/minotaur.glb'));
    const skin = readRefSkin(bytes);
    const rig = detectRig([...skin.jointWorld.keys()]);
    const { byBone } = groupByBone(skin, rig);
    const a = pairAsymmetry(byBone.get('shin.l')!, byBone.get('shin.r')!);
    expect(byBone.get('shin.l')).toHaveLength(6724);
    expect(byBone.get('shin.r')).toHaveLength(18032);
    expect(a.mirrorable).toBe(false);
    // The count alone (skew 0.627) already clears the bar; the pair's
    // armoured radius (0.252 skew) corroborates. Pin the combined score
    // below the NEXT-most-asymmetric pair on the same mesh (thigh, 0.344)
    // so the bar cannot silently drift down until nothing is special.
    expect(a.score).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// Integration: the whole Task 8 surface against the mesh the plan's facts
// were measured on. Skipped (rather than failing) only where the committed
// reference mesh is absent — same guard as ring-fit.test.ts.

const MINOTAUR_GLB = 'docs/dev-notes/refs/minotaur-mesh/minotaur.glb';

describe.skipIf(!existsSync(MINOTAUR_GLB))('integration: minotaur', () => {
  function run() {
    const skin = readRefSkin(new Uint8Array(readFileSync(MINOTAUR_GLB)));
    const rig = detectRig([...skin.jointWorld.keys()]);
    return { skin, rig, gb: groupByBone(skin, rig), bones: refBones(skin.jointWorld, rig) };
  }

  it('reads humanoid stance off both real legs', () => {
    const { bones } = run();
    for (const s of ['l', 'r'] as const) {
      const fit = inferStance(
        bones.get(`thigh.${s}`)!.head,
        bones.get(`shin.${s}`)!.head,
        bones.get(`shin.${s}`)!.tail,
      );
      expect(fit.stance).toBe('humanoid');
      // Measured ~0.085 on both legs: a real margin, not a sign lucky hit.
      expect(fit.forwardOffset).toBeGreaterThan(0.03);
    }
  });

  it('reproduces the unmapped counts as real clouds, and separates the prosthetic from the mirrored pairs', () => {
    const { skin, gb } = run();
    // Plan fact 6, as pins: these joints are UNMAPPED — groupByBone carries
    // only counts for them — and the clouds must agree with those counts.
    for (const j of ['Head', 'LeftHand', 'RightHand']) {
      expect(gb.unmapped.get(j)).toBeGreaterThan(0);
      expect(unmappedCloud(skin, j)).toHaveLength(gb.unmapped.get(j)!);
    }
    expect(gb.unmapped.get('Head')).toBe(7354);

    // Within ONE mesh: the prosthetic shin reads HIGH while the merely
    // hand-sculpted pairs (all skews 0.21-0.36 on this mesh) stay LOW —
    // the bar separates the prosthetic from ordinary asymmetry.
    const shin = pairAsymmetry(gb.byBone.get('shin.l')!, gb.byBone.get('shin.r')!);
    expect(shin.mirrorable).toBe(false);
    const upper = pairAsymmetry(gb.byBone.get('upperarm.l')!, gb.byBone.get('upperarm.r')!);
    expect(upper.mirrorable).toBe(true);
    expect(upper.score).toBeLessThan(0.4);
  });
});
