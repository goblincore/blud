// src/lab/sdf-zombie/gib-switch.test.ts — the live-body -> gib switch steps (gib-switch.ts) and the pure pieces
// they ride on: the rupture following a moving pose (gib-tear.ts regionDrift / followPose) and the release
// carrying the pivots with it (gib-parts.ts carryGibPieces).
import { describe, expect, it } from 'vitest';
import zombieSrc from './characters/zombie.blob?raw';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { buildBody, type BuildResult } from './build-body';
import { applyRig, bindRig } from './rig-bind';
import { carryGibPieces, displaceGibPieces, gibPlan, retargetGibPieces } from './gib-parts';
import { TEAR_TUNING, regionDrift, rupturePosed, type TearState } from './gib-tear';
import { DEFAULT_GIB_SWITCH, GIB_SWITCH_STEPS, blastBloodPlacement, parseGibSwitch } from './gib-switch';
import type { Primitive, Vec3 } from './types';

const body = buildBody(compileBlob(parseBlob(zombieSrc)));
const posed = applyRig(body, bindRig(body), 0);
const torso = posed.clusters.find(c => c.limb === 'torso')!.center;
const plan = gibPlan(posed);
const blast: Vec3 = [torso[0] - 2, 0.15, torso[2]];
const tear = (age: number): TearState => ({ at: blast, falloff: 0.55, age, refPrims: posed.prims });
const moveBody = (b: BuildResult, d: Vec3): BuildResult => {
  const sh = (p: Primitive): Primitive => ({ ...p, a: [p.a[0] + d[0], p.a[1] + d[1], p.a[2] + d[2]], b: [p.b[0] + d[0], p.b[1] + d[1], p.b[2] + d[2]] });
  return { ...b, prims: b.prims.map(sh), bonePrims: b.bonePrims?.map(sh) };
};

describe('parseGibSwitch', () => {
  it('reads none / all / lists, and the default with no param', () => {
    expect([...parseGibSwitch('none')]).toEqual([]);
    expect([...parseGibSwitch('all')].sort()).toEqual([...GIB_SWITCH_STEPS].sort());
    expect([...parseGibSwitch('beat, blood,bogus')].sort()).toEqual(['beat', 'blood']);
    expect([...parseGibSwitch(null)].sort()).toEqual([...DEFAULT_GIB_SWITCH].sort());
    expect([...parseGibSwitch('')].sort()).toEqual([...DEFAULT_GIB_SWITCH].sort());
  });
});

describe('regionDrift / followPose (beat)', () => {
  it('is zero for the pose the plan was cut from, and the travel for a moved pose', () => {
    for (const d of regionDrift(plan, posed.prims, posed.prims)) for (const x of d) expect(Math.abs(x)).toBeLessThan(1e-9);
    const moved = moveBody(posed, [0.4, 0.05, -0.1]);
    for (const d of regionDrift(plan, moved.prims, posed.prims)) {
      expect(d[0]).toBeCloseTo(0.4, 6); expect(d[1]).toBeCloseTo(0.05, 6); expect(d[2]).toBeCloseTo(-0.1, 6);
    }
  });

  it('without followPose the rupture frame is the old one exactly', () => {
    const a = rupturePosed(posed, plan, tear(0.1));
    const b = rupturePosed(posed, plan, tear(0.1), { ...TEAR_TUNING, followPose: false });
    expect(b.drift).toBeUndefined();
    expect(b.body.prims).toEqual(a.body.prims);
  });

  it('a body shoved during the window releases pieces that sit on the drawn geometry (no pop)', () => {
    const moved = moveBody(posed, [0.45, 0, 0.1]);
    const frame = rupturePosed(moved, plan, tear(TEAR_TUNING.sec), { ...TEAR_TUNING, followPose: true });
    expect(frame.drift).toBeDefined();
    // The pieces as the release builds them, then each piece's prims rotated by its own spin about its own
    // (carried) origin: that must be exactly what the last rupture frame drew.
    const pieces = displaceGibPieces(
      carryGibPieces(retargetGibPieces(plan.pieces, frame.deformedPrims, frame.deformedBones), frame.drift),
      frame.offsets, frame.quats, frame.angVels);
    const drawn = new Map<number, Primitive>();
    plan.pieces.forEach(pc => (pc.srcPrims ?? []).forEach(i => drawn.set(i, frame.body.prims[i]!)));
    let worst = 0;
    pieces.forEach((pc, r) => {
      const q = frame.quats[r]!;
      const src = plan.pieces[r]!.srcPrims ?? [];
      src.forEach((i, j) => {
        const p = pc.prims[j]!;
        // rotate p about pc.origin by q (the chunk's spin), compare with the drawn prim
        const rot = (v: Vec3): Vec3 => {
          const [x, y, z, w] = q; const o = pc.origin;
          const vx = v[0] - o[0], vy = v[1] - o[1], vz = v[2] - o[2];
          const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
          return [o[0] + vx + w * tx + (y * tz - z * ty), o[1] + vy + w * ty + (z * tx - x * tz), o[2] + vz + w * tz + (x * ty - y * tx)];
        };
        const d = drawn.get(i)!;
        const ra = rot(p.a);
        worst = Math.max(worst, Math.hypot(ra[0] - d.a[0], ra[1] - d.a[1], ra[2] - d.a[2]));
      });
    });
    expect(worst).toBeLessThan(1e-6);
  });

  it('carryGibPieces moves pivots, never prims', () => {
    const d: Vec3[] = plan.pieces.map(() => [0.3, 0, 0]);
    const out = carryGibPieces(plan.pieces, d);
    expect(out[0]!.origin[0]).toBeCloseTo(plan.pieces[0]!.origin[0] + 0.3, 9);
    expect(out[0]!.prims).toBe(plan.pieces[0]!.prims);
    expect(carryGibPieces(plan.pieces, undefined)).toBe(plan.pieces);
  });
});

describe('blastBloodPlacement (blood)', () => {
  it('sits on the blast side of the torso and sprays away from the blast, tipped up', () => {
    const t: Vec3 = [1, 1.1, 0];
    const { anchor, spray, dirN } = blastBloodPlacement(t, [-1, 0.15, 0]);
    expect(anchor[0]).toBeLessThan(t[0]);           // toward the blast
    expect(anchor[1]).toBe(t[1]);
    expect(spray[0]).toBeGreaterThan(0.5);          // away from it
    expect(spray[1]).toBeGreaterThan(0.2);          // and up
    expect(Math.hypot(...spray)).toBeCloseTo(1, 9);
    expect(dirN).toEqual([-spray[0], -spray[1], -spray[2]]);  // spawnImpactGout sprays along -dirN
  });
  it('a blast straight under the body sprays up from the torso centre', () => {
    const { anchor, spray } = blastBloodPlacement([0, 1, 0], [0, 0.1, 0]);
    expect(anchor).toEqual([0, 1, 0]);
    expect(spray).toEqual([0, 1, 0]);
  });
});
