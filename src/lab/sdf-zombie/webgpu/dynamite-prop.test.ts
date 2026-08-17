// src/lab/sdf-zombie/webgpu/dynamite-prop.test.ts
//
// X1.27 task D1. The derived GLB wrapper: integrity-first loading (hash
// BEFORE parse — GLTFLoader.loadAsync is forbidden precisely because it
// hides the bytes), the FuseTip/FlightPivot anchor contract, the hand /
// flight / gone pose semantics with release-orientation continuity, and
// idempotent unique-resource disposal.
//
// The GLB fixtures are hand-packed HERE (magic + JSON chunk + BIN chunk) so
// the tests exercise the real GLTFLoader parse path without touching disk
// assets or image decoding. The REAL checked-in bundle is additionally
// provenance-checked from disk by raw header/JSON-chunk parsing.

import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
// @ts-expect-error — node:crypto available in vitest via happy-dom/node
import { createHash } from 'node:crypto';
import * as THREE from 'three/webgpu';
import { loadDynamiteProp } from './dynamite-prop';
import type { DynamitePropContract } from './hand-volume-clip';

// ——— tiny GLB packing ————————————————————————————————————————————————————

/** Packs a glTF 2.0 JSON (+ optional BIN chunk) into a real GLB container. */
function glbBuffer(json: object, bin?: Uint8Array): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binBytes = bin ?? new Uint8Array(0);
  const binPad = (4 - (binBytes.length % 4)) % 4;
  const hasBin = binBytes.length > 0;
  const total = 12 + 8 + jsonBytes.length + jsonPad
    + (hasBin ? 8 + binBytes.length + binPad : 0);
  const out = new DataView(new ArrayBuffer(total));
  out.setUint32(0, 0x46546c67, true); // 'glTF'
  out.setUint32(4, 2, true);
  out.setUint32(8, total, true);
  let o = 12;
  out.setUint32(o, jsonBytes.length + jsonPad, true);
  out.setUint32(o + 4, 0x4e4f534a, true); // 'JSON'
  new Uint8Array(out.buffer, o + 8).set(jsonBytes);
  for (let i = 0; i < jsonPad; i++) {
    out.setUint8(o + 8 + jsonBytes.length + i, 0x20); // space padding
  }
  o += 8 + jsonBytes.length + jsonPad;
  if (hasBin) {
    out.setUint32(o, binBytes.length + binPad, true);
    out.setUint32(o + 4, 0x004e4942, true); // 'BIN\0'
    new Uint8Array(out.buffer, o + 8).set(binBytes);
    // zero padding: ArrayBuffer starts zeroed
  }
  return out.buffer;
}

/** One triangle's float32 positions — the only geometry the fixture needs. */
function triangleBytes(): Uint8Array {
  return new Uint8Array(new Float32Array([
    -0.03, -0.05, 0, 0.03, -0.05, 0, 0, 0.16, 0,
  ]).buffer.slice(0));
}

/** A minimal but real glTF: FlightPivot root + FuseTip/GripAnchor anchors,
 *  TWO meshes that share one accessor-backed geometry spec and ONE material
 *  (GLTFLoader material-caches by index, so the traversal sees the same
 *  material instance twice — the disposal uniqueness case). */
function propJson(nodes: object[]): object {
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes,
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
      { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
    ],
    materials: [{ name: 'Paper' }],
    accessors: [{
      componentType: 5126, count: 3, type: 'VEC3',
      min: [-0.03, -0.05, 0], max: [0.03, 0.16, 0],
      bufferView: 0, byteOffset: 0,
    }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
    buffers: [{ byteLength: 36 }], // embedded (no uri) — self-contained
  };
}

const ANCHOR_NODES = [
  { name: 'FlightPivot', children: [1, 2, 3, 4] },
  { name: 'FuseTip', translation: [0, 0.16, 0] },
  { name: 'GripAnchor', translation: [0, -0.015, 0] },
  { name: 'StickA', mesh: 0 },
  { name: 'StickB', mesh: 1 },
];

/** Valid node lists for each anchor-omission case (indices rebuilt). */
function nodesWithout(name: 'FuseTip' | 'FlightPivot'): object[] {
  if (name === 'FuseTip') {
    return [
      { name: 'FlightPivot', children: [1, 2, 3] },
      { name: 'GripAnchor', translation: [0, -0.015, 0] },
      { name: 'StickA', mesh: 0 },
      { name: 'StickB', mesh: 1 },
    ];
  }
  return [
    { name: 'FuseTip', translation: [0, 0.16, 0] },
    { name: 'GripAnchor', translation: [0, -0.015, 0] },
    { name: 'StickA', mesh: 0 },
    { name: 'StickB', mesh: 1 },
  ];
}

/** The valid fixture GLB bytes (both anchor nodes present). */
function validGlb(): ArrayBuffer {
  return glbBuffer(propJson(ANCHOR_NODES), triangleBytes());
}

const sha256 = (bytes: ArrayBuffer): string =>
  createHash('sha256').update(new Uint8Array(bytes)).digest('hex');

/** A contract matching `bytes`' hash and the fixture's node layout. */
function contract(bytes: ArrayBuffer): DynamitePropContract {
  return {
    url: 'tiny-dynamite.glb',
    sha256: sha256(bytes),
    gripLocal: [0.015, 0.097, 0.055],
    axisLocal: [1, 0, 0],
    modelGripOffsetM: -0.015,
    modelRotationLocal: [0, 0, 0, 1],
    contactRadiusM: 0.037,
    contactBelowM: 0.115,
    contactAboveM: 0.135,
    fuseTipNode: 'FuseTip',
    flightPivotNode: 'FlightPivot',
  };
}

const MANIFEST_URL = 'http://localhost/assets/lab/hand-sdf-dynamite-grip-r.json';

/** Serves exactly one GLB payload; records every fetched URL. */
function serve(bytes: ArrayBuffer): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string | URL) => {
    const href = String(url);
    calls.push(href);
    return new Response(bytes.slice(0));
  });
  return calls;
}

const S = Math.SQRT1_2;
/** (w, x, y, z) tuples for the pose tests. */
const Q_Z90: [number, number, number, number] = [S, 0, 0, S];

function quat(p: [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(p[1], p[2], p[3], p[0]); // (w,x,y,z) → THREE
}

describe('loadDynamiteProp — integrity and anchors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the GLB at contract.url resolved RELATIVE to the manifest URL', async () => {
    const bytes = validGlb();
    const calls = serve(bytes);
    const prop = await loadDynamiteProp(MANIFEST_URL, contract(bytes));
    expect(calls).toEqual(['http://localhost/assets/lab/tiny-dynamite.glb']);
    expect(prop.object.name).toBe('FlightPivot');
    prop.dispose();
  });

  it('rejects a non-ok fetch', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }));
    await expect(loadDynamiteProp(MANIFEST_URL, contract(validGlb())))
      .rejects.toThrow(/HTTP 404/);
  });

  it('rejects a sha-256 mismatch BEFORE parse — garbage bytes with a wrong hash report the hash, not a parse failure', async () => {
    const garbage = new Uint8Array(64).map((_, i) => (i * 37 + 11) & 0xff);
    const bad = contract(validGlb()); // hash of the VALID glb, served garbage
    const calls = serve(garbage.buffer.slice(0));
    await expect(loadDynamiteProp(MANIFEST_URL, bad)).rejects.toThrow(/sha-256/i);
    expect(calls.length).toBe(1); // the GLB fetch only
  });

  it('rejects bytes whose own hash matches but which are not a GLB', async () => {
    const garbage = new Uint8Array(64).map((_, i) => (i * 37 + 11) & 0xff);
    const c = contract(garbage.buffer.slice(0)); // hash OF the garbage
    serve(garbage.buffer.slice(0));
    await expect(loadDynamiteProp(MANIFEST_URL, c)).rejects.toThrow();
  });

  it('rejects a GLB missing the FuseTip anchor', async () => {
    const bytes = glbBuffer(propJson(nodesWithout('FuseTip')), triangleBytes());
    serve(bytes);
    await expect(loadDynamiteProp(MANIFEST_URL, contract(bytes)))
      .rejects.toThrow(/FuseTip/);
  });

  it('rejects a GLB missing the FlightPivot anchor', async () => {
    const bytes = glbBuffer(propJson(nodesWithout('FlightPivot')), triangleBytes());
    serve(bytes);
    await expect(loadDynamiteProp(MANIFEST_URL, contract(bytes)))
      .rejects.toThrow(/FlightPivot/);
  });
});

describe('DynamiteProp — pose semantics', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function load(bytes = validGlb()) {
    serve(bytes);
    return loadDynamiteProp(MANIFEST_URL, contract(bytes));
  }

  it('hand pose copies the root position and quaternion EXACTLY ((w,x,y,z) order)', async () => {
    const prop = await load();
    prop.pose({ mode: 'hand', position: [1, 2, 3], quaternion: [0.5, 0.5, 0.5, 0.5], cooking: true });
    expect(prop.object.visible).toBe(true);
    expect(prop.object.position.x).toBe(1);
    expect(prop.object.position.y).toBe(2);
    expect(prop.object.position.z).toBe(3);
    // exact component copy, deliberately NOT normalized
    expect(prop.object.quaternion.w).toBe(0.5);
    expect(prop.object.quaternion.x).toBe(0.5);
    expect(prop.object.quaternion.y).toBe(0.5);
    expect(prop.object.quaternion.z).toBe(0.5);
    prop.dispose();
  });

  it('gone hides the prop without touching the transform', async () => {
    const prop = await load();
    prop.pose({ mode: 'hand', position: [1, 2, 3], quaternion: Q_Z90, cooking: false });
    prop.pose({ mode: 'gone' });
    expect(prop.object.visible).toBe(false);
    expect(prop.object.position.x).toBe(1); // last transform retained
    prop.dispose();
  });

  it('the first flight pose preserves releaseQuaternion exactly (no spin yet)', async () => {
    const prop = await load();
    prop.pose({ mode: 'flight', position: [0.1, 0.2, 0.3], spin: 5, fuseBurning: true, releaseQuaternion: Q_Z90 });
    const q = prop.object.quaternion;
    expect(q.w).toBe(Q_Z90[0]);
    expect(q.x).toBe(Q_Z90[1]);
    expect(q.y).toBe(Q_Z90[2]);
    expect(q.z).toBe(Q_Z90[3]);
    prop.dispose();
  });

  it('later flight spin composes AFTER the stored release quaternion, from the same base', async () => {
    const prop = await load();
    prop.pose({ mode: 'flight', position: [0, 0, 0], spin: 0, fuseBurning: true, releaseQuaternion: Q_Z90 });
    const spin = 1.23;
    prop.pose({ mode: 'flight', position: [0, 0, 0], spin, fuseBurning: true });
    const spinQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(spin * 0.4, 0, spin));
    const expected = quat(Q_Z90).multiply(spinQ);
    expect(prop.object.quaternion.w).toBeCloseTo(expected.w, 9);
    expect(prop.object.quaternion.x).toBeCloseTo(expected.x, 9);
    expect(prop.object.quaternion.y).toBeCloseTo(expected.y, 9);
    expect(prop.object.quaternion.z).toBeCloseTo(expected.z, 9);
    // a second spin frame composes from the SAME release base (no compounding)
    prop.pose({ mode: 'flight', position: [0, 0, 0], spin: spin + 0.5, fuseBurning: true });
    const spinQ2 = new THREE.Quaternion().setFromEuler(new THREE.Euler((spin + 0.5) * 0.4, 0, spin + 0.5));
    const expected2 = quat(Q_Z90).multiply(spinQ2);
    expect(prop.object.quaternion.angleTo(expected2)).toBeLessThan(1e-9);
    prop.dispose();
  });

  it('flight with no prior release tumbles on pure spin (primitive parity)', async () => {
    const prop = await load();
    prop.pose({ mode: 'flight', position: [0, 0, 0], spin: 2, fuseBurning: true });
    const spinQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(2 * 0.4, 0, 2));
    expect(prop.object.quaternion.angleTo(spinQ)).toBeLessThan(1e-12);
    prop.dispose();
  });

  it('a fresh hand pose clears the release base', async () => {
    const prop = await load();
    prop.pose({ mode: 'flight', position: [0, 0, 0], spin: 0, fuseBurning: true, releaseQuaternion: Q_Z90 });
    prop.pose({ mode: 'hand', position: [0, 0, 0], quaternion: [1, 0, 0, 0], cooking: false });
    prop.pose({ mode: 'flight', position: [0, 0, 0], spin: 2, fuseBurning: true });
    const spinQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(2 * 0.4, 0, 2));
    expect(prop.object.quaternion.angleTo(spinQ)).toBeLessThan(1e-12);
    prop.dispose();
  });

  it('exposes a spark sphere parented to the FuseTip anchor', async () => {
    const prop = await load();
    const fuseTip = prop.object.getObjectByName('FuseTip');
    expect(fuseTip).not.toBeNull();
    const spark = fuseTip!.children.find(c => (c as THREE.Mesh).isMesh);
    expect(spark).toBeDefined();
    expect((spark as THREE.Mesh).material).toBeInstanceOf(THREE.MeshBasicMaterial);
    prop.dispose();
  });
});

describe('DynamiteProp — disposal', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('disposes every UNIQUE geometry/material/texture exactly once and is idempotent', async () => {
    const bytes = validGlb();
    serve(bytes);
    const prop = await loadDynamiteProp(MANIFEST_URL, contract(bytes));

    // Collect the loaded resources through the public object.
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const meshMats = new Map<string, THREE.Material>();
    prop.object.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true) return;
      if (m.name) meshMats.set(m.name, (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material);
      if (m.geometry) geometries.add(m.geometry);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) if (mat) materials.add(mat as THREE.Material);
    });
    // Two named meshes share glTF material 0 → the SAME material instance
    // (GLTFLoader caches by index); traversal still reaches it twice.
    expect(meshMats.has('StickA')).toBe(true);
    expect(meshMats.has('StickB')).toBe(true);
    expect(meshMats.get('StickA')).toBe(meshMats.get('StickB'));
    // sticks' shared paper material + the wrapper's spark material
    expect(materials.size).toBe(2);

    // Attach a texture through a material slot — the wrapper must reach it.
    const texture = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
    const mat = meshMats.get('StickA') as THREE.MeshStandardMaterial;
    mat.map = texture;

    const spies = [
      ...[...geometries].map(g => vi.spyOn(g, 'dispose')),
      ...[...materials].map(m => vi.spyOn(m, 'dispose')),
      vi.spyOn(texture, 'dispose'),
    ];
    prop.dispose();
    prop.dispose(); // idempotent
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('the REAL checked-in derived GLB (provenance)', () => {
  const REAL_GLB = 'public/assets/lab/dynamite-bundle-grip.glb';
  const PROP_JSON = 'public/assets/lab/dynamite-bundle-grip.json';
  const CLIP_JSON = 'public/assets/lab/hand-sdf-dynamite-grip-r.json';

  it('hashes to exactly the contract and clip-manifest sha-256', () => {
    const bytes = readFileSync(REAL_GLB);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const propContract = JSON.parse(readFileSync(PROP_JSON, 'utf8'));
    const clip = JSON.parse(readFileSync(CLIP_JSON, 'utf8'));
    expect(digest).toBe(propContract.sha256);
    expect(digest).toBe(clip.prop.sha256);
  });

  it('declares the anchor nodes and is self-contained (embedded buffer, no external uri)', () => {
    const bytes = new Uint8Array(readFileSync(REAL_GLB));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const jsonLen = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
    const names = new Set<string>(json.nodes.map((n: { name?: string }) => n.name));
    expect(names.has('FlightPivot')).toBe(true);
    expect(names.has('FuseTip')).toBe(true);
    expect(names.has('GripAnchor')).toBe(true);
    for (const b of json.buffers) expect(b.uri).toBeUndefined();
    expect(json.scenes[json.scene ?? 0].nodes).toEqual([json.nodes.findIndex((n: { name?: string }) => n.name === 'FlightPivot')]);
  });
});
