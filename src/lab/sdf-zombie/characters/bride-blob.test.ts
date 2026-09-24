// src/lab/sdf-zombie/characters/bride-blob.test.ts
//
// Pins the bride's DESIGN INTENT (spec 2026-09-24-bride-sword-enemy-design.md).
// Prose + one inspiration photo (not committed), so these are STRUCTURAL pins,
// each naming a decision from the .blob header. Whether she reads as
// beautiful-then-wrong is the owner's call on frames, not this file's.
import { describe, it, expect } from 'vitest';
import src from './bride.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { characterEntry } from '../character-registry';
import { MAX_PRIMS, sdBody } from '../validate';
import { checkStance } from '../blob-checks';
import { bindRig } from '../rig-bind';
import { makeMotionJoints } from '../motion';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));
const bone = (n: string) => {
  const b = body.bones.get(n);
  if (!b) throw new Error(`no bone ${n}`);
  return b;
};
const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('bride — build', () => {
  it('compiles clean and is registered', () => {
    expect(body.errors).toEqual([]);
    expect(characterEntry('bride').name).toBe('bride');
  });

  it('stands humanoid: knees fold forward (the lab refuses to load her otherwise)', () => {
    expect(checkStance(body.bones, doc.stance)).toEqual([]);
  });

  it('drives the motion rig: every bone maps to a gait joint, and the rig carries the long sword arm', () => {
    // makeMotionJoints returns null on any unmapped bone (the spec's reason
    // for faking the second elbow with length instead of a new joint).
    const joints = makeMotionJoints(body, bindRig(body).rig.restPose);
    expect(joints).not.toBeNull();
    const [, foreR] = joints!.arm.R;
    const [, foreL] = joints!.arm.L;
    expect(foreR - foreL).toBeGreaterThan(0.03);
  });

  it('has no typo in its face, sheet or palette parameter names; sheet off', () => {
    expect(() => compilePalette(doc)).not.toThrow();
    // Flesh only (Task 1): the baked face sheet arrives in Task 2.
    expect(compileSheet(doc)?.enabled).toBe(0);
  });

  it('fits the 128 flesh+bone prim budget with room for cloth and hair', () => {
    // Task 1 is flesh only; shells + strands (Task 3) need ~20 more.
    expect(body.prims.length).toBeLessThanOrEqual(MAX_PRIMS - 20);
    // MAX_PRIMS bounds flesh AND bone together (validate.ts), so the headroom
    // has to exist in the sum too, or Task 3's cloth lands over the ceiling.
    expect(body.prims.length + body.bonePrims.length).toBeLessThanOrEqual(MAX_PRIMS - 20);
  });
});

describe('bride — wrong anatomy (the cheap version)', () => {
  // Primitive carries endpoints a/b (no `center`), per-axis scale and an
  // optional far radius; the crown is the highest endpoint plus its y extent.
  const height = Math.max(...body.prims.map(p =>
    Math.max(p.a[1] + p.radius * p.scale[1], p.b[1] + (p.radiusB ?? p.radius) * p.scale[1])));

  it('is tall: ~1.85 m', () => {
    expect(height).toBeGreaterThan(1.80);
    expect(height).toBeLessThan(1.92);
  });

  it('has legs ~10% too long: hip-to-floor over total height >= 0.54', () => {
    // A typical adult woman is ~0.49-0.50.
    const hipY = bone('thigh.l').head[1];
    expect(hipY / height).toBeGreaterThanOrEqual(0.54);
  });

  // The hourglass, probed on the CPU field along x at the body's centreline
  // depth: the first x where the field goes positive is the flesh's
  // half-width. Blend volume is included, which is the point — the first
  // "double the blends" pass looked fine in the .blob and probed a 0.131
  // waist.
  const halfWidth = (y: number) => {
    for (let x = 0; x < 0.4; x += 0.001) if (sdBody([x, y, 0], body) > 0) return x;
    return Infinity;
  };

  it('has a wasp waist (half-width <= 0.095) over flared hips (>= 0.15)', () => {
    const waist = Math.min(...[1.10, 1.12, 1.14, 1.16, 1.18].map(halfWidth));
    const hips = Math.max(...[0.94, 0.97, 1.00].map(halfWidth));
    expect(waist).toBeLessThanOrEqual(0.095);
    expect(hips).toBeGreaterThanOrEqual(0.15);
    // ...and the hip flare stops short of the hanging arms: daylight, not a
    // body fused to its own wrists (hips were 0.214 wide = touching the
    // forearm before the arms were splayed out).
    expect(hips).toBeLessThan(0.18);
  });

  it('has a long neck: neck bone >= 0.13 m', () => {
    expect(dist(bone('neck').head, bone('neck').tail)).toBeGreaterThanOrEqual(0.13);
  });

  it('has the sword forearm longer than the off forearm (hidden by the vambrace)', () => {
    const r = dist(bone('forearm.r').head, bone('forearm.r').tail);
    const l = dist(bone('forearm.l').head, bone('forearm.l').tail);
    expect(r - l).toBeGreaterThan(0.03);
  });
});
