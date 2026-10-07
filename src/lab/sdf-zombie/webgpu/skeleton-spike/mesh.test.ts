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
import { meshBoneSource } from './mesh-skull';
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
import {
  SegmentMeshCache, extractSegmentMesh, MESH_CELL, ORGAN_MESHES, ORGAN_MESH_DEFAULT, ORGAN_NETS_FALLBACK, organMeshKey,
  type OrganMeshName, type SegmentMesh,
} from './mesh';
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
    expect(sources.length).toBe(20); // task-1 census, + the two feet (2026-09-29)
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
    const s = meshBoneSource(pick());
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
    const s = meshBoneSource(pick());
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
    const s = meshBoneSource(pick());
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
    const segs = () => renderer.drawn.filter(d => !d.eye).length;
    renderer.update([[headSrc]]);
    expect(segs()).toBe(1);
    renderer.clear();
    expect(segs()).toBe(0);
    expect(renderer.object.children.length).toBe(0);
    expect(renderer.stats.segments).toBe(0);
    cache.dispose();
    renderer.update([[headSrc]]);
    expect(segs()).toBe(1);
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

describe('organ sources mesh by ORGAN_MESHES (organs as mesh, 2026-10-06; low-poly, 2026-10-07)', () => {
  const organSrc = createSkeletonSources(body, bound, { character: 'zombie', organs: true }).filter(s => s.kind === 'organ');
  const meshed = (name: OrganMeshName) => organSrc.map(s => extractSegmentMesh(s, MESH_CELL, ORGAN_MESHES[name]));
  const sum = (ms: SegmentMesh[]) => ({ verts: ms.reduce((n, m) => n + m.verts, 0), tris: ms.reduce((n, m) => n + m.tris, 0) });

  it('keys an organ by its mesh spec and a bone by the cache cell; the default is the swept tubes', () => {
    const cache = new SegmentMeshCache();
    expect(organSrc.length).toBe(2);
    expect(ORGAN_MESH_DEFAULT).toBe('tubes');
    for (const s of organSrc) expect(cache.keyOf(s)).toBe(`${s.revision}@${organMeshKey(ORGAN_MESHES.tubes)}`);
    expect(cache.keyOf(sources[0]!).endsWith(`@${MESH_CELL}`)).toBe(true);
    // Every spec has its own key: two specs never share a cached mesh.
    const keys = Object.values(ORGAN_MESHES).map(organMeshKey);
    expect(new Set(keys).size).toBe(keys.length);
    cache.dispose();
  });

  it('the vertex and triangle counts of the zombie organs, per mesh (the numbers the notes report)', () => {
    // 2026-10-06 shipped nets-5mm. The swept tubes are 13% of its vertices and of its triangles.
    expect(sum(meshed('nets-5mm'))).toEqual({ verts: 4038, tris: 8084 });
    expect(sum(meshed('nets-10mm'))).toEqual({ verts: 999, tris: 1996 });
    expect(sum(meshed('tubes'))).toEqual({ verts: 528, tris: 1024 });
    expect(meshed('tubes').map(m => m.verts)).toEqual([438, 90]);
    for (const name of Object.keys(ORGAN_MESHES) as OrganMeshName[]) {
      const ms = meshed(name);
      console.log(`  organ mesh ${name}: ${ms.map(m => `${m.verts} v / ${m.tris} t`).join(' + ')} = ${sum(ms).verts} v / ${sum(ms).tris} t; built in ${ms.reduce((n, m) => n + m.bakeMs, 0).toFixed(1)} ms`);
    }
  });

  it('extracts each organ segment complete, unclamped, and on the organ field (surface nets)', () => {
    for (const name of ['nets-5mm', 'nets-10mm'] as const) {
      for (const [k, m] of meshed(name).entries()) {
        const s = organSrc[k]!;
        expect(m.mesher).toBe('nets');
        expect(m.overflow).toBe(false);
        expect(m.clamped).toBe(false);
        expect(m.droppedQuads).toBe(0);
        expect(m.geometry.getAttribute('organTube')).toBeUndefined();
        const pos = m.geometry.getAttribute('position');
        let worst = 0;
        for (let i = 0; i < pos.count; i++) worst = Math.max(worst, Math.abs(s.distance([pos.getX(i), pos.getY(i), pos.getZ(i)])));
        // Newton-pulled onto the zero set; creases between hard-min members hold the largest error.
        expect(worst).toBeLessThan(name === 'nets-5mm' ? 0.001 : 0.002);
      }
    }
  });

  it('nets-10mm takes its normals from the field gradient: unit, and round where face normals are faceted', () => {
    for (const [k, m] of meshed('nets-10mm').entries()) {
      const s = organSrc[k]!, pos = m.geometry.getAttribute('position'), nor = m.geometry.getAttribute('normal');
      const faces = m.geometry.clone();
      faces.computeVertexNormals();
      const fn = faces.getAttribute('normal');
      let worstG = 1, worstF = 1;
      for (let i = 0; i < pos.count; i++) {
        const p: Vec3 = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 5);
        // Against the same gradient at a much finer step, away from the creases (there the field has two).
        const fine = gradientOf(q => s.distance(q), p, 1e-5), coarse = gradientOf(q => s.distance(q), p, 0.004);
        if (fine[0] * coarse[0] + fine[1] * coarse[1] + fine[2] * coarse[2] < 0.98) continue;
        worstG = Math.min(worstG, nor.getX(i) * fine[0] + nor.getY(i) * fine[1] + nor.getZ(i) * fine[2]);
        worstF = Math.min(worstF, fn.getX(i) * fine[0] + fn.getY(i) * fine[1] + fn.getZ(i) * fine[2]);
      }
      expect(worstG).toBeGreaterThan(0.97);
      expect(worstG).toBeGreaterThan(worstF);
    }
  });

  it('the swept mesh carries organTube and analytic normals; the cache returns it by identity until the spec changes', () => {
    const cache = new SegmentMeshCache();
    for (const s of organSrc) {
      const m = cache.get(s);
      expect(m.mesher).toBe('tubes');
      expect(m.geometry.getAttribute('organTube').itemSize).toBe(4);
      expect(m.geometry.getAttribute('organTube').count).toBe(m.verts);
      expect(m.geometry.getAttribute('normal').count).toBe(m.verts);
      expect(m.geometry.index!.count).toBe(m.tris * 3);
      expect(cache.get(s)).toBe(m);
      // Another spec: another entry, and the first is still there to go back to.
      cache.organMesh = ORGAN_MESHES['nets-10mm'];
      const n = cache.get(s);
      expect(n).not.toBe(m);
      expect(n.mesher).toBe('nets');
      cache.organMesh = ORGAN_MESHES.tubes;
      expect(cache.get(s)).toBe(m);
    }
    expect(cache.size).toBe(organSrc.length * 2);
    cache.dispose();
  });

  it('a segment with a prim that cannot be swept extracts instead, under the key that asked for tubes', () => {
    const s = organSrc[0]!;
    const boxed: BoneFieldSource = { ...s, revision: `${s.revision}:boxed`, prims: [...s.prims!, { ...s.prims![0]!, box: { round: 0.3 } }] };
    const m = extractSegmentMesh(boxed, MESH_CELL, ORGAN_MESHES.tubes);
    expect(m.mesher).toBe('nets');
    expect(m.key).toBe(`${boxed.revision}@${organMeshKey(ORGAN_MESHES.tubes)}`);
    expect(m.verts).toBe(extractSegmentMesh(boxed, MESH_CELL, ORGAN_NETS_FALLBACK).verts);
    // No prims at all (an adapter carved the field): the same fallback.
    expect(extractSegmentMesh({ ...s, prims: undefined }, MESH_CELL, ORGAN_MESHES.tubes).mesher).toBe('nets');
  });

  it('a bone source ignores the organ spec', () => {
    const bone = sources.find(s => s.segment.startsWith('limb:'))!;
    const a = extractSegmentMesh(bone), b = extractSegmentMesh(bone, MESH_CELL, ORGAN_MESHES.tubes);
    expect(b.mesher).toBe('nets');
    expect(b.key).toBe(a.key);
    expect(b.verts).toBe(a.verts);
  });
});
