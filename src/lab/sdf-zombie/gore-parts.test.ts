import { describe, it, expect } from 'vitest';
import {
  MEAT_VARIANTS, BONE_VARIANTS, meatChunkMesh, classicBoneMesh, meatFields,
  boneBloodField, paintPart, bloodField, cutLimitOf, chunkStepOf, isOrgan, ORGAN_VARIANTS,
  type PartMesh, type MeatVariant, type BoneVariant,
} from './gore-parts';
import type { ChunkLook } from './chunk-bake-field';
import type { Vec3 } from './types';

/** A plausible zombie look — the same fields the actor's view uniforms carry. */
const LOOK: ChunkLook = {
  baseColor: [0.62, 0.5, 0.46], deepColor: [0.42, 0.16, 0.16], fatColor: [0.78, 0.72, 0.6],
  mottleColor: [0.5, 0.42, 0.4], organColor: [0.4, 0.2, 0.22], visceraColor: [0.34, 0.14, 0.16],
  woundDepthAmp: 1, fatDepth: 0.05, muscleDepth: 0.16, visceraAmp: 0.6, visceraDepth: 0.3,
  mottleAmp: 0.3, mottleScale: 3, organAmp: 0.5, goreStrength: 1,
};

function bounds(m: PartMesh) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, m.positions[i + k]!);
      hi[k] = Math.max(hi[k]!, m.positions[i + k]!);
    }
  }
  return { lo, hi, extent: [0, 1, 2].map(k => hi[k]! - lo[k]!) };
}

/** Every index must address a real vertex, and no triangle may be degenerate —
 *  a mesh with a bad index renders as a hole or crashes the upload. */
function checkWellFormed(m: PartMesh, label: string): void {
  const verts = m.positions.length / 3;
  expect(m.positions.length % 3, `${label}: positions not in threes`).toBe(0);
  expect(m.indices.length % 3, `${label}: indices not in threes`).toBe(0);
  for (const i of m.indices) {
    expect(i, `${label}: index ${i} out of range (${verts} verts)`).toBeLessThan(verts);
    expect(i).toBeGreaterThanOrEqual(0);
  }
  expect(verts).toBeGreaterThan(20);
  for (const v of m.positions) expect(Number.isFinite(v), `${label}: non-finite vertex`).toBe(true);
}

describe('meat chunks', () => {
  it('every variant is well formed and sized by its scale', () => {
    for (const v of MEAT_VARIANTS) {
      const m = meatChunkMesh(v, 0.1, 7);
      checkWellFormed(m, v);
      const { extent } = bounds(m);
      // A 0.1 m nominal radius must produce a part of that order — not 10x, and
      // not a speck. The variants have different silhouettes but all are
      // roughly the size they were asked for.
      expect(Math.max(...extent)).toBeGreaterThan(0.08);
      expect(Math.max(...extent)).toBeLessThan(0.42);
      expect(m.radius).toBeGreaterThan(0.05);
      expect(m.radius).toBeLessThan(0.3);
    }
  });

  it('is CHUNKY: quantized onto a grid, so faces are flat and irregular', () => {
    // The whole point of the request. A smooth shell has an unbounded number of
    // distinct vertex radii; a quantized one has few, and its faces are not all
    // the same size. Checked on the radius RATIO spread, which a sphere keeps
    // tight and a lumpy chunk does not.
    const m = meatChunkMesh('blob', 0.1, 3);
    const radii: number[] = [];
    for (let i = 0; i < m.positions.length; i += 3) {
      radii.push(Math.hypot(m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!));
    }
    const min = Math.min(...radii), max = Math.max(...radii);
    // "Too rounded" was the owner's verdict on the first pass, so the spread of
    // radii is asserted hard: a shell that is not aggressively terraced cannot
    // reach this ratio.
    expect(max / min).toBeGreaterThan(1.6);
    // Quantization is on each AXIS, so check the coordinate lattice directly —
    // for the variants that are not BENT (a bend maps lattice points off the
    // lattice by construction, which is correct and not a defect).
    const step = chunkStepOf('blob', 0.1);
    for (let i = 0; i < m.positions.length; i++) {
      const q = m.positions[i]! / step;
      expect(Math.abs(q - Math.round(q))).toBeLessThan(1e-6);
    }
  });

  it('a CUT variant has a flat sliced side; an uncut one does not', () => {
    // 'wedge' slices axis 0 at 0.62 of the radius; 'blob' has no cut. A sliced
    // part has many vertices sitting exactly on the plane — that IS the face.
    const wedge = meatChunkMesh('wedge', 0.1, 5);
    const limit = cutLimitOf('wedge', 0.1);
    const onPlane = [];
    for (let i = 0; i < wedge.positions.length; i += 3) {
      if (Math.abs(Math.abs(wedge.positions[i]!) - limit) < 1e-6) onPlane.push(i);
    }
    expect(onPlane.length).toBeGreaterThan(2);
    const blob = meatChunkMesh('blob', 0.1, 5);
    expect(cutLimitOf('blob', 0.1)).toBe(-1);
    let blobOnPlane = 0;
    for (let i = 0; i < blob.positions.length; i += 3) {
      if (Math.abs(Math.abs(blob.positions[i]!) - limit) < 1e-6) blobOnPlane++;
    }
    expect(blobOnPlane).toBe(0);
  });

  it('is DETERMINISTIC: the same seed is the same mesh, a different seed is not', () => {
    const a = meatChunkMesh('gobbet', 0.08, 11);
    const b = meatChunkMesh('gobbet', 0.08, 11);
    const c = meatChunkMesh('gobbet', 0.08, 12);
    expect(a.positions).toEqual(b.positions);
    expect(a.indices).toEqual(b.indices);
    expect(a.positions).not.toEqual(c.positions);
  });
});

describe('classic bones', () => {
  it('every variant is well formed', () => {
    for (const v of BONE_VARIANTS) {
      const m = classicBoneMesh(v, 0.1, 4);
      checkWellFormed(m, v);
      const { extent } = bounds(m);
      // A long bone is long in ONE axis; a knuckle is small and round. Both must
      // clear the shaft radius, or the part is invisible at gib scale.
      expect(Math.max(...extent)).toBeGreaterThan(0.1);
      expect(Math.max(...extent)).toBeLessThan(0.35);
    }
  });

  it('a long bone is a SHAFT with KNOBBY ENDS, not a ball on a stick', () => {
    const m = classicBoneMesh('long', 0.1, 2);
    const { extent } = bounds(m);
    // Length along y, narrow across.
    expect(extent[1]!).toBeGreaterThan(extent[0]! * 1.6);
    // The ENDS are wider than the middle: sample the max radius in the middle
    // third against the outer thirds. Two lobes per end is what does this.
    let midMax = 0, endMax = 0;
    const half = extent[1]! / 2;
    for (let i = 0; i < m.positions.length; i += 3) {
      const y = m.positions[i + 1]!, r = Math.hypot(m.positions[i]!, m.positions[i + 2]!);
      if (Math.abs(y) < half * 0.4) midMax = Math.max(midMax, r);
      else if (Math.abs(y) > half * 0.75) endMax = Math.max(endMax, r);
    }
    expect(endMax).toBeGreaterThan(midMax * 1.3);
  });

  it('the GUT is a LOOP, not a straight run — a straight gut is a sausage', () => {
    const gut = meatChunkMesh('gut', 0.1, 3);
    const m = gut;
    // The bend is around the local x axis: sample the vertices near each end of
    // the long axis and require them to be displaced in x, which only a curl
    // does. A straight tube keeps its end rings centred on x = 0.
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      zMin = Math.min(zMin, m.positions[i + 2]!);
      zMax = Math.max(zMax, m.positions[i + 2]!);
    }
    let endBias = 0, endN = 0;
    for (let i = 0; i < m.positions.length; i += 3) {
      const z = m.positions[i + 2]!;
      if (z < zMin + (zMax - zMin) * 0.2 || z > zMax - (zMax - zMin) * 0.2) {
        endBias += Math.abs(m.positions[i]!); endN++;
      }
    }
    expect(endN).toBeGreaterThan(3);
    // A curled tube pulls both ends off the centreline, and the curl is a real
    // fraction of the part's own size.
    const span = Math.max(...[0, 1, 2].map(k => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < m.positions.length; i += 3) {
        lo = Math.min(lo, m.positions[i + k]!); hi = Math.max(hi, m.positions[i + k]!);
      }
      return hi - lo;
    }));
    expect(endBias / endN).toBeGreaterThan(span * 0.06);
  });

  it('the rib is BENT, and the knuckle has no shaft', () => {
    const rib = classicBoneMesh('rib', 0.1, 1);
    // A bent bone's max |z| is a real fraction of its length.
    expect(bounds(rib).extent[2]!).toBeGreaterThan(0.04);
    const straight = classicBoneMesh('long', 0.1, 1);
    expect(bounds(straight).extent[2]!).toBeLessThan(bounds(rib).extent[2]!);
    // The knuckle is three lobes: round in every axis, not elongated.
    const k = classicBoneMesh('knuckle', 0.1, 1);
    const e = bounds(k).extent;
    expect(Math.max(...e) / Math.min(...e)).toBeLessThan(2);
  });
});

describe('paint (the blood decal layer)', () => {
  it('paints every vertex, in range, meat on the ramp and bone as ivory', () => {
    for (const v of MEAT_VARIANTS) {
      const m = meatChunkMesh(v, 0.09, 6);
      const c = paintPart(m, LOOK, 'meat', meatFields(v, 0.09, 6));
      expect(c.length).toBe(m.positions.length / 3 * 4);
      for (const x of c) expect(x).toBeGreaterThanOrEqual(0);
      for (const x of c) expect(x).toBeLessThanOrEqual(1);
      // Not one flat colour: the ramp and the mottle must vary across the part.
      const reds = new Set<number>();
      for (let i = 0; i < c.length; i += 4) reds.add(Math.round(c[i]! * 40));
      expect(reds.size).toBeGreaterThan(1);
    }
    const b = classicBoneMesh('long', 0.1, 6);
    const bc = paintPart(b, LOOK, 'bone', { blood: boneBloodField(0.1, 6), depth: () => 0 });
    // BONE IS PALE. Its red channel has to sit well above its blue (an ivory
    // tone), which a meat-ramped bone would not.
    let rSum = 0, bSum = 0;
    for (let i = 0; i < bc.length; i += 4) { rSum += bc[i]!; bSum += bc[i + 2]!; }
    expect(rSum / bSum).toBeGreaterThan(1.25);
  });

  it('the cut face is the BLOODY one — the decal follows the slice', () => {
    const m = meatChunkMesh('wedge', 0.1, 8);
    const f = meatFields('wedge', 0.1, 8);
    const limit = cutLimitOf('wedge', 0.1);
    // Vertices on the cut plane must be bloodier on average than the far side.
    let onCut = 0, onCutN = 0, off = 0, offN = 0;
    for (let i = 0; i < m.positions.length; i += 3) {
      const x = m.positions[i]!;
      const b = f.blood([x, m.positions[i + 1]!, m.positions[i + 2]!] as Vec3);
      if (Math.abs(Math.abs(x) - limit) < 1e-6) { onCut += b; onCutN++; }
      else if (x > limit * 0.2) { off += b; offN++; }
    }
    expect(onCutN).toBeGreaterThan(0);
    expect(offN).toBeGreaterThan(0);
    expect(onCut / onCutN).toBeGreaterThan(off / offN);
  });

  it('the fields are pure and bounded — the same point always paints the same', () => {
    const p: Vec3 = [0.03, -0.02, 0.01];
    expect(bloodField(p, 3)).toBe(bloodField(p, 3));
    expect(bloodField(p, 3)).not.toBe(bloodField(p, 4));
    for (const v of MEAT_VARIANTS) {
      const f = meatFields(v, 0.1, 9);
      const b = f.blood(p);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      expect(f.depth(p)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('organs', () => {
  it('are red/pink and WET — a different material, not a repaint', () => {
    for (const v of ORGAN_VARIANTS) {
      expect(isOrgan(v)).toBe(true);
      const m = meatChunkMesh(v, 0.1, 12);
      const c = paintPart(m, LOOK, 'organ', meatFields(v, 0.1, 12));
      let r = 0, g = 0, b = 0, wet = 0, n = 0;
      for (let i = 0; i < c.length; i += 4) {
        r += c[i]!; g += c[i + 1]!; b += c[i + 2]!; wet += c[i + 3]!; n++;
      }
      // RED/PINK: the red channel leads by a wide margin, and green and blue are
      // close to each other but NOT negligible — that pair is what separates
      // "red/pink tissue" from "dark red maroon". (Green is not asserted above
      // blue: the liver's own tones have a slightly blue bias, and pinning the
      // ordering would be asserting a colour nobody asked for.)
      expect(r / n, `${v} red leads`).toBeGreaterThan(g / n * 1.25);
      expect(b / n, `${v} bright enough to be flesh`).toBeGreaterThan(0.2);
      expect(g / n, `${v} not grey`).toBeGreaterThan(0.12);
      // SPECULAR: the material reads alpha as roughness (0.9 dry, 0.31 wet), so
      // an organ has to be wet nearly everywhere.
      expect(wet / n, `${v} wetness`).toBeGreaterThan(0.75);
    }
  });

  it('are NOT painted through the meat ramp — meat and organ differ on the same shape', () => {
    const m = meatChunkMesh('liver', 0.1, 4);
    const asMeat = paintPart(m, LOOK, 'meat', meatFields('liver', 0.1, 4));
    const asOrgan = paintPart(m, LOOK, 'organ', meatFields('liver', 0.1, 4));
    let diff = 0;
    for (let i = 0; i < asMeat.length; i += 4) {
      diff += Math.abs(asMeat[i]! - asOrgan[i]!) + Math.abs(asMeat[i + 2]! - asOrgan[i + 2]!);
    }
    expect(diff / (asMeat.length / 4)).toBeGreaterThan(0.1);
  });
});

describe('the parts are NOT the body', () => {
  it('none of them is a SAUSAGE: long AND round in section', () => {
    // The owner's complaint was "oblong sausages". The defining property of a
    // sausage is not length — it is being LONG and ROUND at the same time. A
    // torn sheet is long and FLAT, which is meat, not a tube, so the test is a
    // pair of conditions and not one aspect bound.
    for (const v of MEAT_VARIANTS) {
      const e = [...bounds(meatChunkMesh(v, 0.1, 21)).extent].sort((a, b) => b - a);
      const elongated = e[0]! / e[2]!;
      const roundSection = e[2]! / e[1]!;
      const isSausage = elongated > 2.5 && roundSection > 0.75;
      expect(isSausage, `${v}: ${elongated.toFixed(2)} long, ${roundSection.toFixed(2)} round`).toBe(false);
    }
  });
});
