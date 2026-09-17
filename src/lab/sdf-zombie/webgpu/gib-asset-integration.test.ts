// src/lab/sdf-zombie/webgpu/gib-asset-integration.test.ts
//
// offline-gib-assets task 2, the CPU end-to-end checks the plan names that are
// NOT just schema/loader mechanics:
//
//   * pose + SLOUGH deformation and the release frame/pivot bookkeeping (the
//     mesh's world position must sit on the drawn slough, not the rest pose);
//   * movement / settle / recycle through the sprite-piece lifecycle (the same
//     `stepChunk` + `onDetach` pool return the game uses);
//   * the head piece keeps its face frame;
//   * supported vs damaged eligibility and the low-budget split policy.
//
// NO GPU, NO RENDERER: this proves the arithmetic and the lifecycle, not the
// pixels. Pixel acceptance is Task 3's gate.
import { describe, expect, it } from 'vitest';
// @ts-expect-error — node:fs is available in the vitest node environment
import { readFileSync } from 'node:fs';
// @ts-expect-error — node:path is available in the vitest node environment
import { resolve } from 'node:path';
declare const process: { cwd(): string };
import * as THREE from 'three/webgpu';
import zombieSrc from '../characters/zombie.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { DEFAULT_FACE, type FaceParams } from '../face';
import {
  displaceGibPieces, gibPlan, gibTierPlan, retargetGibPieces,
  type GibPiece, type GibPlan,
} from '../gib-parts';
import { rupturePosed, TEAR_TUNING } from '../gib-tear';
import { chunkSettled, makeChunk, stepChunk } from '../gib-chunks';
import { createBakedChunkMaterial } from './baked-chunks';
import { gibAssetPosedRows, gibAssetRowsFromPrims } from './gib-asset-deform';
import { loadGibAssetSet, resetGibAssetCache } from './gib-asset-loader';
import { buildGibAssetLibrary, GibAssetInstancePool, gibAssetEligible, gibAssetMeshEligible } from './gib-asset-runtime';
import {
  applyMeshPose, clearSpritePieces, makeSpritePieceSet, spawnSpritePiece, stepSpritePieces,
} from './gib-sprite-pieces';
import type { Vec3 } from '../types';

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

function zombieBody() {
  const doc = parseBlob(zombieSrc);
  const face: FaceParams = { ...DEFAULT_FACE, ...compileFace(doc) };
  return buildBody(compileBlob(doc, face), DEFAULT_BUILD_OPTS);
}

async function loaded() {
  resetGibAssetCache();
  const set = await loadGibAssetSet('zombie', { fetchImpl });
  return buildGibAssetLibrary(set, createBakedChunkMaterial({
    goreDetail: true, bakedAo: true, fleshResponse: true,
  }).material);
}

describe('offline asset release continuity (CPU frame bookkeeping)', () => {
  it('places the deformed mesh on the drawn slough, not at the rest pose', async () => {
    const lib = await loaded();
    const body = zombieBody();
    const plan: GibPlan = gibPlan(body, { bones: 'all', organs: true });
    const piece = plan.pieces.find(p => p.part === 'torso.chest')!;
    const pi = plan.pieces.indexOf(piece);
    const asset = lib.byPart.get(piece.part)!;
    const pool = new GibAssetInstancePool(lib);

    // (1) POSE TRACKING IS EXACT on the immediate-gib path: the piece's own
    // SEALED prims are the row-aligned posed frames (`gibAssetRowsFromPrims`),
    // so a rigid translation of the piece must translate the placed mesh by the
    // same vector — no rest-pose snap.
    const t: Vec3 = [0.07, -0.03, 0.11];
    const shift = <T extends { a: Vec3; b: Vec3 }>(ps: readonly T[]): T[] => ps.map(q => ({
      ...q,
      a: [q.a[0] + t[0], q.a[1] + t[1], q.a[2] + t[2]] as Vec3,
      b: [q.b[0] + t[0], q.b[1] + t[1], q.b[2] + t[2]] as Vec3,
    }));
    const rowsPose = gibAssetRowsFromPrims([...shift(piece.prims), ...shift(piece.bones)]);
    const pivotPose: Vec3 = [piece.origin[0] + t[0], piece.origin[1] + t[1], piece.origin[2] + t[2]];
    const instPose = pool.acquire(piece.part);
    pool.deformRows(instPose, rowsPose, pivotPose);
    for (let i = 0; i < asset.doc.verts; i++) {
      for (let k = 0; k < 3; k++) {
        const world = pivotPose[k]! + instPose.positions[i * 3 + k]!;
        const expected = asset.decoded.positions[i * 3 + k]! + asset.doc.offset[k]! + t[k]!;
        expect(world).toBeCloseTo(expected, 4);
      }
    }
    pool.release(instPose);

    // (2) THE RUPTURE SLOUGH MOVES THE MESH off its rest placement, with every
    // vertex finite, using the SHIPPED frame source: the runtime piece's own
    // row-aligned prims (`retargetGibPieces` output + the region offset) with
    // `moved.origin` as the pivot. This is what `spawnAssetGibPiece` does.
    const tear = { at: [0.35, 1.05, 0.1] as Vec3, falloff: 1, age: TEAR_TUNING.sec };
    const frame = rupturePosed(body, plan, tear, TEAR_TUNING);
    const moved = displaceGibPieces(
      retargetGibPieces([piece], frame.deformedPrims, frame.deformedBones),
      [frame.offsets[pi]!], [frame.quats[pi]!], [frame.angVels[pi]!],
    )[0]!;
    expect(gibAssetEligible(asset.doc, moved)).toBeNull();
    const rows = gibAssetRowsFromPrims([...moved.prims, ...moved.bones]);
    const inst = pool.acquire(piece.part);
    pool.deformRows(inst, rows, moved.origin);
    const state = makeChunk(
      moved.limb as never, moved.origin as Vec3, [0, 0, 0], 0.1,
      [0, 1, 0] as Vec3, () => 0.5, 'limb',
      { quat: moved.spinQuat, angVel: moved.spinAngVel },
    );
    const target = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    applyMeshPose(target, state);
    let maxShift = 0;
    for (let i = 0; i < asset.doc.verts; i++) {
      const v = new THREE.Vector3(inst.positions[i * 3]!, inst.positions[i * 3 + 1]!, inst.positions[i * 3 + 2]!)
        .applyQuaternion(target.quaternion).add(target.position);
      expect(Number.isFinite(v.x)).toBe(true);
      const restWorld = asset.decoded.positions[i * 3]! + asset.doc.offset[0];
      maxShift = Math.max(maxShift, Math.abs(v.x - restWorld));
    }
    expect(maxShift).toBeGreaterThan(0.01);
    pool.dispose();
  });

  // THE TASK-3 REGRESSION (measured on the page, now pinned on the CPU). The
  // asset's bind table stores a REST frame for the unsourced `sub` CUT CAPS. The
  // old rupture path mapped those rows through `frame.deformedPrims` by source
  // index — which has no entry for a cap — so `deformBoundVertex` fell back to
  // the rest frame, and the vertex was placed at (rest body point − the RUNTIME
  // plan's clean origin). The runtime plan is built on the POSED body, so that
  // origin differs from the REST origin the asset was baked with; every cap
  // vertex inherited that whole offset, which rotated into long spike triangles
  // off each piece (page-observed, then fixed). The shipped path deforms against
  // the runtime piece's own row-aligned prims (caps included) about
  // `moved.origin`, which cancels the pose/origin difference.
  it('deforms cut-cap rows against the runtime frames, with no rest-origin spike', async () => {
    const lib = await loaded();
    const rest = zombieBody();
    const asset = lib.byPart.get('torso.chest')!;
    const pool = new GibAssetInstancePool(lib);
    const maxLocal = (p: Float32Array): number => {
      let m = 0;
      for (let i = 0; i < p.length; i += 3) m = Math.max(m, Math.hypot(p[i]!, p[i + 1]!, p[i + 2]!));
      return m;
    };
    const t: Vec3 = [0.4, 0.05, -0.25];
    const shift = <T extends { a: Vec3; b: Vec3 }>(q: T): T => ({
      ...q, a: [q.a[0] + t[0], q.a[1] + t[1], q.a[2] + t[2]] as Vec3,
      b: [q.b[0] + t[0], q.b[1] + t[1], q.b[2] + t[2]] as Vec3,
    });
    // A rigidly POSED body (a translation is enough: it moves the runtime plan's
    // clean origins away from the rest origins the asset was baked at).
    const posed = {
      ...rest,
      prims: rest.prims.map(shift),
      bonePrims: (rest.bonePrims ?? []).map(shift),
      clusters: rest.clusters.map(c => ({ ...c, center: [c.center[0] + t[0], c.center[1] + t[1], c.center[2] + t[2]] as Vec3 })),
    };
    const planPosed = gibPlan(posed, { bones: 'all', organs: true });
    const piecePosed = planPosed.pieces.find(p => p.part === 'torso.chest')!;
    const pi = planPosed.pieces.indexOf(piecePosed);
    const tear = { at: [0.35 + t[0], 1.05 + t[1], 0.1 + t[2]] as Vec3, falloff: 1, age: TEAR_TUNING.sec };
    const frame = rupturePosed(posed, planPosed, tear, TEAR_TUNING);
    const moved = displaceGibPieces(
      retargetGibPieces([piecePosed], frame.deformedPrims, frame.deformedBones),
      [frame.offsets[pi]!], [frame.quats[pi]!], [frame.angVels[pi]!],
    )[0]!;
    expect(gibAssetEligible(asset.doc, moved)).toBeNull();

    const restMax = maxLocal(asset.decoded.positions);
    const newInst = pool.acquire('torso.chest');
    pool.deformRows(newInst, gibAssetRowsFromPrims([...moved.prims, ...moved.bones]), moved.origin);
    const newMax = maxLocal(newInst.positions);

    // The OLD path, reproduced exactly as it shipped: source-indexed rows from
    // the whole-body slough + the runtime plan's CLEAN origin.
    const oldInst = pool.acquire('torso.chest');
    pool.deformRows(oldInst, gibAssetPosedRows(asset.doc, frame.deformedPrims, frame.deformedBones), piecePosed.origin);
    const oldMax = maxLocal(oldInst.positions);

    expect(newMax).toBeLessThan(restMax * 1.6 + 0.1);
    expect(oldMax).toBeGreaterThan(newMax + 0.2);
    pool.dispose();
  });
});

describe('offline asset physics / recycle', () => {
  it('steps, settles and returns its pooled geometry when the piece is dropped', async () => {
    const lib = await loaded();
    const pool = new GibAssetInstancePool(lib);
    const part = 'torso.chest';
    const inst = pool.acquire(part);
    const state = makeChunk('torso' as never, [0, 1.2, 0] as Vec3, [2, 3, 1] as Vec3, 0.12, [0, 1, 0] as Vec3, () => 0.5);
    expect(pool.liveCount()).toBe(1);

    // The SAME stepper the game uses, until it settles.
    let s = state;
    for (let i = 0; i < 1500 && !chunkSettled(s); i++) s = stepChunk(s, 1 / 60);
    expect(chunkSettled(s)).toBe(true);

    // Recycle: a sprite piece carrying this instance, evicted over a cap,
    // fires `onDetach` — where the game returns the geometry to the pool.
    const set = makeSpritePieceSet();
    const sprite = spawnSpritePiece(set, {
      state, render: 'mesh', geometry: inst.geometry, material: lib.material,
    });
    let released = 0;
    sprite.onDetach = () => { pool.release(inst); released++; };
    spawnSpritePiece(set, { state, render: 'mesh', geometry: pool.acquire(part).geometry, material: lib.material });
    stepSpritePieces(set, { dt: 1 / 60, cameraQuat: new THREE.Quaternion(), liveCap: 1, restCap: 0 });
    expect(released).toBe(1);
    expect(pool.pooledCount()).toBe(1);
    expect(pool.liveCount()).toBe(1);
    clearSpritePieces(set);
    pool.dispose();
  });
});

describe('offline asset eligibility and split policy', () => {
  it('keeps the head face frame and its own geometry', async () => {
    const lib = await loaded();
    const head = lib.byPart.get('head')!;
    expect(head).toBeTruthy();
    expect(head.face).toBeTruthy();
    expect(head.doc.verts).toBeGreaterThan(0);
    // The face texture is an EXTERNAL reference: the asset carries where it
    // projects, never pixels. The frame is in the rest body frame.
    expect([...head.face!.axes].every(Number.isFinite)).toBe(true);
  });

  it('carries the head on the mesh path when a per-instance face is available', async () => {
    const lib = await loaded();
    const body = zombieBody();
    const plan = gibPlan(body, { bones: 'all', organs: true });
    const head = plan.pieces.find(p => p.part === 'head')!;
    const doc = lib.byPart.get('head')!.doc;
    // Source sets MATCH, so the plain eligibility check is happy...
    expect(gibAssetEligible(doc, head)).toBeNull();
    // ...but WITHOUT a face source the mesh path still refuses it, so the head
    // falls through to the marched piece rather than drawing as bare flesh.
    expect(gibAssetMeshEligible(doc, head)).toBe('head-face');
    // WITH a per-instance face material the head is an ordinary eligible mesh
    // (task 4): the face rides the chunk's own transform.
    expect(gibAssetMeshEligible(doc, head, true)).toBeNull();
    // A DAMAGED/severed head is still ineligible even with a face, so no
    // custom/damaged head silently loses its damage.
    const damaged = { ...head, srcPrims: head.srcPrims ? head.srcPrims.slice(0, 1) : [0] };
    expect(gibAssetMeshEligible(doc, damaged, true)).toBe('source-mismatch');
    // A non-face piece is unaffected by the face flag.
    const chest = plan.pieces.find(p => p.part === 'torso.chest')!;
    expect(gibAssetMeshEligible(lib.byPart.get('torso.chest')!.doc, chest, true)).toBeNull();
  });

  it('a low-budget plan selects a subset of pieces that all stay eligible', async () => {
    const lib = await loaded();
    const body = zombieBody();
    const full = gibTierPlan(body, 64, { bones: 'all', mode: 'parts', at: [0, 1, 0] });
    const tight = gibTierPlan(body, 6, { bones: 'all', mode: 'parts', at: [0, 1, 0] });
    expect(tight.plan.pieces.length).toBeLessThan(full.plan.pieces.length);
    for (const g of tight.plan.pieces) {
      const asset = lib.byPart.get(g.part);
      // Every piece the low-budget tier can emit maps to an asset and is
      // eligible (the tier changes the SHAPE, not the source prims).
      expect(asset, g.part).toBeTruthy();
      expect(gibAssetEligible(asset!.doc, g as GibPiece), g.part).toBeNull();
    }
  });

  it('a damaged (severed) piece is ineligible while the intact one is eligible', async () => {
    const lib = await loaded();
    const body = zombieBody();
    const clean = gibPlan(body, { bones: 'all', organs: true }).pieces.find(p => p.part === 'torso.chest')!;
    const asset = lib.byPart.get('torso.chest')!;
    expect(gibAssetEligible(asset.doc, clean)).toBeNull();
    // Simulate a wound that removed a source prim from the piece.
    expect(clean.srcPrims!.length).toBeGreaterThan(1);
    const damaged: GibPiece = { ...clean, srcPrims: clean.srcPrims!.slice(0, 1) };
    expect(gibAssetEligible(asset.doc, damaged)).toBe('source-mismatch');
  });
});
