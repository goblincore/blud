// src/lab/sdf-zombie/characters/zombie-fat-blob.test.ts
import { describe, it, expect } from 'vitest';
import src from './zombie-fat.blob?raw';
import zombieSrc from './zombie.blob?raw';
import detail from './zombie-fat.detail?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';
import { CHARACTERS, isZombieKin } from '../character-registry';
import { motionProfileFor } from '../motion-profile';
import type { Vec3 } from '../types';

const build = (s: string) => { const doc = parseBlob(s); return buildBody(compileBlob(doc, compileFace(doc))); };
const fat = build(src), thin = build(zombieSrc);
/** The body with only its torso cluster alive: a probe across the waist must not land on the hanging arm. */
const torsoOnly = (b: typeof fat) => ({ ...b, clusters: b.clusters.map(c => ({ ...c, alive: c.limb === 'torso' })) }) as typeof fat;

/** How far out the skin is from (0, y, z0) along `dir` (marched inward from 0.6 m), torso and head clusters alive. */
function reach(body: typeof fat, y: number, dir: Vec3, z0 = 0.02): number {
  let t = 0.6;
  for (let i = 0; i < 400; i++) {
    const d = sdBody([dir[0] * t, y + dir[1] * t, z0 + dir[2] * t], body);
    if (d < 1e-4) break;
    t -= Math.max(d * 0.9, 2e-4);
  }
  return t;
}

describe('zombie-fat.blob is the zombie gone to fat', () => {
  it('compiles with no validation errors', () => {
    expect(fat.errors).toEqual([]);
  });

  // Same skeleton = the zombie's gait (gait.ts JOINT_AT), rig and kit bones, unchanged.
  it('stands on the zombie skeleton, bone for bone', () => {
    expect([...fat.bones.keys()].sort()).toEqual([...thin.bones.keys()].sort());
    for (const [name, bone] of fat.bones) {
      const ref = thin.bones.get(name)!;
      bone.head.forEach((v, i) => expect(v, `${name} head[${i}]`).toBeCloseTo(ref.head[i]!, 6));
      bone.tail.forEach((v, i) => expect(v, `${name} tail[${i}]`).toBeCloseTo(ref.tail[i]!, 6));
    }
  });

  it('carries the zombie\'s authored bones verbatim (the same man inside the fat)', () => {
    const bonesBlock = (s: string) => s.slice(s.indexOf('\nbones\n'), s.indexOf('\nface\n'));
    // The bones block runs to the face block's leading comment; compare the bone lines themselves.
    const lines = (s: string) => bonesBlock(s).split('\n').filter(l => /^\s+(bar|blob)\s/.test(l));
    expect(lines(src)).toEqual(lines(zombieSrc));
  });

  it('has a gut: the belly stands well forward of the zombie\'s, and further forward than it is wide', () => {
    const front = (b: typeof fat) => reach(torsoOnly(b), 1.10, [0, 0, 1]);
    const side = (b: typeof fat) => reach(torsoOnly(b), 1.10, [1, 0, 0]);
    expect(front(fat) - front(thin), 'belly gain at y 1.10').toBeGreaterThan(0.08);
    expect(front(fat), 'front-heavy barrel').toBeGreaterThan(side(fat));
  });

  it('has a thick neck under a heavy jaw', () => {
    // At the neck's middle the zombie is a 45 mm bar; the fat zombie's is 68 mm plus the jowl roll in front.
    const neck = fat.bones.get('neck')!, mid: Vec3 = [0, (neck.head[1] + neck.tail[1]) / 2, (neck.head[2] + neck.tail[2]) / 2];
    const across = (b: typeof fat) => reach(b, mid[1], [1, 0, 0], mid[2]);
    expect(across(fat) - across(thin)).toBeGreaterThan(0.015);
  });

  // The refit kit's shackles and the shared grabber hands are laid at the wrist: the fat stops at the forearm.
  it('keeps the zombie\'s wrist, so the shackles and hands sit where the zombie\'s do', () => {
    const wrist = (b: typeof fat) => b.prims.filter(p => p.limb === 'armL' && p.op !== 'bone').map(p => p.radius).sort()[0];
    expect(wrist(fat)).toBeCloseTo(wrist(thin)!, 6);
  });

  it('stays inside the crowd budget: two flesh prims over the zombie', () => {
    const flesh = (b: typeof fat) => b.prims.filter(p => p.op !== 'bone').length;
    expect(flesh(fat) - flesh(thin)).toBeLessThanOrEqual(2);
  });

  it('bakes fat, not bone: the detail has the gut crease and no ribs or spine knuckles', () => {
    expect(detail).toContain('fat: the gut');
    expect(detail).toContain('love handles');
    expect(detail).not.toContain('ribs: the lower four arcs');
    expect(detail).not.toContain('spinous processes');
  });
});

describe('zombie-fat in the registry', () => {
  const e = CHARACTERS['zombie-fat']!;

  it('plays as a zombie: kin, kit hands and breakables like the zombie\'s', () => {
    expect(isZombieKin('zombie-fat')).toBe(true);
    expect(isZombieKin('zombie')).toBe(true);
    expect(isZombieKin('butcher')).toBe(false);
    expect(e.kitHands).toEqual(CHARACTERS.zombie!.kitHands);
    expect(e.kitBreakables).toEqual(CHARACTERS.zombie!.kitBreakables);
  });

  it('wears its own refit kit and body map, on the zombie\'s gait, slower', () => {
    expect(e.kit).toBe('/assets/lab/zombie-fat-kit.gltf');
    expect(e.bodyNormal?.url).toBe('/assets/lab/zombie-fat-body-n.png');
    const p = motionProfileFor('zombie-fat'), z = motionProfileFor('zombie');
    expect(p.gait).toBe(z.gait);
    expect(p.cruise).toBeLessThan(z.cruise);
  });
});
