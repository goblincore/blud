// src/lab/sdf-zombie/damage-lips.test.ts
//
// The lips that went with the limb (damage.ts lipsAfterSever): after a sever a lip is taken only where it would stand
// in removed flesh (on flesh that is gone, in a crater's hole, in the stump's bowl), and nowhere by mere nearness.
import { afterEach, describe, expect, it } from 'vitest';
import {
  LIP_HOLE_SHARE, LIP_RING, STUMP_LIP, WOUND_PROFILES, inCarveHole, lipShareInHoles, lipsAfterSever, setStumpLip, stumpLipShare,
  type CarveHole, type Wound,
} from './damage';
import type { Primitive, Vec3 } from './types';
import { createWoundRing } from './webgpu/character-view';

afterEach(() => setStumpLip(STUMP_LIP));

/** Point prims whose own frame is the world's (an identity orient: a wound's `local` is then a world offset from
 *  the prim's point): 0 a head at (0, 1.6, 0), 1 a torso at (0, 1.3, 0), 2 an upper arm at (0.25, 1.35, 0), 3 a
 *  forearm at (0.25, 1.05, 0); the head is one cluster, the torso one, the arm one. */
const prim = (at: Vec3, limb: 'head' | 'torso' | 'armL', o: Partial<Primitive> = {}): Primitive =>
  ({ a: at, b: at, radius: 0.12, scale: [1, 1, 1], blendK: 0.003, limb, cluster: limb === 'head' ? 0 : limb === 'torso' ? 1 : 2, orient: [0, 0, 0, 1], ...o });
const PRIMS = [prim([0, 1.6, 0], 'head'), prim([0, 1.3, 0], 'torso'), prim([0.25, 1.35, 0], 'armL'), prim([0.25, 1.05, 0], 'armL')];
const WHOLE = [{ start: 0, count: 1, alive: true }, { start: 1, count: 1, alive: true }, { start: 2, count: 2, alive: true }];
const HEADLESS = [{ ...WHOLE[0]!, alive: false }, WHOLE[1]!, WHOLE[2]!];
/** A crater on prim `primIdx`, `offset` from the prim's point. */
const crater = (primIdx: number, offset: Vec3, radius: number, o: Partial<Wound> = {}): Wound =>
  ({ primIdx, local: offset, radius, type: 'blast', ageSec: 0, ...o });
const lips = (ws: readonly Wound[]) => ws.map(w => w.rimScale ?? 1);

// The head's stump as the game stamps it on a zombie (sever.ts: 0.112 m, a whole ball), 16.7 cm over the torso's point.
const STUMP = (): Wound => crater(1, [0, 0.167, 0], 0.112, { injuryIgnored: true });
/** A slug's crater (0.16 m) `from` the stump's centre. */
const slug = (from: Vec3, o: Partial<Wound> = {}): Wound => crater(1, [from[0], 0.167 + from[1], from[2]], 0.16, o);

describe('the lip\'s shell and the holes it may stand in', () => {
  const ball = (centre: Vec3, radius: number): CarveHole => ({ centre, radius, inward: null, depth: 0 });
  it('a point is in a hole when it is in the ball and above the floor', () => {
    const whole = ball([0, 1, 0], 0.1), floored: CarveHole = { centre: [0, 1, 0], radius: 0.1, inward: [0, -1, 0], depth: 0.03 };
    expect(inCarveHole([0, 1.05, 0], whole)).toBe(true);
    expect(inCarveHole([0, 0.92, 0], whole)).toBe(true);
    expect(inCarveHole([0, 1.11, 0], whole)).toBe(false);
    // 8 cm under the anchor is past a floor 3 cm down; 2 cm under is not; above the anchor there is no floor.
    expect(inCarveHole([0, 0.92, 0], floored)).toBe(false);
    expect(inCarveHole([0, 0.98, 0], floored)).toBe(true);
    expect(inCarveHole([0, 1.08, 0], floored)).toBe(true);
  });
  it('the share of a shell inside a ball is the cap the ball cuts from it', () => {
    // A sphere of radius r about the origin against a ball of radius R whose centre is d away: the part inside is the
    // cap where cos(angle) > (d^2 + r^2 - R^2) / (2 d r), a share (1 - that) / 2 of the sphere.
    for (const [r, R, d] of [[0.1, 0.16, 0.05], [0.1, 0.16, 0.12], [0.1, 0.16, 0.2], [0.1, 0.05, 0.1], [0.12, 0.12, 0.12]] as const) {
      const c = Math.min(1, Math.max(-1, (d * d + r * r - R * R) / (2 * d * r)));
      expect(lipShareInHoles([0, 0, 0], r, [ball([d, 0, 0], R)]), `${r} ${R} ${d}`).toBeCloseTo((1 - c) / 2, 1);
    }
    expect(lipShareInHoles([0, 0, 0], 0.1, [ball([0.01, 0, 0], 0.2)])).toBe(1);
    expect(lipShareInHoles([0, 0, 0], 0.1, [ball([0.5, 0, 0], 0.2)])).toBe(0);
    expect(lipShareInHoles([0, 0, 0], 0.1, [])).toBe(0);
    // Two holes: a point in either counts once.
    const one = lipShareInHoles([0, 0, 0], 0.1, [ball([0.12, 0, 0], 0.1)]);
    expect(lipShareInHoles([0, 0, 0], 0.1, [ball([0.12, 0, 0], 0.1), ball([-0.12, 0, 0], 0.1)])).toBeCloseTo(2 * one, 1);
    expect(lipShareInHoles([0, 0, 0], 0.1, [ball([0.12, 0, 0], 0.1), ball([0.12, 0, 0], 0.1)])).toBe(one);
  });
  it('a stump\'s lip stands 1.15 x its profile\'s offset out from its centre', () => {
    expect(LIP_RING).toBe(1.15);
    expect(LIP_HOLE_SHARE).toBe(0.5);
  });
});

describe('lipsAfterSever', () => {
  it('a crater on flesh that is gone loses its lip: a dead cluster, a dead prim', () => {
    const onHead = crater(0, [0, 0, 0.12], 0.05), onTorso = crater(1, [0, -0.1, 0.12], 0.05);
    const out = lipsAfterSever([onHead, onTorso], PRIMS, HEADLESS, null);
    expect(out[0]!.rimScale).toBe(0);
    expect(out[1]).toBe(onTorso);
    // The carve and everything else of the wound stay.
    expect(out[0]).toMatchObject({ primIdx: 0, radius: 0.05, type: 'blast', local: [0, 0, 0.12] });
    const deadPrim = [{ ...PRIMS[0]!, dead: true }, ...PRIMS.slice(1)];
    expect(lipsAfterSever([onHead, onTorso], deadPrim, WHOLE, null)[0]!.rimScale).toBe(0);
  });

  it('THE STUMP OPENS IN A SLUG\'S CRATER (the floating piece): the stump loses its lip, and so does the crater that holds it', () => {
    // As staged in the game: the slug that cut the neck left its 16 cm crater 4.5 cm from the stump's centre.
    const stump = STUMP(), holds = slug([0.021, -0.039, 0.009]);
    const out = lipsAfterSever([holds, stump], PRIMS, HEADLESS, stump);
    expect(lips(out)).toEqual([0, 0]);
    // The carves stay.
    expect(out[0]).toMatchObject({ radius: 0.16, local: holds.local });
    expect(out[1]).toMatchObject({ radius: 0.112, local: stump.local });
    // The same with the crater that took the head's own flesh beside them (gone with the head).
    const onNeck = crater(0, [0, -0.15, 0.05], 0.16, { rimScale: 0.3 });
    expect(lips(lipsAfterSever([onNeck, holds, stump], PRIMS, HEADLESS, stump))).toEqual([0, 0, 0]);
  });

  it('A SLUG DECAPITATION WITH AN EARLIER CHEST CRATER: the chest crater keeps its lip, and the stump its own', () => {
    // As staged: a slug crater on the chest, 17 cm from the stump's centre (16 cm under it). The reach the rule once
    // had (the stump's radius plus 1.6 of the crater's, 37 cm) took both lips.
    const stump = STUMP(), chest = slug([0.023, -0.162, 0.053]);
    const wounds = [chest, stump];
    expect(lipsAfterSever(wounds, PRIMS, HEADLESS, stump)).toBe(wounds);
    // With the slug that cut the neck, which holds the bowl: that one and the stump go, the chest's stays.
    const holds = slug([0.021, -0.039, 0.009]);
    const out = lipsAfterSever([chest, holds, stump], PRIMS, HEADLESS, stump);
    expect(lips(out)).toEqual([1, 0, 0]);
    expect(out[0]).toBe(chest);
  });

  it('A SLUG CRATER BESIDE THE STUMP: both keep their lips', () => {
    // A slug's crater on a shoulder, 16 to 30 cm to one side of the stump's centre: beside the bowl, not holding it.
    for (const d of [0.16, 0.2, 0.3]) {
      const stump = STUMP(), beside = slug([d, -0.05, 0]);
      const wounds = [beside, stump];
      expect(lipsAfterSever(wounds, PRIMS, HEADLESS, stump), `${d} m`).toBe(wounds);
    }
  });

  it('AN ARM SEVER BESIDE A CRATER: the crater on the chest keeps its lip; a crater the arm\'s stump opens in loses it with the stump', () => {
    // The forearm is cut off at the elbow: its prim is dead, and the stump (5.8 cm) rides the upper arm.
    const prims = [...PRIMS.slice(0, 3), { ...PRIMS[3]!, dead: true }];
    const stump = crater(2, [0, -0.15, 0], 0.058, { injuryIgnored: true });
    const chest = crater(1, [0.08, 0.05, 0.1], 0.16), onForearm = crater(3, [0, 0.05, 0.05], 0.09);
    // A slug's crater on the upper arm 12 cm above the stump holds the stump's shell; one 22 cm above does not.
    const near = crater(2, [0, -0.03, 0.02], 0.16), far = crater(2, [0, 0.07, 0.02], 0.16);
    const out = lipsAfterSever([chest, onForearm, near, far, stump], prims, WHOLE, stump);
    expect(lips(out)).toEqual([1, 0, 0, 1, 0]);
    expect(out[0]).toBe(chest);
    expect(out[3]).toBe(far);
    // With only the chest's crater, nothing changes at all.
    const wounds = [chest, stump];
    expect(lipsAfterSever(wounds, prims, WHOLE, stump)).toBe(wounds);
  });

  it('A CRATER IN THE BOWL loses its lip (its centre is in the stump\'s carve); one on the bowl\'s edge or outside keeps it; the stump keeps its own beside small craters', () => {
    const stump = STUMP();
    const inside = crater(1, [0.02, 0.167, 0], 0.03), deep = crater(1, [0.1, 0.167, 0], 0.055);
    const edge = crater(1, [0.12, 0.167, 0], 0.055), outside = crater(1, [0.2, 0.12, 0], 0.055);
    const out = lipsAfterSever([inside, deep, edge, outside, stump], PRIMS, HEADLESS, stump);
    expect(lips(out)).toEqual([0, 0, 1, 1, 1]);
    expect(out[4]).toBe(stump);
    // Many pellet craters round the bowl (a decapitation by pellets): none holds the stump's shell, and the ones whose
    // centres are outside the bowl keep their lips.
    const round = Array.from({ length: 8 }, (_, k) => crater(1, [0.13 * Math.cos(k * Math.PI / 4), 0.14, 0.13 * Math.sin(k * Math.PI / 4)], 0.055));
    const wounds = [...round, stump];
    expect(lipsAfterSever(wounds, PRIMS, HEADLESS, stump)).toBe(wounds);
  });

  it('a crater\'s FLOOR counts: a shallow crater over the stump does not hold its shell, a deep one does', () => {
    const stump = STUMP();
    // A slug's crater anchored 10 cm in front of the stump's centre, floored 3 cm in from its anchor: nearly all of
    // the stump's shell is behind that floor, in flesh the crater left.
    const shallow = slug([0, 0, 0.1], { carveN: [0, 0, -1], carveDepth: 0.03 });
    const out = lipsAfterSever([shallow, stump], PRIMS, HEADLESS, stump);
    // Its centre is in the bowl, so its own lip goes; the stump keeps its lip.
    expect(lips(out)).toEqual([0, 1]);
    expect(out[1]).toBe(stump);
    // The same crater 25 cm deep is the whole ball there, and holds most of the shell.
    const deep = slug([0, 0, 0.1], { carveN: [0, 0, -1], carveDepth: 0.25 });
    expect(lips(lipsAfterSever([deep, stump], PRIMS, HEADLESS, stump))).toEqual([0, 0]);
  });

  it('two craters that hold the stump\'s shell only together: the stump loses its lip, and each crater keeps its own', () => {
    const stump = STUMP();
    const a = crater(1, [0.13, 0.167, 0], 0.13), b = crater(1, [-0.13, 0.167, 0], 0.13);
    expect(lipShareInHoles([0, 1.467, 0], 0.112 * LIP_RING * WOUND_PROFILES.blast.rimOffsetScale, [{ centre: [0.13, 1.467, 0], radius: 0.13, inward: null, depth: 0 }])).toBeLessThan(LIP_HOLE_SHARE);
    const out = lipsAfterSever([a, b, stump], PRIMS, HEADLESS, stump);
    expect(lips(out)).toEqual([1, 1, 0]);
  });

  it('decals, cuts, burns and craters that already have no lip are left alone, and with nothing to change the list is the same one', () => {
    const stump = STUMP();
    const decal = crater(1, [0.02, 0.15, 0], 0.16, { decal: true });
    const cut = crater(1, [0.02, 0.15, 0], 0.16, { shape: 'cut' });
    const bare = crater(1, [0, 0.4, 0.1], 0.06, { rimScale: 0 });
    const wounds = [decal, cut, bare];
    expect(lipsAfterSever(wounds, PRIMS, WHOLE, null)).toBe(wounds);
    // A decal and a cut carve no hole for the stump's lip to stand in, though they sit where a holding crater would.
    const withStump = [decal, cut, crater(1, [0, -0.3, 0.12], 0.05), stump];
    expect(lipsAfterSever(withStump, PRIMS, HEADLESS, stump)).toBe(withStump);
  });

  it('at a share of 1 (the look before), every lip is left as it was; in between, a taken lip keeps that share', () => {
    const wounds = [crater(0, [0, 0, 0.12], 0.05, { rimScale: 0.8 })];
    setStumpLip(1);
    expect(stumpLipShare()).toBe(1);
    expect(lipsAfterSever(wounds, PRIMS, HEADLESS, null)).toBe(wounds);
    setStumpLip(0.25);
    expect(lipsAfterSever(wounds, PRIMS, HEADLESS, null)[0]!.rimScale).toBeCloseTo(0.2, 9);
    const stump = STUMP(), holds = slug([0.021, -0.039, 0.009]);
    expect(lips(lipsAfterSever([holds, stump], PRIMS, HEADLESS, stump))).toEqual([0.25, 0.25]);
  });
});

describe('the upload: a wound with no lip sends a lip of no height', () => {
  it('the ring uploads rimScale 0 as 0, as it did before a sever could take a lip, and a whole lip as the profile\'s', () => {
    const ring = createWoundRing();
    const posed = { prims: PRIMS, clusters: HEADLESS.map((c, id) => ({ ...c, id, limb: id === 0 ? 'head' : 'torso', center: [0, 0, 0] as Vec3, radius: 1 })) };
    const whole = crater(1, [0, -0.1, 0.12], 0.05), bare = crater(0, [0, 0, 0.12], 0.05);
    ring.stamp(whole, posed as never, 0);
    ring.stamp(bare, posed as never, 0);
    ring.set([...lipsAfterSever(ring.all(), PRIMS, HEADLESS, null)]);
    let splay: readonly number[] = [];
    const gpu = { setWounds: (_p: unknown, _r: unknown, _t: unknown, _a: unknown, splayScales: readonly number[]) => { splay = splayScales; } };
    ring.refresh(gpu as never, posed as never, 0);
    expect(splay[0]).toBe(WOUND_PROFILES.blast.rimSplayScale);
    expect(splay[1]).toBe(0);
  });
});
