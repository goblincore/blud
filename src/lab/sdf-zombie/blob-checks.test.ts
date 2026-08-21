// src/lab/sdf-zombie/blob-checks.test.ts
import { describe, expect, it, vi } from 'vitest';
import { compileBlob } from './blob-compile';
import { clearOf, fusedOf, worstFieldOnSegment , kneeOffset, checkStance } from './blob-checks';
import { parseBlob } from './blob-parse';
import { buildBody } from './build-body';
import type { ClusterInfo, Primitive, Vec3 } from './types';
import src from './characters/zombie.blob?raw';

const zombie = () => buildBody(compileBlob(parseBlob(src)));

interface PrimSpec { a: Vec3; b: Vec3; radius: number }

/**
 * Builds a synthetic single-primitive-per-cluster field for the fixtures
 * below, with every cluster's `start`/`count` matching its REAL offset into
 * the combined `prims` array.
 *
 * This exists because a naive per-cluster helper (build one `{prim,
 * cluster}` pair at a time, each hardcoding `start: 0, count: 1`, then
 * concatenate) is wrong for every cluster after the first: `start` has to
 * be the cluster's position in the FINAL combined array, which a helper
 * building one cluster in isolation can't know. That bug bit this test file
 * during review of the mid-shaft-crossing fix — `clearOf`'s `bOnly` field
 * silently resolved to the wrong cluster's primitive (whichever one
 * happened to occupy index 0), so the check was accidentally comparing a
 * cluster against ITSELF instead of the other one. `sdBody` gives no signal
 * when this happens — the field is well-formed, just wrong — so the fixture
 * builder now does the indexing itself instead of asking each call site to
 * get it right by hand.
 */
function syntheticField(specs: PrimSpec[]): { field: { prims: Primitive[]; clusters: ClusterInfo[] }; clusters: ClusterInfo[] } {
  const prims: Primitive[] = [];
  const clusters: ClusterInfo[] = [];
  specs.forEach((s, id) => {
    const start = prims.length;
    prims.push({ a: s.a, b: s.b, radius: s.radius, scale: [1, 1, 1], blendK: 0.01, limb: 'torso', cluster: id });
    const center: Vec3 = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2];
    clusters.push({ id, limb: 'torso', start, count: 1, center, radius: s.radius, alive: true });
  });
  return { field: { prims, clusters }, clusters };
}

describe('worstFieldOnSegment', () => {
  // These two fixtures pin down the Math.max-vs-Math.min question directly,
  // independent of the zombie's geometry: a "fused" reading requires the
  // field to stay inside solid flesh for every sample, not merely somewhere.

  it('stays negative across a gap-free segment (two overlapping spheres)', () => {
    const p1: Vec3 = [0, 0, -0.05];
    const p2: Vec3 = [0, 0, 0.05];
    const { field } = syntheticField([{ a: p1, b: p1, radius: 0.1 }, { a: p2, b: p2, radius: 0.1 }]);
    expect(worstFieldOnSegment(field, p1, p2)).toBeLessThan(0);
  });

  it('goes positive somewhere across a real gap (two spheres far apart)', () => {
    // Surfaces are 0.1 apart (centers 0.6 apart, radius 0.1 each) — solidly
    // disconnected. A Math.min-based reduction would still report this as
    // "fused" because both endpoints themselves sit inside solid flesh; only
    // Math.max — the worst point along the path — catches the gap in between.
    const p1: Vec3 = [0, 0, -0.3];
    const p2: Vec3 = [0, 0, 0.3];
    const { field } = syntheticField([{ a: p1, b: p1, radius: 0.1 }, { a: p2, b: p2, radius: 0.1 }]);
    expect(worstFieldOnSegment(field, p1, p2)).toBeGreaterThan(0);
  });
});

describe('clearOf — sampling cap warning', () => {
  it('warns when a long, thin primitive exceeds the sampling cap', () => {
    // length 10, effective radius 0.05 -> needs ceil(10 / 0.05) = 200
    // sampling intervals to keep spacing at or under its own radius, far
    // past the 32-interval cap. This is exactly the case Fix 1 exists for:
    // proof the cap-forced coarse-spacing gap announces itself instead of
    // silently reporting a false "clear".
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const longThin: Primitive = {
      a: [-5, 0, 0], b: [5, 0, 0], radius: 0.05, scale: [1, 1, 1], blendK: 0.01, limb: 'torso', cluster: 0,
    };
    const other: Primitive = {
      a: [0, 0, 0], b: [0, 0, 0], radius: 0.05, scale: [1, 1, 1], blendK: 0.01, limb: 'torso', cluster: 1,
    };
    const longCluster: ClusterInfo = { id: 0, limb: 'torso', start: 0, count: 1, center: [0, 0, 0], radius: 5, alive: true };
    const otherCluster: ClusterInfo = { id: 1, limb: 'torso', start: 1, count: 1, center: [0, 0, 0], radius: 0.05, alive: true };
    const body = { prims: [longThin, other], clusters: [longCluster, otherCluster] };

    clearOf(body, longCluster, otherCluster);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('would need 200 sampling intervals');
    warn.mockRestore();
  });

  it('does not warn for any primitive pair on the lab zombie', () => {
    // Exercises clearOf across every distinct cluster pair — the same shape
    // of call an all-pairs authoring check would make — to prove nothing on
    // the shipped zombie is anywhere near the 32-interval cap today. (The
    // longest thin primitive, the thigh bar, sits around a 4-5 ratio.)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = zombie();
    for (let i = 0; i < b.clusters.length; i++) {
      for (let j = i + 1; j < b.clusters.length; j++) {
        clearOf(b, b.clusters[i]!, b.clusters[j]!);
      }
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('fusedOf — no live primitive to probe from', () => {
  it('reports Infinity (never fused) when a cluster has no live additive primitive', () => {
    // clusterCore only considers live, additive (non-carve, non-dead)
    // primitives — a cluster made ENTIRELY of carves has nothing to probe
    // from and clusterCore returns null. fusedOf must not crash or silently
    // treat that as "fused"; Infinity reads as "never inside solid flesh",
    // the correct answer for a cluster with no flesh of its own.
    const carveOnly: Primitive = {
      a: [0, 0, 0], b: [0, 0, 0], radius: 0.1, scale: [1, 1, 1], blendK: 0.01, limb: 'torso', cluster: 0, op: 'sub',
    };
    const solid: Primitive = {
      a: [1, 0, 0], b: [1, 0, 0], radius: 0.1, scale: [1, 1, 1], blendK: 0.01, limb: 'torso', cluster: 1,
    };
    const emptyCluster: ClusterInfo = { id: 0, limb: 'torso', start: 0, count: 1, center: [0, 0, 0], radius: 0.1, alive: true };
    const otherCluster: ClusterInfo = { id: 1, limb: 'torso', start: 1, count: 1, center: [1, 0, 0], radius: 0.1, alive: true };
    const body = { prims: [carveOnly, solid], clusters: [emptyCluster, otherCluster] };

    expect(fusedOf(body, emptyCluster, otherCluster)).toBe(Infinity);
  });
});

describe("clearOf — a target cluster's own carve still applies", () => {
  it('reads clear when the only overlap sits inside the target\'s carved-out cavity', () => {
    // b is a solid sphere (radius 0.3 at the origin) with a carve (radius
    // 0.15, op 'sub') removing a cavity centred at [0.1, 0, 0]. a is a
    // single point sitting exactly at that carve's centre — deep inside b's
    // UNCARVED solid (0.3 - 0.1 = 0.2 of clearance), which would read as a
    // clear collision if clearOf ignored the carve when building b's
    // isolated field. Because restrictedTo keeps every primitive belonging
    // to a cluster (carves included) and sdBody already applies op 'sub'
    // correctly, the carve removes exactly that material and the point
    // reads OUTSIDE (clear) instead.
    const solid: Primitive = {
      a: [0, 0, 0], b: [0, 0, 0], radius: 0.3, scale: [1, 1, 1], blendK: 0.01, limb: 'torso', cluster: 1,
    };
    const carve: Primitive = {
      a: [0.1, 0, 0], b: [0.1, 0, 0], radius: 0.15, scale: [1, 1, 1], blendK: 0.01, limb: 'torso', cluster: 1, op: 'sub',
    };
    const probe: Primitive = {
      a: [0.1, 0, 0], b: [0.1, 0, 0], radius: 0.01, scale: [1, 1, 1], blendK: 0.01, limb: 'torso', cluster: 0,
    };
    const bCluster: ClusterInfo = { id: 1, limb: 'torso', start: 0, count: 2, center: [0.05, 0, 0], radius: 0.3, alive: true };
    const aCluster: ClusterInfo = { id: 0, limb: 'torso', start: 2, count: 1, center: [0.1, 0, 0], radius: 0.01, alive: true };
    const body = { prims: [solid, carve, probe], clusters: [bCluster, aCluster] };

    expect(clearOf(body, aCluster, bCluster)).toBeGreaterThan(0);
  });
});

describe('clearOf — mid-shaft crossings', () => {
  it('catches two perpendicular capsules crossing through the origin (spec-review counter-example)', () => {
    // A along X, B along Z, both radius 0.1, crossing at the origin. sdBody
    // at the origin is unambiguously solid (~-0.1) — deep interpenetration —
    // but all four primitive ENDPOINTS sit about 1 unit from the other
    // capsule's axis. An endpoints-only clearOf reports this as clear
    // (+0.9 — verified against the pre-fix implementation below), because it
    // never samples anywhere along either shaft. This is not a contrived
    // shape: crossed forearms, or a leg swept through the far side of the
    // torso mid-limb, are exactly this topology.
    const { field, clusters } = syntheticField([
      { a: [-1, 0, 0], b: [1, 0, 0], radius: 0.1 },
      { a: [0, 0, -1], b: [0, 0, 1], radius: 0.1 },
    ]);
    const [capA, capB] = clusters as [ClusterInfo, ClusterInfo];
    expect(clearOf(field, capA, capB)).toBeLessThanOrEqual(0);
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

describe('knee stance', () => {
  const legs = (kneeZ: number) => new Map([
    ['thigh.l', { head: [0, 0.6, 0] as Vec3, tail: [0, 0.32, kneeZ] as Vec3 }],
    ['shin.l', { head: [0, 0.32, kneeZ] as Vec3, tail: [0, 0.04, 0] as Vec3 }],
  ]);

  it('reports a forward knee as positive and a backward one as negative', () => {
    expect(kneeOffset(legs(0.05), 'l')!).toBeGreaterThan(0);
    expect(kneeOffset(legs(-0.05), 'l')!).toBeLessThan(0);
  });

  it('returns null for a body with no leg chain, rather than guessing', () => {
    expect(kneeOffset(new Map(), 'l')).toBeNull();
  });

  it('passes when the fold matches the declaration, either way round', () => {
    expect(checkStance(legs(0.05), 'humanoid')).toEqual([]);
    expect(checkStance(legs(-0.05), 'digitigrade')).toEqual([]);
  });

  // The failure this exists for: WAM's leg pitches ported verbatim produced a
  // kangaroo hock that passed every geometric check, because a backward knee
  // is perfectly closed, connected and non-interpenetrating.
  it('catches a knee folded the way the model did NOT declare', () => {
    const errs = checkStance(legs(-0.05), 'humanoid');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/folds digitigrade.*declares stance humanoid/);
  });

  it('ignores a knee within tolerance of straight, where there is no fold', () => {
    expect(checkStance(legs(0.001), 'digitigrade')).toEqual([]);
  });

  it('agrees with the shipped goblin, which declares humanoid', async () => {
    const src = (await import('./characters/goblin.blob?raw')).default;
    const { parseBlob } = await import('./blob-parse');
    const { compileBlob } = await import('./blob-compile');
    const { buildBody } = await import('./build-body');
    const doc = parseBlob(src);
    const b = buildBody(compileBlob(doc));
    expect(doc.stance).toBe('humanoid');
    expect(checkStance(b.bones, doc.stance)).toEqual([]);
  });
});
