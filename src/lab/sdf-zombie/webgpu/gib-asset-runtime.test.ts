// src/lab/sdf-zombie/webgpu/gib-asset-runtime.test.ts
//
// offline-gib-assets task 2. These pin the runtime contract the plan names:
//
//   * the committed assets load, decode and validate once per archetype;
//   * missing / stale / malformed payloads fall back with a typed reason;
//   * eligibility is explicit (a changed source set is ineligible);
//   * a rigid motion of the source prims deforms the mesh exactly;
//   * two simultaneous instances do NOT mutate the shared asset;
//   * the instance pool reuses buffers across release/acquire.
import { describe, expect, it } from 'vitest';
// @ts-expect-error — node:fs is available in the vitest node environment
import { readFileSync } from 'node:fs';
// @ts-expect-error — node:path is available in the vitest node environment
import { resolve } from 'node:path';
// The vitest node environment provides `process`; the DOM lib types do not.
declare const process: { cwd(): string };
import * as THREE from 'three/webgpu';
import zombieSrc from '../characters/zombie.blob?raw';
import soldierSrc from '../characters/soldier.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { DEFAULT_FACE, type FaceParams } from '../face';
import { gibParts, gibPlan, type GibPiece } from '../gib-parts';
import { createBakedChunkMaterial } from './baked-chunks';
import { deformGibAssetPiece, gibAssetPosedRows, gibAssetRowsFromPrims } from './gib-asset-deform';
import {
  loadGibAssetSet, resetGibAssetCache,
  type GibAssetFetch, type GibAssetFetchResponse,
} from './gib-asset-loader';
import {
  buildGibAssetLibrary, GibAssetInstancePool, GibAssetRuntime,
  gibAssetEligible, type GibAssetLibraryPiece,
} from './gib-asset-runtime';
import { sdPrimitive } from '../validate';
import type { Primitive } from '../types';
import type { Vec3 } from '../types';

const GIB_DIR = resolve(process.cwd(), 'public/assets/lab/gibs');

/** A `fetch` over the committed files, so the loader runs against the REAL
 *  assets in node without a server. */
function diskFetch(overrides: Record<string, () => GibAssetFetchResponse | Promise<GibAssetFetchResponse>> = {}): GibAssetFetch {
  return async (url: string): Promise<GibAssetFetchResponse> => {
    const rel = url.replace(/^assets\/lab\/gibs\//, '');
    const hit = overrides[rel];
    if (hit) return hit();
    try {
      const buf = readFileSync(resolve(GIB_DIR, rel));
      return {
        ok: true, status: 200,
        json: async () => JSON.parse(buf.toString('utf8')),
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    } catch {
      return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    }
  };
}

function zombieBody() {
  const doc = parseBlob(zombieSrc);
  // The face must be MERGED with DEFAULT_FACE exactly as the generator does,
  // or the body's prim order/geometry differs and the bind indices miss.
  const face: FaceParams = { ...DEFAULT_FACE, ...compileFace(doc) };
  return buildBody(compileBlob(doc, face), DEFAULT_BUILD_OPTS);
}

function soldierBody() {
  const doc = parseBlob(soldierSrc);
  const face: FaceParams = { ...DEFAULT_FACE, ...compileFace(doc) };
  return buildBody(compileBlob(doc, face), DEFAULT_BUILD_OPTS);
}

function dummyMaterial() {
  return createBakedChunkMaterial({ goreDetail: true, bakedAo: true, fleshResponse: true }).material;
}

/** A fake fetch that serves a manifest but mutates one archetype in a specific
 *  way — the malformed/stale arms. */
function tamperedFetch(mutate: (files: Map<string, Uint8Array>) => void): GibAssetFetch {
  const files = new Map<string, Uint8Array>();
  for (const name of ['manifest.json', 'zombie.gib.json', 'zombie.gib.bin']) {
    files.set(name, readFileSync(resolve(GIB_DIR, name)) as Uint8Array);
  }
  mutate(files);
  return async (url: string): Promise<GibAssetFetchResponse> => {
    const rel = url.replace(/^assets\/lab\/gibs\//, '');
    const bytes = files.get(rel);
    if (!bytes) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true, status: 200,
      json: async () => JSON.parse(new TextDecoder().decode(bytes)),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  };
}

describe('gib-asset-loader — committed assets', () => {
  it('loads and validates every piece of both archetypes', async () => {
    resetGibAssetCache();
    for (const archetype of ['zombie', 'soldier'] as const) {
      const set = await loadGibAssetSet(archetype, { fetchImpl: diskFetch() });
      expect(set.archetype).toBe(archetype);
      expect(set.pieces.length).toBeGreaterThan(0);
      expect(set.byPart.size).toBe(set.pieces.length);
      expect(set.bytes.bin).toBeGreaterThan(0);
      for (const p of set.pieces) {
        expect(p.doc.verts).toBeGreaterThan(0);
        expect(p.decoded.positions.length).toBe(p.doc.verts * 3);
      }
      // The skeleton is in the set (Task 1's whole point).
      expect(set.pieces.some(p => p.doc.material === 'bone')).toBe(true);
    }
  });

  it('reports a missing manifest as no-manifest', async () => {
    resetGibAssetCache();
    await expect(loadGibAssetSet('zombie', { fetchImpl: diskFetch({ 'manifest.json': () => ({ ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }) }) }))
      .rejects.toMatchObject({ reason: 'no-manifest' });
  });

  it('reports an archetype absent from the manifest as no-entry', async () => {
    resetGibAssetCache();
    const fetch = tamperedFetch(files => {
      const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as { assets: { archetype: string }[] };
      manifest.assets = manifest.assets.filter(a => a.archetype !== 'zombie');
      files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
    });
    await expect(loadGibAssetSet('zombie', { fetchImpl: fetch })).rejects.toMatchObject({ reason: 'no-entry' });
  });

  it('flags a fingerprint mismatch as stale', async () => {
    resetGibAssetCache();
    const fetch = tamperedFetch(files => {
      const doc = JSON.parse(new TextDecoder().decode(files.get('zombie.gib.json'))) as { fingerprint: string };
      doc.fingerprint = '0000000000000000';
      files.set('zombie.gib.json', new TextEncoder().encode(JSON.stringify(doc)));
    });
    await expect(loadGibAssetSet('zombie', { fetchImpl: fetch })).rejects.toMatchObject({ reason: 'stale' });
  });

  it('flags a truncated bin as stale and a NaN position as malformed', async () => {
    resetGibAssetCache();
    const truncated = tamperedFetch(files => {
      files.set('zombie.gib.bin', files.get('zombie.gib.bin')!.subarray(0, 64));
    });
    await expect(loadGibAssetSet('zombie', { fetchImpl: truncated })).rejects.toMatchObject({ reason: 'stale' });

    resetGibAssetCache();
    const nan = tamperedFetch(files => {
      const bin = Uint8Array.from(files.get('zombie.gib.bin')!);
      new DataView(bin.buffer).setFloat32(0, NaN, true);
      files.set('zombie.gib.bin', bin);
    });
    await expect(loadGibAssetSet('zombie', { fetchImpl: nan })).rejects.toMatchObject({ reason: 'malformed' });
  });
});

describe('gib-asset deform', () => {
  async function loadedPiece(part = 'torso.chest') {
    const set = await loadGibAssetSet('zombie', { fetchImpl: diskFetch() });
    return set.byPart.get(part)!;
  }

  it('rest frames reproduce the asset local geometry exactly', async () => {
    const piece = await loadedPiece();
    // Row-aligned rest frames: at the rest pose the deformed mesh IS the asset.
    const rows = gibAssetRowsFromPrims(piece.doc.bind.prims);
    const out = { positions: new Float32Array(piece.doc.verts * 3), normals: new Float32Array(piece.doc.verts * 3) };
    // Pivot at the piece origin => local positions are the decoded ones.
    deformGibAssetPiece(piece.doc, piece.decoded, rows, piece.doc.offset, out, false);
    for (let i = 0; i < piece.decoded.positions.length; i++) {
      expect(out.positions[i]).toBeCloseTo(piece.decoded.positions[i]!, 4);
    }
  });

  it('a rigid translation of every source prim leaves the local geometry alone', async () => {
    const piece = await loadedPiece();
    const t: Vec3 = [0.021, -0.014, 0.008];
    const shifted = piece.doc.bind.prims.map(p => ({
      a: [p.a[0] + t[0], p.a[1] + t[1], p.a[2] + t[2]] as Vec3,
      b: [p.b[0] + t[0], p.b[1] + t[1], p.b[2] + t[2]] as Vec3,
      radius: p.radius, radiusB: p.radiusB, scale: [p.scale[0], p.scale[1], p.scale[2]] as Vec3,
    }));
    const rows = gibAssetRowsFromPrims(shifted);
    const out = { positions: new Float32Array(piece.doc.verts * 3), normals: new Float32Array(piece.doc.verts * 3) };
    const pivot: Vec3 = [piece.doc.offset[0] + t[0], piece.doc.offset[1] + t[1], piece.doc.offset[2] + t[2]];
    deformGibAssetPiece(piece.doc, piece.decoded, rows, pivot, out, false);
    // The pivot moved with the body too, so the LOCAL geometry is unchanged.
    for (let i = 0; i < piece.decoded.positions.length; i++) {
      expect(out.positions[i]).toBeCloseTo(piece.decoded.positions[i]!, 4);
    }
  });

  it('the source-indexed path (rupture) follows the posed body prims', async () => {
    const piece = await loadedPiece();
    const body = zombieBody();
    const rows = gibAssetPosedRows(piece.doc, body.prims, body.bonePrims ?? []);
    const out = { positions: new Float32Array(piece.doc.verts * 3), normals: new Float32Array(piece.doc.verts * 3) };
    deformGibAssetPiece(piece.doc, piece.decoded, rows, piece.doc.offset, out, true);
    // Every output vertex is finite, normals are unit, and the surface moved
    // (the planner seals cut prims, so the posed body is not identical to the
    // sealed rest frame — the point is that it FOLLOWS the body, not the old pose).
    let moved = false;
    for (let i = 0; i < out.positions.length; i++) {
      expect(Number.isFinite(out.positions[i])).toBe(true);
      if (Math.abs(out.positions[i]! - piece.decoded.positions[i]!) > 1e-4) moved = true;
    }
    expect(moved).toBe(true);
    for (let i = 0; i < out.normals.length; i += 3) {
      const l = Math.hypot(out.normals[i]!, out.normals[i + 1]!, out.normals[i + 2]!);
      expect(l).toBeCloseTo(1, 3);
    }
  });

  it('two simultaneous instances do not mutate the shared asset or each other', async () => {
    const piece = await loadedPiece();
    const body = zombieBody();
    const lib = buildGibAssetLibrary(
      await loadGibAssetSet('zombie', { fetchImpl: diskFetch() }), dummyMaterial(),
    );
    const pool = new GibAssetInstancePool(lib);
    const a = pool.acquire(piece.doc.part);
    const b = pool.acquire(piece.doc.part);
    const rows = gibAssetPosedRows(piece.doc, body.prims, body.bonePrims ?? []);
    const base = Float32Array.from(piece.decoded.positions);
    pool.deform(a, body.prims, body.bonePrims ?? [], piece.doc.offset);
    const bPivot: Vec3 = [piece.doc.offset[0] + 0.05, piece.doc.offset[1], piece.doc.offset[2]];
    pool.deform(b, body.prims, body.bonePrims ?? [], bPivot);
    // The shared decoded array is untouched.
    expect([...piece.decoded.positions]).toEqual([...base]);
    // a is at the rest pivot, b is 5 cm over.
    const ai = 0, bi = 0;
    expect(a.positions[ai]! - b.positions[bi]!).toBeCloseTo(0.05, 4);
    // The rest geometry's own attribute still points at the untouched array.
    expect((lib.byPart.get(piece.doc.part)!.rest.getAttribute('position').array as Float32Array)[0])
      .toBeCloseTo(base[0]!, 6);
    // rows unused beyond the call; keep TS honest.
    expect(rows.length).toBe(piece.doc.bind.prims.length);
  });
});

describe('gib-asset runtime eligibility + pool', () => {
  it('accepts a clean piece and rejects a changed source set', async () => {
    const set = await loadGibAssetSet('zombie', { fetchImpl: diskFetch() });
    const body = zombieBody();
    const clean = gibParts(body, { bones: 'all', organs: true }).find(p => p.part === 'torso.chest')!;
    const doc = set.byPart.get('torso.chest')!.doc;
    expect(gibAssetEligible(doc, clean)).toBeNull();
    const damaged: GibPiece = { ...clean, srcPrims: clean.srcPrims ? [...clean.srcPrims, 999] : [0] };
    expect(gibAssetEligible(doc, damaged)).toBe('source-mismatch');
    expect(gibAssetEligible(doc, { ...clean, part: 'legL.upper' })).toBe('source-mismatch');
  });

  it('runtime loads once, counts bytes, and falls back with a typed reason', async () => {
    resetGibAssetCache();
    const runtime = new GibAssetRuntime({
      fetchImpl: diskFetch(), materialFactory: { create: dummyMaterial },
    });
    expect(runtime.archetypeState('zombie')).toBe('idle');
    expect(await runtime.ensure('zombie')).toBe(true);
    expect(runtime.archetypeState('zombie')).toBe('ready');
    // Second call joins the ready library, not a second fetch.
    expect(await runtime.ensure('zombie')).toBe(true);
    const lib = runtime.library('zombie')!;
    expect(lib.pieces.length).toBeGreaterThan(0);
    const c = runtime.countersSnapshot();
    expect(c.loadBytes).toBeGreaterThan(0);
    expect(c.runtimeExtractionJobs).toBe(0);
    runtime.dispose();

    resetGibAssetCache();
    const failing = new GibAssetRuntime({
      fetchImpl: diskFetch({ 'manifest.json': () => ({ ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }) }),
      materialFactory: { create: dummyMaterial },
    });
    expect(await failing.ensure('zombie')).toBe(false);
    expect(failing.archetypeState('zombie')).toBe('failed');
    expect(failing.failureReason('zombie')).toBe('no-manifest');
    expect(failing.countersSnapshot().fallbacks['no-manifest']).toBe(1);
    failing.dispose();
  });

  it('the pool reuses geometries across release/acquire', async () => {
    resetGibAssetCache();
    const set = await loadGibAssetSet('zombie', { fetchImpl: diskFetch() });
    const lib = buildGibAssetLibrary(set, dummyMaterial());
    const pool = new GibAssetInstancePool(lib);
    const first = pool.acquire('torso.chest');
    pool.release(first);
    const second = pool.acquire('torso.chest');
    expect(second.geometry).toBe(first.geometry);
    expect(pool.createdCount()).toBe(1);
    expect(pool.liveCount()).toBe(1);
    expect(pool.pooledCount()).toBe(0);
    pool.dispose();
  });
});

describe('gib-asset library geometry', () => {
  it('builds shared rest geometry with the detail-material channels', async () => {
    resetGibAssetCache();
    const set = await loadGibAssetSet('zombie', { fetchImpl: diskFetch() });
    const lib = buildGibAssetLibrary(set, dummyMaterial());
    const piece = lib.byPart.get('bone.cage')!;
    for (const attr of ['position', 'normal', 'bakeColor', 'bakeResponse', 'bakeFresnel', 'bakeAnchor', 'bakeAo', 'goreKind']) {
      expect(piece.rest.getAttribute(attr), attr).toBeTruthy();
    }
    // `goreKind` carries the bone branch (1), synthesised from `material`.
    expect((piece.rest.getAttribute('goreKind').array as Float32Array)[0]).toBe(1);
    expect(piece.rest.boundingSphere).toBeTruthy();
    expect(piece.rest.boundingBox).toBeTruthy();
    lib.dispose();
  });
});

describe('gib-asset runtime head materials', () => {
  it('reports, releases and disposes per-instance head materials', () => {
    const disposed: number[] = [];
    let id = 0;
    const runtime = new GibAssetRuntime({
      materialFactory: { create: dummyMaterial },
      headMaterialFactory: {
        create: () => {
          const my = id++;
          return { material: { my }, setFrame: () => {}, dispose: () => disposed.push(my) };
        },
      },
    });
    expect(runtime.countersSnapshot().headFaceAvailable).toBe(true);
    const local = { centre: [0, 0, 0] as Vec3, quat: [0, 0, 0, 1] as [number, number, number, number], axes: [1, 1, 1] as Vec3 };
    const a = runtime.acquireHead('head', local);
    const b = runtime.acquireHead('head', local);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    // TWO distinct materials — the no-shared-uniforms contract at the runtime.
    expect(a!.material).not.toBe(b!.material);
    expect(runtime.countersSnapshot().headMaterials).toEqual({ live: 2, created: 2, disposed: 0 });
    a!.release();
    expect(runtime.countersSnapshot().headMaterials).toEqual({ live: 1, created: 2, disposed: 1 });
    // A reset disposes whatever a live piece still holds, exactly once.
    runtime.dispose();
    expect(disposed.sort((x, y) => x - y)).toEqual([0, 1]);
    expect(runtime.countersSnapshot().headMaterials).toEqual({ live: 0, created: 2, disposed: 2 });
  });

  it('keeps the marched head fallback when no head factory is wired', () => {
    const runtime = new GibAssetRuntime({ materialFactory: { create: dummyMaterial } });
    expect(runtime.countersSnapshot().headFaceAvailable).toBe(false);
    expect(runtime.acquireHead('head', {
      centre: [0, 0, 0], quat: [0, 0, 0, 1], axes: [1, 1, 1],
    })).toBeNull();
    runtime.dispose();
  });
});

// THE TASK-3 BLOCKER-1 REGRESSION (2026-09-16). The committed sets were baked
// with `torn: []`, so `bakeColor.a` — the wound/wet mask the mesh shader turns
// into blood-slick cut faces — was 0 on 100% of vertices; every cut face read
// as dry outer skin. The regeneration derives the mask from the ACTUAL planner
// cut caps, so the classification here is independent of the bake: a vertex is
// "at a cut" when it sits on a cap sphere's own iso (`sdPrimitive(cap) ~= 0`),
// and "outer skin" when it is well clear of every cap. The caps come from a
// fresh `gibPlan` (schema 3 removed them from the BIND TABLE — they are not
// deform targets — but the planner still emits them); the coordinates are the
// same rest body frame as `decoded.positions + doc.offset`.
describe('gib-asset cut mask — committed sets', () => {
  it('has a wet cut face and a dry outer skin (bakeColor.a is not empty)', async () => {
    resetGibAssetCache();
    let total = 0, nonzero = 0, maxWm = 0;
    let cut = 0, cutWet = 0, skin = 0, skinDry = 0;
    let cappedPieces = 0;
    for (const archetype of ['zombie', 'soldier'] as const) {
      const set = await loadGibAssetSet(archetype, { fetchImpl: diskFetch() });
      const body = archetype === 'zombie' ? zombieBody() : soldierBody();
      const plan = gibPlan(body, { bones: 'all', organs: true });
      for (const { doc, decoded } of set.pieces) {
        const caps: Primitive[] = (plan.pieces.find(p => p.part === doc.part)?.prims ?? []).filter(p => p.op === 'sub');
        if (caps.length === 0) continue;
        cappedPieces++;
        for (let i = 0; i < doc.verts; i++) {
          const p: Vec3 = [
            decoded.positions[i * 3]! + doc.offset[0],
            decoded.positions[i * 3 + 1]! + doc.offset[1],
            decoded.positions[i * 3 + 2]! + doc.offset[2],
          ];
          let capDist = Infinity;
          for (const c of caps) capDist = Math.min(capDist, Math.abs(sdPrimitive(p, c)));
          const wm = decoded.bakeColor[i * 4 + 3]!;
          total++;
          if (wm > 0.02) nonzero++;
          if (wm > maxWm) maxWm = wm;
          if (capDist < 0.002) { cut++; if (wm > 0.5) cutWet++; }
          else if (capDist > 0.03) { skin++; if (wm < 0.3) skinDry++; }
        }
      }
    }
    // Both archetypes carry capped pieces, and the mask is actually populated.
    expect(cappedPieces).toBeGreaterThanOrEqual(20);
    expect(total).toBeGreaterThan(40000);
    expect(nonzero / total).toBeGreaterThan(0.5);
    // THE BLOCKER: max was 0.0 before the regeneration.
    expect(maxWm).toBeGreaterThan(0.9);
    // Every vertex on a cut cap is fully wet; the outer skin stays dry.
    expect(cut).toBeGreaterThan(2000);
    expect(cutWet / cut).toBeGreaterThan(0.95);
    expect(skin).toBeGreaterThan(20000);
    expect(skinDry / skin).toBeGreaterThan(0.8);
  });
});
