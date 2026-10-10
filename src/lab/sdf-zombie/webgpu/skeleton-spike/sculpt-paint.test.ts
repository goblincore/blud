import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../types';
import { SKULL2_FACE, skull2Orbit } from './mesh-skull-2';
import {
  SCULPT_BUMP, SCULPT_CLING, SCULPT_HEIGHT, SCULPT_PAINT_SHAPE1, SCULPT_PAINT_SHAPE2, SCULPT_TEETH_MAX, SCULPT_TOOTH,
  sculptCavity, sculptCling, sculptHeight, sculptHeightGrad, sculptLines, sculptPaintNormal, sculptPaintSources, sculptPaintSurface,
  sculptPaintWet, sculptPaintWgsl, sculptRelief, sculptTeeth, type SculptPaintLayout,
} from './sculpt-paint';

const BONE: Vec3 = [0.93, 0.89, 0.80], DEEP: Vec3 = [0.45, 0.06, 0.05];
const luma = (c: Vec3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const LAYOUTS: [string, SculptPaintLayout][] = [['the first sculpt\'s layout', SCULPT_PAINT_SHAPE1], ['the second sculpt\'s layout', SCULPT_PAINT_SHAPE2]];
/** The middle of tooth `i` of a row, at the share `t` of the way from the tips (0) to the root line (1). */
const tooth = (L: SculptPaintLayout, upper: boolean, i: number, t: number, u = 0): Vec3 => {
  const e = upper ? L.upper : L.lower, tip = upper ? L.upperTip : L.lowerTip, root = upper ? L.upperRoot : L.lowerRoot;
  return [(e[i]! + e[i + 1]!) / 2 + u * (e[i + 1]! - e[i]!) / 2, tip + (root - tip) * t, 0.9];
};

describe.each(LAYOUTS)('sculptTeeth, %s', (_name, L) => {
  it('lays out whole teeth from the middle outward, the same on both sides', () => {
    expect(L.upper).toHaveLength(SCULPT_TEETH_MAX + 1);
    expect(L.lower).toHaveLength(SCULPT_TEETH_MAX + 1);
    expect(L.count).toBeLessThanOrEqual(SCULPT_TEETH_MAX);
    for (const row of [L.upper, L.lower]) {
      expect(row[0]).toBe(0);
      for (let i = 0; i < L.count; i++) expect(row[i + 1]! - row[i]!, `tooth ${i}`).toBeGreaterThan(0.04);
    }
    const p = tooth(L, true, 1, 0.3);
    expect(sculptTeeth(L, [-p[0], p[1], p[2]])).toEqual(sculptTeeth(L, p));
  });

  it('a crown is enamel through its middle, with dark wedges between crowns that open toward the gum', () => {
    for (const upper of [true, false]) for (let i = 0; i < Math.min(L.count, 5); i++) {
      const mid = sculptTeeth(L, tooth(L, upper, i, 0.3));
      expect(mid[0], `crown ${upper} ${i}`).toBeGreaterThan(0.95);
      expect(mid[2]).toBeLessThan(0.05);
      expect(mid[3]).toBeGreaterThan(SCULPT_TOOTH.proud * 0.9);
      // At the tooth's edge: enamel near the tip (if the tooth is not the pointed one), a dark wedge near the gum.
      const nearGum = sculptTeeth(L, tooth(L, upper, i, 0.5, 0.9));
      expect(nearGum[0]).toBeLessThan(0.1);
      expect(nearGum[2]).toBeGreaterThan(0.9);
      if (i !== L.fang) expect(sculptTeeth(L, tooth(L, upper, i, 0.2, 0.6))[0]).toBeGreaterThan(0.9);
    }
  });

  it('the canine comes to a point: beside its middle the tip is cut away where an incisor\'s is not', () => {
    const fang = sculptTeeth(L, tooth(L, true, L.fang, 0.12, 0.6)), incisor = sculptTeeth(L, tooth(L, true, 0, 0.12, 0.6));
    expect(incisor[0]).toBeGreaterThan(0.9);
    expect(fang[0]).toBeLessThan(0.1);
    expect(sculptTeeth(L, tooth(L, true, L.fang, 0.12, 0))[0]).toBeGreaterThan(0.9);
  });

  it('above the gum line the root is a ridge under each tooth, fading out by the root line', () => {
    const ridge = sculptTeeth(L, tooth(L, true, 1, 0.74)), between = sculptTeeth(L, tooth(L, true, 1, 0.74, 0.98));
    expect(ridge[0]).toBe(0);
    expect(ridge[1]).toBeGreaterThan(0.6);
    expect(ridge[3]).toBeGreaterThan(SCULPT_TOOTH.ridge * 0.6);
    expect(between[1]).toBeLessThan(0.1);
    // The roots sit in a stain that the ridges stand out of.
    expect(between[2]).toBeGreaterThan(ridge[2] + 0.2);
    expect(sculptTeeth(L, tooth(L, true, 1, 1.0))[1]).toBeLessThan(0.02);
  });

  it('nothing is painted in the parting, beyond the last tooth, or past the root lines', () => {
    const zero = [0, 0, 0, 0];
    expect(sculptTeeth(L, [0.04, (L.upperTip + L.lowerTip) / 2 + 0.012, 0.9]).slice(0, 2)).toEqual([0, 0]);
    expect(sculptTeeth(L, [0.04, L.upperRoot + 0.05, 0.9])).toEqual(zero);
    expect(sculptTeeth(L, [0.04, L.lowerRoot - 0.05, 0.9])).toEqual(zero);
    expect(sculptTeeth(L, [(L.upper[L.count]! + 0.05), L.upperTip + 0.04, 0.9])).toEqual(zero);
  });
});

describe('the layouts', () => {
  it('the second sculpt\'s teeth are on its arches and counted back along them; the first\'s face is flat', () => {
    expect(SCULPT_PAINT_SHAPE2.upperTip).toBe(SKULL2_FACE.teeth.upperTip);
    expect(SCULPT_PAINT_SHAPE2.lowerRoot).toBe(SKULL2_FACE.teeth.lowerRoot);
    expect(SCULPT_PAINT_SHAPE1.wrap).toBe(0);
    // On the arch's side wall (|x| at the arch's half-width, z behind the turn) successive teeth follow z.
    const y = SCULPT_PAINT_SHAPE2.upperTip + 0.04, side = (z: number): Vec3 => [SKULL2_FACE.arch.halfW, y, z];
    const hits = new Set<string>();
    for (let z = 0.72; z > 0.36; z -= 0.004) { const t = sculptTeeth(SCULPT_PAINT_SHAPE2, side(z)); hits.add(t[0] > 0.9 ? 'crown' : t[2] > 0.9 ? 'dark' : 'edge'); }
    expect(hits.has('crown') && hits.has('dark')).toBe(true);
    // The first sculpt's bone has the brow, the cheekbones and the hollows painted in; the second has them in bone.
    expect([SCULPT_PAINT_SHAPE1.relief, SCULPT_PAINT_SHAPE2.relief]).toEqual([1, 0]);
  });
});

describe('sculptLines', () => {
  it('draws the brow crack along its path and nothing beside it', () => {
    let on = 0, off = 0;
    for (let y = 0.60; y <= 0.92; y += 0.02) {
      let best = 0;
      for (let x = -0.5; x <= 0.1; x += 0.004) best = Math.max(best, sculptLines([x, y, 0.8]));
      if (best > 0.9) on++;
      if (sculptLines([0.35, y, 0.8]) < 0.05) off++;
    }
    expect(on).toBeGreaterThanOrEqual(15);
    expect(off).toBeGreaterThanOrEqual(15);
  });
  it('is a few lines, not a texture: most of the face and the cranium is clear', () => {
    let clear = 0, n = 0;
    for (let x = -0.8; x <= 0.8; x += 0.05) for (let y = -0.8; y <= 0.9; y += 0.05) for (const z of [0.8, 0.5, -0.4]) { n++; if (sculptLines([x, y, z]) < 0.05) clear++; }
    expect(clear / n).toBeGreaterThan(0.9);
    expect(clear / n).toBeLessThan(0.995);
  });
  it('the cracks are on the face only; the sutures cross the top of the head', () => {
    let top = 0;
    for (let z = -0.6; z <= 0.6; z += 0.004) top = Math.max(top, sculptLines([0.3, 0.9, z]));
    expect(top).toBeGreaterThan(0.9);
    let back = 0;
    for (let x = -0.3; x <= 0.3; x += 0.004) back = Math.max(back, sculptLines([x, 0.8, -0.5]));
    expect(back).toBeGreaterThan(0.9);
    for (let x = -0.6; x <= 0.7; x += 0.01) for (let y = -0.84; y <= 0.2; y += 0.02) expect(sculptLines([x, y, -0.3])).toBe(0);
  });
});

describe('sculptRelief', () => {
  it('names the brow ridge, the cheekbone, the temple and the hollow under the cheekbone, each in its place', () => {
    const { brow, malar, temple, arch } = SKULL2_FACE;
    expect(sculptRelief([0.3, brow.top - brow.droop * 0.18 - 0.05, 0.8])[0]).toBeCloseTo(1, 2);
    expect(sculptRelief([malar.x, malar.y, 0.7])[1]).toBe(1);
    expect(sculptRelief([0.75, temple.y, temple.z])[2]).toBe(1);
    expect(sculptRelief([arch.halfW + 0.12, -0.38, 0.5])[3]).toBe(1);
    // None of them on the forehead's middle or the back of the head.
    expect(sculptRelief([0, 0.8, 0.8])).toEqual([0, 0, 0, 0]);
    expect(sculptRelief([0.2, 0.3, -0.8]).slice(0, 2)).toEqual([0, 0]);
    // Mirrored.
    expect(sculptRelief([-0.75, temple.y, temple.z])).toEqual(sculptRelief([0.75, temple.y, temple.z]));
  });
});

describe.each(LAYOUTS)('sculptCavity, %s', (_name, L) => {
  const o = SKULL2_FACE.orbit, n = SKULL2_FACE.nose;
  it('darkens the orbit inside the sculpt\'s outline, more with depth, and not the bone between the orbits', () => {
    const rim = sculptCavity(L, [o.x, o.y, 0.9], 1)[0], floor = sculptCavity(L, [o.x, o.y, 0.4], 1)[0];
    expect(rim).toBeGreaterThan(0.65);
    expect(floor).toBeGreaterThan(rim + 0.2);
    expect(floor).toBeCloseTo(1, 2);
    expect(sculptCavity(L, [0, o.y, 0.9], 1)[0]).toBe(0);
    // The outline is the bone's own: just inside it dark, just outside it not.
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const at = (k: number): Vec3 => [o.x + Math.cos(a) * o.halfW * k, o.y + Math.sin(a) * o.halfH * k, 0.6];
      let edge = 1;
      for (let k = 0.5; k < 1.6; k += 0.01) if (skull2Orbit(at(k)[0], at(k)[1]) > 0) { edge = k; break; }
      expect(sculptCavity(L, at(edge - 0.15), 1)[0], `inside ${a.toFixed(2)}`).toBeGreaterThan(0.6);
      expect(sculptCavity(L, at(edge + 0.15), 1)[0], `outside ${a.toFixed(2)}`).toBe(0);
    }
  });
  it('darkens the aperture and the parting of the jaws, and stains a halo outside the rims', () => {
    expect(sculptCavity(L, [n.lobeX, n.lobeY, 0.5], 1)[1]).toBeGreaterThan(0.9);
    expect(sculptCavity(L, [0.3, n.lobeY, 0.8], 1)[1]).toBe(0);
    const part = (L.upperTip + L.lowerTip) / 2;
    expect(sculptCavity(L, [0.1, part, 0.8], 1)[2]).toBeGreaterThan(0.95);
    expect(sculptCavity(L, [0.1, L.upperTip + 0.05, 0.8], 1)[2]).toBe(0);
    expect(sculptCavity(L, [L.mouthHalfW + 0.1, part, 0.8], 1)[2]).toBe(0);
    // The halo: outside the orbit's rim, fading within a tenth of a unit.
    const rimX = o.x - 0.31;
    expect(skull2Orbit(rimX, o.y)).toBeGreaterThan(0);
    expect(sculptCavity(L, [rimX, o.y, 0.9], 1)[3]).toBeGreaterThan(0.3);
    expect(sculptCavity(L, [0, 0.75, 0.8], 1)[3]).toBe(0);
  });
  it('is the front of a head only', () => {
    for (const p of [[o.x, o.y, 0.9], [n.lobeX, n.lobeY, 0.6], [0.1, (L.upperTip + L.lowerTip) / 2, 0.8]] as Vec3[]) {
      expect(sculptCavity(L, p, 0)).toEqual([0, 0, 0, 0]);
      expect(sculptCavity(L, [p[0], p[1], -0.5], 1)).toEqual([0, 0, 0, 0]);
    }
  });
});

describe.each(LAYOUTS)('sculptHeight and its gradient, %s', (_name, L) => {
  it('raises a crown above the wedge beside it and the gum above it', () => {
    const crown = sculptHeight(L, tooth(L, true, 1, 0.3), 1), wedge = sculptHeight(L, tooth(L, true, 1, 0.5, 0.97), 1);
    expect(crown).toBeGreaterThan(SCULPT_TOOTH.proud * 0.9);
    expect(crown - wedge).toBeGreaterThan(SCULPT_TOOTH.proud * 0.8);
    expect(sculptHeight(L, tooth(L, true, 1, 0.3), 0)).toBe(0);
  });
  it('grooves a line and lips the orbit\'s rim', () => {
    let deepest = 0;
    for (let x = -0.5; x <= 0.1; x += 0.004) deepest = Math.min(deepest, sculptHeight(L, [x, 0.8, 0.8], 1) - L.relief * 0);
    expect(deepest).toBeLessThan(-SCULPT_HEIGHT.groove * 0.9);
    const o = SKULL2_FACE.orbit;
    let lip = 0;
    for (let x = 0; x < 0.12; x += 0.004) lip = Math.max(lip, sculptHeight(L, [x, o.y, 0.9], 1));
    expect(lip).toBeGreaterThan(SCULPT_HEIGHT.rim * 0.9);
  });
  it('carries the brow, the cheekbone and the hollows only where the bone lacks them', () => {
    const { brow, malar, temple } = SKULL2_FACE;
    // Between the orbits, clear of their rims' lips.
    const onBrow = sculptHeight(L, [0, brow.top - 0.05, 0.85], 1);
    const onMalar = sculptHeight(L, [-malar.x, malar.y, 0.7], 1);
    const inTemple = sculptHeight(L, [0.75, temple.y, temple.z], 1);
    if (L.relief === 1) {
      expect(onBrow).toBeCloseTo(SCULPT_HEIGHT.brow, 4);
      expect(onMalar).toBeGreaterThan(SCULPT_HEIGHT.malar * 0.9);
      expect(inTemple).toBeLessThan(-SCULPT_HEIGHT.temple * 0.9);
    } else {
      expect(Math.abs(onBrow)).toBeLessThan(1e-6);
      expect(Math.abs(inTemple)).toBeLessThan(1e-6);
    }
  });
  it('the gradient is the height\'s slope: zero on a crown\'s crest, steep and opposite on its two flanks', () => {
    const crest = sculptHeightGrad(L, tooth(L, true, 1, 0.3), 1);
    expect(Math.abs(crest[0])).toBeLessThan(0.01);
    const left = sculptHeightGrad(L, tooth(L, true, 1, 0.3, -0.6), 1)[0], right = sculptHeightGrad(L, tooth(L, true, 1, 0.3, 0.6), 1)[0];
    expect(left).toBeGreaterThan(0.01);
    expect(right).toBeLessThan(-0.01);
    // It matches a centred difference of the height.
    const q = tooth(L, true, 1, 0.3, 0.5), e = 0.0005;
    const centred = (sculptHeight(L, [q[0] + e, q[1], q[2]], 1) - sculptHeight(L, [q[0] - e, q[1], q[2]], 1)) / (2 * e);
    expect(sculptHeightGrad(L, q, 1)[0]).toBeCloseTo(centred, 1);
    expect(sculptHeightGrad(L, q, 0)).toEqual([0, 0, 0]);
  });
});

describe('sculptPaintNormal', () => {
  const L = SCULPT_PAINT_SHAPE2;
  // A patch of the face square to the eye: one pixel is `s` metres, and 1 normalized unit is 0.1 m on every axis.
  const frame = (s: number) => ({ n: [0, 0, 1] as Vec3, sx: [s, 0, 0] as Vec3, sy: [0, -s, 0] as Vec3, qx: [s / 0.1, 0, 0] as Vec3, qy: [0, -s / 0.1, 0] as Vec3 });
  const tilt = (q: Vec3, s: number, head = 1) => { const f = frame(s); return sculptPaintNormal(L, f.n, f.sx, f.sy, f.qx, f.qy, q, head); };
  it('leans the normal downhill: away from a crown\'s crest on both flanks, and not at all on the crest', () => {
    const left = tilt(tooth(L, true, 1, 0.3, -0.6), 0.001), right = tilt(tooth(L, true, 1, 0.3, 0.6), 0.001), crest = tilt(tooth(L, true, 1, 0.3), 0.001);
    expect(left[0]).toBeLessThan(-0.2);
    expect(right[0]).toBeGreaterThan(0.2);
    // (The gradient is a forward difference: on the crest it reads the slope half a step on.)
    expect(Math.abs(crest[0])).toBeLessThan(0.05);
    for (const v of [left, right, crest]) expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 9);
    // The slope is the height's: dh/dx in metres per metre.
    const g = sculptHeightGrad(L, tooth(L, true, 1, 0.3, 0.6), 1)[0] / 0.1;
    expect(right[0] / right[2]).toBeCloseTo(-g, 6);
  });
  it('does not depend on which way the screen runs across the surface', () => {
    const q = tooth(L, true, 1, 0.3, 0.6), s = 0.001, a = tilt(q, s);
    // The same patch with the screen's axes swapped and one reversed.
    const b = sculptPaintNormal(L, [0, 0, 1], [0, s, 0], [-s, 0, 0], [0, s / 0.1, 0], [-s / 0.1, 0, 0], q, 1);
    for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(a[k]!, 9);
  });
  it('reports the pixel\'s footprint and fades the tilt out as it grows', () => {
    const q = tooth(L, true, 1, 0.3, 0.6);
    expect(tilt(q, 0.001)[3]).toBeCloseTo(0.001, 12);
    const near = Math.abs(tilt(q, SCULPT_BUMP.fadeFrom)[0]), mid = Math.abs(tilt(q, (SCULPT_BUMP.fadeFrom + SCULPT_BUMP.fadeTo) / 2)[0]);
    expect(mid).toBeLessThan(near * 0.7);
    expect(mid).toBeGreaterThan(0);
    expect(tilt(q, SCULPT_BUMP.fadeTo)).toEqual([0, 0, 1, SCULPT_BUMP.fadeTo]);
    // Not a head: the normal it was given.
    expect(tilt(q, 0.001, 0)).toEqual([0, 0, 1, 0.001]);
  });
});

describe.each(LAYOUTS)('sculptPaintSurface and sculptPaintWet, %s', (_name, L) => {
  const o = SKULL2_FACE.orbit, local: Vec3 = [0.01, 0.02, 0.03];
  const paint = (q: Vec3, w = 1, expo = 0, foot = 0) => sculptPaintSurface(L, local, q, w, BONE, DEEP, expo, foot);
  it('a cavity is near black, a crown is the brightest thing on the face, the wedge beside it near black', () => {
    const orbit = paint([o.x, o.y, 0.4]), crown = paint(tooth(L, true, 1, 0.3)), wedge = paint(tooth(L, true, 1, 0.5, 0.97)), bone = paint([0, 0.8, 0.8]);
    expect(luma(orbit.albedo)).toBeLessThan(0.06);
    expect(orbit.cavity).toBeGreaterThan(0.95);
    expect(luma(crown.albedo)).toBeGreaterThan(luma(bone.albedo));
    expect(luma(crown.albedo)).toBeGreaterThan(0.3);
    expect(crown.crown).toBeGreaterThan(0.95);
    expect(luma(wedge.albedo)).toBeLessThan(luma(crown.albedo) * 0.25);
    const part = paint([0.1, (L.upperTip + L.lowerTip) / 2, 0.8]);
    expect(luma(part.albedo)).toBeLessThan(0.06);
  });
  it('far away the tooth pattern is one band: the wedge and the crown come to the same colour', () => {
    const far = SCULPT_TOOTH.fadeTo;
    const crown = paint(tooth(L, true, 1, 0.3), 1, 0, far), wedge = paint(tooth(L, true, 1, 0.5, 0.97), 1, 0, far);
    expect(Math.abs(luma(crown.albedo) - luma(wedge.albedo))).toBeLessThan(0.08);
    expect(luma(crown.albedo)).toBeGreaterThan(0.2);
    // And near, they are far apart.
    expect(luma(paint(tooth(L, true, 1, 0.3)).albedo) - luma(paint(tooth(L, true, 1, 0.5, 0.97)).albedo)).toBeGreaterThan(0.25);
  });
  it('shades the temple and the hollow under the cheekbone', () => {
    const temple = SKULL2_FACE.temple;
    expect(luma(paint([0.75, temple.y, temple.z]).albedo)).toBeLessThan(luma(paint([0.75, temple.y + 0.5, temple.z]).albedo) * 0.8);
  });
  it('a bone that is not a head keeps the first paint\'s tissue and none of the face', () => {
    const limb = paint([o.x, o.y, 0.4], 0), elsewhere = paint([0.9, -0.9, -0.9], 0);
    expect(limb.cavity).toBe(0);
    expect(limb.crown).toBe(0);
    expect(limb.albedo).toEqual(elsewhere.albedo);
    expect(sculptPaintWet(L, local, [o.x, o.y, 0.4], 0, 0)).toBe(sculptPaintWet(L, local, [0.9, -0.9, -0.9], 0, 0));
  });
  it('the soldier\'s head keeps its steel plate and its heavier wound stain', () => {
    const plate: Vec3 = [-0.66, -0.05, 0.6];
    // Grey steel where the zombie's head is ivory: less than half as red, and nearly neutral.
    expect(paint(plate, 2).albedo[0]).toBeLessThan(paint(plate, 1).albedo[0] * 0.5);
    expect(paint(plate, 2).albedo[0] - paint(plate, 2).albedo[2]).toBeLessThan(0.05);
    expect(paint(plate, 1).albedo[0] - paint(plate, 1).albedo[2]).toBeGreaterThan(0.2);
    expect(paint([-plate[0], plate[1], plate[2]], 2).albedo[0]).toBeGreaterThan(paint(plate, 2).albedo[0] * 1.5);
    const clean = paint([0, 0.8, 0.8], 2), bloody = paint([0, 0.8, 0.8], 2, 1), zombieBloody = paint([0, 0.8, 0.8], 1, 1);
    expect(bloody.albedo[1]).toBeLessThan(clean.albedo[1] * 0.5);
    expect(bloody.albedo[1]).toBeLessThan(zombieBloody.albedo[1]);
  });
  it('enamel shines, a cavity does not', () => {
    expect(sculptPaintWet(L, local, tooth(L, true, 1, 0.3), 1, 0)).toBeGreaterThanOrEqual(0.8);
    expect(sculptPaintWet(L, local, [o.x, o.y, 0.4], 1, 0)).toBeLessThan(0.05);
    expect(sculptPaintWet(L, local, [0.1, (L.upperTip + L.lowerTip) / 2, 0.8], 1, 0)).toBeLessThan(0.05);
  });
});

describe.each(LAYOUTS)('sculptCling, %s: torn flesh left on a shot skull', (_name, L) => {
  const o = SKULL2_FACE.orbit;
  /** The mean cling over a patch of bone: `n` points scattered through the segment's local space at the face place `q`. */
  const mean = (q: Vec3, w: number, expo: number, n = 400) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sculptCling(L, [0.0173 * i, 0.0091 * (i % 37), 0.0127 * (i % 53)], q, w, expo);
    return sum / n;
  };
  const cheek: Vec3 = [0.75, -0.2, 0.5];
  it('clean bone far from any wound has none', () => {
    expect(mean(cheek, 1, 0)).toBe(0);
    expect(mean([o.x, o.y, 0.4], 1, 0.1)).toBe(0);
  });
  it('a head near a wound carries patches, not a coat: some of the bone is clear and some is covered', () => {
    const m = mean(cheek, 1, 1);
    expect(m).toBeGreaterThan(0.12);
    expect(m).toBeLessThan(0.6);
  });
  it('more of it the closer the wound, and more of it in the hollows where flesh holds', () => {
    expect(mean(cheek, 1, 1)).toBeGreaterThan(mean(cheek, 1, 0.45));
    expect(mean([o.x, o.y, 0.4], 1, 0.6)).toBeGreaterThan(mean(cheek, 1, 0.6));
  });
  it('a bone that is not a head, and the soldier\'s head, have none', () => {
    expect(mean(cheek, 0, 1)).toBe(0);
    expect(mean(cheek, 2, 1)).toBe(0);
  });
  it('the patches are red and wet: they redden the bone and give it a shine, and the teeth stay clean', () => {
    const local: Vec3 = [0.0173 * 211, 0.0091 * (211 % 37), 0.0127 * (211 % 53)];
    let found: Vec3 | null = null;
    for (let i = 0; i < 400 && !found; i++) {
      const p: Vec3 = [0.0173 * i, 0.0091 * (i % 37), 0.0127 * (i % 53)];
      if (sculptCling(L, p, cheek, 1, 1) > 0.9) found = p;
    }
    expect(found).not.toBeNull();
    const dry = sculptPaintSurface(L, found!, cheek, 1, BONE, DEEP, 0).albedo, wound = sculptPaintSurface(L, found!, cheek, 1, BONE, DEEP, 1).albedo;
    expect(wound[0] - wound[1]).toBeGreaterThan((dry[0] - dry[1]) + 0.12);
    expect(luma(wound)).toBeLessThan(luma(dry) * 0.6);
    expect(sculptPaintWet(L, found!, cheek, 1, 1)).toBeGreaterThanOrEqual(0.75);
    expect(sculptPaintWet(L, found!, cheek, 1, 0)).toBeLessThan(0.6);
    void local;
  });
  it('is tuned by its table', () => {
    expect(SCULPT_CLING.cover).toBeGreaterThan(SCULPT_CLING.byExpo + SCULPT_CLING.byCavity);
  });
});

describe.each(LAYOUTS)('the WGSL, %s', (_name, L) => {
  const w = sculptPaintWgsl(L), sources = sculptPaintSources(L);
  const nameOf = (src: string) => /^fn (\w+)\(/.exec(src)![1]!;
  it('is one function per source, in an order where each calls only what came before it', () => {
    const names = sources.map(nameOf);
    expect(names).toEqual(['sculptOrbit', 'sculptNose', 'sculptTeeth', 'sculptLines', 'sculptRelief', 'sculptCavity', 'sculptCling', 'sculptHeight', 'sculptHeightGrad', 'sculptPaintNormal', 'sculptPaintSurface', 'sculptPaintWet']);
    const known = new Set(['boneHash', 'boneNoise']);
    sources.forEach((src, i) => {
      expect(src.match(/\bfn \w+\(/g)).toHaveLength(1);
      for (const call of src.matchAll(/\b(sculpt\w+|bone(?:Hash|Noise))\(/g)) {
        if (call[1] === names[i]) continue;
        expect(known.has(call[1]!), `${names[i]} calls ${call[1]}`).toBe(true);
      }
      known.add(names[i]!);
      expect((src.match(/{/g) ?? []).length).toBe((src.match(/}/g) ?? []).length);
      expect((src.match(/\(/g) ?? []).length).toBe((src.match(/\)/g) ?? []).length);
      // No number is written without its decimal point where a float is meant.
      expect(src).not.toMatch(/NaN|undefined|Infinity/);
    });
  });
  it('carries the tables\' numbers', () => {
    const o = SKULL2_FACE.orbit, n = SKULL2_FACE.nose;
    for (const v of [o.x, o.y, o.halfW, o.halfH, o.power]) expect(w.orbit).toContain(String(v));
    for (const v of [n.top, n.topHalfW, n.flare, n.lobeX, n.lobeY, n.lobeR]) expect(w.nose).toContain(String(v));
    for (const v of [L.upperTip, L.upperRoot, L.lowerTip, L.lowerRoot, L.wrap, L.turn, SCULPT_TOOTH.crown, SCULPT_TOOTH.proud, SCULPT_TOOTH.ridge]) expect(w.teeth, String(v)).toContain(String(v));
    for (let i = 0; i <= L.count; i++) { expect(w.teeth).toContain(String(L.upper[i])); expect(w.teeth).toContain(String(L.lower[i])); }
    expect(w.teeth).toContain(`i < ${L.count};`);
    expect(w.teeth).toContain(`i == ${L.fang}`);
    for (const v of Object.values(SCULPT_HEIGHT)) expect(w.height).toContain(String(v));
    expect(w.height).toContain(`${L.relief}.0 * headFlag`);
    for (const v of [SCULPT_BUMP.fadeFrom, SCULPT_BUMP.fadeTo, SCULPT_BUMP.eps]) expect(w.normal + w.grad).toContain(String(v));
    for (const v of [SCULPT_TOOTH.fadeFrom, SCULPT_TOOTH.fadeTo]) expect(w.surface).toContain(String(v));
    expect(w.cavity).toContain(String(L.mouthHalfW - 0.03));
  });
  it('takes its screen derivatives first, in the one function that has any', () => {
    for (const src of sources) expect(/dpd[xy]\(/.test(src)).toBe(src === w.normal);
    const body = w.normal.slice(w.normal.indexOf('{'));
    expect(body.indexOf('dpdy(feature.xyz)')).toBeLessThan(body.indexOf('if ('));
    // The surface reads its craters with textureLoad and samples nothing: it may be called inside a branch.
    expect(w.surface).toContain('textureLoad(woundTex');
    expect(w.surface).not.toMatch(/textureSample/);
  });
});

describe('the two layouts\' WGSL', () => {
  it('share the face and differ in the teeth, the parting and the relief', () => {
    const a = sculptPaintWgsl(SCULPT_PAINT_SHAPE1), b = sculptPaintWgsl(SCULPT_PAINT_SHAPE2);
    for (const k of ['orbit', 'nose', 'lines', 'relief', 'grad', 'normal', 'surface', 'wet'] as const) expect(a[k]).toBe(b[k]);
    for (const k of ['teeth', 'cavity', 'height'] as const) expect(a[k]).not.toBe(b[k]);
  });
});
