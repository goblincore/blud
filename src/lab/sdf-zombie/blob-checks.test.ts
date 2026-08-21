// src/lab/sdf-zombie/blob-checks.test.ts
import { describe, expect, it } from 'vitest';
import { compileBlob } from './blob-compile';
import { clearOf, fusedOf, minFieldOnSegment } from './blob-checks';
import { parseBlob } from './blob-parse';
import { buildBody } from './build-body';
import type { ClusterInfo, Primitive, Vec3 } from './types';
import src from './characters/zombie.blob?raw';

const zombie = () => buildBody(compileBlob(parseBlob(src)));

/** A single-sphere "cluster" for the synthetic dumbbell fixtures below. */
function sphereCluster(id: number, center: Vec3, radius: number): { prim: Primitive; cluster: ClusterInfo } {
  const prim: Primitive = {
    a: center,
    b: center,
    radius,
    scale: [1, 1, 1],
    blendK: 0.01,
    limb: 'torso',
    cluster: id,
  };
  return {
    prim,
    cluster: { id, limb: 'torso', start: 0, count: 1, center, radius, alive: true },
  };
}

describe('minFieldOnSegment', () => {
  // These two fixtures pin down the Math.max-vs-Math.min question directly,
  // independent of the zombie's geometry: a "fused" reading requires the
  // field to stay inside solid flesh for every sample, not merely somewhere.

  it('stays negative across a gap-free segment (two overlapping spheres)', () => {
    const s1 = sphereCluster(0, [0, 0, -0.05], 0.1);
    const s2 = sphereCluster(1, [0, 0, 0.05], 0.1);
    const body = { prims: [s1.prim, s2.prim], clusters: [s1.cluster, s2.cluster] };
    expect(minFieldOnSegment(body, s1.prim.a, s2.prim.a)).toBeLessThan(0);
  });

  it('goes positive somewhere across a real gap (two spheres far apart)', () => {
    // Surfaces are 0.1 apart (centers 0.6 apart, radius 0.1 each) — solidly
    // disconnected. A Math.min-based reduction would still report this as
    // "fused" because both endpoints themselves sit inside solid flesh; only
    // Math.max — the worst point along the path — catches the gap in between.
    const s1 = sphereCluster(0, [0, 0, -0.3], 0.1);
    const s2 = sphereCluster(1, [0, 0, 0.3], 0.1);
    const body = { prims: [s1.prim, s2.prim], clusters: [s1.cluster, s2.cluster] };
    expect(minFieldOnSegment(body, s1.prim.a, s2.prim.a)).toBeGreaterThan(0);
  });
});

describe('blob checks — lab zombie', () => {
  it('reports the field staying inside the flesh between two fused clusters', () => {
    const b = zombie();
    const torso = b.clusters.find(c => c.limb === 'torso')!;
    const head = b.clusters.find(c => c.limb === 'head')!;
    expect(fusedOf(b, torso, head)).toBeLessThan(0);
  });

  it('reports a positive separation between two parts that must not touch', () => {
    const b = zombie();
    const armL = b.clusters.find(c => c.limb === 'armL')!;
    const legR = b.clusters.find(c => c.limb === 'legR')!;
    expect(clearOf(b, armL, legR)).toBeGreaterThan(0);
  });

  it('catches a hand driven into the near thigh', () => {
    // The plan's original value here was tilt=-40, asserted without checking
    // whether it actually collides. Measured across the tilt range: the arm
    // only overlaps the leg for roughly -10 to -30 degrees (deepest around
    // -20/-25); by -40 the upper arm has rotated PAST the thigh and swung
    // clear again — clearOf(armL, legL) at tilt=-40 measures +0.022, i.e.
    // still clear, which would have made the plan's test pass without any
    // collision ever happening. -20 sits well inside the verified-colliding
    // range (-0.0138) with margin on both sides, so a small change in the
    // rig can't flip this test's meaning by accident.
    const doc = parseBlob(src.replace(
      'bone upperArm parent=clavicle dir=down tilt=16.699244',
      'bone upperArm parent=clavicle dir=down tilt=-20',
    ));
    const b = buildBody(compileBlob(doc));
    const armL = b.clusters.find(c => c.limb === 'armL')!;
    const legL = b.clusters.find(c => c.limb === 'legL')!;
    expect(clearOf(b, armL, legL)).toBeLessThanOrEqual(0);
  });
});
