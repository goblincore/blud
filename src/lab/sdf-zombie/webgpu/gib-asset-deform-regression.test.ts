// src/lab/sdf-zombie/webgpu/gib-asset-deform-regression.test.ts
//
// THE 2026-09-17 METRE-POLE REGRESSION (offline-gib-spikes). Owner playtest of
// ea699255 saw long red/black metre-scale poles attached to gibs in flight AND
// settled, across arena and room1, after repeated dynamite on MOVING enemies.
// The Task-3 gate had passed because its fixtures were frozen, at low yaw, at
// the origin, and spawned at rest.
//
// ROOT CAUSE (proved here on the CPU). The bind table's nearest-surface rule
// could hand a cut-face vertex to the `sub` CUT CAP: a POINT sphere whose centre
// sits `GIB_CUT.radiusK` (~12x) piece extents behind the cut plane, so its
// radius is ~3-5 m and its surface passes exactly through the cut face.
// `primTransformPoint` maps the offset from the rest cap centre to the posed cap
// centre; a point prim has no axis, so the (metre-scale) radial offset could not
// be rotated with the body. A rotated/translated character therefore displaced
// those vertices by `(I - R) * radial` — metres — and every animated piece
// trailed spike triangles. The fix is `GIB_ASSET_BIND_MASK = 'additive-v1'`:
// carve caps are not bind targets. `primTransformPoint` also now rotates the
// radial offset about the rest->posed segment axis (exact for a capsule).
//
// WHY THIS FILE. `gib-asset-integration.test.ts` pinned the ROW-ALIGNMENT half
// of the same family (a rest-frame fallback for cap rows). This file pins the
// BINDING half, and the runtime display gate that turns any future
// out-of-bounds deform into a counted marched fallback instead of a pole.
import { describe, expect, it } from 'vitest';
// @ts-expect-error — node:fs is available in the vitest node environment
import { readFileSync } from 'node:fs';
// @ts-expect-error — node:path is available in the vitest node environment
import { resolve } from 'node:path';
declare const process: { cwd(): string };
import zombieSrc from '../characters/zombie.blob?raw';
import soldierSrc from '../characters/soldier.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { DEFAULT_FACE, type FaceParams } from '../face';
import {
  displaceGibPieces, gibPlan, gibTierPlan, retargetGibPieces,
  type GibPiece,
} from '../gib-parts';
import { rupturePosed, TEAR_TUNING } from '../gib-tear';
import { applyRig, bindRig, type BoundRig } from '../rig-bind';
import { stepRig } from '../rig';
import { makeMotionJoints, makeMotionState, STANDING_RIG, stepMotion } from '../motion';
import { headingDir, makeRng, type WanderBounds } from '../wander';
import type { Primitive, Vec3 } from '../types';
import { createBakedChunkMaterial } from './baked-chunks';
import { primTransformPoint } from './gib-asset';
import { loadGibAssetSet, resetGibAssetCache } from './gib-asset-loader';
import { buildGibAssetLibrary, GibAssetInstancePool, gibAssetMeshEligible } from './gib-asset-runtime';
import {
  checkGibAssetDeformBounds, gibAssetDeformBoundsOk, gibAssetRowsFromPrims,
  measureGibAssetOutside,
} from './gib-asset-deform';

const GIB_DIR = resolve(process.cwd(), 'public/assets/lab/gibs');
const fetchImpl = async (url: string) => {
  const rel = url.replace(/^assets\/lab\/gibs\//, '');
  const b = new Uint8Array(readFileSync(resolve(GIB_DIR, rel)));
  return {
    ok: true, status: 200,
    json: async () => JSON.parse(new TextDecoder().decode(b)),
    arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer,
  };
};

const BOUNDS: WanderBounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };
const DT = 1 / 60;

function bodyOf(src: string) {
  const doc = parseBlob(src);
  const face: FaceParams = { ...DEFAULT_FACE, ...compileFace(doc) };
  return buildBody(compileBlob(doc, face), DEFAULT_BUILD_OPTS);
}

/** Walk `frames` steps; returns the posed body at a yawed, swung-arm gait. */
function walkedPose(src: string, frames: number, seed = 7) {
  const body = bodyOf(src);
  let bound: BoundRig = bindRig(body);
  const joints = makeMotionJoints(body, bound.rig.restPose) as NonNullable<ReturnType<typeof makeMotionJoints>>;
  const rng = makeRng(seed);
  let state = makeMotionState(seed, [0, 0, 0]);
  state.wander = { ...state.wander, heading: 0.9, idle: 0 };
  let posed = applyRig(body, bound, 0);
  for (let f = 0; f < frames; f++) {
    const h = headingDir(0.9);
    const ahead = [state.wander.pos[0] + h[0] * 30, state.wander.pos[1], state.wander.pos[2] + h[2] * 30] as Vec3;
    state = { ...state, wander: { ...state.wander, target: ahead, idle: 0 } };
    const step = stepMotion(state, joints, { enabled: true, wander: true },
      { dt: DT, shot: null, fire: false, wounded: { armL: false, armR: false, legL: false, legR: false }, severed: [], missing: { legL: false, legR: false, armL: false, armR: false }, headAlive: true, forcedCollapse: false, freshWounds: [] },
      bound.rig.points, BOUNDS, rng);
    state = step.state;
    const points = stepRig({ ...bound.rig, restPose: step.frame.restPose }, DT, { gravity: step.frame.gravity, damping: 0.06, iterations: 4, restStiffness: STANDING_RIG.restStiffness * step.frame.restPull }).points;
    bound = { ...bound, rig: { points, constraints: bound.rig.constraints, restPose: step.frame.restPose } };
    posed = applyRig(body, bound, step.frame.bodyYaw);
  }
  return { body, posed };
}

/** Move a posed body well away from the origin (float precision + real play). */
function translated(body: ReturnType<typeof applyRig>, t: Vec3) {
  const sh = <T extends { a: Vec3; b: Vec3 }>(p: T): T => ({
    ...p, a: [p.a[0] + t[0], p.a[1] + t[1], p.a[2] + t[2]] as Vec3,
    b: [p.b[0] + t[0], p.b[1] + t[1], p.b[2] + t[2]] as Vec3,
  });
  return {
    ...body,
    prims: body.prims.map(sh),
    bonePrims: (body.bonePrims ?? []).map(sh),
    clusters: body.clusters.map(c => ({ ...c, center: [c.center[0] + t[0], c.center[1] + t[1], c.center[2] + t[2]] as Vec3 })),
  };
}

async function library(archetype: string) {
  resetGibAssetCache();
  const set = await loadGibAssetSet(archetype, { fetchImpl });
  return buildGibAssetLibrary(set, createBakedChunkMaterial({
    goreDetail: true, bakedAo: true, fleshResponse: true,
  }).material);
}

describe('gib asset binding: carve caps are not deform targets (2026-09-17 regression)', () => {
  it('a metre-radial point cap cannot be carried unrotated onto a posed body', () => {
    // The producing condition, reproduced in isolation: an additive arm capsule
    // plus the planner's actual cut cap shape (a POINT sphere ~3.2 m behind the
    // face, radius ~3.2 m). A cut-face vertex is just inside the cap's surface,
    // so nearest-surface binding picks the cap.
    const face: Vec3 = [0.10, 1.30, 0.02];
    const restCap = { a: [0, -1.90, 0.04] as Vec3, b: [0, -1.90, 0.04] as Vec3, radius: 3.21, scale: [1, 1, 1] as Vec3 };
    // A rotated, translated pose (the live walking enemy's arm swing). The cap's
    // radial is mostly along -Y, so a NON-Y-axis rotation is what exposes the
    // unrotated radial; a pure yaw would leave it nearly untouched.
    const th = 1.25, tx = 21, tz = -13;
    const rot = (p: Vec3): Vec3 => [
      p[0] * Math.cos(th) - p[1] * Math.sin(th) + tx,
      p[0] * Math.sin(th) + p[1] * Math.cos(th),
      p[2] + tz,
    ];
    const posedCap = { a: rot(restCap.a), b: rot(restCap.b), radius: 3.21, scale: [1, 1, 1] as Vec3 };
    const mapped = primTransformPoint(face, restCap, posedCap);
    // The correct image of the cut-face vertex under the body transform:
    const want = rot(face);
    const err = Math.hypot(mapped[0] - want[0], mapped[1] - want[1], mapped[2] - want[2]);
    // A degenerate point prim has no axis, so the radial cannot rotate: metres.
    expect(err).toBeGreaterThan(1.0);
    // ...and the same vertex bound to the ADDITIVE arm capsule stays put.
    const restArm = { a: [0.10, 1.40, 0.04] as Vec3, b: [0.30, 1.00, 0.04] as Vec3, radius: 0.06, scale: [1, 1, 1] as Vec3 };
    const posedArm = { a: rot(restArm.a), b: rot(restArm.b), radius: 0.06, scale: [1, 1, 1] as Vec3 };
    const armMapped = primTransformPoint(face, restArm, posedArm);
    expect(Math.hypot(armMapped[0] - want[0], armMapped[1] - want[1], armMapped[2] - want[2])).toBeLessThan(0.05);
  });

  it('refuses to display a piece whose bind table still carries a sub cap row', async () => {
    const lib = await library('zombie');
    const asset = lib.byPart.get('armR.upper')!;
    const { posed } = walkedPose(zombieSrc, 90);
    const g = gibPlan(posed, { bones: 'all', organs: true }).pieces.find(p => p.part === 'armR.upper')!;
    expect(gibAssetMeshEligible(asset.doc, g, true)).toBeNull();
    // A v2-style table (a `sub` cap row snuck back in) must be refused as a
    // source/row mismatch, not silently deformed against the wrong frame.
    const withCap = {
      ...asset.doc,
      bind: {
        ...asset.doc.bind,
        prims: [...asset.doc.bind.prims, {
          source: null, index: -1, op: 'sub', limb: asset.doc.limb, cluster: 0,
          a: [0, -2, 0] as Vec3, b: [0, -2, 0] as Vec3, radius: 3.2, scale: [1, 1, 1] as Vec3, blendK: 0.003,
        }],
      },
    };
    expect(gibAssetMeshEligible(withCap, g, true)).toBe('source-mismatch');
  });

  it('every committed bind row is additive (no sub cap, no unsourced row)', async () => {
    for (const archetype of ['zombie', 'soldier']) {
      const lib = await library(archetype);
      for (const piece of lib.pieces) {
        expect(piece.doc.bind.prims.length).toBeGreaterThan(0);
        for (const row of piece.doc.bind.prims) {
          expect(row.op, `${archetype}/${piece.part}`).not.toBe('sub');
          expect(row.source, `${archetype}/${piece.part}`).not.toBeNull();
        }
      }
    }
  });
});

describe('gib asset deform stays inside the runtime additive geometry', () => {
  it('animated, yawed, translated bodies: no out-of-bounds mesh on either hand-off path', async () => {
    for (const [archetype, src] of [['zombie', zombieSrc], ['soldier', soldierSrc]] as const) {
      const lib = await library(archetype);
      const pool = new GibAssetInstancePool(lib);
      let checked = 0;
      let worstOutside = 0, worstLocalRatio = 0, worstEdgeRatio = 0;
      const audit = (g: GibPiece, pivot: Vec3, additive: readonly Primitive[]) => {
        const asset = lib.byPart.get(g.part)!;
        expect(asset, `${archetype}/${g.part} has no asset`).toBeTruthy();
        // Supported (undamaged) pieces must NOT fall back: a high fallback rate
        // would be a false pass of this test.
        expect(gibAssetMeshEligible(asset.doc, g, true), `${archetype}/${g.part}`).toBeNull();
        const rows = gibAssetRowsFromPrims([...g.prims, ...g.bones]);
        const inst = pool.acquire(g.part);
        pool.deformRows(inst, rows, pivot);
        const b = checkGibAssetDeformBounds(asset.doc, asset.decoded, inst.positions, pivot, additive);
        expect(gibAssetDeformBoundsOk(b), `${archetype}/${g.part} outside=${b.maxOutside} edge=${b.maxEdge}`).toBe(true);
        // The gate is cheap-first, so also pay for the EXACT additive-field
        // error here: every vertex must sit on/inside the runtime additive
        // union. The pre-fix poles measured 4-5 m.
        const exactOutside = measureGibAssetOutside(inst.positions, pivot, additive);
        expect(exactOutside, `${archetype}/${g.part}`).toBeLessThan(0.15);
        worstOutside = Math.max(worstOutside, exactOutside);
        // Normals after correction: finite and unit, so no degenerate spike
        // triangle collapsed a normal to zero/NaN.
        for (let i = 0; i < inst.normals.length; i += 3) {
          const n = Math.hypot(inst.normals[i]!, inst.normals[i + 1]!, inst.normals[i + 2]!);
          expect(Number.isFinite(n)).toBe(true);
          expect(Math.abs(n - 1)).toBeLessThan(1e-3);
        }
        worstLocalRatio = Math.max(worstLocalRatio, b.maxLocalRadius / b.restMaxLocalRadius);
        worstEdgeRatio = Math.max(worstEdgeRatio, b.maxEdge / b.restMaxEdge);
        pool.release(inst);
        checked++;
      };
      // MULTIPLE GAIT PHASES, each on a rotated body well away from the origin:
      // a different arm/leg phase must not change the verdict.
      let expected = 0;
      for (const frames of [90, 220]) {
        const { posed: walked } = walkedPose(src, frames);
        const posed = translated(walked, [37.5, 0, -21.25]);
        const plan = gibPlan(posed, { bones: 'all', organs: true });
        expected += plan.pieces.length * 2;
        // Immediate hand-off: the piece's own sealed prims.
        for (const g of plan.pieces) {
          audit(g, g.origin, [...g.prims, ...g.bones].filter(p => p.op !== 'sub'));
        }
        // Rupture hand-off: the sloughed twins at the region offsets the body
        // was drawn with (what `spawnScheduledGibs` spawns by default).
        const tear = { at: [posed.prims[6]!.a[0], 1.0, posed.prims[6]!.a[2]] as Vec3, falloff: 1, age: TEAR_TUNING.sec };
        const frame = rupturePosed(posed, plan, tear, TEAR_TUNING);
        for (let pi = 0; pi < plan.pieces.length; pi++) {
          const moved = displaceGibPieces(
            retargetGibPieces([plan.pieces[pi]!], frame.deformedPrims, frame.deformedBones),
            [frame.offsets[pi]!], [frame.quats[pi]!], [frame.angVels[pi]!],
          )[0]!;
          audit(moved, moved.origin, [...moved.prims, ...moved.bones].filter(p => p.op !== 'sub'));
        }
      }
      // Two gait phases × (immediate + rupture) × every piece.
      expect(checked).toBe(expected);
      // The pre-fix producer measured 4-5 m; bound the fixed one tightly enough
      // that a relapse cannot pass.
      expect(worstOutside).toBeLessThan(0.15);
      expect(worstLocalRatio).toBeLessThan(2.5);
      expect(worstEdgeRatio).toBeLessThan(12);
      pool.dispose();
    }
  });

  it('a low-budget plan keeps every emitted piece eligible and in bounds', async () => {
    const lib = await library('zombie');
    const pool = new GibAssetInstancePool(lib);
    const { posed } = walkedPose(zombieSrc, 90);
    const tight = gibTierPlan(posed, 6, { bones: 'all', mode: 'parts', at: [0, 1, 0] });
    expect(tight.plan.pieces.length).toBeGreaterThan(0);
    for (const g of tight.plan.pieces) {
      const asset = lib.byPart.get(g.part)!;
      expect(gibAssetMeshEligible(asset.doc, g, true)).toBeNull();
      const inst = pool.acquire(g.part);
      pool.deformRows(inst, gibAssetRowsFromPrims([...g.prims, ...g.bones]), g.origin);
      const b = checkGibAssetDeformBounds(asset.doc, asset.decoded, inst.positions, g.origin, [...g.prims, ...g.bones].filter(p => p.op !== 'sub'));
      expect(gibAssetDeformBoundsOk(b), g.part).toBe(true);
      pool.release(inst);
    }
    pool.dispose();
  });

  it('the display gate rejects a deliberately out-of-bounds instance and releases it once', async () => {
    const lib = await library('zombie');
    const pool = new GibAssetInstancePool(lib);
    const asset = lib.byPart.get('armR.upper')!;
    const { posed } = walkedPose(zombieSrc, 90);
    const g = gibPlan(posed, { bones: 'all', organs: true }).pieces.find(p => p.part === 'armR.upper')!;
    const additive = [...g.prims, ...g.bones].filter(p => p.op !== 'sub');
    const inst = pool.acquire('armR.upper');
    // Every vertex 5 m above the pivot: finite, but nowhere near the runtime
    // additive union. The pre-fix pole was exactly this shape of failure.
    inst.positions.fill(0);
    for (let i = 1; i < inst.positions.length; i += 3) inst.positions[i] = 5;
    const bounds = checkGibAssetDeformBounds(asset.doc, asset.decoded, inst.positions, g.origin, additive);
    expect(bounds.finite).toBe(true);
    expect(bounds.maxOutside).toBeGreaterThan(1);
    expect(gibAssetDeformBoundsOk(bounds)).toBe(false);
    // The gate's rejection path returns the pooled buffers exactly once.
    pool.release(inst);
    expect(pool.liveCount()).toBe(0);
    expect(pool.pooledCount()).toBe(1);
    pool.dispose();
  });
});
