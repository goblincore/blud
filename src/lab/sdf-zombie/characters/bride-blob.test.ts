// src/lab/sdf-zombie/characters/bride-blob.test.ts
//
// Pins the bride's DESIGN INTENT (spec 2026-09-24-bride-sword-enemy-design.md).
// Prose + one inspiration photo (not committed), so these are STRUCTURAL pins,
// each naming a decision from the .blob header. Whether she reads as
// beautiful-then-wrong is the owner's call on frames, not this file's.
import { describe, it, expect } from 'vitest';
import src from './bride.blob?raw';
import { parseBlob } from '../blob-parse';
// @ts-expect-error — node:fs available in vitest via happy-dom/node (strand-wiring.test.ts)
import { readFileSync } from 'node:fs';
import { compileBlob, compileFace, compilePalette, compileSheet, compileSheetImage } from '../blob-compile';
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

  it('has her feet pointing FORWARD (+z, the way she faces): toe ahead of ankle', () => {
    // Owner (2026-09-24): "feet point backwards". The .blob was right; the
    // lab turntable rotated her offset prims by a stale wander yaw
    // (lab-main.ts setMotionEnabled). Pinned here in the rest skeleton AND in
    // the motion rig's base pose, which is what the gait and the renderer
    // pose from — the face is at +z, so the toes must be too.
    for (const s of ['l', 'r']) {
      const foot = bone(`foot.${s}`);
      expect(foot.tail[2] - foot.head[2], `foot.${s}`).toBeGreaterThan(0.08);
    }
    const joints = makeMotionJoints(body, bindRig(body).rig.restPose)!;
    const at = (n: string) => joints.base[joints.index[n as keyof typeof joints.index]!]!;
    expect(at('toeL')[2]).toBeGreaterThan(at('footL')[2]);
    expect(at('toeR')[2]).toBeGreaterThan(at('footR')[2]);
    // ...and the face is on the same side: nose tip ahead of the cranium.
    const skull = body.prims.filter(p => p.bone === 'skull');
    const cranium = skull.reduce((m, p) => (p.radius > m.radius ? p : m));
    const noseTip = Math.max(...skull.map(p => Math.max(p.a[2], p.b[2]) + p.radius * p.scale[2]));
    expect(noseTip).toBeGreaterThan(cranium.a[2] + cranium.radius * cranium.scale[2]);
  });

  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compilePalette(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
  });

  it('wears the corpse-makeup sheet at rgb multiply, eyes unlit (Task 2)', () => {
    const sheet = compileSheet(doc)!;
    expect(sheet.enabled).toBe(1);
    expect(compileSheetImage(doc)).toBe('bride-face.png');
    // MULTIPLY with blendLuma 0: the sheet's base is neutral grey, and the
    // makeup's hues (bruise, violet hollows, blue veins) are the point.
    expect(sheet.decal).toBe(0);
    expect(sheet.blendLuma).toBe(0);
    // Her eyes do not glow; the sheet's bright grey base must not either.
    expect(sheet.eyeGlowAmp).toBe(0);
    expect(sheet.eyeGlowCut).toBeGreaterThanOrEqual(0.99);
    // The registry declares the MEASURED mean (the game does not measure;
    // bakedFace's fallback 1 would darken her face).
    const face = characterEntry('bride').face;
    expect(face.url).toBe('/assets/lab/faces/bride-face.png');
    expect(face.mean).toBeGreaterThan(0.6);
    expect(face.mean).toBeLessThan(0.85);
  });

  it('paints with the SAME projection the sheet block declares', () => {
    // make-bride-face.py places every stroke through these four numbers; if
    // the .blob moves the projection without rerunning the painter, the
    // liner lands off the lids and the sutures off the mouth corners.
    const py = readFileSync('scripts/make-bride-face.py', 'utf8');
    const num = (k: string) => Number(new RegExp(`^${k} = ([0-9.]+)`, 'm').exec(py)?.[1]);
    const sheet = compileSheet(doc)!;
    expect(num('PROJ_SCALE_X')).toBe(sheet.projScaleX);
    expect(num('PROJ_SCALE_Y')).toBe(sheet.projScaleY);
    expect(num('PROJ_CENTRE_X')).toBe(sheet.projCentreX);
    expect(num('PROJ_CENTRE_Y')).toBe(sheet.projCentreY);
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
