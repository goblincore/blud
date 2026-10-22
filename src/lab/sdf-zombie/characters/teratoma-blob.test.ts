// src/lab/sdf-zombie/characters/teratoma-blob.test.ts
//
// Pins the teratoma's DESIGN INTENT (teratoma.blob's header). There is no reference mesh, so these are STRUCTURAL
// PINS, not mesh-derived thresholds; each names a decision and fails if it is quietly undone:
//
//   * the body FLOATS: its underside is well off the floor and `height` is the top of the ball;
//   * the marched flesh stays CHEAP: a few large prims (the house split puts detail in the baked normal map and the
//     hard parts, the strogg machinery and its cables in the kit, biomech-style.md), so the prim count is pinned low;
//   * the maw is ADDITIVE, a dark gullet recessed behind the lips, never a carve;
//   * the arms fuse to the ball;
//   * a LEGLESS body builds motion joints and hovers: makeMotionJoints used to throw on a body with no feet, so it could
//     be neither shown in the lab nor spawned (motion.ts), and the HOVER gait keeps the ball at its authored height;
//   * the registry wires the kit, the baked normal map and the mouth SPIT.
//
// What this file cannot check is whether it READS as a cacodemon. That took the turntable frames.
import { describe, it, expect } from 'vitest';
import src from './teratoma.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, fusedOf } from '../blob-checks';
import { characterEntry } from '../character-registry';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { makeRng } from '../wander';
import { HOVER } from '../gait';
import { TERATOMA_PROFILE } from '../motion-profile';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
const limb = (b: ReturnType<typeof built>, l: string) => b.clusters.find(c => c.limb === l)!;

function bounds(b: ReturnType<typeof built>) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of b.prims) {
    if (p.op === 'sub') continue;
    for (const e of [p.a, p.b]) for (let i = 0; i < 3; i++) {
      mn[i] = Math.min(mn[i]!, e[i]! - p.radius * p.scale[i]!);
      mx[i] = Math.max(mx[i]!, e[i]! + p.radius * p.scale[i]!);
    }
  }
  return { mn, mx };
}

describe('teratoma.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  it('omits stance (no legs to check)', () => {
    expect(doc.stance).toBeNull();
    expect(checkStance(built().bones, doc.stance)).toEqual([]);
  });

  // Ball centre 1.45, the jaw's underside ~0.94: nearly a metre of air under it. The bounds are prim boxes, so the
  // true surface is inside them.
  it('hovers clear of the floor, the ball top at the declared height', () => {
    const { mn, mx } = bounds(built());
    expect(mn[1]).toBeGreaterThan(0.8);
    expect(mx[1]).toBeGreaterThan(doc.height! - 0.03);
    expect(mx[1]).toBeLessThan(doc.height! + 0.03);
  });

  // THE PRIM BUDGET. 33 at authoring (23 torso, 4 per arm, the 2 buried face prims): the ball and its lobes, the
  // face masses, four tapered half-lips, and 8 small raw wounds where the kit's hoses enter. The folds,
  // veins and knots are the baked normal map (teratoma.detail); the horns, teeth, eye, machinery, cables and hoses are
  // kit. A pass that marches any of them should have to change this number on purpose.
  it('marches few prims', () => {
    const b = built();
    expect(b.prims.length).toBeLessThanOrEqual(36);
    expect(limb(b, 'torso').count).toBeLessThanOrEqual(26);
  });

  it('makes the maw an additive dark gullet, not a carve', () => {
    const b = built();
    expect(b.prims.some(p => p.op === 'sub')).toBe(false);
    const gullet = b.prims.filter(p => p.color && p.color[0] < 0.05 && p.color[1] < 0.05);
    expect(gullet).toHaveLength(1);
    // As wide as most of the ball: the maw is the face.
    const ball = b.prims.find(p => p.core && p.limb === 'torso')!;
    expect(gullet[0]!.radius * gullet[0]!.scale[0] / (ball.radius * ball.scale[0])).toBeGreaterThan(0.5);
  });

  it('fuses both arms to the ball', () => {
    const b = built();
    for (const l of ['armL', 'armR']) expect(fusedOf(b, limb(b, l), limb(b, 'torso')), l).toBeLessThan(0);
  });

  // THE LEGLESS FIX (motion.ts makeMotionJoints): no feet -> leg lengths 0, groundY the floor.
  it('builds motion joints with no legs, its ground the floor', () => {
    const m = makeActorMotion(built(), { seed: 1 });
    expect(m.motionJoints).not.toBeNull();
    expect(m.motionJoints!.index.footL).toBeUndefined();
    expect(m.motionJoints!.leg.L).toEqual([0, 0]);
    expect(m.motionJoints!.groundY).toBe(0);
  });

  // Ten seconds of HOVER wander: the ball heaves round its authored height and never sinks toward the floor.
  it('hovers in motion without sinking', () => {
    const b = built();
    const m = makeActorMotion(b, { seed: 1 });
    const rng = makeRng(7);
    const pelvis = m.motionJoints!.index.pelvis!;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 600; i++) {
      const f = stepActorMotion(m, {
        current: b, dt: 1 / 60, wander: true, armStyle: undefined,
        headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
        rng, signals: emptyActorSignals(), profile: TERATOMA_PROFILE,
      });
      expect(f).not.toBeNull();
      const y = m.bound.rig.points[pelvis]!.pos[1];
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    expect(lo).toBeGreaterThan(1.25);
    expect(hi).toBeLessThan(1.6);
  });

  it('uses the HOVER gait with no stepping', () => {
    expect(TERATOMA_PROFILE.gait.walk).toBe(HOVER);
    expect(HOVER.strideLen).toBe(0);
    expect(HOVER.footLift).toBe(0);
  });

  it('is registered with its kit, baked normal map and mouth spit', () => {
    const e = characterEntry('teratoma');
    expect(e.kit).toBe('/assets/lab/teratoma-kit.gltf');
    expect(e.bodyNormal?.url).toBe('/assets/lab/teratoma-body-n.png');
    expect(e.profile.gunner?.weapon).toBe('rocket');
    // Spat from the maw: in front of the ball's centre, below it.
    expect(e.profile.spit?.from).toBe('pelvis');
    expect(e.profile.spit!.offset[2]).toBeGreaterThan(0.5);
    expect(e.profile.spit!.offset[1]).toBeLessThan(0);
    // No prop and no carries: it holds nothing.
    expect(e.profile.prop).toBeUndefined();
    expect(e.profile.carries).toBeUndefined();
  });
});
