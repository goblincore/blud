// src/lab/sdf-zombie/characters/juggernaut-blob.test.ts
//
// Pins the juggernaut body's DESIGN INTENT against the soldier it is scaled
// from (juggernaut.blob's header lists the factors). There is no reference
// mesh, so these are STRUCTURAL PINS, like ogre-blob.test.ts:
//
//   * same skeleton topology as the soldier, so soldier-family systems
//     (gait, carry, rig bind, regional injury) apply unchanged;
//   * ~1.15x the soldier's height and ~1.3x his shoulder span: "taller AND
//     broader" (owner, 2026-09-25);
//   * no hair: the helmet covers the skull;
//   * still one body, and the limbs still read as limbs.
//
// Whether he reads as a power-armoured tank is the kit's and the frames' job.
import { describe, it, expect } from 'vitest';
import src from './juggernaut.blob?raw';
import soldierSrc from './soldier.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf, daylightOf, fusedOf, strandedOf } from '../blob-checks';
// @ts-expect-error — node:fs available in vitest (silhouette.test.ts's pattern)
import { readFileSync } from 'node:fs';
import { JUGGERNAUT_PROFILE } from '../motion-profile';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { makeRng } from '../wander';
import { GUN_GRIP, gunPoint } from '../carry';

const doc = parseBlob(src);
const soldierDoc = parseBlob(soldierSrc);
type Built = ReturnType<typeof buildBody>;
const build = (d: typeof doc): Built => buildBody(compileBlob(d, compileFace(d)));
const jug = build(doc);
const soldier = build(soldierDoc);
const limb = (b: Built, l: string) => b.clusters.find(c => c.limb === l)!;
/** 2% of standing height (the authoring skill's visible-daylight rule). */
const DAYLIGHT = 0.02 * doc.height!;

/** World-space extents of a cluster's solid prims, honouring per-axis scale. */
function bounds(b: Built, l: string) {
  const c = limb(b, l);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of b.prims.slice(c.start, c.start + c.count)) {
    if (p.op === 'sub') continue;
    for (const e of [p.a, p.b]) for (let i = 0; i < 3; i++) {
      mn[i] = Math.min(mn[i]!, e[i]! - p.radius * p.scale[i]!);
      mx[i] = Math.max(mx[i]!, e[i]! + p.radius * p.scale[i]!);
    }
  }
  return { mn, mx };
}
const shoulderSpan = (b: Built) => bounds(b, 'armL').mx[0]! - bounds(b, 'armR').mn[0]!;

describe('juggernaut.blob', () => {
  it('compiles and validates clean', () => {
    expect(jug.errors).toEqual([]);
  });

  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  it('declares humanoid and passes the stance check', () => {
    expect(doc.stance).toBe('humanoid');
    expect(checkStance(jug.bones, doc.stance)).toEqual([]);
  });

  it('keeps the soldier skeleton topology (same bones, same parents)', () => {
    expect([...jug.bones.keys()].sort()).toEqual([...soldier.bones.keys()].sort());
  });

  it('is ~1.15x the soldier tall and ~1.3x his shoulders wide', () => {
    expect(doc.height! / soldierDoc.height!).toBeCloseTo(1.15, 2);
    // The soldier's crown includes his hair; compare the skull bone's tail.
    const crown = (b: Built) => b.bones.get('skull')!.tail[1];
    expect(crown(jug) / crown(soldier)).toBeCloseTo(1.15, 2);
    const span = shoulderSpan(jug) / shoulderSpan(soldier);
    expect(span).toBeGreaterThan(1.25);
    expect(span).toBeLessThan(1.35);
  });

  it('wears no hair: nothing painted the soldier\'s flat-top green', () => {
    const green = jug.prims.filter(p => p.color && Math.abs(p.color[0] - 0x2e / 255) < 0.01 && Math.abs(p.color[1] - 0x60 / 255) < 0.01);
    expect(green).toEqual([]);
  });

  it('is still one body: arms, legs and head fuse to the torso', () => {
    for (const l of ['armL', 'armR', 'legL', 'legR', 'head'] as const)
      expect(fusedOf(jug, limb(jug, l), limb(jug, 'torso')), l).toBeLessThan(0);
  });

  // The soldier's own forearm hugs his waist (daylightOf -4.4 cm at any join
  // radius short of the elbow; his kit hides it), so the skill's absolute 2%
  // rule is one the base body fails too. What is pinned is that the
  // juggernaut is NO WORSE than the soldier scaled by H: the upper-arm tilt 12
  // in juggernaut.blob is what buys it.
  it.each(['armL', 'armR'] as const)('%s hugs the torso no deeper than the soldier does, scaled', arm => {
    const clav = arm === 'armL' ? 'clavicle.l' : 'clavicle.r';
    const dl = (b: Built, r: number) => daylightOf(b, limb(b, arm), limb(b, 'torso'), b.bones.get(clav)!.tail, r);
    expect(dl(jug, 0.45)).toBeGreaterThan(dl(soldier, 0.45) * 1.15);
    // ...and the fist hangs free past the soldier's elbow radius, scaled.
    expect(dl(jug, 0.65 * 1.15)).toBeGreaterThan(dl(soldier, 0.65));
  });

  it('keeps the legs clear of each other and nothing stranded in a cluster', () => {
    expect(clearOf(jug, limb(jug, 'legL'), limb(jug, 'legR'))).toBeGreaterThan(0.010);
    for (const c of jug.clusters) {
      const gap = strandedOf(jug, c);
      if (gap !== null) expect(gap, `${c.limb} has a stranded prim`).toBeLessThan(0.005);
    }
  });
});

// THE CHAINGUN HOLD (carry.ts `heavy`), through the real motion pipeline:
// the rear grip in the right fist, the left hand on the TOP CARRY HANDLE (the
// prop's foreHand override), and the muzzle pointing where he faces, because
// the rounds fly along it (game-actor.ts onFire).
describe('juggernaut chaingun hold', () => {
  // Read off disk from the repo root (vitest's cwd), as silhouette.test.ts
  // and others do: Vite has no asset handling for .glb in a glob import.
  const GLB = 'public/assets/lab/juggernaut-chaingun.glb';

  it('ships the chaingun prop with its locators where the profile and GUN_GRIP say', () => {
    const bytes = readFileSync(GLB) as Uint8Array;
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true)))) as { nodes: { name: string; translation?: number[] }[] };
    const at = (n: string) => json.nodes.find(x => x.name === n)!.translation!;
    for (let k = 0; k < 3; k++) {
      expect(at('Grip_Hand')[k]).toBeCloseTo(GUN_GRIP.gripHand[k]!, 5);
      expect(at('Muzzle')[k]).toBeCloseTo(GUN_GRIP.muzzle[k]!, 5);
      expect(at('Fore_Hand')[k]).toBeCloseTo(JUGGERNAUT_PROFILE.prop!.foreHand![k]!, 5);
    }
    expect(json.nodes.some(n => n.name === 'Barrels')).toBe(true);
  });

  it.each([['walking', JUGGERNAUT_PROFILE.cruise], ['standing', 0]] as const)('%s: both hands on the gun, muzzle ahead', (_, speed) => {
    const m = makeActorMotion(jug, { seed: 7 });
    const rng = makeRng(7);
    const J = m.motionJoints!.index;
    let grip = 0, fore = 0, yawErr = 0, pitch = 0, n = 0;
    for (let i = 0; i < 240; i++) {
      const f = stepActorMotion(m, {
        current: jug, dt: 1 / 60, wander: speed > 0, armStyle: undefined,
        headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
        rng, signals: emptyActorSignals(), profile: JUGGERNAUT_PROFILE, forceSpeed: speed,
      })!;
      expect(f.carry).toBe('heavy');
      if (i < 60) continue; // the verlet settles into the carry
      const pts = m.bound.rig.points;
      const d = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
      grip += d(pts[J.handR!]!.pos, gunPoint(f.gun!, GUN_GRIP.gripHand));
      fore += d(pts[J.handL!]!.pos, gunPoint(f.gun!, JUGGERNAUT_PROFILE.prop!.foreHand!));
      const a = gunPoint(f.gun!, [0, 0, 0]), b = gunPoint(f.gun!, [0, 0, 1]);
      const dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(dir[0]!, dir[1]!, dir[2]!);
      const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
      yawErr = Math.max(yawErr, Math.abs(wrap(Math.atan2(dir[0]!, dir[2]!) - f.bodyYaw)));
      pitch = Math.max(pitch, Math.abs(Math.asin(dir[1]! / l)));
      n++;
    }
    // The grip seats on the wrist (the soldier-family 2 cm rule); the left
    // hand is a FABRIK solve onto the handle, allowed 3 cm.
    expect(grip / n).toBeLessThan(0.02);
    expect(fore / n).toBeLessThan(0.03);
    // Where he faces, within ~7 deg in yaw across the stride, and roughly
    // level (the rounds take their vertical from the player's chest anyway).
    expect(yawErr).toBeLessThan(0.12);
    expect(pitch).toBeLessThan(0.2);
  });
});
