// src/lab/sdf-zombie/webgpu/gib-asset.test.ts
//
// offline-gib-assets task 1. These pin the four claims that make the offline
// set usable rather than merely written:
//
//   1. The schema round-trips (encode → decode preserves every channel) and
//      REJECTS corrupt payloads (non-finite positions, out-of-range indices,
//      bad bind rows, section offsets past the end of the buffy).
//   2. The recipe fingerprint covers the FULL source text — an equal-length
//      edit must change it, and the committed files must match the tracked
//      `.blob` (the stale-asset check).
//   3. Generation is deterministic: the same source regenerates identical
//      bytes, so "current" is decidable.
//   4. The binding is real: a rigid motion applied to the source prims is
//      reproduced exactly by the per-vertex weights, and the committed sets
//      contain the skeleton (bone pieces are not silently dropped).
import { describe, expect, it } from 'vitest';
// @ts-expect-error — node:fs is available in the vitest node environment
import { existsSync, readFileSync } from 'node:fs';
// @ts-expect-error — node:path is available in the vitest node environment
import { join, resolve } from 'node:path';
// The vitest node environment provides `process`; the DOM lib types do not, and
// this repo deliberately ships no @types/node.
declare const process: { cwd(): string };
import zombieSrc from '../characters/zombie.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette } from '../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { DEFAULT_FACE, type FaceParams } from '../face';
import { gibParts } from '../gib-parts';
import {
  decodeGibAssetPiece, deformBoundVertex, encodeGibAssetBin, gibAssetRecipeFingerprint,
  validateGibAssetManifest, validateGibAssetPiece,
  type GibAssetArchetype, type GibAssetManifest, type GibAssetRecipe,
} from './gib-asset';
import { buildGibAssetArchetype } from './gib-asset-build';
import {
  gibLookFromMaterial, gibMaterialFor, gibPaletteName, gibSurfaceFromMaterial, makeGibAssetRecipe,
} from './gib-asset-archetypes';

const GIB_DIR = resolve(process.cwd(), 'public/assets/lab/gibs');
const CELL = 0.03; // coarse on purpose: these tests are about the contract, not the pixels

function zombieBody() {
  const doc = parseBlob(zombieSrc);
  const face: FaceParams = { ...DEFAULT_FACE, ...compileFace(doc) };
  return { doc, face, body: buildBody(compileBlob(doc, face), DEFAULT_BUILD_OPTS) };
}

function buildZombie(cell = CELL) {
  const { doc, face, body } = zombieBody();
  const palette = compilePalette(doc);
  const material = gibMaterialFor(palette);
  const recipe = makeGibAssetRecipe({
    archetype: 'zombie', blobPath: 'src/lab/sdf-zombie/characters/zombie.blob',
    blobSource: zombieSrc, face,
    look: gibLookFromMaterial(material), surface: gibSurfaceFromMaterial(material),
    paletteName: gibPaletteName(palette),
    cellSize: cell, maxBindPrims: 4, carveK: 0.008,
    boneRelease: 'core', organs: true,
    generator: 'test', buildOpts: { ...DEFAULT_BUILD_OPTS },
  });
  return buildGibAssetArchetype({
    archetype: 'zombie', body,
    look: gibLookFromMaterial(material), surface: gibSurfaceFromMaterial(material),
    recipe, bones: 'core', organs: true, cellSize: cell, maxBindPrims: 4, carveK: 0.008,
  });
}

describe('gib-asset schema', () => {
  it('round-trips every channel through the binary encoder', () => {
    const positions = new Float32Array([1, 2, 3, 4, 5, 6]);
    const normals = new Float32Array([0, 1, 0, 0, 0, 1]);
    const indices = new Uint16Array([0, 1, 0]);
    const colors = new Float32Array([0.1, 0.2, 0.3, 0.9, 0.4, 0.5, 0.6, 0.1]);
    const responses = new Float32Array(8).fill(0.25);
    const fresnels = new Float32Array([0.18, 0.18]);
    const anchors = new Float32Array(8).fill(0.06);
    const aos = new Float32Array([0.9, 0.8]);
    const bindIndex = new Uint16Array([0, 1, 0, 0, 1, 0, 0, 0]);
    const bindWeight = new Uint8Array([128, 127, 0, 0, 64, 191, 0, 0]);
    const { sections, bin } = encodeGibAssetBin([[
      { name: 'positions', data: positions }, { name: 'normals', data: normals },
      { name: 'indices', data: indices }, { name: 'bakeColor', data: colors },
      { name: 'bakeResponse', data: responses }, { name: 'bakeFresnel', data: fresnels },
      { name: 'bakeAnchor', data: anchors }, { name: 'bakeAo', data: aos },
      { name: 'bindIndex', data: bindIndex }, { name: 'bindWeight', data: bindWeight },
    ]]);
    const piece = {
      part: 't', limb: 'torso', kind: 'limb' as const, material: 'flesh' as const,
      offset: [0, 0, 0] as const, origin: [0, 0, 0] as const, radius: 0.1, longAxis: [0, 1, 0] as const,
      verts: 2, tris: 1,
      bounds: { min: [0, 0, 0] as const, max: [1, 1, 1] as const, center: [0.5, 0.5, 0.5] as const, sphereRadius: 1 },
      sections: sections[0]!, bind: { maxPrims: 4, prims: [] },
      cuts: [], approximation: { vertexFieldErrorMax: 0, vertexFieldErrorMean: 0, deformedFieldErrorMax: 0, deformedFieldErrorMean: 0, seams: [] },
      srcPrims: [], srcBones: [],
    };
    const decoded = decodeGibAssetPiece(piece, bin);
    expect([...decoded.positions]).toEqual([...positions]);
    expect([...decoded.normals]).toEqual([...normals]);
    expect([...decoded.indices]).toEqual([...indices]);
    expect([...decoded.bakeColor]).toEqual([...colors]);
    expect([...decoded.bakeResponse]).toEqual([...responses]);
    expect([...decoded.bakeFresnel]).toEqual([...fresnels]);
    expect([...decoded.bakeAnchor]).toEqual([...anchors]);
    expect([...decoded.bakeAo]).toEqual([...aos]);
    expect([...decoded.bindIndex]).toEqual([...bindIndex]);
    expect([...decoded.bindWeight]).toEqual([...bindWeight]);
  });

  it('is byte-deterministic for identical input', () => {
    const mk = () => encodeGibAssetBin([[{ name: 'positions', data: new Float32Array([1, 2, 3]) } as const]]);
    expect([...mk().bin]).toEqual([...mk().bin]);
  });

  it('fingerprints the full source, so an EQUAL-LENGTH edit changes it', () => {
    const base: GibAssetRecipe = {
      schemaVersion: 2, generator: 'g', archetype: 'zombie', blobPath: 'p',
      blobSource: 'head 1\nbody 2\n', buildOpts: { silhouetteNoiseAmp: 0.012, stepMultiplier: 0.6 },
      face: {}, palette: 'default', look: {}, surface: {},
      boneRelease: 'all', organs: true, cellSize: 0.012, maxBindPrims: 4, carveK: 0.008, gore: 1,
      cutMask: 'planner-cut-v1',
    };
    const a = gibAssetRecipeFingerprint(base);
    // One character swapped, same byte length — a length-only key would miss it.
    const edited = { ...base, blobSource: 'head 1\nbody 3\n' };
    expect(edited.blobSource.length).toBe(base.blobSource.length);
    expect(gibAssetRecipeFingerprint(edited)).not.toBe(a);
    // The cut-mask derivation rides the fingerprint too: a set baked with the
    // old (empty) mask must be STALE, not silently served dry.
    expect(gibAssetRecipeFingerprint({ ...base, cutMask: 'planner-cut-v2' })).not.toBe(a);
    // ...and it is stable for an identical recipe.
    expect(gibAssetRecipeFingerprint({ ...base })).toBe(a);
  });
});

describe('gib-asset-build', () => {
  it('bakes the split as named pieces and includes the skeleton', () => {
    const { archetype, bin } = buildZombie();
    expect(archetype.pieces.length).toBeGreaterThan(10);
    const parts = archetype.pieces.map(p => p.part);
    expect(parts).toContain('torso.chest');
    expect(parts.some(p => p.startsWith('bone.'))).toBe(true);
    for (const p of archetype.pieces) {
      expect(p.verts).toBeGreaterThan(0);
      expect(p.tris).toBeGreaterThan(0);
      const decoded = decodeGibAssetPiece(p, bin);
      expect(validateGibAssetPiece(p, decoded, bin.byteLength).ok).toBe(true);
    }
    // The skeleton is EXTRACTED, not reported-and-skipped (gib-library's gap).
    const bone = archetype.pieces.find(p => p.part === 'bone.cage')!;
    expect(bone.material).toBe('bone');
    expect(bone.verts).toBeGreaterThan(0);
  });

  it('regenerating the same source produces identical bytes', () => {
    const a = buildZombie();
    const b = buildZombie();
    expect(a.bin.byteLength).toBe(b.bin.byteLength);
    expect(a.bin).toEqual(b.bin);
    expect(JSON.stringify(a.archetype.pieces)).toBe(JSON.stringify(b.archetype.pieces));
  });

  it('binding reproduces a rigid motion exactly and keeps u8 rows normalised', () => {
    const { archetype, bin } = buildZombie();
    for (const piece of archetype.pieces) {
      const decoded = decodeGibAssetPiece(piece, bin);
      const prims = piece.bind.prims;
      expect(prims.length).toBeGreaterThan(0);
      // A rigid translation of every prim must translate every vertex by the
      // same vector — the binding carries the piece, it does not smear it.
      const t = [0.011, -0.023, 0.007] as const;
      const posed = prims.map(p => ({
        a: [p.a[0] + t[0], p.a[1] + t[1], p.a[2] + t[2]] as [number, number, number],
        b: [p.b[0] + t[0], p.b[1] + t[1], p.b[2] + t[2]] as [number, number, number],
        radius: p.radius, radiusB: p.radiusB, scale: p.scale,
      }));
      for (let i = 0; i < piece.verts; i += 37) {
        const q = [decoded.positions[i * 3]!, decoded.positions[i * 3 + 1]!, decoded.positions[i * 3 + 2]!] as const;
        const out = deformBoundVertex(q, i, decoded.bindIndex, decoded.bindWeight, piece.bind.maxPrims, prims, posed);
        expect(out[0]).toBeCloseTo(q[0] + t[0], 5);
        expect(out[1]).toBeCloseTo(q[1] + t[1], 5);
        expect(out[2]).toBeCloseTo(q[2] + t[2], 5);
      }
    }
  });
});

describe('gib-asset validation rejects corrupt payloads', () => {
  it('catches non-finite positions, out-of-range indices and bad bind rows', () => {
    const { archetype, bin } = buildZombie();
    const piece = archetype.pieces[0]!;
    const corruptAndValidate = (mutate: (bin: Uint8Array, decoded: ReturnType<typeof decodeGibAssetPiece>) => void) => {
      const copy = new Uint8Array(bin);
      const decoded = decodeGibAssetPiece(piece, copy);
      mutate(copy, decoded);
      // Re-decode so the views reflect the mutation.
      const fresh = decodeGibAssetPiece(piece, copy);
      return validateGibAssetPiece(piece, fresh, copy.byteLength);
    };
    expect(corruptAndValidate((_, d) => { d.positions[0] = NaN; }).ok).toBe(false);
    expect(corruptAndValidate((_, d) => { d.indices[0] = piece.verts + 10; }).ok).toBe(false);
    expect(corruptAndValidate((_, d) => { d.bindIndex[0] = piece.bind.prims.length + 5; }).ok).toBe(false);
    expect(corruptAndValidate((_, d) => { d.bindWeight[0] = 0; d.bindWeight[1] = 0; d.bindWeight[2] = 0; d.bindWeight[3] = 0; }).ok).toBe(false);
  });

  it('flags a section whose offset runs past the buffer', () => {
    const { archetype, bin } = buildZombie();
    const piece = JSON.parse(JSON.stringify(archetype.pieces[0])) as typeof archetype.pieces[0];
    piece.sections[0]!.byteOffset = bin.byteLength + 4;
    const decoded = decodeGibAssetPiece(archetype.pieces[0]!, bin);
    expect(validateGibAssetPiece(piece, decoded, bin.byteLength).ok).toBe(false);
  });
});

describe('committed offline assets', () => {
  const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

  it('exist, validate, and are not stale against the tracked .blob', () => {
    const manifestPath = join(GIB_DIR, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = readJson<GibAssetManifest>(manifestPath);
    const shape = validateGibAssetManifest(manifest);
    expect(shape.errors).toEqual([]);

    for (const name of ['zombie', 'soldier'] as const) {
      const entry = manifest.assets.find(a => a.archetype === name)!;
      expect(entry).toBeTruthy();
      const doc = readJson<GibAssetArchetype>(join(GIB_DIR, entry.json));
      const bin = new Uint8Array(readFileSync(join(GIB_DIR, entry.bin)));
      expect(bin.byteLength).toBe(entry.bytes.bin);
      expect(doc.fingerprint).toBe(entry.fingerprint);

      // Recompute the recipe from the CURRENT source + the recorded settings.
      const header = doc.recipe;
      const src = name === 'zombie'
        ? zombieSrc
        : readFileSync(resolve(process.cwd(), header.blobPath), 'utf8');
      const parsed = parseBlob(src);
      const face: FaceParams = { ...DEFAULT_FACE, ...compileFace(parsed) };
      const palette = compilePalette(parsed);
      const material = gibMaterialFor(palette);
      const recipe = makeGibAssetRecipe({
        archetype: name, blobPath: header.blobPath, blobSource: src, face,
        look: gibLookFromMaterial(material), surface: gibSurfaceFromMaterial(material),
        paletteName: gibPaletteName(palette),
        cellSize: header.cellSize, maxBindPrims: header.maxBindPrims, carveK: header.carveK,
        boneRelease: header.boneRelease, organs: header.organs,
        generator: header.generator, buildOpts: header.buildOpts,
      });
      expect(gibAssetRecipeFingerprint(recipe)).toBe(entry.fingerprint);

      for (const piece of doc.pieces) {
        const decoded = decodeGibAssetPiece(piece, bin);
        const v = validateGibAssetPiece(piece, decoded, bin.byteLength);
        expect(v.errors, `${name}/${piece.part}`).toEqual([]);
      }
    }
  });

  it('the committed split matches the gib planner piece-for-piece', () => {
    const manifest = readJson<GibAssetManifest>(join(GIB_DIR, 'manifest.json'));
    const entry = manifest.assets.find(a => a.archetype === 'zombie')!;
    const doc = readJson<GibAssetArchetype>(join(GIB_DIR, entry.json));
    const planned = gibParts(zombieBody().body, { bones: 'all', organs: true }).map(p => p.part).sort();
    expect(doc.pieces.map(p => p.part).sort()).toEqual(planned);
  });
});
