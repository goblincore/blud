// src/lab/sdf-zombie/webgpu/skeleton-spike/contract.test.ts
//
// Task 1 regression tests for the skeleton field contract. Everything here
// runs against the REAL zombie (characters/zombie.blob) — skull, pelvis and
// rib segments, no synthetic stand-ins. The oracle is validate.sdPrimitive
// over the posed bonePrims, exactly the field foldBoneRange implements on
// the GPU (hard min, shape/bend honoured).
import { describe, it, expect } from 'vitest';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from '../../build-body';
import { applyRig, bindRig, type BoundRig } from '../../rig-bind';
import { stepRig } from '../../rig';
import { sdBody, sdPrimitive, smax } from '../../validate';
import type { Vec3 } from '../../types';
import { add, len, sub } from '../../vec';
import { severDistal } from '../../sever';
import { SegmentMeshCache, MESH_CELL } from './mesh';
import * as THREE from 'three/webgpu';
import { createSegmentMeshRenderer } from './mesh-renderer';
import zombieSrc from '../../characters/zombie.blob?raw';
import soldierSrc from '../../characters/soldier.blob?raw';
import {
  composedBoneDistance, createSkeletonSources, type BoneFieldSource,
} from './contract';

const body = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
const bound = bindRig(body);
const sources = createSkeletonSources(body, bound, { character: 'zombie' });
/** The posed rest body (identity pose), carrying boneSegment tags. */
const rest = applyRig(body, bound);

/** The cranium: the fattest authored skull bone (a sphere prim, a === b). */
const cranium = body.bonePrims
  .filter(b => b.op === 'bone' && b.limb === 'head')
  .reduce((a, b) => (b.radius > a.radius ? b : a));

/** The procedural oracle: hard min over live posed BONE prims (organs are
 *  out of contract — they stay procedural on the GPU side too). */
function referenceBoneDistance(posed: BuildResult, p: Vec3): number {
  let d = Infinity;
  for (const b of posed.bonePrims) {
    if (b.op === 'organ' || b.dead) continue;
    if (!posed.clusters[b.cluster]?.alive) continue;
    const sd = sdPrimitive(p, b);
    if (sd < d) d = sd;
  }
  return d;
}

/** applyRig's segment-assignment ladder, duplicated so the test can attribute
 *  a bonePrim index to its source WITHOUT trusting the implementation under
 *  test (organ → excluded; head-rigid; axial frame; limb bind pair). */
function segmentKeyOf(b: BoundRig, i: number): string | null {
  const p = body.bonePrims[i]!;
  if (p.op === 'organ') return null;
  if (b.head?.bones.has(i)) return 'head';
  const f = b.boneFrames.get(i);
  if (f) return `axial:${f.head}-${f.tail}`;
  const bind = b.boneBinding[i]!;
  return `limb:${p.limb}:${bind.a.point}-${bind.b.point}`;
}

/** Sample cloud around a world-space centre. */
function cloud(centre: Vec3, r: number): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [-1, -0.33, 0.33, 1])
    for (const y of [-1, 0.2, 1])
      for (const z of [-1, -0.5, 0.5, 1])
        out.push([centre[0] + x * r, centre[1] + y * r, centre[2] + z * r]);
  return out;
}

const pelvis = body.bones.get('pelvis')!;
const skullMid = cranium.a; // the cranium sphere centre
const pelvisMid: Vec3 = [(pelvis.head[0] + pelvis.tail[0]) / 2, (pelvis.head[1] + pelvis.tail[1]) / 2, (pelvis.head[2] + pelvis.tail[2]) / 2];
const ribMid: Vec3 = [0.12, 1.28, 0.02]; // flank of the widest authored rib pair
/** Front surface point of the cranium ellipsoid (+z semi-axis). */
const craniumFront: Vec3 = [cranium.a[0], cranium.a[1], cranium.a[2] + cranium.radius * cranium.scale[2]];

describe('createSkeletonSources — census', () => {
  it('builds with a clean body', () => {
    expect(body.errors).toEqual([]);
    expect(sources.length).toBeGreaterThan(3);
  });

  it('partitions every bone prim exactly once and excludes organs', () => {
    const boneIdxs = body.bonePrims.map((b, i) => ({ b, i })).filter(x => x.b.op !== 'organ');
    expect(boneIdxs.length).toBeGreaterThan(0);
    expect(sources.reduce((n, s) => n + s.primCount, 0)).toBe(boneIdxs.length);
    expect(sources.some(s => s.segment === 'organs')).toBe(false);
    // Every bone prim's ladder key names a real source.
    for (const { i } of boneIdxs) {
      const key = segmentKeyOf(bound, i);
      expect(sources.some(s => s.segment === key)).toBe(true);
    }
  });

  it('has the skull unit, axial pelvis/spine segments and bent rib bars', () => {
    const head = sources.find(s => s.segment === 'head');
    expect(head).toBeDefined();
    expect(head!.rigidity).toBe('rigid');
    expect(head!.primCount).toBeGreaterThanOrEqual(2); // cranium + jaw
    const axial = sources.filter(s => s.segment.startsWith('axial:'));
    expect(axial.length).toBeGreaterThanOrEqual(2);
    expect(body.bonePrims.some(b => b.op === 'bone' && b.bend !== undefined)).toBe(true);
  });

  it('bounds enclose the member surfaces (segment-local AABB)', () => {
    for (const s of sources) {
      for (let k = 0; k < 3; k++) {
        expect(s.bounds.min[k]!).toBeLessThan(s.bounds.max[k]!);
        expect(Math.abs(s.bounds.min[k]!)).toBeLessThan(1.0);
        expect(Math.abs(s.bounds.max[k]!)).toBeLessThan(1.0);
      }
      // A bounds corner is outside or on the surface (no interior corner).
      expect(s.distance(s.bounds.min)).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it('revisions are deterministic per build and unique per segment', () => {
    const again = createSkeletonSources(body, bound, { character: 'zombie' });
    expect(again.map(s => s.revision)).toEqual(sources.map(s => s.revision));
    expect(new Set(sources.map(s => s.revision)).size).toBe(sources.length);
  });
});

describe('rest pose — identity frames and exact distance agreement', () => {
  it('poses are the identity at rest (local->posed->local round trip)', () => {
    const p: Vec3 = [0.013, -0.007, 0.042];
    for (const s of sources) {
      expect(len(sub(s.toLocal(s.toWorld(p)), p))).toBeLessThan(1e-9);
      expect(s.poseEndpointError()).toBeLessThan(1e-9);
      expect(Math.abs(1 - s.pose().quat[3])).toBeLessThan(1e-9);
    }
  });

  it.each([
    ['skull', skullMid, 0.14],
    ['pelvis', pelvisMid, 0.18],
    ['rib', ribMid, 0.10],
  ] as const)('source distance agrees with the procedural oracle at the %s', (_n, centre, r) => {
    for (const p of cloud(centre, r))
      expect(Math.abs(composedBoneDistance(sources, p) - referenceBoneDistance(rest, p))).toBeLessThan(1e-6);
  });

  it('composes under a subtraction cavity exactly (carve, then bone min)', () => {
    // A pellet crater centred on the cranium's front surface: applyWounds'
    // sequential smax against the flesh field, then the bone hard-min — the
    // marched order. The crater reaches ~5 cm into the head, well past the
    // ~1 cm of flesh over the bone.
    const wound = { at: craniumFront, r: 0.05, depth: 0.06, k: 0.01 };
    const carved = (p: Vec3) => {
      const rr = len(sub(p, wound.at));
      return smax(sdBody(p, rest), Math.min(wound.r - rr, wound.depth - rr), wound.k);
    };
    let boneWon = 0;
    for (const p of cloud(add(craniumFront, [0, -0.01, -0.02] as Vec3), 0.03)) {
      const ref = Math.min(carved(p), referenceBoneDistance(rest, p));
      const got = Math.min(carved(p), composedBoneDistance(sources, p));
      expect(Math.abs(got - ref)).toBeLessThan(1e-6);
      if (referenceBoneDistance(rest, p) < carved(p)) boneWon++;
    }
    // The fixture must actually reach bone inside the cavity, or it is
    // vacuous — the cranium sits ~6 mm under the skin here.
    expect(boneWon).toBeGreaterThan(0);
  });

  it('severed clusters drop their segment from the composed field', () => {
    const headCluster = body.clusters.findIndex(c => c.limb === 'head');
    expect(headCluster).toBeGreaterThanOrEqual(0);
    const severed: BuildResult = {
      ...body,
      clusters: body.clusters.map((c, i) => i === headCluster ? { ...c, alive: false } : c),
    };
    const sevSources = createSkeletonSources(severed, bound, { character: 'zombie' });
    const sevHead = sevSources.find(s => s.segment === 'head')!;
    expect(sevHead.isLive()).toBe(false);
    const p = add(skullMid, [0, 0.03, 0.10] as Vec3);
    const intactRef = referenceBoneDistance(rest, p);
    const severedRef = referenceBoneDistance({ ...rest, clusters: severed.clusters }, p);
    expect(severedRef).toBeGreaterThan(intactRef); // skull bone no longer folds
    expect(composedBoneDistance(sevSources, p)).toBeCloseTo(severedRef, 9);
  });
});

describe('posed — round trips and measured rigidity error', () => {
  // A real verlet pose: 60 gravity steps (the rig-bind.test.ts recipe), so
  // joints sit off rest but constraint-legal.
  const movedRig = (() => {
    let rig = bound.rig;
    for (let i = 0; i < 60; i++)
      rig = stepRig(rig, 1 / 60, { gravity: [0, -9.8, 0], damping: 0.04, iterations: 4, restStiffness: 0.2 });
    return rig;
  })();
  const moved: BoundRig = { ...bound, rig: movedRig };
  const posed = applyRig(body, moved);
  // Sources bound to the MOVED rig through the live accessor — the stale-rig
  // failure mode (a ~1 cm phantom gap on every rigid segment) is what the
  // exactness assertion below verified before this accessor existed.
  const movedSources = createSkeletonSources(body, bound, { character: 'zombie', rig: () => movedRig });

  /** Min over the segment's OWN posed member prims (the per-segment oracle). */
  function segmentOracle(src: BoneFieldSource, p: Vec3): number {
    let d = Infinity;
    body.bonePrims.forEach((b, i) => {
      if (segmentKeyOf(bound, i) !== src.segment) return;
      const sd = sdPrimitive(p, posed.bonePrims[i]!);
      if (sd < d) d = sd;
    });
    return d;
  }

  it('frames stay invertible under pose (local->posed->local)', () => {
    const p: Vec3 = [-0.021, 0.055, 0.018];
    for (const s of movedSources)
      expect(len(sub(s.toLocal(s.toWorld(p)), p))).toBeLessThan(1e-9);
  });

  it('rigid segments (skull unit, axial frames) pose endpoints exactly', () => {
    const rigid = movedSources.filter(s => s.rigidity === 'rigid');
    expect(rigid.length).toBeGreaterThan(0);
    for (const s of rigid) expect(s.poseEndpointError()).toBeLessThan(1e-9);
  });

  it('limb segments carry a small, measured two-anchor endpoint error', () => {
    const limbs = movedSources.filter(s => s.rigidity === 'limb');
    expect(limbs.length).toBeGreaterThan(0);
    let worst = 0;
    for (const s of limbs) worst = Math.max(worst, s.poseEndpointError());
    // The verlet holds bone lengths; 5 mm is the documented budget — the
    // measured value for this pose is recorded in task-1.md. If this blows
    // up, the two-anchor drift got worse and tasks 2/3 must know.
    expect(worst).toBeLessThan(0.005);
  });

  it('posed distance: unbent rigid segments exact; bent rib bars bounded (bend caveat)', () => {
    // applyRig does not rotate Primitive.bend (a world-axis displacement),
    // while a rigid local bake rotates it. That gap is geometric, not an
    // endpoint error: pin it with its own bound so the report can quote it.
    let worstExact = 0;
    let worstBent = 0;
    for (const s of movedSources.filter(s => s.rigidity === 'rigid')) {
      const idxs = body.bonePrims.map((_, i) => i).filter(i => segmentKeyOf(bound, i) === s.segment);
      const bent = idxs.some(i => body.bonePrims[i]!.bend !== undefined);
      const centre = s.toWorld([0, 0, 0]);
      for (const p of cloud(centre as Vec3, 0.06)) {
        const gap = Math.abs(s.distance(s.toLocal(p)) - segmentOracle(s, p));
        if (bent) worstBent = Math.max(worstBent, gap);
        else worstExact = Math.max(worstExact, gap);
      }
    }
    expect(worstExact).toBeLessThan(1e-9);
    // Rib bend up to 0.162 m at this pose's spine tilt: |bend| * tilt scale.
    // 3 mm covers the measured value by ~10x; the number goes in the report.
    expect(worstBent).toBeLessThan(0.003);
  });
});

describe('soldier limb mesh pose', () => {
  it('derives stable local geometry after motion has rewritten rig.restPose', () => {
    const soldier = buildBody(compileBlob(parseBlob(soldierSrc)), DEFAULT_BUILD_OPTS);
    const soldierBound = bindRig(soldier);
    const pristine = createSkeletonSources(soldier, soldierBound, { character: 'soldier' });
    const elbowPos = soldier.bones.get('upperarm.l')!.tail;
    const handIdx = soldierBound.rig.restPose.findIndex(p => len(sub(p, elbowPos)) < 1e-9);
    expect(handIdx).toBeGreaterThanOrEqual(0);
    const rewrittenRestPose = soldierBound.rig.restPose.map((p, i) =>
      i === handIdx ? add(p, [0, 0.35, 0.25]) : p);
    const delayedBound: BoundRig = {
      ...soldierBound,
      rig: { ...soldierBound.rig, restPose: rewrittenRestPose },
    };
    const delayed = createSkeletonSources(soldier, delayedBound, { character: 'soldier' });

    // Extraction/cache identity belongs to stable actor.body geometry. A
    // rewritten motion target must not bake the raised weapon pose into it.
    expect(delayed.map(s => s.revision)).toEqual(pristine.map(s => s.revision));
    expect(Math.max(...delayed.map(s => s.poseEndpointError()))).toBeLessThan(1e-9);
  });
});


describe.each([['soldier', soldierSrc], ['zombie', zombieSrc]])('%s distal skeleton sever', (character, blob) => {
  it.each(['L', 'R'] as const)('removes dead %s forearm bones while retaining the live upper arm', side => {
    const intact = buildBody(compileBlob(parseBlob(blob)));
    const limb = side === 'L' ? 'armL' : 'armR';
    const cut = severDistal(intact, { limb, fromPrim: intact.prims.findIndex(p => p.bone?.toLowerCase() === `forearm.${side.toLowerCase()}`) });
    expect(cut.body.clusters.find(c => c.limb === limb)!.alive).toBe(true);
    expect(cut.body.bonePrims.some(p => p.limb === limb && p.dead)).toBe(true);
    const rig = bindRig(cut.body), posed = applyRig(cut.body, rig);
    const rebuilt = createSkeletonSources(cut.body, rig, { character });
    const liveBones = cut.body.bonePrims.filter(p => p.op !== 'organ' && !p.dead);
    expect(rebuilt.reduce((n, s) => n + s.primCount, 0)).toBe(liveBones.length);
    for (const bone of posed.bonePrims.filter(p => p.limb === limb && p.dead)) {
      const middle: Vec3 = [(bone.a[0] + bone.b[0]) / 2, (bone.a[1] + bone.b[1]) / 2, (bone.a[2] + bone.b[2]) / 2];
      expect(composedBoneDistance(rebuilt, middle)).toBeCloseTo(referenceBoneDistance(posed, middle), 6);
    }
  });

  it('replaces cached intact-arm meshes on the first post-sever renderer update', () => {
    const intact = buildBody(compileBlob(parseBlob(blob)));
    const sources = createSkeletonSources(intact, bindRig(intact), { character }).filter(s => s.segment.startsWith('limb:armR:'));
    const cache = new SegmentMeshCache(), renderer = createSegmentMeshRenderer(cache), owner = {};
    renderer.update([sources], [owner]);
    const segsDrawn = () => renderer.drawn.filter(d => !d.eye);
    const originalCount = segsDrawn().length;
    const cut = severDistal(intact, { limb: 'armR', fromPrim: intact.prims.findIndex(p => p.bone?.toLowerCase() === 'forearm.r') });
    const rebuilt = createSkeletonSources(cut.body, bindRig(cut.body), { character }).filter(s => s.segment.startsWith('limb:armR:'));
    renderer.update([rebuilt], [owner]);
    expect(segsDrawn().length).toBeLessThan(originalCount);
    expect(segsDrawn().length).toBe(rebuilt.length);
    expect(rebuilt.reduce((n, s) => n + s.primCount, 0)).toBe(cut.body.bonePrims.filter(p => p.limb === 'armR' && !p.dead && p.op !== 'organ').length);
    const posed = applyRig(cut.body, bindRig(cut.body));
    let vertices = 0;
    for (const d of segsDrawn()) {
      const pos = d.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const world = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(d.matrix);
        expect(referenceBoneDistance(posed, world.toArray() as Vec3)).toBeLessThanOrEqual(MESH_CELL);
        vertices++;
      }
    }
    expect(vertices).toBeGreaterThan(0);
    renderer.dispose(); cache.dispose();
  });
});
