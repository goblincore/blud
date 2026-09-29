// src/lab/sdf-zombie/characters/warbull-blob.test.ts
//
// Pins the warbull body against its REFERENCE PLATE
// (docs/dev-notes/refs/warbull-reference.png; warbull.blob's header has the
// measurement table: 3.25 mm a pixel, the soles at y 880 px). A front plate
// gives widths by height, so that is what is pinned, as the body's own front
// silhouette read off the field; depth, the face and the kit are the frames'
// job. The second draft: nothing here refers to the minotaur.
import { describe, it, expect } from 'vitest';
import src from './warbull.blob?raw';
import soldierSrc from './soldier.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf, fusedOf, strandedOf } from '../blob-checks';
import { sdBody } from '../validate';
import { WALL_H } from '../webgpu/game-level';
// @ts-expect-error — node:fs available in vitest (silhouette.test.ts's pattern)
import { readFileSync } from 'node:fs';
import { WARBULL_PROFILE } from '../motion-profile';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { makeRng } from '../wander';
import { GUN_GRIP, gunPoint } from '../carry';

const doc = parseBlob(src);
type Built = ReturnType<typeof buildBody>;
const build = (d: typeof doc): Built => buildBody(compileBlob(d, compileFace(d)));
const bull = build(doc);
const soldier = build(parseBlob(soldierSrc));
const limb = (b: Built, l: string) => b.clusters.find(c => c.limb === l)!;

/** Highest point of the SURFACE (a field march). */
const topOf = (b: Built) => {
  let top = 0;
  for (let x = -0.5; x <= 0.5; x += 0.01) for (let z = -0.3; z <= 0.4; z += 0.02) {
    let y = 3;
    while (y > top && sdBody([x, y, z], b) > 0.002) y -= 0.005;
    top = Math.max(top, y);
  }
  return top;
};
/** The front silhouette's x runs at height y: [x0, x1] spans of solid, read
 *  by marching every 5 mm column through z, as the plate sees him. */
function runs(b: Built, y: number): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;
  for (let x = -1.2; x <= 1.2; x += 0.005) {
    let z = 0.8, hit = false;
    for (let k = 0; k < 60 && z > -0.8; k++) { const d = sdBody([x, y, z], b); if (d < 0.002) { hit = true; break; } z -= Math.max(d, 0.004); }
    if (hit && start === null) start = x;
    if (!hit && start !== null) { out.push([start, x]); start = null; }
  }
  return out;
}
const span = (b: Built, y: number) => { const r = runs(b, y); return r.length ? r[r.length - 1]![1] - r[0]![0] : 0; };

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

  // The horns are the top of the figure (the plate: 2.53 at its 2.55 scale),
  // under the room ceiling with headroom for his stride.
  it('tops out at ~2.55 m, under the room ceiling with headroom', () => {
    const top = topOf(bull);
    expect(top).toBeGreaterThan(2.48);
    expect(top).toBeLessThan(WALL_H - 0.35);
  });

  // The plate's widths by height (warbull.blob header), within ~10%.
  it.each([
    ['deltoids', 2.02, 0.96],
    ['ribs', 1.59, 0.51],
    ['belt', 1.45, 0.51],
  ] as const)('%s: the front silhouette is the plate\'s width at that height', (_, y, want) => {
    // The torso alone: the arms hang clear of it below the armpit.
    const r = runs(bull, y);
    const w = y > 1.8 ? span(bull, y) : (() => { const c = r.find(([a, b]) => a < 0 && b > 0)!; return c[1] - c[0]; })();
    expect(w).toBeGreaterThan(want * 0.9);
    expect(w).toBeLessThan(want * 1.1);
  });

  // THE NO-NECK BEAT: at his chin (2.19) the traps are already out past the
  // jaw, so the silhouette there is far wider than a head.
  it('has no neck: at the chin the traps make the silhouette wider than the head', () => {
    expect(span(bull, 2.19)).toBeGreaterThan(0.45);
  });

  // THE HORNS: out sideways past the head, the plate's 0.82 tip-to-tip sweep.
  it('sweeps its horns out wide: at the eye line the head spans 0.7 m or more', () => {
    expect(span(bull, 2.43)).toBeGreaterThan(0.7);
  });

  it('stands on long legs: the crotch at ~46% of his height, wide-set hooves', () => {
    // Two leg runs (the thighs apart) from just under the plate's 1.18 crotch.
    expect(runs(bull, 1.10).length).toBeGreaterThanOrEqual(2);
    const feet = runs(bull, 0.1);
    expect(feet.length).toBe(2);
    const cx = feet.map(([a, b]) => (a + b) / 2);
    expect(Math.abs(cx[0]!)).toBeGreaterThan(0.22);
    expect(Math.abs(cx[1]!)).toBeGreaterThan(0.22);
  });

  it('glows from both eyes, and only there', () => {
    const glow = bull.prims.filter(p => (p.glow ?? 0) > 0);
    expect(glow.length).toBe(2);
    for (const g of glow) expect(g.a[1]).toBeCloseTo(2.40, 1);
  });

  it('carries no painted metal: every hard surface is the kit\'s or the prop\'s', () => {
    expect(bull.prims.filter(p => p.metal || p.box)).toEqual([]);
  });

  it('is still one body: arms, legs and head fuse to the torso', () => {
    for (const l of ['armL', 'armR', 'legL', 'legR', 'head'] as const)
      expect(fusedOf(bull, limb(bull, l), limb(bull, 'torso')), l).toBeLessThan(0);
  });

  it('keeps the legs clear of each other and nothing stranded in a cluster', () => {
    expect(clearOf(bull, limb(bull, 'legL'), limb(bull, 'legR'))).toBeGreaterThan(0.005);
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
  for (const x of [-0.095, 0.095]) for (const y of [-0.167, 0.023]) for (const z of [-0.20, -0.08, 0.05]) casing.push([x, y, z]);
  for (const z of [0.2, 0.41]) for (let i = 0; i < 6; i++) casing.push([Math.cos(i * Math.PI / 3) * 0.056, Math.sin(i * Math.PI / 3) * 0.056, z]);

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
    // is that clearance (the verlet wrist lags the stomp when walking).
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
