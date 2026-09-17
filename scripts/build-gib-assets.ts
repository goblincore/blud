#!/usr/bin/env node
// scripts/build-gib-assets.ts
//
// OFFLINE GIB ASSET GENERATOR (offline-gib-assets task 1).
//
//   npm run gib:assets                 # build every archetype that is stale
//   npm run gib:assets -- --force      # rebuild everything
//   npm run gib:assets -- --archetype zombie
//   npm run gib:assets -- --check      # validate + stale-check, write nothing
//
// WHY A SCRIPT AND NOT A BOOT-TIME BAKE. gib-library.ts builds the same pieces
// in the browser at boot. Moving that work offline removes the extraction from
// every page load (no startup mesh-generation delay), makes the result
// inspectable/diffable, and lets the build be validated in CI. The runtime
// loader is Task 2's; this script only produces and checks the files.
//
// THE `.blob` SOURCES ARE READ FROM DISK, NOT VIA VITE. `character-registry.ts`
// imports them with `?raw`, which needs a bundler; a Node script does not have
// one, so the path lives in gib-asset-archetypes.ts and is read with node:fs.
// That is also why the recipe carries the full source text (for the stale
// check), not a module hash.
//
// DETERMINISM. The `.gib.json` and `.gib.bin` contain no timestamps or timings
// (those live in manifest.json), so identical sources regenerate identical
// bytes. Run with `--check` to see whether the committed files match.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace, compilePalette } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../src/lab/sdf-zombie/build-body';
import { DEFAULT_FACE, type FaceParams } from '../src/lab/sdf-zombie/face';
import { buildGibAssetArchetype } from '../src/lab/sdf-zombie/webgpu/gib-asset-build';
import {
  GIB_ARCHETYPES, gibLookFromMaterial, gibMaterialFor, gibPaletteName, gibSurfaceFromMaterial,
  makeGibAssetRecipe, type GibArchetypeDef,
} from '../src/lab/sdf-zombie/webgpu/gib-asset-archetypes';
import {
  GIB_ASSET_DEFAULT_CELL, GIB_ASSET_KIND, GIB_ASSET_MAX_BIND_PRIMS, GIB_ASSET_SCHEMA_VERSION,
  decodeGibAssetPiece, gibAssetRecipeFingerprint, validateGibAssetManifest, validateGibAssetPiece,
  type GibAssetArchetype, type GibAssetManifest, type GibAssetManifestEntry,
} from '../src/lab/sdf-zombie/webgpu/gib-asset';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = 'scripts/build-gib-assets.ts';
const DEFAULT_OUT = 'public/assets/lab/gibs';
const CARVE_K = 0.008;
const BONE_RELEASE = 'all';
const ORGANS = true;

interface Cli {
  out: string;
  archetypes: string[];
  force: boolean;
  check: boolean;
  cell: number;
  quiet: boolean;
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = { out: DEFAULT_OUT, archetypes: [], force: false, check: false, cell: GIB_ASSET_DEFAULT_CELL, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--out') cli.out = argv[++i] ?? cli.out;
    else if (a === '--archetype') cli.archetypes.push(argv[++i] ?? '');
    else if (a === '--force') cli.force = true;
    else if (a === '--check') cli.check = true;
    else if (a === '--cell') cli.cell = Number(argv[++i]);
    else if (a === '--quiet') cli.quiet = true;
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { console.error(`unknown argument '${a}'`); usage(); process.exit(2); }
  }
  if (!Number.isFinite(cli.cell) || cli.cell <= 0) { console.error('--cell must be a positive number'); process.exit(2); }
  return cli;
}

function usage(): void {
  console.log(`usage: tsx scripts/build-gib-assets.ts [--out DIR] [--archetype NAME]... [--cell M] [--force] [--check] [--quiet]

  --out DIR        output directory (default ${DEFAULT_OUT})
  --archetype NAME only this archetype (repeatable; default all)
  --cell M         extraction cell size, metres (default ${GIB_ASSET_DEFAULT_CELL})
  --force          rebuild even when the fingerprint matches
  --check          validate committed assets + report staleness; write nothing
  --quiet          only print the summary`);
}

/** Recompute the full recipe from the CURRENT source, using the settings the
 *  manifest recorded, with CURRENT body-build defaults. This is the stale
 *  check: a changed `.blob`, palette, face or blend default changes the fingerprint. */
function recomputeRecipe(def: GibArchetypeDef, header: GibAssetArchetype['recipe']): ReturnType<typeof makeGibAssetRecipe> {
  const src = readFileSync(join(ROOT, def.blobPath), 'utf8');
  const doc = parseBlob(src);
  const face: FaceParams = { ...DEFAULT_FACE, ...compileFace(doc) };
  const palette = compilePalette(doc);
  const material = gibMaterialFor(palette);
  return makeGibAssetRecipe({
    archetype: def.name, blobPath: def.blobPath, blobSource: src, face,
    look: gibLookFromMaterial(material), surface: gibSurfaceFromMaterial(material),
    paletteName: gibPaletteName(palette),
    cellSize: header.cellSize, maxBindPrims: header.maxBindPrims, carveK: header.carveK,
    boneRelease: header.boneRelease, organs: header.organs,
    generator: header.generator, buildOpts: { ...DEFAULT_BUILD_OPTS },
  });
}

function buildOne(def: GibArchetypeDef, cli: Cli): { entry: GibAssetManifestEntry; doc: GibAssetArchetype; bin: Uint8Array } {
  const src = readFileSync(join(ROOT, def.blobPath), 'utf8');
  const doc = parseBlob(src);
  const face: FaceParams = { ...DEFAULT_FACE, ...compileFace(doc) };
  const palette = compilePalette(doc);
  const material = gibMaterialFor(palette);
  const look = gibLookFromMaterial(material);
  const surface = gibSurfaceFromMaterial(material);
  const recipe = makeGibAssetRecipe({
    archetype: def.name, blobPath: def.blobPath, blobSource: src, face, look, surface,
    paletteName: gibPaletteName(palette),
    cellSize: cli.cell, maxBindPrims: GIB_ASSET_MAX_BIND_PRIMS, carveK: CARVE_K,
    boneRelease: BONE_RELEASE, organs: ORGANS,
    generator: GENERATOR, buildOpts: { ...DEFAULT_BUILD_OPTS },
  });
  const t0 = performance.now();
  const body = buildBody(compileBlob(doc, face), DEFAULT_BUILD_OPTS);
  const built = buildGibAssetArchetype({
    archetype: def.name, body, look, surface, recipe,
    bones: BONE_RELEASE, organs: ORGANS, cellSize: cli.cell, maxBindPrims: GIB_ASSET_MAX_BIND_PRIMS, carveK: CARVE_K,
  });
  const buildMs = Math.round(performance.now() - t0);
  const json = JSON.stringify(built.archetype, null, 2) + '\n';
  const jsonBytes = Buffer.byteLength(json, 'utf8');
  const entry: GibAssetManifestEntry = {
    archetype: def.name,
    fingerprint: built.archetype.fingerprint,
    recipe: built.archetype.recipe,
    json: built.archetype.offsets.json,
    bin: built.archetype.offsets.bin,
    bytes: { json: jsonBytes, bin: built.bin.byteLength },
    totals: { ...built.archetype.totals, binBytes: built.bin.byteLength },
    timing: { bakeMs: built.bakeMs, buildMs },
    source: { ...built.archetype.source },
  };
  return { entry, doc: built.archetype, bin: built.bin };
}

function loadManifest(outDir: string): GibAssetManifest | null {
  const file = join(outDir, 'manifest.json');
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')) as GibAssetManifest; }
  catch { return null; }
}

function checkAssets(defs: GibArchetypeDef[], outDir: string, quiet: boolean): number {
  const manifest = loadManifest(outDir);
  if (!manifest) { console.error(`[gib-assets] no manifest at ${join(outDir, 'manifest.json')} — run the generator`); return 1; }
  const shape = validateGibAssetManifest(manifest);
  let problems = shape.errors.length;
  for (const e of shape.errors) console.error(`[gib-assets] manifest: ${e}`);

  for (const def of defs) {
    const entry = manifest.assets.find(a => a.archetype === def.name);
    if (!entry) { console.error(`[gib-assets] ${def.name}: missing from manifest`); problems++; continue; }
    const jsonPath = join(outDir, entry.json);
    const binPath = join(outDir, entry.bin);
    if (!existsSync(jsonPath) || !existsSync(binPath)) { console.error(`[gib-assets] ${def.name}: missing file(s)`); problems++; continue; }
    const bin = new Uint8Array(readFileSync(binPath));
    let doc: GibAssetArchetype;
    try { doc = JSON.parse(readFileSync(jsonPath, 'utf8')) as GibAssetArchetype; }
    catch (err) { console.error(`[gib-assets] ${def.name}: unreadable json: ${String(err)}`); problems++; continue; }

    if (doc.fingerprint !== entry.fingerprint) { console.error(`[gib-assets] ${def.name}: doc/manifest fingerprint disagree`); problems++; }
    if (bin.byteLength !== entry.bytes.bin) { console.error(`[gib-assets] ${def.name}: bin size ${bin.byteLength} ≠ manifest ${entry.bytes.bin}`); problems++; }
    for (const piece of doc.pieces) {
      const decoded = decodeGibAssetPiece(piece, bin);
      const v = validateGibAssetPiece(piece, decoded, bin.byteLength);
      if (!v.ok) { for (const err of v.errors) console.error(`[gib-assets] ${err}`); problems += v.errors.length; }
    }
    const current = recomputeRecipe(def, entry.recipe);
    const currentFp = gibAssetRecipeFingerprint(current);
    const stale = currentFp !== entry.fingerprint;
    if (stale) {
      console.error(`[gib-assets] ${def.name}: STALE (source/settings changed) — run: npm run gib:assets -- --force --archetype ${def.name}`);
      problems++;
    } else if (!quiet) {
      console.log(`[gib-assets] ${def.name}: ok (${doc.totals.pieces} pieces, ${doc.totals.verts} verts, ${doc.totals.tris} tris, ${entry.bytes.bin} bin bytes)`);
    }
  }
  if (problems > 0) { console.error(`[gib-assets] ${problems} problem(s)`); return 1; }
  if (!quiet) console.log('[gib-assets] all assets valid and current');
  return 0;
}

function main(): void {
  const cli = parseArgs(process.argv.slice(2));
  const all = GIB_ARCHETYPES;
  const selected = cli.archetypes.length > 0 ? all.filter(d => cli.archetypes.includes(d.name)) : all;
  if (selected.length === 0) { console.error(`no such archetype; known: ${all.map(d => d.name).join(', ')}`); process.exit(2); }
  const outDir = resolve(ROOT, cli.out);

  if (cli.check) process.exit(checkAssets(selected, outDir, cli.quiet));

  mkdirSync(outDir, { recursive: true });
  const existing = loadManifest(outDir);
  const entries = new Map<string, GibAssetManifestEntry>();
  for (const e of existing?.assets ?? []) entries.set(e.archetype, e);

  let built = 0, skipped = 0;
  for (const def of selected) {
    const prior = entries.get(def.name);
    const jsonPath = join(outDir, prior?.json ?? `${def.name}.gib.json`);
    const binPath = join(outDir, prior?.bin ?? `${def.name}.gib.bin`);
    if (!cli.force && prior && existsSync(jsonPath) && existsSync(binPath)) {
      let current: string | null = null;
      try { current = gibAssetRecipeFingerprint(recomputeRecipe(def, prior.recipe)); } catch { current = null; }
      if (current === prior.fingerprint) {
        skipped++;
        if (!cli.quiet) console.log(`[gib-assets] ${def.name}: current — skipped`);
        continue;
      }
    }
    const { entry, doc, bin } = buildOne(def, cli);
    writeFileSync(join(outDir, entry.json), JSON.stringify(doc, null, 2) + '\n');
    writeFileSync(join(outDir, entry.bin), bin);
    // Re-measure the on-disk json now that it is serialised identically.
    entry.bytes.json = Buffer.byteLength(readFileSync(join(outDir, entry.json)));
    entries.set(def.name, entry);
    built++;
    if (!cli.quiet) {
      console.log(`[gib-assets] ${def.name}: ${entry.totals.pieces} pieces, ${entry.totals.verts} verts, `
        + `${entry.totals.tris} tris, ${entry.bytes.bin} bin bytes (bake ${entry.timing.bakeMs} ms, build ${entry.timing.buildMs} ms)`);
    }
  }

  const manifest: GibAssetManifest = {
    kind: GIB_ASSET_KIND,
    schemaVersion: GIB_ASSET_SCHEMA_VERSION,
    generator: GENERATOR,
    builtAt: existing?.builtAt ?? new Date().toISOString(),
    assets: [...entries.values()].sort((a, b) => a.archetype.localeCompare(b.archetype)),
  };
  // Do not rewrite the manifest on a no-op run: keeping it byte-stable is what
  // lets `--check`/CI prove the committed set is current without leaving a
  // `builtAt`-only diff behind.
  if (built > 0 || !existing) writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (!cli.quiet) {
    console.log(`[gib-assets] built ${built}, skipped ${skipped}; manifest at ${join(cli.out, 'manifest.json')}`);
  }
}

main();
