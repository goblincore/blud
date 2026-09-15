// scripts/blob-mesh-compare.ts
//
// CLI for the Blobforge mesher comparison (2026-09-15 dispatch task 1).
//
//   npx tsx scripts/blob-mesh-compare.ts --help
//   npx tsx scripts/blob-mesh-compare.ts --smoke
//   npx tsx scripts/blob-mesh-compare.ts --cells 20,10,5 --repeats 3 \
//       --out .scratch/mesher-comparison --evidence docs/dev-notes/2026-09-15-mesher-comparison
//
// It runs Blud's CURRENT surface nets, a table-based marching cubes and an
// ALICE-inspired dual contouring over the same fields at the same grid, writes
// OBJ/GLB meshes, CPU-rendered panels, a results.json and a summary.md.
// Production meshers/renderers are untouched.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { platform, release, cpus } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

import { FIXTURES, GOBLIN_HEAD_REGION, type FixtureDef } from '../src/lab/sdf-zombie/mesher-comparison/fixtures';
import { gridFor, LADDERS, optionsFor, runMesher, timeMeshers, type RunId } from '../src/lab/sdf-zombie/mesher-comparison/runner';
import { analyzeMesh, buildReferenceMesh, FEATURE_REGIONS, type MethodAnalysis } from '../src/lab/sdf-zombie/mesher-comparison/analysis';
import { meshToObj, meshToGlb, readBackObj, inspectGlb } from '../src/lab/sdf-zombie/mesher-comparison/export';
import { defaultCamera, renderMesh, unionBounds } from '../src/lab/sdf-zombie/mesher-comparison/render';
import { gridCellCount, gridCornerCount, meshRankable, type IndexedMesh, type ScalarField } from '../src/lab/sdf-zombie/mesher-comparison/types';
import type { Vec3 } from '../src/lab/sdf-zombie/types';
import { sharpBoxSensitivity } from '../src/lab/sdf-zombie/mesher-comparison/sensitivity';

const ALL_RUN_IDS: readonly RunId[] = ['surface-nets', 'marching-cubes', 'dual-contouring', 'surface-nets-unpruned'];
const DEFAULT_METHODS: readonly RunId[] = ['surface-nets', 'marching-cubes', 'dual-contouring'];

/**
 * Ownership + budget guards. The output directory is task-owned scratch; we
 * only ever delete a directory that either is empty or carries our marker,
 * and we validate the grid size BEFORE any large allocation.
 */
export const RUN_MARKER = '.blob-mesh-compare-run';
export const RUN_MARKER_MAGIC = 'blob-mesh-compare run dir v1';
/** Exact-file manifest written into an owned run dir, next to the marker. */
export const RUN_MANIFEST = '.blob-mesh-compare-generated.json';
/** Exact-file manifest for the shared evidence dir (tracked in git). */
export const EVIDENCE_MANIFEST = '.blob-mesh-compare-manifest.json';
/** Generated top-level files inside an owned run dir (never human notes). */
export const RUN_TOP_LEVEL = ['results.json', 'summary.md', 'preview.html'] as const;
/** Generated top-level files the CLI may own inside a shared evidence dir. */
export const EVIDENCE_TOP_LEVEL = ['results.json', 'summary.md', 'preview.html', 'sensitivity.json', 'sensitivity.md'] as const;
/** The only subdirectories the CLI ever creates/removes, and only when empty. */
export const GENERATED_SUBDIRS = ['meshes', 'panels'] as const;
/** Generated mesh filenames (`+` appears in panel/closeup names). */
export const MESH_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.(obj|glb)$/;
/** Generated panel filenames (`+` appears e.g. in `closeup-corner-+++`). */
export const PANEL_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.png$/;
/** Conservative pre-allocation budget for one extraction grid. */
export const MAX_GRID_CELLS = 20_000_000;
export const MAX_GRID_CORNERS = 25_000_000;

interface Args {
  fixtures: string[];
  methods: RunId[];
  cells: number[];
  out: string;
  evidence: string | null;
  repeats: number;
  warmups: number;
  panelsCellMm: number;
  panelsExtraMm: number[];
  unpruned: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = {
    fixtures: FIXTURES.map(f => f.id),
    methods: [...DEFAULT_METHODS],
    cells: [...LADDERS.bounded],
    out: '.scratch/mesher-comparison',
    evidence: null,
    repeats: 3,
    warmups: 1,
    panelsCellMm: 20,
    panelsExtraMm: [],
    unpruned: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case '--help': case '-h': a.help = true; break;
      case '--fixtures': a.fixtures = next().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--methods': a.methods = next().split(',').map(s => s.trim()) as RunId[]; break;
      case '--cells': a.cells = next().split(',').map(s => Number(s) / 1000); break;
      case '--out': a.out = next(); break;
      case '--evidence': a.evidence = next(); break;
      case '--repeats': a.repeats = Number(next()); break;
      case '--warmups': a.warmups = Number(next()); break;
      case '--panels-cell': a.panelsCellMm = Number(next()); break;
      case '--panels-extra': a.panelsExtraMm = next().split(',').map(s => Number(s.trim())); break;
      case '--unpruned': a.unpruned = true; break;
      case '--smoke':
        a.cells = [...LADDERS.smoke]; a.repeats = 1; a.warmups = 0; break;
      default: throw new Error(`unknown argument ${arg}`);
    }
  }
  return a;
}

// ---------------------------------------------------------------------------
// Argument validation + path/budget safety
// ---------------------------------------------------------------------------

/** Path segments the CLI must never write into or delete through. */
const PROTECTED_SEGMENTS = new Set(['node_modules', '.git', 'src', 'public', 'assets-source']);

/** Resolve a CLI path against the repo root and refuse anything unsafe. */
export function resolveWithinRoot(rootReal: string, argPath: string, label: string): string {
  const abs = resolve(rootReal, argPath);
  const rel = relative(rootReal, abs);
  if (rel === '') throw new Error(`${label}: refusing to use the repository root (${abs})`);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${label}: must stay inside the repository; ${abs} is outside ${rootReal}`);
  }
  const first = rel.split(sep)[0]!;
  if (PROTECTED_SEGMENTS.has(first)) {
    throw new Error(`${label}: refusing to write or delete inside '${first}' (${abs})`);
  }
  // Walking the existing prefix catches a symlinked component that escapes or
  // aliases a protected tree. Deletion through a symlink must never happen.
  const rootCanon = existsSync(rootReal) ? realpathSync(rootReal) : rootReal;
  let cur = rootReal;
  for (const seg of rel.split(sep)) {
    cur = join(cur, seg);
    if (!existsSync(cur)) break;
    const st = lstatSync(cur);
    if (st.isSymbolicLink()) {
      const real = realpathSync(cur);
      const rrel = relative(rootCanon, real);
      if (rrel.startsWith('..') || isAbsolute(rrel)) throw new Error(`${label}: symlink ${cur} escapes the repository`);
      const rfirst = rrel.split(sep)[0]!;
      if (PROTECTED_SEGMENTS.has(rfirst)) {
        throw new Error(`${label}: symlink ${cur} aliases protected '${rfirst}' (${real})`);
      }
      throw new Error(`${label}: refusing to use symlinked path component ${cur} (alias of ${real})`);
    }
    if (!st.isDirectory() && cur !== abs) throw new Error(`${label}: ${cur} is not a directory`);
  }
  return abs;
}

/** Canonicalise a path against its deepest existing prefix (follows symlinks). */
export function canonicalPath(p: string): string {
  let cur = resolve(p);
  const tail: string[] = [];
  while (!existsSync(cur)) {
    tail.unshift(basename(cur));
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  const real = existsSync(cur) ? realpathSync(cur) : cur;
  return tail.length ? join(real, ...tail) : real;
}

/** Throw unless `a` and `b` are disjoint (neither contains the other) after canonicalisation. */
export function assertDisjoint(aPath: string, bPath: string, aLabel: string, bLabel: string): void {
  const a = canonicalPath(aPath);
  const b = canonicalPath(bPath);
  const ab = relative(a, b);
  const ba = relative(b, a);
  if (ab === '' || (!ab.startsWith('..') && !isAbsolute(ab))) {
    throw new Error(`${aLabel} (${a}) overlaps ${bLabel} (${b})`);
  }
  if (!ba.startsWith('..') && !isAbsolute(ba)) {
    throw new Error(`${bLabel} (${b}) overlaps ${aLabel} (${a})`);
  }
}

/** Validate a manifest entry as a safe relative path in the allowed generated structure. */
export function isGeneratedRelPath(rel: string, kind: 'run' | 'evidence'): boolean {
  if (typeof rel !== 'string' || rel.length === 0) return false;
  if (rel.includes('\\') || rel.includes('\0')) return false;
  if (rel.startsWith('/') || isAbsolute(rel)) return false;
  const segs = rel.split('/');
  if (segs.some(s => s === '' || s === '.' || s === '..')) return false;
  if (segs.length === 1) {
    const top: readonly string[] = kind === 'evidence' ? EVIDENCE_TOP_LEVEL : RUN_TOP_LEVEL;
    return top.includes(segs[0]!);
  }
  if (segs.length === 2 && segs[0] === 'meshes') return MESH_FILE_RE.test(segs[1]!);
  if (segs.length === 2 && segs[0] === 'panels') return PANEL_FILE_RE.test(segs[1]!);
  return false;
}

/** Read + validate an exact-file manifest; throws (deleting nothing) on corruption or an unsafe entry. */
export function readGeneratedManifest(dir: string, manifestName: string, kind: 'run' | 'evidence', label: string): string[] {
  const manifestPath = join(dir, manifestName);
  let parsed: { generated?: unknown };
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { generated?: unknown };
  } catch {
    throw new Error(`${label}: manifest ${manifestPath} is missing or not valid JSON; refusing to delete anything`);
  }
  const generated = parsed.generated;
  if (!Array.isArray(generated)) {
    throw new Error(`${label}: manifest ${manifestPath} has no 'generated' array; refusing to delete anything`);
  }
  const out: string[] = [];
  for (const entry of generated as unknown[]) {
    if (typeof entry !== 'string' || !isGeneratedRelPath(entry, kind)) {
      throw new Error(`${label}: manifest ${manifestPath} entry ${JSON.stringify(entry)} is not a safe generated path; refusing to delete anything`);
    }
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

/** Delete exactly these owned regular files; refuse symlinks and non-regular targets. */
function removeOwnedFiles(base: string, rels: readonly string[], label: string): void {
  for (const rel of rels) {
    const segs = rel.split('/');
    let gone = false;
    let cur = base;
    for (let i = 0; i < segs.length - 1; i++) {
      cur = join(cur, segs[i]!);
      if (!existsSync(cur)) { gone = true; break; }
      const st = lstatSync(cur);
      if (st.isSymbolicLink()) throw new Error(`${label}: owned path ${rel} crosses symlink ${cur}; refusing to delete`);
      if (!st.isDirectory()) throw new Error(`${label}: owned path ${rel} crosses non-directory ${cur}; refusing to delete`);
    }
    if (gone) continue;
    const target = join(base, rel);
    if (!existsSync(target)) continue;
    const st = lstatSync(target);
    if (st.isSymbolicLink()) throw new Error(`${label}: ${target} is a symlink; refusing to delete`);
    if (!st.isFile()) throw new Error(`${label}: ${target} is not a regular file; refusing to delete`);
    rmSync(target);
  }
}

/** Remove the CLI's meshes/panels dirs, and only when they are real and empty. */
function removeEmptyGeneratedDirs(base: string, label: string): void {
  for (const name of GENERATED_SUBDIRS) {
    const p = join(base, name);
    if (!existsSync(p)) continue;
    const st = lstatSync(p);
    if (st.isSymbolicLink()) throw new Error(`${label}: ${p} is a symlink; refusing to delete`);
    if (!st.isDirectory()) throw new Error(`${label}: ${p} is not a directory; refusing to delete`);
    if (readdirSync(p).length === 0) rmdirSync(p);
  }
}

/** Entries that are neither the ownership files nor the exact owned manifest paths. */
function auditOwnedDir(base: string, owned: ReadonlySet<string>, exempt: ReadonlySet<string>, label: string): string[] {
  const unknown: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      if (prefix === '' && exempt.has(name)) continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) throw new Error(`${label}: ${p} is a symlink; refusing to operate on it`);
      if (st.isDirectory()) {
        if (prefix === '' && (GENERATED_SUBDIRS as readonly string[]).includes(name)) walk(p, rel);
        else unknown.push(rel);
      } else if (!owned.has(rel)) {
        unknown.push(rel);
      }
    }
  };
  walk(base, '');
  return unknown;
}

/** Regular files (and symlinks, recorded as blockers) under the evidence dir. */
function collectEvidenceEntries(base: string): Set<string> {
  const files = new Set<string>();
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) { files.add(rel); continue; }
      if (st.isDirectory()) walk(p, rel);
      else files.add(rel);
    }
  };
  walk(base, '');
  return files;
}

/**
 * Prepare a task-owned run directory for reuse. An empty or nonexistent target
 * is fine. A populated target is touched only when it carries our ownership
 * marker AND an exact-file manifest; only the manifest's files are deleted and
 * only now-empty meshes/panels dirs are removed (never a recursive delete).
 * Any other populated directory is rejected untouched.
 */
export function prepareOwnedDir(abs: string, label: string): void {
  if (!existsSync(abs)) {
    mkdirSync(abs, { recursive: true });
  } else {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) throw new Error(`${label}: refusing to use symlinked directory ${abs}`);
    if (!st.isDirectory()) throw new Error(`${label}: ${abs} exists and is not a directory`);
    if (readdirSync(abs).length > 0) {
      const markerPath = join(abs, RUN_MARKER);
      if (!existsSync(markerPath)) {
        throw new Error(`${label}: ${abs} is a populated directory without the tool ownership marker (${RUN_MARKER}); refusing to delete it — use a fresh output directory`);
      }
      if (readFileSync(markerPath, 'utf8').trim() !== RUN_MARKER_MAGIC) {
        throw new Error(`${label}: ${abs} has a corrupt ownership marker; refusing to delete it — use a fresh output directory`);
      }
      if (!existsSync(join(abs, RUN_MANIFEST))) {
        throw new Error(`${label}: ${abs} carries a marker but no generated-file manifest (${RUN_MANIFEST}); refusing to delete it — use a fresh output directory`);
      }
      const owned = readGeneratedManifest(abs, RUN_MANIFEST, 'run', label);
      const unknown = auditOwnedDir(abs, new Set(owned), new Set([RUN_MARKER, RUN_MANIFEST]), label);
      if (unknown.length > 0) {
        throw new Error(`${label}: ${abs} contains entries not recorded in the run manifest (${unknown.slice(0, 5).join(', ')}); refusing to delete it`);
      }
      removeOwnedFiles(abs, owned, label);
      removeEmptyGeneratedDirs(abs, label);
    }
  }
  writeFileSync(join(abs, RUN_MARKER), RUN_MARKER_MAGIC + '\n');
}

export interface EvidenceCleanup {
  /** Exact evidence-relative paths the valid manifest claims as tool output. */
  readonly owned: ReadonlySet<string>;
  /** Paths still present after cleanup (owned files were removed). */
  readonly remaining: ReadonlySet<string>;
  readonly removed: readonly string[];
}

/**
 * Remove only files the prior evidence manifest claims as tool output, then
 * drop empty meshes/panels dirs. Human notes and unowned files survive. A
 * corrupt/unsafe manifest throws without deleting anything; with no manifest
 * nothing is deleted (a fresh evidence dir is written directly).
 */
export function cleanEvidenceDir(evidenceDir: string, label = '--evidence'): EvidenceCleanup {
  mkdirSync(evidenceDir, { recursive: true });
  const owned = new Set<string>();
  if (existsSync(join(evidenceDir, EVIDENCE_MANIFEST))) {
    for (const rel of readGeneratedManifest(evidenceDir, EVIDENCE_MANIFEST, 'evidence', label)) owned.add(rel);
  }
  const before = collectEvidenceEntries(evidenceDir);
  removeOwnedFiles(evidenceDir, owned, label);
  removeEmptyGeneratedDirs(evidenceDir, label);
  const after = collectEvidenceEntries(evidenceDir);
  const removed = [...before].filter(rel => owned.has(rel) && !after.has(rel));
  return { owned, remaining: after, removed };
}

export interface EvidenceWrite {
  readonly rel: string;
  readonly srcPath?: string;
  readonly data?: string | Uint8Array;
}

/**
 * Validate a complete evidence write plan BEFORE any evidence mutation: every
 * path must be an allowed generated path and must not collide with a file that
 * survived cleanup (i.e. an unowned or human file).
 */
export function assertEvidencePlan(plan: readonly EvidenceWrite[], cleanup: EvidenceCleanup, label = '--evidence'): void {
  const seen = new Set<string>();
  for (const w of plan) {
    if (!isGeneratedRelPath(w.rel, 'evidence')) throw new Error(`${label}: refusing to write non-generated path ${JSON.stringify(w.rel)}`);
    if (seen.has(w.rel)) throw new Error(`${label}: duplicate generated path ${w.rel}`);
    seen.add(w.rel);
    if (cleanup.remaining.has(w.rel)) {
      throw new Error(`${label}: ${w.rel} already exists and is not tool-owned; refusing to overwrite it`);
    }
    const parent = w.rel.includes('/') ? w.rel.slice(0, w.rel.lastIndexOf('/')) : '';
    if (parent && cleanup.remaining.has(parent)) {
      throw new Error(`${label}: ${parent} is not a real directory; refusing to write ${w.rel}`);
    }
  }
}

/** Validate every user-supplied name and numeric bound. Throws on the first problem. */
export function validateArgs(args: Args): void {
  const knownFixtures = FIXTURES.map(f => f.id);
  if (args.fixtures.length === 0) throw new Error(`no fixtures selected; known: ${knownFixtures.join(', ')}`);
  for (const f of args.fixtures) {
    if (!knownFixtures.includes(f)) throw new Error(`unknown fixture '${f}'; known: ${knownFixtures.join(', ')}`);
  }
  if (args.methods.length === 0) throw new Error(`no methods selected; known: ${ALL_RUN_IDS.join(', ')}`);
  for (const m of args.methods) {
    if (!ALL_RUN_IDS.includes(m)) throw new Error(`unknown method '${m}'; known: ${ALL_RUN_IDS.join(', ')}`);
  }
  if (args.cells.length === 0) throw new Error('no cell sizes selected');
  for (const c of args.cells) {
    if (!Number.isFinite(c) || c <= 0) throw new Error(`cell size must be a finite positive number of metres (got ${c})`);
  }
  if (!Number.isInteger(args.repeats) || args.repeats <= 0) throw new Error(`--repeats must be a positive integer (got ${args.repeats})`);
  if (!Number.isInteger(args.warmups) || args.warmups < 0) throw new Error(`--warmups must be a nonnegative integer (got ${args.warmups})`);
  if (!Number.isFinite(args.panelsCellMm) || args.panelsCellMm <= 0) throw new Error(`--panels-cell must be a finite positive number of mm (got ${args.panelsCellMm})`);
  for (const m of args.panelsExtraMm) {
    if (!Number.isFinite(m) || m <= 0) throw new Error(`--panels-extra entries must be finite positive mm (got ${m})`);
  }
  for (const def of FIXTURES.filter(f => args.fixtures.includes(f.id))) {
    for (const cell of args.cells) {
      if (cell < def.minCell) {
        throw new Error(`fixture ${def.id} requires cell >= ${(def.minCell * 1000).toFixed(3)} mm (got ${(cell * 1000).toFixed(3)} mm)`);
      }
    }
  }
}

/** Throw before allocating if a grid exceeds the conservative memory budget. */
export function assertGridBudget(field: ScalarField, cell: number, label: string): void {
  const g = gridFor(field, cell);
  const cells = gridCellCount(g);
  const corners = gridCornerCount(g);
  if (cells > MAX_GRID_CELLS || corners > MAX_GRID_CORNERS) {
    throw new Error(
      `${label}: ${g.dims.join('x')} cells at ${(cell * 1000).toFixed(3)} mm needs ${cells} cells / ${corners} corners, ` +
      `over the budget (${MAX_GRID_CELLS} cells / ${MAX_GRID_CORNERS} corners)`);
  }
}

/** Serialize JSON without turning NaN/Infinity into an innocuous `null`. */
export function jsonText(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    typeof v === 'number' && !Number.isFinite(v)
      ? (Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity')
      : v, 2) + '\n';
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, jsonText(value));
}

const HELP = `Blobforge mesher comparison — surface nets vs marching cubes vs dual contouring

Usage: npx tsx scripts/blob-mesh-compare.ts [options]

  --fixtures a,b   fixture ids (default: all). See fixtures.ts.
  --methods a,b    surface-nets,marching-cubes,dual-contouring,surface-nets-unpruned
  --cells 20,10,5  cell sizes in MILLIMETRES (default 20,10,5)
  --out DIR        output dir (default .scratch/mesher-comparison)
  --evidence DIR   also write the compact committed set (results.json, panels, meshes)
  --repeats N      measured repeats per method (default 3)
  --warmups N      warmup passes (default 1)
  --panels-cell N  cell size (mm) for the rendered panels (default 20)
  --panels-extra a,b  additional panel cells (mm) for sharp/concave fixtures
  --unpruned       add the labelled surface-nets-unpruned control
  --smoke          one coarse cell, one repeat (fast end-to-end check)
  -h, --help       this text

Fixtures: ${FIXTURES.map(f => f.id).join(', ')}
Outputs:  results.json, summary.md, preview.html, meshes/*.obj, meshes/*.glb, panels/*.png`;

// ---------------------------------------------------------------------------
// PNG encoding (pure, no dependencies)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mmOf = (cell: number): number => Math.round(cell * 1000);
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

function writeMeshPair(dir: string, base: string, mesh: IndexedMesh): { obj: string; glb: string; readback: ReturnType<typeof readBackObj>; glbOk: boolean } {
  const objPath = join(dir, `${base}.obj`);
  const glbPath = join(dir, `${base}.glb`);
  const objText = meshToObj(mesh, `fixture ${base} (static posed geometry, not skinned)`);
  writeFileSync(objPath, objText);
  const glb = meshToGlb(mesh);
  writeFileSync(glbPath, glb);
  const readback = readBackObj(objText);
  const inspected = inspectGlb(glb);
  return { obj: objPath, glb: glbPath, readback, glbOk: inspected.magicOk && inspected.version === 2 };
}

function buildFixture(def: FixtureDef, blobSource: string): ScalarField {
  return def.build(def.id === GOBLIN_HEAD_REGION.id ? blobSource : undefined);
}

interface PanelRecord {
  readonly fixture: string;
  readonly method: string;
  readonly cell: number;
  readonly view: string;
  readonly file: string;
  readonly tris: number;
  readonly camera: { yaw: number; pitch: number; centre: Vec3; halfSize: number; width: number; height: number };
}

function renderPanel(
  dir: string, fixture: string, method: string, cell: number, view: string, mesh: IndexedMesh,
  cam: ReturnType<typeof defaultCamera>, mode: 'shaded' | 'wireframe',
): PanelRecord {
  const img = renderMesh(mesh, cam, mode);
  const name = `${fixture}__${method}__${mmOf(cell)}mm__${view}${mode === 'wireframe' ? '-wire' : ''}.png`;
  writeFileSync(join(dir, name), encodePng(img.rgba, img.width, img.height));
  return {
    fixture, method, cell, view, file: name, tris: mesh.indices.length / 3,
    camera: { yaw: cam.yaw, pitch: cam.pitch, centre: cam.centre as Vec3, halfSize: cam.halfSize, width: cam.width, height: cam.height },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  const root = realpathSync(process.cwd());
  // Validate every name and numeric bound BEFORE touching the filesystem.
  validateArgs(args);
  const methods: RunId[] = [...args.methods];
  if (args.unpruned && !methods.includes('surface-nets-unpruned')) methods.push('surface-nets-unpruned');
  const selected = FIXTURES.filter(f => args.fixtures.includes(f.id));

  // Resolve and cross-check paths before any mutation. An absolute or `..`
  // `--out`/`--evidence` that escapes the repo, or an overlap between them,
  // fails here rather than deleting anything.
  const outDir = resolveWithinRoot(root, args.out, '--out');
  const evidenceDir = args.evidence ? resolveWithinRoot(root, args.evidence, '--evidence') : null;
  if (evidenceDir) assertDisjoint(outDir, evidenceDir, '--out', '--evidence');

  // Build the shared fields (cheap, non-destructive) and reject an
  // over-budget grid BEFORE any large allocation. The .blob source is only
  // read when the character fixture is actually selected.
  const blobSource = selected.some(d => d.id === GOBLIN_HEAD_REGION.id)
    ? readFileSync(join(root, 'src/lab/sdf-zombie/characters/goblin.blob'), 'utf8')
    : '';
  const fields = selected.map(def => ({ def, field: buildFixture(def, blobSource) }));
  const panelCell = args.panelsCellMm / 1000;
  for (const { def, field } of fields) {
    for (const cell of args.cells) {
      assertGridBudget(field, cell, `${def.id}@${mmOf(cell)}mm`);
      const refCell = Math.max(cell / 2, 0.005);
      if (refCell < cell) assertGridBudget(field, refCell, `${def.id}@${mmOf(cell)}mm reference`);
    }
    assertGridBudget(field, panelCell, `${def.id}@${args.panelsCellMm}mm panels`);
  }

  let commit = 'unknown';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* not a repo */ }
  let dirty = '';
  try { dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* not a repo */ }
  const fingerprint = codeFingerprint(root);

  // ---- mutations begin only after all validation passed ------------------
  prepareOwnedDir(outDir, '--out');
  const meshDir = join(outDir, 'meshes');
  const panelDir = join(outDir, 'panels');
  mkdirSync(meshDir, { recursive: true });
  mkdirSync(panelDir, { recursive: true });
  const evidenceCleanup = evidenceDir ? cleanEvidenceDir(evidenceDir) : null;

  const runFiles = new Set<string>();
  const evidencePlan: EvidenceWrite[] = [];
  const invalidRuns: string[] = [];
  const results: unknown[] = [];
  const exports: unknown[] = [];
  const panels: PanelRecord[] = [];

  console.log(`mesher comparison: ${selected.length} fixtures x ${args.cells.map(mmOf).join('/')}mm x ${methods.join(', ')}`);
  for (const { def, field } of fields) {
    for (const cell of args.cells) {
      const timing = timeMeshers(field, cell, methods, args.warmups, args.repeats);
      // Only build the (expensive) reference surface when at least one method
      // produced a rankable mesh; invalid rows never get compared.
      const ref = methods.some(id => meshRankable(timing[id]!.mesh)) ? buildReferenceMesh(field, cell) : null;
      const analyses: MethodAnalysis[] = [];
      const built: Partial<Record<string, IndexedMesh>> = {};
      for (const id of methods) {
        const t = timing[id]!;
        built[id] = t.mesh;
        const analysis = analyzeMesh(id, t.mesh, field, def.id, t, ref);
        analyses.push(analysis);
        if (!meshRankable(t.mesh)) {
          invalidRuns.push(`${def.id}@${mmOf(cell)}mm / ${id}: ${t.mesh.invalidReason ?? 'invalid'}`);
        } else {
          const base = `${def.id}-${id}-${mmOf(cell)}mm`;
          const wrote = writeMeshPair(meshDir, base, t.mesh);
          runFiles.add(`meshes/${base}.obj`);
          runFiles.add(`meshes/${base}.glb`);
          exports.push({ fixture: def.id, method: id, cell, base, ...wrote });
          if (evidenceDir && cell === args.cells[0]) {
            // Commit only the representative (coarsest) cell, and only GLB for
            // every fixture plus OBJ for the two most inspectable ones, to keep
            // the committed evidence compact. Writes are deferred so the whole
            // evidence plan can be collision-checked before any mutation.
            if (id !== 'surface-nets-unpruned') {
              const f = `${base}.glb`;
              evidencePlan.push({ rel: `meshes/${f}`, data: meshToGlb(t.mesh) });
            }
            if (def.id === 'character-head' || def.id === 'control-sharp-box') {
              const f = `${base}.obj`;
              evidencePlan.push({ rel: `meshes/${f}`, data: meshToObj(t.mesh, `${def.id} / ${id} / ${mmOf(cell)}mm`) });
            }
          }
        }
        const flag = t.mesh.invalid ? ` INVALID(${t.mesh.invalidReason})` : '';
        console.log(`  ${def.id.padEnd(17)} ${String(mmOf(cell)).padStart(4)}mm ${id.padEnd(24)} v=${String(analysis.verts).padStart(7)} t=${String(analysis.tris).padStart(7)} bnd=${String(analysis.topology.boundaryEdges).padStart(6)} nm=${analysis.topology.nonManifoldEdges} median=${analysis.medianMs.toFixed(0)}ms${flag}`);
      }
      results.push({
        fixture: def.id,
        kind: def.kind,
        fieldMeta: field.meta,
        bounds: { min: field.bounds.min, max: field.bounds.max },
        analyticDistance: field.analyticDistance,
        cell,
        grid: gridFor(field, cell),
        reference: ref ? { method: ref.mesh.method, cell: ref.cell, verts: ref.mesh.positions.length / 3, tris: ref.mesh.indices.length / 3 } : null,
        methods: analyses,
      });
    }
  }

  // ---- panels at the representative cell ---------------------------------
  // ---- panels at the representative cell (plus extra sharp-feature cells) --
  const extraPanelFixtures = new Set(['control-sharp-box', 'chamfer-groove']);
  for (const { def, field } of fields) {
    const cells = [panelCell, ...(extraPanelFixtures.has(def.id) ? args.panelsExtraMm.map(mm => mm / 1000) : [])];
    for (const pcell of cells) {
      const built: Partial<Record<string, IndexedMesh>> = {};
      for (const id of methods) {
        if (id === 'surface-nets-unpruned') continue;
        const grid = gridFor(field, pcell);
        // Re-run at the panel cell (cheap) so the render owns a clean mesh.
        built[id] = runMesher(id, field, optionsFor(id, pcell, grid));
      }
      const meshes = Object.values(built).filter((m): m is IndexedMesh => !!m && !m.invalid);
      if (meshes.length === 0) continue;
      const u = unionBounds(meshes);
      const camAll = defaultCamera(u.centre, u.radius);
      for (const id of methods) {
        const mesh = built[id];
        if (!mesh || mesh.invalid) continue;
        panels.push(renderPanel(panelDir, def.id, id, pcell, 'main', mesh, camAll, 'shaded'));
      }
      // Wireframe on the first method only, same framing.
      const wireId = methods.find(id => id !== 'surface-nets-unpruned');
      if (wireId && built[wireId] && !built[wireId]!.invalid) {
        panels.push(renderPanel(panelDir, def.id, wireId, pcell, 'main', built[wireId]!, camAll, 'wireframe'));
      }
      // Closeups on the fixture's designated feature regions.
      const regions = FEATURE_REGIONS[def.id] ?? [];
      for (const region of regions.slice(0, 2)) {
        const centre: Vec3 = [(region.min[0] + region.max[0]) / 2, (region.min[1] + region.max[1]) / 2, (region.min[2] + region.max[2]) / 2];
        const half = Math.hypot(region.max[0] - region.min[0], region.max[1] - region.min[1], region.max[2] - region.min[2]) / 2;
        const cam = defaultCamera(centre, half, 420, 420);
        for (const id of methods) {
          const mesh = built[id];
          if (!mesh || mesh.invalid) continue;
          panels.push(renderPanel(panelDir, def.id, id, pcell, `closeup-${region.name}`, mesh, cam, 'shaded'));
        }
      }
    }
  }

  // ---- evidence copies ---------------------------------------------------
  const summary = buildSummary(results as ResultRow[], args, commit, dirty, fingerprint);
  for (const p of panels) runFiles.add(`panels/${p.file}`);
  if (evidenceDir && evidenceCleanup) {
    for (const p of panels) evidencePlan.push({ rel: `panels/${p.file}`, srcPath: join(panelDir, p.file) });
    evidencePlan.push({ rel: 'results.json', data: jsonText({ commit, dirty: dirty || null, codeFingerprint: fingerprint, generatedAt: new Date().toISOString(), environment: ENV(), args: { ...args }, results, exports: compactExports(exports), panels }) });
    evidencePlan.push({ rel: 'summary.md', data: summary });
    evidencePlan.push({ rel: 'preview.html', data: previewHtml('panels', panels, args, commit) });
    for (const w of buildSensitivityEvidence(args.cells)) evidencePlan.push(w);
    // Reject any accidental overwrite of a human/unowned file BEFORE writing.
    assertEvidencePlan(evidencePlan, evidenceCleanup);
    for (const w of evidencePlan) {
      const target = join(evidenceDir, w.rel);
      mkdirSync(dirname(target), { recursive: true });
      if (w.srcPath) writeFileSync(target, readFileSync(w.srcPath));
      else writeFileSync(target, w.data!);
    }
    writeFileSync(join(evidenceDir, EVIDENCE_MANIFEST), JSON.stringify({ generated: evidencePlan.map(w => w.rel).sort() }, null, 2) + '\n');
  }
  const outResults = { commit, dirty: dirty || null, codeFingerprint: fingerprint, generatedAt: new Date().toISOString(), environment: ENV(), args: { ...args }, results, exports, panels };
  runFiles.add('results.json');
  runFiles.add('summary.md');
  runFiles.add('preview.html');
  writeJson(join(outDir, 'results.json'), outResults);
  writeFileSync(join(outDir, 'summary.md'), summary);
  writeFileSync(join(outDir, 'preview.html'), previewHtml('panels', panels, args, commit));
  writeFileSync(join(outDir, RUN_MANIFEST), JSON.stringify({ generated: [...runFiles].sort() }, null, 2) + '\n');

  console.log(`\nwrote ${outDir}`);
  if (evidenceDir) console.log(`wrote compact evidence ${evidenceDir}`);
  if (invalidRuns.length > 0) {
    console.error(`\n${invalidRuns.length} INVALID mesher result(s) — comparison INCOMPLETE; diagnostics were written but invalid meshes were not ranked or exported:`);
    for (const line of invalidRuns) console.error(`  - ${line}`);
    process.exitCode = 1;
  }
}

/** Static import at module scope would be circular-free; this keeps the panel
 *  loop readable without another top-level import. */

interface ResultRow {
  fixture: string; kind: string; cell: number; reference: unknown;
  methods: MethodAnalysis[];
}

function compactExports(exports: unknown[]): unknown[] {
  return exports.filter(e => (e as { method: string }).method !== 'surface-nets-unpruned');
}

const ENV = (): Record<string, string> => ({
  node: process.version, platform: platform(), release: release(),
  cpus: String(cpus().length),
});

/**
 * Content hash of the comparison sources that produced the evidence, so a
 * results file cannot be mistaken for a bare-base-commit run. Includes the
 * shared modules and this CLI.
 */
export function codeFingerprint(root: string): string {
  const h = createHash('sha256');
  const dir = join(root, 'src/lab/sdf-zombie/mesher-comparison');
  for (const f of readdirSync(dir).filter(n => n.endsWith('.ts')).sort()) {
    h.update(f);
    h.update(readFileSync(join(dir, f)));
  }
  h.update('scripts/blob-mesh-compare.ts');
  h.update(readFileSync(join(root, 'scripts/blob-mesh-compare.ts')));
  return h.digest('hex').slice(0, 16);
}

function sensitivityMarkdown(cell: number, rows: ReturnType<typeof sharpBoxSensitivity>): string {
  const lines: string[] = [];
  lines.push(`## cell ${mmOf(cell)} mm\n`);
  lines.push('| phase (cells) | rot deg | SN surf mm | MC surf mm | DC surf mm | SN vert mm | MC vert mm | DC vert mm |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of rows) {
    lines.push(`| ${JSON.stringify(r.phaseCells)} | ${r.rotationDeg} | ${r.snSurfaceMm.toFixed(3)} | ${r.mcSurfaceMm.toFixed(3)} | ${r.dcSurfaceMm.toFixed(3)} | ${r.snVertexMm.toFixed(3)} | ${r.mcVertexMm.toFixed(3)} | ${r.dcVertexMm.toFixed(3)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Build the sharp-box phase/rotation sensitivity evidence (no filesystem writes)
 * so the whole evidence plan can be collision-checked before any mutation.
 */
export function buildSensitivityEvidence(cells: readonly number[]): EvidenceWrite[] {
  const byCell = cells.map(cell => ({ cell, rows: sharpBoxSensitivity(cell) }));
  const md: string[] = [];
  md.push('# Sharp-box phase/rotation sensitivity\n');
  md.push('Nearest TRIANGLE SURFACE distance from the true box corner to each mesh (mm). `phase` shifts the grid origin by that fraction of a cell; `rot` rotates the analytic box by degrees about (1,1,0). The direction (DC closest) is phase-robust; the absolute SN/MC error is alignment-specific, so these are fixture numbers, not a universal guarantee.\n');
  for (const { cell, rows } of byCell) md.push(sensitivityMarkdown(cell, rows));
  return [
    { rel: 'sensitivity.md', data: md.join('\n') },
    { rel: 'sensitivity.json', data: jsonText(byCell.map(({ cell, rows }) => ({ cell, rows }))) },
  ];
}

function buildSummary(rows: ResultRow[], args: Args, commit: string, dirty = '', fingerprint = ''): string {
  const lines: string[] = [];
  lines.push('# Mesher comparison — measured summary\n');
  lines.push(`worktree HEAD \`${commit}\`${dirty ? ' (DIRTY WORKING TREE)' : ' (clean)'}${fingerprint ? `, comparison source fingerprint \`${fingerprint}\`` : ''}, ${new Date().toISOString()}, node ${process.version}`);
  lines.push(`cells (mm): ${args.cells.map(mmOf).join(', ')}; repeats: ${args.repeats}; warmups: ${args.warmups}\n`);
  lines.push('`med` = median extraction ms; `resid` = median |field|/|grad| over mesh VERTICES (first-order, metres); `surf resid` = median |field| sampled at vertices + triangle centroids (exact distance only where the fixture is analytic); `off>10%` = vertices more than 0.1 cell from the field zero set; `fallbacks` = benign finite fallbacks (e.g. singular QEF); `dropped` = unconnected intended geometry (nonzero + not explained by a clipped domain -> invalid).\n');
  lines.push('Residuals are vertex/surface-sampling diagnostics: dividing by |grad| does not remove sampling bias or account for triangle-interior error. Cross-method reference distances are sampled and approximate; because the reference resolution varies per ladder step, matched-ERROR extraction cost is NOT established.\n');
  for (const row of rows) {
    lines.push(`## ${row.fixture} @ ${mmOf(row.cell)} mm\n`);
    lines.push('| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |');
    lines.push('| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |');
    for (const m of row.methods) {
      const r = m.normalizedResidual;
      const volSign = Number.isFinite(m.topology.signedVolume) ? (m.topology.signedVolume > 0 ? '+' : '−') : 'n/a';
      lines.push(`| ${m.run} | ${m.rankable ? 'ok' : '**INVALID**'} | ${m.verts} | ${m.tris} | ${m.topology.boundaryEdges} | ${m.topology.nonManifoldEdges} | ${m.topology.connectedComponents} | ${m.topology.closed ? 'yes' : 'no'} | ${volSign} | ${fmtMm(r.median)}/${fmtMm(r.p95)}/${fmtMm(r.max)} | ${fmtMm(m.surfaceResidual.median)} | ${m.topology.vertsInsideField}/${m.topology.vertsOutsideField} | ${m.verticesOffSurface} | ${m.fallbacks} | ${m.droppedCells} | ${m.fieldEvals} | ${m.medianMs.toFixed(0)} (${m.minMs.toFixed(0)}–${m.maxMs.toFixed(0)}) | ${m.invalid ? m.invalidReason ?? 'yes' : ''} |`);
    }
    const withRef = row.methods.find(m => m.reference);
    if (withRef?.reference) {
      lines.push(`\nReference: ${withRef.reference.method} @ ${mmOf(withRef.reference.cell)} mm (approximate; resolution varies by ladder step), tolerance ${fmtMm(withRef.reference.tolerance)} mm.`);
      lines.push('| method | mesh→ref med/p95/max mm | ref→mesh med/p95/max mm | coverage mesh→ref |');
      lines.push('| --- | ---: | ---: | ---: |');
      for (const m of row.methods) {
        if (!m.reference) continue;
        lines.push(`| ${m.run} | ${fmtMm(m.reference.aToB.median)}/${fmtMm(m.reference.aToB.p95)}/${fmtMm(m.reference.aToB.max)} | ${fmtMm(m.reference.bToA.median)}/${fmtMm(m.reference.bToA.p95)}/${fmtMm(m.reference.bToA.max)} | ${(m.reference.coverageAinB * 100).toFixed(1)}% |`);
      }
    }
    // feature presence
    const feats = row.methods.find(m => m.features.length)?.features ?? [];
    if (feats.length) {
      lines.push('\nFeature presence (mesh verts inside box / reference coverage):');
      lines.push('| region | ' + row.methods.map(m => m.run).join(' | ') + ' |');
      lines.push('| --- | ' + row.methods.map(() => '---').join(' | ') + ' |');
      for (const f of feats) {
        const cells = row.methods.map(m => {
          const x = m.features.find(y => y.region.name === f.region.name);
          if (!x) return '—';
          return `${x.meshVerts}v${Number.isFinite(x.coverage) ? `/${(x.coverage * 100).toFixed(0)}%` : ''}`;
        });
        lines.push(`| ${f.region.name} | ${cells.join(' | ')} |`);
      }
    }
    const sharp = row.methods.find(m => m.sharpProbes.length)?.sharpProbes ?? [];
    if (sharp.length) {
      lines.push('\nSharp crease probes — nearest TRIANGLE SURFACE distance to the designated point (mm; vertex-only distance in parentheses):');
      lines.push('| probe | ' + row.methods.map(m => m.run).join(' | ') + ' |');
      lines.push('| --- | ' + row.methods.map(() => '---:').join(' | ') + ' |');
      for (const sp of sharp) {
        lines.push(`| ${sp.name} | ` + row.methods.map(m => {
          const x = m.sharpProbes.find(y => y.name === sp.name);
          if (!x) return '—';
          return `${fmtMm(x.minSurfaceDistance)} (${fmtMm(x.minVertexDistance)})`;
        }).join(' | ') + ' |');
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

const fmtMm = (m: number): string => Number.isFinite(m) ? (m * 1000).toFixed(m < 0.001 ? 3 : 2) : 'n/a';

function previewHtml(panelDirRel: string, panels: PanelRecord[], args: Args, commit: string): string {
  const byFixture = new Map<string, PanelRecord[]>();
  for (const p of panels) {
    const arr = byFixture.get(p.fixture) ?? [];
    arr.push(p);
    byFixture.set(p.fixture, arr);
  }
  const parts: string[] = [];
  parts.push('<!doctype html><html><head><meta charset="utf-8"><title>Blobforge mesher comparison</title>');
  parts.push('<style>body{background:#14161a;color:#dfe3ea;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:24px}');
  parts.push('h1{font-size:20px} h2{font-size:16px;margin-top:28px;border-bottom:1px solid #2a2e36;padding-bottom:6px}');
  parts.push('.row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:10px 0}');
  parts.push('figure{margin:0;background:#1b1e24;border:1px solid #2a2e36;border-radius:6px;overflow:hidden}');
  parts.push('figure img{display:block;width:100%;height:auto} figcaption{padding:4px 8px;font-size:12px;color:#aab2c0}');
  parts.push('.viewlabel{color:#8c95a4;font-size:12px;margin:14px 0 2px} .bad{color:#ff8a8a}</style></head><body>');
  parts.push(`<h1>Blobforge mesher comparison</h1><p>commit <code>${commit}</code> — ${panels.length} CPU-rendered panels, identical camera per row, one neutral material. Static posed geometry.</p>`);
  parts.push(`<p>cells: ${args.cells.map(mmOf).join(', ')} mm; panels at ${args.panelsCellMm} mm.</p>`);
  for (const [fixture, list] of byFixture) {
    parts.push(`<h2>${fixture}</h2>`);
    const keys = [...new Set(list.map(p => `${p.view}\u0000${p.cell}`))];
    for (const key of keys) {
      const [view, cellStr] = key.split('\u0000');
      const cell = Number(cellStr);
      const group = list.filter(p => p.view === view && p.cell === cell);
      parts.push(`<div class="viewlabel">${view} @ ${mmOf(cell)} mm (${group[0]?.camera.halfSize.toFixed(3)} m half-extent)</div>`);
      parts.push('<div class="row">');
      for (const p of group) {
        const wire = p.file.includes('-wire');
        parts.push(`<figure><img src="${panelDirRel}/${p.file}" loading="lazy"><figcaption>${p.method}${wire ? ' (wireframe)' : ''} — ${p.tris} tris</figcaption></figure>`);
      }
      parts.push('</div>');
    }
  }
  parts.push('</body></html>');
  return parts.join('\n');
}

// Only run when invoked as a script; importing this module (e.g. from a test
// that exercises path/budget validation) must not start a comparison.
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (invokedDirectly) main();
