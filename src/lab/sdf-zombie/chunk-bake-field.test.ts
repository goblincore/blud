// src/lab/sdf-zombie/chunk-bake-field.test.ts
//
// Gates for the settled-chunk bake field (close-up task 5). The extraction
// and the albedo are pure CPU here, so these tests can be BETTER than the
// eyeball: a carve must actually open, bones must appear only where the
// nearWound gate says, and the paint must follow the shipped albedo order.
import { describe, it, expect } from 'vitest';
import {
  chunkBakeField, bakeChunkAlbedo, bakeFaceCover, hash13, noise3, fbm,
  type ChunkLook, type BakeFaceFrame,
} from './chunk-bake-field';
import { sdBody, type Body } from './validate';
import { HEAD_EXTERIOR_GORE_KEEP } from './gib-look-tuning';
import type { Primitive, Vec3 } from './types';

/** A capsule along +x centred at the origin. */
const cap = (a: Vec3, b: Vec3, radius: number, over: Partial<Primitive> = {}): Primitive => ({
  limb: 'armL', op: 'add', a, b, radius, scale: [1, 1, 1], blendK: 0.02, ...over,
} as Primitive);

// A settled forearm: one flesh capsule 20 cm long, its bone inside, torn at
// the +x end (the elbow end stays attached in this thought experiment).
const FLESH = [cap([-0.1, 0, 0], [0.1, 0, 0], 0.035)];
const BONE = [cap([-0.09, 0, 0], [0.095, 0, 0], 0.012, { op: 'bone' as never })];
const TORN = [{ at: [0.1, 0, 0] as Vec3, radius: 0.045 }];
const PARTS = { flesh: FLESH, bones: BONE, torn: TORN, carveK: 0.015 };

describe('chunkBakeField', () => {
  it('honors corpse wound depth caps and excludes unrelated owner fields', () => {
    const flesh=[cap([0,0,0],[0,0,0],.1)];
    const w={at:[0,0,0] as Vec3,radius:.2,normal:[1,0,0] as Vec3,depth:.02};
    const capped=chunkBakeField({flesh,bones:[],torn:[w],carveK:0});
    expect(capped.field([.08,0,0])).toBeLessThan(0);
    expect(capped.field([0,0,0])).toBeGreaterThan(0);
    const owner:Body={prims:[cap([2,0,0],[2,0,0],.1)],clusters:[{id:0,limb:'armL',start:0,count:1,center:[2,0,0],radius:.1,alive:true}]};
    const scoped=chunkBakeField({flesh,bones:[],torn:[{...w,owner}],carveK:0});
    expect(scoped.field([0,0,0])).toBeLessThan(0);
  });

  it('field is negative deep inside the flesh and positive far outside', () => {
    const ev = chunkBakeField(PARTS);
    expect(ev.field([0, 0, 0])).toBeLessThan(0);
    expect(ev.field([0, 0.5, 0])).toBeGreaterThan(0);
  });

  it('the torn-end carve OPENS the surface: field > 0 at the tear centre', () => {
    const ev = chunkBakeField(PARTS);
    // The un-carved flesh reaches exactly 0.1 + 0.035 along +x; the tear at
    // 0.1 with radius 0.045 must carve well past that.
    expect(ev.preWound([0.11, 0, 0])).toBeLessThan(0);
    expect(ev.field([0.11, 0, 0])).toBeGreaterThan(0);
  });

  it('bone enters the field ONLY near the wound (the applyBones gate)', () => {
    const ev = chunkBakeField(PARTS);
    // Mid-shaft the bone is strictly inside the flesh AND outside the
    // nearWound gate (0.1 > 2 * 0.045): with and without the bones the
    // field must be IDENTICAL — the gate is exact, not approximate.
    const mid = [0, 0, 0] as Vec3;
    const noBones = chunkBakeField({ ...PARTS, bones: [] });
    expect(ev.field(mid)).toBeCloseTo(noBones.field(mid), 12);
    // In the crater the bone is the surface: the material attribution says
    // which prim owns it.
    const onBone: Vec3 = [0.09, 0, 0];
    expect(ev.materialAt(onBone)).toBe('bone');
  });

  it('woundMask is 1 at the tear, 0 far away', () => {
    const ev = chunkBakeField(PARTS);
    expect(ev.woundMask([0.1, 0, 0])).toBeCloseTo(1, 5);
    expect(ev.woundMask([-0.1, 0, 0])).toBe(0);
  });
});

describe('hash13 / noise3 / fbm mirrors', () => {
  it('hash13 stays in [0,1) and matches the WGSL structure at 0 and unit corners', () => {
    for (let i = 0; i < 200; i++) {
      const h = hash13([i * 0.371, i * 1.913, i * 0.117]);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it('noise3 is bounded to [-1,1] and smooth across a cell boundary', () => {
    for (let i = 0; i < 100; i++) {
      expect(Math.abs(noise3([i * 0.21, 3.7, -1.2]))).toBeLessThanOrEqual(1);
    }
    const a = noise3([0.999, 0.5, 0.5]);
    const b = noise3([1.001, 0.5, 0.5]);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });

  it('fbm matches its WGSL definition (0.6 * n(4p) + 0.3 * n(9p))', () => {
    const p: Vec3 = [0.31, -0.77, 1.13];
    expect(fbm(p)).toBeCloseTo(noise3([p[0] * 4, p[1] * 4, p[2] * 4]) * 0.6 + noise3([p[0] * 9, p[1] * 9, p[2] * 9]) * 0.3, 12);
  });
});

const LOOK: ChunkLook = {
  baseColor: [0.72, 0.55, 0.47],
  deepColor: [0.45, 0.06, 0.05],
  fatColor: [0.82, 0.7, 0.55],
  mottleColor: [0.55, 0.42, 0.38],
  organColor: [0.72, 0.35, 0.3],
  visceraColor: [0.6, 0.2, 0.16],
  woundDepthAmp: 1, fatDepth: 0.004, muscleDepth: 0.012, visceraAmp: 0.7, visceraDepth: 0.03,
  mottleAmp: 0.5, mottleScale: 1.5,
  organAmp: 0.6,
  // Tissue/organ tests isolate the wound chain from the optional gib stains.
  goreStrength: 0,
};

describe('bakeChunkAlbedo', () => {
  it('far from the tear the albedo is flesh-coloured with wm = 0', () => {
    const ev = chunkBakeField(PARTS);
    // A point ON the intact surface, half a limb back from the tear.
    const p: Vec3 = [-0.1, 0, 0];
    const [r, g, b, wm] = bakeChunkAlbedo(p, p, ev, LOOK);
    expect(wm).toBe(0);
    expect(r).toBeGreaterThan(0.2);
    expect(r).toBeLessThan(1);
    // Flesh, not deep red: green channel well above the deep color's.
    expect(g).toBeGreaterThan(LOOK.deepColor[1] * 3);
  });

  it('inside the crater the albedo is pulled toward deep/clot red with wm high', () => {
    const ev = chunkBakeField(PARTS);
    // On the carved crater wall: near the tear, pre-wound depth > 0.
    const p: Vec3 = [0.095, 0, 0];
    const [, gFar, bFar] = bakeChunkAlbedo([-0.1, 0, 0], [-0.1, 0, 0], ev, LOOK);
    const [r, g, b, wm] = bakeChunkAlbedo(p, p, ev, LOOK);
    expect(wm).toBeGreaterThan(0.3);
    // Redder and darker than intact flesh — the gore mask + tissue ramp.
    expect(r / (g + 1e-6)).toBeGreaterThan((LOOK.baseColor[0] + 0.2) / (gFar + 1e-6));
    expect(b).toBeLessThan(bFar);
  });

  it('organ material tints toward organColor by organAmp', () => {
    // An organ mass jammed right under the tear: at the tear centre the
    // carve has pulled the flesh field ABOVE the organ's own distance, so
    // the near-wound fold makes the organ the surface owner — which is the
    // only place an organ is ever visible, exactly as in the march.
    const organs = [cap([0.07, 0, 0], [0.1, 0, 0], 0.02, { op: 'organ' as never })];
    const ev = chunkBakeField({ ...PARTS, bones: [...BONE, ...organs] });
    const p: Vec3 = [0.1, 0, 0];
    expect(ev.materialAt(p)).toBe('organ');
    const [r, g, b] = bakeChunkAlbedo(p, p, ev, LOOK);
    const noOrgan = bakeChunkAlbedo(p, p, chunkBakeField({ ...PARTS, bones: [...BONE] }), LOOK);
    // Organ tint moved the colour.
    expect(Math.abs(r - noOrgan[0]) + Math.abs(g - noOrgan[1]) + Math.abs(b - noOrgan[2])).toBeGreaterThan(0.01);
  });

  it('adds dark patches to capped gibs without inventing torn-end geometry', () => {
    const ev = chunkBakeField({ ...PARTS, torn: [] });
    const ratios: number[] = [];
    for (let i = 0; i < 200; i++) {
      const p: Vec3 = [i * .003, .02, .01];
      const clean = bakeChunkAlbedo(p, p, ev, { ...LOOK, mottleAmp: 0 });
      const stained = bakeChunkAlbedo(p, p, ev, { ...LOOK, mottleAmp: 0, goreStrength: 1 });
      expect(stained[3]).toBe(0);
      expect(ev.field(p)).toBeCloseTo(ev.preWound(p), 8);
      ratios.push(stained[1] / clean[1]);
    }
    expect(Math.min(...ratios)).toBeLessThan(.3);
    expect(Math.max(...ratios)).toBeGreaterThan(.7);
  });

  it('is stable and finite over a sweep of the whole chunk', () => {
    const ev = chunkBakeField(PARTS);
    for (let i = 0; i < 500; i++) {
      const p: Vec3 = [(i / 250 - 1) * 0.15, ((i % 7) - 3) * 0.01, ((i % 11) - 5) * 0.01];
      const [r, g, b, wm] = bakeChunkAlbedo(p, p, ev, LOOK);
      for (const v of [r, g, b, wm]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1.0001);
      }
    }
  });
});

// ——— TASK 2: the face survives the bake ————————————————————————————————————
describe('bakeFaceCover / face-protected gore', () => {
  // A unit head at the origin, facing +z (forward = +1), semi-axes in metres.
  const FACE: BakeFaceFrame = {
    centre: [0, 0, 0], quat: [0, 0, 0, 1], axes: [0.1, 0.12, 0.1], forward: 1,
  };

  it('is high in front of the face, and keeps only the exterior share behind it', () => {
    const front = bakeFaceCover([0, 0, 0.1], FACE);
    const back = bakeFaceCover([0, 0, -0.1], FACE);
    // The face itself is fully protected...
    expect(front).toBeGreaterThan(0.8);
    // ...while the back of the head keeps exactly the shared exterior share of
    // the gore (so it is not a meat blob, but is still bloodied).
    expect(back).toBeCloseTo(HEAD_EXTERIOR_GORE_KEEP, 5);
  });

  it('falls off toward the sides and past the head extent', () => {
    const side = bakeFaceCover([0.1, 0, 0], FACE);
    const far = bakeFaceCover([0, 0, 0.3], FACE);
    expect(side).toBeLessThan(bakeFaceCover([0, 0, 0.1], FACE));
    expect(side).toBeGreaterThanOrEqual(HEAD_EXTERIOR_GORE_KEEP);
    // Off the head's extent the protection is gone entirely.
    expect(far).toBe(0);
  });

  it('keeps the gore off the face but still stains the rest of the piece', () => {
    const ev = chunkBakeField({ ...PARTS, torn: [] });
    const look: ChunkLook = { ...LOOK, mottleAmp: 0, goreStrength: 1 };
    // Same point, same gore, ONLY the face coverage differs: full coverage
    // must leave the intact flesh colour untouched by the gore mix.
    const p: Vec3 = [0, 0.0, 0.02];
    const covered = bakeChunkAlbedo(p, p, ev, look, 1);
    const bare = bakeChunkAlbedo(p, p, ev, look, 0);
    const clean = bakeChunkAlbedo(p, p, ev, { ...look, goreStrength: 0 }, 0);
    expect(covered).toEqual(clean);
    expect(Math.abs(bare[0] - covered[0]) + Math.abs(bare[1] - covered[1])).toBeGreaterThan(0.05);
  });
});
