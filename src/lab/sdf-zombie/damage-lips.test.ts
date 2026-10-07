// src/lab/sdf-zombie/damage-lips.test.ts
//
// The lips that went with the limb (damage.ts lipsAfterSever): after a sever, no crater's everted lip is left
// standing over the stump's hole or on flesh that is gone.
import { afterEach, describe, expect, it } from 'vitest';
import { LIP_REACH, STUMP_LIP, WOUND_PROFILES, lipsAfterSever, setStumpLip, stumpLipShare, type Wound } from './damage';
import type { Primitive, Vec3 } from './types';
import { MIN_LIP_SPLAY, createWoundRing } from './webgpu/character-view';

afterEach(() => setStumpLip(STUMP_LIP));

/** Two point prims: 0 a head at (0, 1.6, 0), 1 a torso at (0, 1.3, 0); one cluster each. */
const prim = (y: number, limb: 'head' | 'torso', o: Partial<Primitive> = {}): Primitive =>
  ({ a: [0, y, 0], b: [0, y, 0], radius: 0.12, scale: [1, 1, 1], blendK: 0.003, limb, cluster: limb === 'head' ? 0 : 1, ...o });
const PRIMS = [prim(1.6, 'head'), prim(1.3, 'torso')];
const BOTH = [{ start: 0, count: 1, alive: true }, { start: 1, count: 1, alive: true }];
const HEADLESS = [{ start: 0, count: 1, alive: false }, { start: 1, count: 1, alive: true }];
/** A crater on prim `primIdx`, `offset` from the prim's centre (point prims at yaw 0 keep the world axes). */
const crater = (primIdx: number, offset: Vec3, radius: number, o: Partial<Wound> = {}): Wound =>
  ({ primIdx, local: offset, radius, type: 'blast', ageSec: 0, ...o });

describe('lipsAfterSever', () => {
  it('a crater on flesh that is gone loses its lip: a dead cluster, a dead prim', () => {
    const onHead = crater(0, [0, 0, 0.12], 0.05), onTorso = crater(1, [0, -0.1, 0.12], 0.05);
    const out = lipsAfterSever([onHead, onTorso], PRIMS, HEADLESS, null);
    expect(out[0]!.rimScale).toBe(0);
    expect(out[1]).toBe(onTorso);
    // The carve and everything else of the wound stay.
    expect(out[0]).toMatchObject({ primIdx: 0, radius: 0.05, type: 'blast', local: [0, 0, 0.12] });
    const deadPrim = [{ ...PRIMS[0]!, dead: true }, PRIMS[1]!];
    expect(lipsAfterSever([onHead, onTorso], deadPrim, BOTH, null)[0]!.rimScale).toBe(0);
  });
  it('a crater whose lip reaches into the stump\'s carve loses it; one out of reach keeps it', () => {
    const stump = crater(1, [0, 0.15, 0], 0.11);
    const near = crater(1, [0, 0.12, 0.1], 0.06), far = crater(1, [0, -0.3, 0.12], 0.06);
    // Just inside the reach, and just outside it.
    const edge = stump.radius + 0.06 * LIP_REACH;
    const inside = crater(1, [edge - 0.005, 0.15, 0], 0.06), outside = crater(1, [edge + 0.005, 0.15, 0], 0.06);
    const out = lipsAfterSever([near, far, inside, outside, stump], PRIMS, BOTH, stump);
    // The stump keeps its own lip: none of these craters is as big as its bowl (the next test).
    expect(out.map(w => w.rimScale)).toEqual([0, undefined, 0, undefined, undefined]);
    expect(out[4]).toBe(stump);
    expect(out[1]).toBe(far);
    expect(out[3]).toBe(outside);
  });
  it('a stump inside a bigger crater\'s carve loses its own lip, and that crater keeps the lip that lines the one hole', () => {
    const stump = crater(1, [0, 0.15, 0], 0.11);
    // A slug's 16 cm crater 3 cm from the stump's centre holds the whole 11 cm bowl.
    const big = crater(1, [0.02, 0.14, 0.02], 0.16);
    const out = lipsAfterSever([big, stump], PRIMS, BOTH, stump);
    expect(out[0]).toBe(big);
    expect(out[1]!.rimScale).toBe(0);
    // A crater with a floor nearer than its radius does not hold the bowl: the stump goes deeper than it did.
    const floored = lipsAfterSever([{ ...big, carveDepth: 0.05 }, stump], PRIMS, BOTH, stump);
    expect(floored.map(w => w.rimScale)).toEqual([0, 0]);
    // Nor does one the bowl pokes out of.
    const beside = lipsAfterSever([crater(1, [0.08, 0.14, 0.02], 0.16), stump], PRIMS, BOTH, stump);
    expect(beside.map(w => w.rimScale)).toEqual([0, 0]);
    // A stump with nothing near it keeps its ragged edge.
    const alone = lipsAfterSever([crater(1, [0, -0.3, 0.12], 0.05), stump], PRIMS, BOTH, stump);
    expect(alone[1]).toBe(stump);
  });
  it('a crater smaller than the stump\'s bowl loses its lip beside it or inside it, and the stump keeps its own', () => {
    const stump = crater(1, [0, 0.15, 0], 0.11);
    // A pellet's crater on the bowl's edge, one wholly inside the bowl, and one just under the bowl's size.
    for (const small of [crater(1, [0.1, 0.15, 0], 0.055), crater(1, [0.02, 0.15, 0], 0.03), crater(1, [0.1, 0.15, 0], 0.109)]) {
      const out = lipsAfterSever([small, stump], PRIMS, BOTH, stump);
      expect(out[0]!.rimScale).toBe(0);
      expect(out[1]).toBe(stump);
    }
    // One as big as the bowl beside it: the stump's lip would stand free in that hole.
    const same = lipsAfterSever([crater(1, [0.1, 0.15, 0], 0.11), stump], PRIMS, BOTH, stump);
    expect(same.map(w => w.rimScale)).toEqual([0, 0]);
  });
  it('decals, cuts and craters that already have no lip are left alone, and with nothing to change the list is the same one', () => {
    const stump = crater(1, [0, 0.15, 0], 0.11);
    const decal = crater(1, [0, 0.12, 0.1], 0.06, { decal: true });
    const cut = crater(1, [0, 0.12, 0.1], 0.06, { shape: 'cut' });
    const bare = crater(1, [0, 0.4, 0.1], 0.06, { rimScale: 0 });
    const wounds = [decal, cut, bare];
    expect(lipsAfterSever(wounds, PRIMS, BOTH, null)).toBe(wounds);
    const withStump = [decal, cut, crater(1, [0, -0.3, 0.12], 0.05), stump];
    expect(lipsAfterSever(withStump, PRIMS, BOTH, stump)).toBe(withStump);
  });
  it('at a share of 1 (the look before), every lip is left as it was; in between, a hanging lip keeps that share', () => {
    const wounds = [crater(0, [0, 0, 0.12], 0.05, { rimScale: 0.8 })];
    setStumpLip(1);
    expect(stumpLipShare()).toBe(1);
    expect(lipsAfterSever(wounds, PRIMS, HEADLESS, null)).toBe(wounds);
    setStumpLip(0.25);
    expect(lipsAfterSever(wounds, PRIMS, HEADLESS, null)[0]!.rimScale).toBeCloseTo(0.2, 9);
  });
});

describe('the upload: a wound with no lip sends the least lip height', () => {
  it('the ring uploads rimScale 0 as MIN_LIP_SPLAY (never 0: a NaN in the shader\'s lip gate), and a whole lip as the profile\'s', () => {
    const ring = createWoundRing();
    const posed = { prims: PRIMS, clusters: BOTH.map((c, id) => ({ ...c, id, limb: id === 0 ? 'head' : 'torso', center: [0, 0, 0] as Vec3, radius: 1 })) };
    const whole = crater(1, [0, -0.1, 0.12], 0.05), bare = crater(0, [0, 0, 0.12], 0.05);
    ring.stamp(whole, posed as never, 0);
    ring.stamp(bare, posed as never, 0);
    ring.set([...lipsAfterSever(ring.all(), PRIMS, HEADLESS, null)]);
    let splay: readonly number[] = [];
    const gpu = { setWounds: (_p: unknown, _r: unknown, _t: unknown, _a: unknown, splayScales: readonly number[]) => { splay = splayScales; } };
    ring.refresh(gpu as never, posed as never, 0);
    expect(splay[0]).toBe(WOUND_PROFILES.blast.rimSplayScale);
    expect(splay[1]).toBe(MIN_LIP_SPLAY);
    expect(MIN_LIP_SPLAY).toBeGreaterThan(0);
    // A lip under a millimetre on the largest crater (a slug's, 0.16 m, at the stock height uniform 0.55).
    expect(0.16 * 0.55 * MIN_LIP_SPLAY).toBeLessThan(0.001);
  });
});
