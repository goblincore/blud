// src/lab/sdf-zombie/webgpu/skeleton-spike/mesh.test.ts
//
// Task 2 regression tests for the segment mesh extraction. Everything runs
// against the REAL zombie sources (contract.ts over characters/zombie.blob)
// — skull, pelvis and rib segments, no synthetic stand-ins. The CHOSEN
// anatomy is the contract source field itself (per the 2026-09-08 owner
// clarification the source is the authored shape; extraction accuracy is
// what these tests pin — within extraction-cell error, holes and
// disconnected components preserved, cache invalidation + disposal exact).
import { describe, it, expect } from 'vitest';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { applyRig, bindRig } from '../../rig-bind';
import type { Vec3 } from '../../types';
import zombieSrc from '../../characters/zombie.blob?raw';
import soldierSrc from '../../characters/soldier.blob?raw';
import { makeMotionJoints, makeMotionState, stepMotion, STANDING_RIG } from '../../motion';
import { stepRig } from '../../rig';
import { makeRng } from '../../wander';
import { SOLDIER_PROFILE } from '../../motion-profile';
import { solveHingeLeg } from '../../ik';
import { sdBody } from '../../validate';
import { gradientOf } from '../surface-nets-cpu';
import { createSkeletonSources, type BoneFieldSource } from './contract';
import { SegmentMeshCache, extractSegmentMesh, MESH_CELL, type SegmentMesh } from './mesh';
import { createSegmentMeshRenderer } from './mesh-renderer';

const body = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
const bound = bindRig(body);
const sources = createSkeletonSources(body, bound, { character: 'zombie' });

describe('soldier mesh containment', () => {
  it('contains cached leg meshes throughout 240 live soldier strafe steps', () => {
    const soldier = buildBody(compileBlob(parseBlob(soldierSrc)), DEFAULT_BUILD_OPTS);
    const bound = bindRig(soldier);
    const joints = makeMotionJoints(soldier, bound.rig.restPose)!;
    const sources = createSkeletonSources(soldier, bound, { character: 'soldier', rig: () => bound.rig });
    const meshes = sources.filter(s => s.segment.startsWith('limb:leg')).map(source => ({ source, mesh: extractSegmentMesh(source) }));
    let state = makeMotionState(8, [0, 0, 0]);
    state.wander = { ...state.wander, target: [20, 0, 0], speed: SOLDIER_PROFILE.cruise };
    const random = makeRng(8);
    let worst = -Infinity, segment = '', worstFrame = -1;
    for (let frame = 0; frame < 240; frame++) {
      const r = stepMotion(state, joints, { enabled: true, wander: true, profile: SOLDIER_PROFILE, faceHeading: 0 }, {
        dt: 1 / 60, shot: null, fire: false, wounded: { armL: false, armR: false, legL: false, legR: false },
        severed: [], missing: { legL: false, legR: false, armL: false, armR: false }, headAlive: true, forcedCollapse: false, freshWounds: [],
      }, bound.rig.points, { minX: -30, maxX: 30, minZ: -30, maxZ: 30 }, random);
      bound.rig = stepRig({ ...bound.rig, restPose: r.frame.restPose, posePins: r.frame.posePins }, 1 / 60,
        { gravity: r.frame.gravity, restStiffness: STANDING_RIG.restStiffness * r.frame.restPull, damping: .06, iterations: 4 });
      state = r.state;
      if (frame % 15 !== 0) continue;
      const posed = applyRig(soldier, bound, r.frame.bodyYaw);
      for (const { source, mesh } of meshes) {
        const pos = mesh.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          const d = sdBody(source.toWorld([pos.getX(i), pos.getY(i), pos.getZ(i)]), posed);
          if (d > worst) { worst = d; segment = source.segment; worstFrame = frame; }
        }
      }
    }
    for (const { mesh } of meshes) mesh.geometry.dispose();
    expect(worst, `frame ${worstFrame}, ${segment}`).toBeLessThanOrEqual(-0.004);
  });
  it.each([0.12, 0.3])('contains leg meshes through a grounded hinge squat of %s metres', drop => {
    const soldier = buildBody(compileBlob(parseBlob(soldierSrc)), DEFAULT_BUILD_OPTS);
    const bound = bindRig(soldier);
    const joints = makeMotionJoints(soldier, bound.rig.restPose)!;
    const sources = createSkeletonSources(soldier, bound, { character: 'soldier', rig: () => bound.rig });
    // Same exact two-bone solver and pinned contacts used by soldier footwork.
    const points = bound.rig.points.map(p => ({ ...p, pos: [p.pos[0], p.pos[1] - drop, p.pos[2]] as Vec3 }));
    for (const side of ['L', 'R'] as const) {
      const hip = joints.index[`hip${side}`], knee = joints.index[`knee${side}`];
      const foot = joints.index[`foot${side}`], toe = joints.index[`toe${side}`];
      const solved = solveHingeLeg(points[hip]!.pos, bound.rig.points[foot]!.pos, joints.leg[side], [0, 0, 1]);
      points[knee]!.pos = solved.knee;
      points[foot]!.pos = solved.foot;
      points[toe]!.pos = bound.rig.points[toe]!.pos;
    }
    bound.rig = { ...bound.rig, points };
    const posed = applyRig(soldier, bound);
    let worst = -Infinity, segment = '';
    for (const source of sources.filter(s => s.segment.startsWith('limb:leg'))) {
      const mesh = extractSegmentMesh(source);
      const pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const p = source.toWorld([pos.getX(i), pos.getY(i), pos.getZ(i)]);
        const d = sdBody(p, posed);
        if (d > worst) { worst = d; segment = source.segment; }
      }
      mesh.geometry.dispose();
    }
    expect(worst, `worst squat segment: ${segment}`).toBeLessThanOrEqual(-0.004);
  });
  it('keeps every extracted bone vertex behind the authored flesh surface', () => {
    const soldier = buildBody(compileBlob(parseBlob(soldierSrc)), DEFAULT_BUILD_OPTS);
    const soldierSources = createSkeletonSources(soldier, bindRig(soldier), { character: 'soldier' });
    let worst = -Infinity;
    let worstSegment = '';
    for (const source of soldierSources) {
      const mesh = extractSegmentMesh(source);
      const pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const p = source.toWorld([pos.getX(i), pos.getY(i), pos.getZ(i)]);
        const d = sdBody(p, soldier);
        if (d > worst) { worst = d; worstSegment = source.segment; }
      }
      mesh.geometry.dispose();
    }
    expect(worst, `worst soldier segment: ${worstSegment}`).toBeLessThanOrEqual(-0.004);
  });
});

const headSrc = sources.find(s => s.segment === 'head')!;
/** Rib carrier: the axial segment with the most member prims (rib hoops). */
const ribSrc = sources
  .filter(s => s.segment.startsWith('axial:'))
  .reduce((a, b) => (b.primCount > a.primCount ? b : a));
/** Pelvis: the axial segment whose rest-local field is inside at the
 *  authored pelvis midpoint (rest pose is the identity shift, so
 *  toLocal(world) is exact here). */
const pelvisBone = body.bones.get('pelvis')!;
const pelvisMid: Vec3 = [
  (pelvisBone.head[0] + pelvisBone.tail[0]) / 2,
  (pelvisBone.head[1] + pelvisBone.tail[1]) / 2,
  (pelvisBone.head[2] + pelvisBone.tail[2]) / 2,
];
const pelvisSrc = sources
  .filter(s => s.segment.startsWith('axial:'))
  .map(s => ({ s, d: s.distance(s.toLocal(pelvisMid)) }))
  .reduce((a, b) => (b.d < a.d ? b : a)).s; // nearest field = the pelvis segment

/** Deterministic RNG (mulberry32) — coverage samples must not flake. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function meshVerts(m: SegmentMesh): Float32Array {
  return m.geometry.getAttribute('position').array as Float32Array;
}

function nearestVertDist(m: SegmentMesh, p: Vec3): number {
  const v = meshVerts(m);
  let best = Infinity;
  for (let i = 0; i < v.length; i += 3) {
    const dx = v[i]! - p[0], dy = v[i + 1]! - p[1], dz = v[i + 2]! - p[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

describe('extractSegmentMesh — real zombie segments', () => {
  it('extracts every segment non-empty, complete and unclamped', () => {
    expect(headSrc).toBeDefined();
    expect(sources.length).toBe(18); // task-1 census
    for (const s of sources) {
      const m = extractSegmentMesh(s);
      expect(m.verts, s.segment).toBeGreaterThan(0);
      expect(m.tris, s.segment).toBeGreaterThan(0);
      // No lost quads, no vertex-cap overflow, no grid clamp: any of these
      // is a HOLE in the bone surface — an unacceptable defect class.
      expect(m.droppedQuads, s.segment).toBe(0);
      expect(m.overflow, s.segment).toBe(false);
      expect(m.clamped, s.segment).toBe(false);
    }
  });

  it.each([
    ['skull', () => headSrc],
    ['pelvis', () => pelvisSrc],
    ['ribs', () => ribSrc],
  ])('%s: every vertex lands ON the field within extraction-cell error', (_label, pick) => {
    const s = pick();
    const m = extractSegmentMesh(s);
    const v = meshVerts(m);
    let worst = 0;
    for (let i = 0; i < v.length; i += 3) {
      const d = Math.abs(s.distance([v[i]!, v[i + 1]!, v[i + 2]!]));
      if (d > worst) worst = d;
    }
    // Newton pull targets the true surface; allow one cell of slack.
    expect(worst).toBeLessThan(MESH_CELL * 1.5);
  });

  it.each([
    ['skull', () => headSrc],
    ['pelvis', () => pelvisSrc],
    ['ribs', () => ribSrc],
  ])('%s: mesh stays inside the contract bounds (no leak room)', (_label, pick) => {
    const s = pick();
    const m = extractSegmentMesh(s);
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    for (let k = 0; k < 3; k++) {
      const mn = [bb.min.x, bb.min.y, bb.min.z][k]!;
      const mx = [bb.max.x, bb.max.y, bb.max.z][k]!;
      expect(mn).toBeGreaterThanOrEqual(s.bounds.min[k]! - MESH_CELL);
      expect(mx).toBeLessThanOrEqual(s.bounds.max[k]! + MESH_CELL);
    }
  });

  it.each([
    ['skull', () => headSrc],
    ['pelvis', () => pelvisSrc],
    ['ribs', () => ribSrc],
  ])('%s: authored surface is covered — no holes, no dropped components', (_label, pick) => {
    const s = pick();
    const m = extractSegmentMesh(s);
    // Sample the segment's own field: uniform points in bounds, keep the
    // near-surface ones, Newton-pull them ONTO the surface, then require a
    // mesh vertex within extraction-cell error. A hole or a dropped
    // disconnected component (e.g. an iliac wing, a rib flank) leaves its
    // pulled samples with no near vertex.
    const rand = rng(0x5eed);
    const field = (p: Vec3) => s.distance(p);
    let covered = 0;
    let worst = 0;
    for (let n = 0; n < 4000 && covered < 300; n++) {
      let p: Vec3 = [
        s.bounds.min[0] + rand() * (s.bounds.max[0] - s.bounds.min[0]),
        s.bounds.min[1] + rand() * (s.bounds.max[1] - s.bounds.min[1]),
        s.bounds.min[2] + rand() * (s.bounds.max[2] - s.bounds.min[2]),
      ];
      if (Math.abs(field(p)) > MESH_CELL * 2) continue;
      for (let it = 0; it < 4; it++) {
        const d = field(p);
        const g = gradientOf(field, p, MESH_CELL * 0.25);
        p = [p[0] - d * g[0], p[1] - d * g[1], p[2] - d * g[2]];
      }
      if (Math.abs(field(p)) > MESH_CELL * 0.5) continue; // not converged
      const near = nearestVertDist(m, p);
      worst = Math.max(worst, near);
      covered++;
    }
    expect(covered).toBeGreaterThan(100); // the samples really probed the surface
    expect(worst).toBeLessThan(MESH_CELL * 1.5);
  });
});

describe('SegmentMeshRenderer lifecycle', () => {
  it('clear releases actor slots before cache disposal and permits reuse', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    renderer.update([[headSrc]]);
    expect(renderer.object.children.length).toBe(1);
    renderer.clear();
    expect(renderer.object.children.length).toBe(0);
    expect(renderer.stats.segments).toBe(0);
    cache.dispose();
    renderer.update([[headSrc]]);
    expect(renderer.object.children.length).toBe(1);
    renderer.dispose();
    cache.dispose();
  });
});

describe('SegmentMeshCache', () => {
  it('hits by identity on the same revision, misses on a new revision', () => {
    const cache = new SegmentMeshCache();
    const a = cache.get(headSrc);
    expect(cache.get(headSrc)).toBe(a); // identity = the cache hit
    expect(cache.size).toBe(1);
    // A re-derived segment (anatomy/ratio/sever) carries a NEW revision —
    // it must extract fresh geometry, never reuse the stale mesh.
    const rederived: BoneFieldSource = { ...headSrc, revision: headSrc.revision + '-v2' };
    const b = cache.get(rederived);
    expect(b).not.toBe(a);
    expect(b.key).not.toBe(a.key);
    expect(cache.size).toBe(2);
    cache.dispose();
  });

  it('keys the extraction resolution into the cache', () => {
    const fine = new SegmentMeshCache(MESH_CELL);
    const coarse = new SegmentMeshCache(MESH_CELL * 2);
    expect(fine.keyOf(headSrc)).not.toBe(coarse.keyOf(headSrc));
    const mf = fine.get(headSrc);
    const mc = coarse.get(headSrc);
    expect(mc.verts).toBeLessThan(mf.verts);
    fine.dispose();
    coarse.dispose();
  });

  it('dispose() frees every geometry and re-extracts on the next get', () => {
    const cache = new SegmentMeshCache();
    const a = cache.get(headSrc);
    let disposed = 0;
    a.geometry.addEventListener('dispose', () => disposed++);
    cache.dispose();
    expect(disposed).toBe(1);
    expect(cache.size).toBe(0);
    const b = cache.get(headSrc);
    expect(b).not.toBe(a); // re-extracted, not resurrected
    expect(b.verts).toBe(a.verts); // deterministic field, same surface
    cache.dispose();
  });
});
