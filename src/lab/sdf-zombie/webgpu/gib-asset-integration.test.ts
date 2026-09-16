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
import { buildGibAssetLibrary, GibAssetInstancePool, gibAssetEligible } from './gib-asset-runtime';
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
    // vertex finite. The exact residual against the drawn body is the Task-1
    // binding/seal approximation and is reported in the task report — this test
    // proves the deform is wired and continuous, not that it is pixel-exact.
    const tear = { at: [0.35, 1.05, 0.1] as Vec3, falloff: 1, age: TEAR_TUNING.sec };
    const frame = rupturePosed(body, plan, tear, TEAR_TUNING);
    const moved = displaceGibPieces(
      retargetGibPieces([piece], frame.deformedPrims, frame.deformedBones),
      [frame.offsets[pi]!], [frame.quats[pi]!], [frame.angVels[pi]!],
    )[0]!;
    expect(gibAssetEligible(asset.doc, moved)).toBeNull();
    const rows = gibAssetPosedRows(asset.doc, frame.deformedPrims, frame.deformedBones);
    const inst = pool.acquire(piece.part);
    // The game's pivot: the CLEAN region origin, while the chunk sits at
    // `g.origin = clean + offset`.
    pool.deformRows(inst, rows, piece.origin);
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
