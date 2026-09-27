// src/lab/sdf-zombie/characters/warbull-blob.test.ts
//
// Pins the warbull body's DESIGN INTENT against the minotaur it is scaled
// from (warbull.blob's header): the minotaur's mesh-fitted flesh at 1.28x,
// its painted metal removed, the right horn and right eye handed to the kit,
// and a hump added. Structural pins, like juggernaut-blob.test.ts; whether
// he reads as a cyber-bull is the kit's and the frames' job.
import { describe, it, expect } from 'vitest';
import src from './warbull.blob?raw';
import minotaurSrc from './minotaur.blob?raw';
import soldierSrc from './soldier.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf, daylightOf, fusedOf, strandedOf } from '../blob-checks';
import { sdBody } from '../validate';
import { WALL_H } from '../webgpu/game-level';
// @ts-expect-error — node:fs available in vitest (silhouette.test.ts's pattern)
import { readFileSync } from 'node:fs';
import { WARBULL_PROFILE } from '../motion-profile';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { makeRng } from '../wander';
import { GUN_GRIP, gunPoint } from '../carry';

const doc = parseBlob(src);
const minoDoc = parseBlob(minotaurSrc);
type Built = ReturnType<typeof buildBody>;
const build = (d: typeof doc): Built => buildBody(compileBlob(d, compileFace(d)));
const bull = build(doc);
const mino = build(minoDoc);
const soldier = build(parseBlob(soldierSrc));
const limb = (b: Built, l: string) => b.clusters.find(c => c.limb === l)!;
const S = 1.28;

/** Highest point of the SURFACE (a field march; a prim bound over-counts a
 *  tapered horn tip by its fat-end radius). */
const topOf = (b: Built) => {
  let top = 0;
  for (let x = -0.5; x <= 0.5; x += 0.01) for (let z = -0.3; z <= 0.4; z += 0.02) {
    let y = 3;
    while (y > top && sdBody([x, y, z], b) > 0.002) y -= 0.005;
    top = Math.max(top, y);
  }
  return top;
};
/** Head prims reaching further out than `x` on the given side. */
const headOut = (b: Built, side: 1 | -1, x: number) => {
  const c = limb(b, 'head');
  return b.prims.slice(c.start, c.start + c.count).filter(p => p.op !== 'sub' && Math.max(side * p.a[0], side * p.b[0]) > x);
};
/** Centreline back surface at height y (the most negative z still inside). */
const backAt = (b: Built, y: number) => {
  let z = -1;
  while (z < 0.5 && sdBody([0, y, z], b) > 0.001) z += 0.002;
  return z;
};

describe('warbull.blob', () => {
  it('compiles and validates clean', () => {
    expect(bull.errors).toEqual([]);
  });

  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  it('declares humanoid and passes the stance check', () => {
    expect(doc.stance).toBe('humanoid');
    expect(checkStance(bull.bones, doc.stance)).toEqual([]);
  });

  // Same bone NAMES as the soldier, so the soldier-family systems (carry,
  // regional injury, plates keyed by bone) can drive him.
  it('uses the soldier\'s bone names', () => {
    expect([...bull.bones.keys()].sort()).toEqual([...soldier.bones.keys()].sort());
  });

  // The two exceptions are the head pivot (warbull.blob's skeleton comment):
  // the skull starts at 2.05, not the minotaur's 1.775 x S, and the clavicles
  // hang from spine2, so their HEADS move while their tails, where the arms
  // attach, stay exactly on the minotaur's.
  it('is the minotaur scaled 1.28: every bone joint moves by exactly S, bar the head pivot', () => {
    expect(doc.height! / minoDoc.height!).toBeCloseTo(S, 3);
    for (const [name, bone] of mino.bones) {
      const moved = name === 'skull' || name.startsWith('clavicle');
      for (let k = 0; k < 3; k++) {
        if (!moved) expect(bull.bones.get(name)!.head[k], `${name}[${k}]`).toBeCloseTo(bone.head[k]! * S, 3);
        if (name !== 'skull' && name !== 'neck') expect(bull.bones.get(name)!.tail[k], `${name} tail[${k}]`).toBeCloseTo(bone.tail[k]! * S, 3);
      }
    }
    expect(bull.bones.get('skull')!.head[1]).toBeCloseTo(2.05, 2);
  });

  // The cranium stays where the minotaur's face block puts it, x S.
  it('keeps the cranium where the minotaur has it, scaled', () => {
    const cran = (b: Built) => { const h = limb(b, 'head'); return b.prims.slice(h.start, h.start + h.count).reduce((a, p) => (p.radius > a.radius ? p : a)); };
    for (let k = 0; k < 3; k++) expect(cran(bull).a[k]).toBeCloseTo(cran(mino).a[k]! * S, 3);
  });

  // The horn is his highest point, and it must clear no ceiling: rooms are
  // WALL_H (3.0 m) tall and his stride bobs.
  it('tops out at ~2.60 m on the horn, under the room ceiling with headroom', () => {
    const top = topOf(bull);
    expect(top).toBeGreaterThan(2.55);
    expect(top).toBeLessThan(WALL_H - 0.35);
  });

  it('keeps only the LEFT flesh horn and eye; the right side is the kit\'s', () => {
    // The horn sweep reaches x ~0.33 m; the root bosses stop at ~0.2.
    expect(headOut(bull, 1, 0.25).length).toBeGreaterThan(0);
    expect(headOut(bull, -1, 0.25)).toEqual([]);
    const glow = bull.prims.filter(p => (p.glow ?? 0) > 0);
    expect(glow.length).toBe(1);
    expect(glow[0]!.a[0]).toBeGreaterThan(0);
  });

  it('carries no painted metal: every hard surface is the kit\'s', () => {
    expect(bull.prims.filter(p => p.metal || p.box)).toEqual([]);
  });

  // The hump pushes the back of the neck out where the minotaur has only the
  // gap behind his traps.
  it('has a hump behind the neck at least 4 cm proud of the minotaur\'s back', () => {
    for (const y of [1.70, 1.75, 1.80])
      expect(backAt(bull, y), `y ${y}`).toBeLessThan(backAt(mino, y / S) * S - 0.04);
  });

  it('is still one body: arms, legs and head fuse to the torso', () => {
    for (const l of ['armL', 'armR', 'legL', 'legR', 'head'] as const)
      expect(fusedOf(bull, limb(bull, l), limb(bull, 'torso')), l).toBeLessThan(0);
  });

  // Uniform scale keeps every clearance ratio, so the pin is: no worse than
  // the minotaur, scaled.
  it.each(['armL', 'armR'] as const)('%s reads as a limb no worse than the minotaur\'s, scaled', arm => {
    const clav = arm === 'armL' ? 'clavicle.l' : 'clavicle.r';
    const dl = (b: Built, r: number) => daylightOf(b, limb(b, arm), limb(b, 'torso'), b.bones.get(clav)!.tail, r);
    expect(dl(bull, 0.45 * S)).toBeGreaterThanOrEqual(dl(mino, 0.45) * S - 0.002);
  });

  it('keeps the legs clear of each other and nothing stranded in a cluster', () => {
    expect(clearOf(bull, limb(bull, 'legL'), limb(bull, 'legR'))).toBeGreaterThan(0.010);
    for (const c of bull.clusters) {
      const gap = strandedOf(bull, c);
      if (gap !== null) expect(gap, `${c.limb} has a stranded prim`).toBeLessThan(0.005);
    }
  });
});

// THE LAUNCHER HOLDS (carry.ts `launcher`, `launcherLow`), through the real
// motion pipeline. The launcher casing swallows the fist, so the checks are:
// the grip seats in the fist, the muzzle points where he faces (the rockets
// fly along it), level when raised and down-forward when lowered, and the
// casing clears his body (everything but the gun arm itself).
describe('warbull launcher holds', () => {
  const noArmR = { ...bull, prims: bull.prims.map((p, i) => {
    const c = bull.clusters.find(c => i >= c.start && i < c.start + c.count)!;
    return c.limb === 'armR' ? { ...p, dead: true } : p;
  }) };
  const casing: [number, number, number][] = [];
  for (const x of [-0.095, 0.095]) for (const y of [-0.167, 0.023]) for (const z of [-0.34, -0.12, 0.03]) casing.push([x, y, z]);
  for (const z of [0.2, 0.41]) for (let i = 0; i < 6; i++) casing.push([Math.cos(i * Math.PI / 3) * 0.066, Math.sin(i * Math.PI / 3) * 0.066, z]);

  it.each([
    ['launcher', 'standing', 0, 0.0], ['launcher', 'walking', WARBULL_PROFILE.cruise, 0.0],
    ['launcherLow', 'standing', 0, -0.55], ['launcherLow', 'walking', WARBULL_PROFILE.cruise, -0.55],
  ] as const)('%s %s: fist in the casing, muzzle on his facing, casing clear', (carry, _, speed, wantPitch) => {
    const m = makeActorMotion(bull, { seed: 7 });
    const rng = makeRng(7);
    const J = m.motionJoints!.index;
    let grip = 0, yawErr = 0, pitchErr = 0, clear = Infinity, n = 0;
    for (let i = 0; i < 200; i++) {
      const f = stepActorMotion(m, {
        current: bull, dt: 1 / 60, wander: speed > 0, armStyle: undefined, headingFollow: 1, gazeFollow: 1,
        bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, rng, signals: emptyActorSignals(),
        profile: WARBULL_PROFILE, forceSpeed: speed, carryOverride: carry,
      })!;
      expect(f.carry).toBe(carry);
      if (i < 60) continue;
      const pts = m.bound.rig.points;
      const hand = pts[J.handR!]!.pos, elbow = pts[J.elbowR!]!.pos;
      const dl = Math.hypot(hand[0] - elbow[0], hand[1] - elbow[1], hand[2] - elbow[2]);
      const fist = [0, 1, 2].map(k => hand[k]! + (hand[k]! - elbow[k]!) / dl * WARBULL_PROFILE.prop!.gripReach!);
      const g = gunPoint(f.gun!, GUN_GRIP.gripHand);
      grip += Math.hypot(fist[0]! - g[0], fist[1]! - g[1], fist[2]! - g[2]);
      const a = gunPoint(f.gun!, [0, 0, 0]), b = gunPoint(f.gun!, [0, 0, 1]);
      const dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(dir[0]!, dir[1]!, dir[2]!);
      const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
      yawErr = Math.max(yawErr, Math.abs(wrap(Math.atan2(dir[0]!, dir[2]!) - f.bodyYaw)));
      pitchErr = Math.max(pitchErr, Math.abs(Math.asin(dir[1]! / l) - wantPitch));
      // The rest-pose field is compared in body-local space (the rig walks).
      const pel = pts[J.pelvis!]!.pos, c = Math.cos(-f.bodyYaw), s = Math.sin(-f.bodyYaw);
      const home = bull.bones.get('pelvis')!.head;
      for (const q of casing) {
        const w = gunPoint(f.gun!, q), x = w[0] - pel[0], z = w[2] - pel[2];
        clear = Math.min(clear, sdBody([x * c + z * s + home[0], w[1], -x * s + z * c + home[2]], noArmR));
      }
      n++;
    }
    // NOT the soldier family's 2 cm: that rule keeps a VISIBLE grip in a
    // visible fist. Here the fist is hidden inside the casing, built 0.02
    // prop-local (3.2 cm at scale 1.6) clear of it all round, so the bound
    // is that clearance. Measured: 0.2 cm standing, 2.1 cm walking (the
    // verlet wrist lags the stomp).
    expect(grip / n).toBeLessThan(0.03);
    expect(yawErr).toBeLessThan(0.12);
    expect(pitchErr).toBeLessThan(0.1);
    expect(clear).toBeGreaterThan(0.03);
  });

  it('ships the launcher prop with its locators where GUN_GRIP says, and a Barrels node', () => {
    const bytes = readFileSync('public/assets/lab/warbull-launcher.glb') as Uint8Array;
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true)))) as { nodes: { name: string; translation?: number[] }[] };
    const at = (n: string) => json.nodes.find(x => x.name === n)!.translation!;
    for (let k = 0; k < 3; k++) {
      expect(at('Grip_Hand')[k]).toBeCloseTo(GUN_GRIP.gripHand[k]!, 5);
      expect(at('Muzzle')[k]).toBeCloseTo(GUN_GRIP.muzzle[k]!, 5);
    }
    expect(json.nodes.some(n => n.name === 'Barrels')).toBe(true);
  });
});
