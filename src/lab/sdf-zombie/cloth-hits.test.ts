// src/lab/sdf-zombie/cloth-hits.test.ts
//
// CLOTH HIT REACTIONS (cultist, 2026-09-23). Owner: "a pistol or SMG will
// just make a small hole or bullet decal on the clothes, but a large shotgun
// slug would actually reveal wounds ... it's all about differing visceral
// effects." The rendering needs nothing new: a wound already carves cloth and
// flesh together, and paint now yields inside a wound (paint-char.wgsl.ts).
// What IS new, and pinned here:
//   * clothifyWound: the stamp-time rewrite (heavy = ragged tear; small =
//     bullet hole, no lip, no gore extras); a no-op off cloth;
//   * the hole bit on the GPU flags row (bit 1, beside the cavity bit 0);
//   * kickHem: a skirt hit kicks the cloth pendulum, not a knee;
//   * the size-scaled carve fillet that keeps a bullet hole a bullet hole.
import { describe, it, expect } from 'vitest';
import cultistSrc from './characters/cultist.blob?raw';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';
import { bindRig, kickHem } from './rig-bind';
import { sdBody } from './validate';
import {
  clothifyWound, clothDecal, isClothPrim, worldHitToWound, WOUND_PROFILES,
  CLOTH_BULLET_HOLE_RADIUS, CLOTH_RAGGED, CLOTH_STAIN_MAX_RADIUS, type Wound,
} from './damage';
import { writeWounds } from './webgpu/zombie-gpu';
import { APPLY_WOUNDS, WOUND_MASK } from './webgpu/march.wgsl';
import { NG_WOUNDS as NORMAL_GRADIENT_WGSL } from './webgpu/normal-gradient.wgsl';
import { PAINT_CHAR_BLOCK } from './webgpu/march/body/blocks/post/paint-char.wgsl';
import { ROW_WOUND_FLAGS } from './webgpu/march.wgsl';
import { BASE_PRIM_STRIDE } from './validate';
import { len, sub } from './vec';
import type { Vec3 } from './types';

const doc = parseBlob(cultistSrc);
const body = buildBody(compileBlob(doc, compileFace(doc)));
const idx = (pred: (p: (typeof body.prims)[number]) => boolean) => body.prims.findIndex(pred);
const skirt = idx(p => !!p.shell && p.bone === 'hem');
const hand = idx(p => p.limb === 'armL' && p.bone === 'foreArm.l' && p.color === undefined && p.radius > 0.03);
const eye = idx(p => (p.glow ?? 0) > 0);

/** A wound stamped on `primIdx`'s surface, pointing straight out of it. */
function stampOn(primIdx: number, type: 'pellet' | 'blast' | 'burn' = 'pellet'): Wound {
  const p = body.prims[primIdx]!;
  // March in from far out along +z at the prim's centre height to its surface.
  const c: Vec3 = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
  let hit: Vec3 = [c[0], c[1], c[2] + 1];
  for (let i = 0; i < 400; i++) {
    const d = sdBody(hit, body);
    if (d < 1e-4) break;
    hit = [hit[0], hit[1], hit[2] - Math.max(d, 1e-4)];
  }
  const w = worldHitToWound(body.prims, hit, WOUND_PROFILES[type].radius, type, 0, q => sdBody(q, body));
  return { ...w, primIdx };
}

describe('isClothPrim', () => {
  it('shells and painted prims are cloth; bare flesh, glowing eyes are not', () => {
    expect(isClothPrim(body.prims[skirt]!)).toBe(true);
    expect(isClothPrim(body.prims[idx(p => p.limb === 'torso' && p.color !== undefined && !p.shell)]!)).toBe(true);
    expect(isClothPrim(body.prims[hand]!)).toBe(false);
    expect(isClothPrim(body.prims[eye]!)).toBe(false);
  });
  it('metal is not cloth', () => {
    expect(isClothPrim({ ...body.prims[skirt]!, shell: undefined, metal: true })).toBe(false);
  });
});

describe('clothifyWound', () => {
  it('HEAVY on cloth: a ragged tear that keeps its size and its gore', () => {
    const w = { ...stampOn(skirt), cavity: true, spillCalibre: 'slug' as const };
    const r0 = w.radius;
    const out = clothifyWound(body.prims, w, 'heavy');
    expect(out.cloth).toBe('tear');
    expect(out.ragged).toBe(CLOTH_RAGGED);
    expect(out.radius).toBe(r0);
    expect(out.cavity).toBe(true);
    expect(out.spillCalibre).toBe('slug');
  });
  it('SMALL on cloth: a bullet hole — shrunk, no lip, no gore extras', () => {
    const w = { ...stampOn(skirt), cavity: true, spillCalibre: 'slug' as const };
    const out = clothifyWound(body.prims, w, 'small');
    expect(out.cloth).toBe('hole');
    expect(out.radius).toBe(CLOTH_BULLET_HOLE_RADIUS);
    expect(out.rimScale).toBe(0);
    expect(out.cavity).toBeUndefined();
    expect(out.spillCalibre).toBeUndefined();
    if (out.carveDepth !== undefined) expect(out.carveDepth).toBeLessThanOrEqual(out.radius);
  });
  it('is a no-op on bare flesh, whatever the calibre', () => {
    for (const c of ['heavy', 'small'] as const) {
      const w = stampOn(hand);
      const before = JSON.stringify(w);
      expect(JSON.stringify(clothifyWound(body.prims, w, c))).toBe(before);
    }
  });
  it('leaves burns alone (fire is not a bullet)', () => {
    const w = stampOn(skirt, 'burn');
    const before = JSON.stringify(w);
    expect(JSON.stringify(clothifyWound(body.prims, w, 'small'))).toBe(before);
  });
});

describe('the bullet-hole GPU flag', () => {
  it('rides flags.x bit 1, beside the cavity bit 0, under the threat fraction', () => {
    const texels = new Float32Array(32 * BASE_PRIM_STRIDE * 4);
    const p: Vec3[] = [[0, 1, 0], [0, 1.1, 0], [0, 1.2, 0]];
    writeWounds(texels, p, [0.05, 0.05, 0.05], [0, 0, 0], [0, 0, 0], undefined, undefined, {},
      undefined, [true, false, true], undefined, [5, 0, 0], [false, true, true]);
    const x = (i: number) => texels[ROW_WOUND_FLAGS * BASE_PRIM_STRIDE * 4 + i * 4]!;
    expect(Math.floor(x(0))).toBe(1);            // cavity only
    expect(Math.floor(x(1))).toBe(2);            // hole only
    expect(Math.floor(x(2))).toBe(3);            // both
    expect(x(0) - Math.floor(x(0))).toBeCloseTo(5 / 1024, 9); // threat survives
  });
  it('the shader reads it as a bitfield (a > 0.5 cavity test would read a hole as a cavity)', () => {
    expect(WOUND_MASK).toContain('if ((fBits & 1) != 0) { cav = max(cav, contribution); }');
    expect(WOUND_MASK).toContain('if ((fBits & 2) != 0) { gWoundHole = max(gWoundHole, contribution); }');
    expect(WOUND_MASK).not.toContain('flags.x > 0.5');
  });
});

describe('size-scaled carve fillet', () => {
  it('keeps k for every stock profile and sharpens only sub-5 cm wounds', () => {
    expect(APPLY_WOUNDS).toContain('let kW = woundCfg.y * clamp(w.w / 0.05, 0.1, 1.0);');
    for (const t of ['pellet', 'blast', 'burn'] as const)
      expect(WOUND_PROFILES[t].radius, t).toBeGreaterThanOrEqual(0.05);
    expect(CLOTH_BULLET_HOLE_RADIUS).toBeLessThan(0.05);
  });
});

describe('kickHem', () => {
  it('moves ONLY the hem pendulum point', () => {
    const bound = bindRig(body);
    const kicked = kickHem(bound, [0.2, 0, 0]);
    const hemI = bound.rig.restScale!.findIndex(k => k !== 1);
    bound.rig.points.forEach((p, i) => {
      const moved = len(sub(kicked.rig.points[i]!.pos, p.pos));
      expect(moved, `point ${i}`).toBeCloseTo(i === hemI ? 0.2 : 0, 9);
    });
  });
  it('is a no-op on a body with no hem', () => {
    const zombie = buildBody(compileBlob(parseBlob(cultistSrc.replace(/^\s*bone hem .*$/m, '').replace(/ on hem /g, ' on spine '))));
    const bound = bindRig(zombie);
    expect(kickHem(bound, [1, 0, 0])).toBe(bound);
  });
});

// SOFT-TARGET DECALS (owner playtest 2026-09-24): "it would just pass through
// the cloth and hit the flesh ... the rips and tears can be replaced with
// decals". A soft target's robe is painted, never carved.
describe('clothDecal', () => {
  it('a slug on the robe becomes a capped, carve-free stain with no gut spill', () => {
    const w = clothDecal(body.prims, clothifyWound(body.prims,
      { ...stampOn(skirt, 'blast'), radius: 0.16, cavity: true, spillCalibre: 'slug' as const }, 'heavy'));
    expect(w.decal).toBe(true);
    expect(w.cloth).toBe('tear');
    expect(w.radius).toBe(CLOTH_STAIN_MAX_RADIUS);
    expect(w.cavity).toBeUndefined();
    expect(w.spillCalibre).toBeUndefined();
  });
  it('a small-calibre hole stays a hole, now as a decal', () => {
    const w = clothDecal(body.prims, clothifyWound(body.prims, stampOn(skirt), 'small'));
    expect(w.decal).toBe(true);
    expect(w.cloth).toBe('hole');
    expect(w.radius).toBe(CLOTH_BULLET_HOLE_RADIUS);
  });
  it('bare flesh and burns still carve (a face shot is a wound)', () => {
    expect(clothDecal(body.prims, stampOn(hand)).decal).toBeUndefined();
    expect(clothDecal(body.prims, stampOn(skirt, 'burn')).decal).toBeUndefined();
  });
  it('rides flags.x bit 4 beside cavity and hole', () => {
    const texels = new Float32Array(32 * BASE_PRIM_STRIDE * 4);
    const p: Vec3[] = [[0, 1, 0], [0, 1.1, 0]];
    writeWounds(texels, p, [0.05, 0.05], [0, 0], [0, 0], undefined, undefined, {},
      undefined, undefined, undefined, [0, 0], [false, true], [true, true]);
    const x = (i: number) => texels[ROW_WOUND_FLAGS * BASE_PRIM_STRIDE * 4 + i * 4]!;
    expect(x(0)).toBe(4);
    expect(x(1)).toBe(6);
  });
  it('every carve skips a decal; the mask paints it outside the flesh wound mask', () => {
    expect(APPLY_WOUNDS).toContain('if ((i32(wFlags.x) & 4) != 0) { continue; }');
    expect(NORMAL_GRADIENT_WGSL).toContain('if ((i32(flagsRow.x) & 4) != 0) { continue; }');
    const decal = WOUND_MASK.indexOf('if ((fBits & 4) != 0)');
    expect(decal).toBeGreaterThan(-1);
    expect(decal).toBeLessThan(WOUND_MASK.indexOf('m = max(m, contribution);'));
    expect(PAINT_CHAR_BLOCK).toContain('gClothStain');
    expect(PAINT_CHAR_BLOCK).toContain('gClothMark');
  });
});
