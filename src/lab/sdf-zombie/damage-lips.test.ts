// src/lab/sdf-zombie/damage-lips.test.ts
//
// The lips that went with the limb (damage.ts lipsAfterSever): after a sever, no crater's everted lip is left
// standing over the stump's hole or on flesh that is gone.
import { afterEach, describe, expect, it } from 'vitest';
import { LIP_REACH, lipsAfterSever, setStumpLips, stumpLipsEnabled, type Wound } from './damage';
import type { Primitive, Vec3 } from './types';
import { createWoundRing } from './webgpu/character-view';

afterEach(() => setStumpLips(true));

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
    // (The stump's own ring reaches into the near crater's carve, so it goes too: the next test.)
    expect(out.map(w => w.rimScale)).toEqual([0, undefined, 0, undefined, 0]);
    expect(out[1]).toBe(far);
    expect(out[3]).toBe(outside);
  });
  it('the stump loses its own lip when it opens inside a bigger crater\'s carve', () => {
    const stump = crater(1, [0, 0.15, 0], 0.11);
    const big = crater(1, [0.02, 0.14, 0.02], 0.16);
    const out = lipsAfterSever([big, stump], PRIMS, BOTH, stump);
    expect(out[0]!.rimScale).toBe(0);
    expect(out[1]!.rimScale).toBe(0);
    // A stump with nothing near it keeps its ragged edge.
    const alone = lipsAfterSever([crater(1, [0, -0.3, 0.12], 0.05), stump], PRIMS, BOTH, stump);
    expect(alone[1]).toBe(stump);
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
  it('switched off (the look before), every lip is left as it was', () => {
    setStumpLips(false);
    expect(stumpLipsEnabled()).toBe(false);
    const wounds = [crater(0, [0, 0, 0.12], 0.05)];
    expect(lipsAfterSever(wounds, PRIMS, HEADLESS, null)).toBe(wounds);
  });
});

describe('the upload: a wound with no lip sends a zero lip height', () => {
  it('the ring uploads rimScale 0 as splay 0, and a whole lip as the profile\'s', () => {
    const ring = createWoundRing();
    const posed = { prims: PRIMS, clusters: BOTH.map((c, id) => ({ ...c, id, limb: id === 0 ? 'head' : 'torso', center: [0, 0, 0] as Vec3, radius: 1 })) };
    const whole = crater(1, [0, -0.1, 0.12], 0.05), bare = crater(0, [0, 0, 0.12], 0.05);
    ring.stamp(whole, posed as never, 0);
    ring.stamp(bare, posed as never, 0);
    ring.set([...lipsAfterSever(ring.all(), PRIMS, HEADLESS, null)]);
    let splay: readonly number[] = [];
    const gpu = { setWounds: (_p: unknown, _r: unknown, _t: unknown, _a: unknown, splayScales: readonly number[]) => { splay = splayScales; } };
    ring.refresh(gpu as never, posed as never, 0);
    expect(splay[0]).toBeGreaterThan(0);
    expect(splay[1]).toBe(0);
  });
});
