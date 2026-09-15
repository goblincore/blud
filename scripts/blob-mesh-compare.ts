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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { platform, release, cpus } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

import { FIXTURES, GOBLIN_HEAD_REGION, type FixtureDef } from '../src/lab/sdf-zombie/mesher-comparison/fixtures';
import { gridFor, LADDERS, optionsFor, runMesher, timeMeshers, type RunId } from '../src/lab/sdf-zombie/mesher-comparison/runner';
import { analyzeMesh, buildReferenceMesh, FEATURE_REGIONS, type MethodAnalysis } from '../src/lab/sdf-zombie/mesher-comparison/analysis';
import { meshToObj, meshToGlb, readBackObj, inspectGlb } from '../src/lab/sdf-zombie/mesher-comparison/export';
import { defaultCamera, meshBounds, renderMesh, unionBounds } from '../src/lab/sdf-zombie/mesher-comparison/render';
import type { IndexedMesh, MethodId, ScalarField } from '../src/lab/sdf-zombie/mesher-comparison/types';
import type { Vec3 } from '../src/lab/sdf-zombie/types';

const DEFAULT_METHODS: readonly RunId[] = ['surface-nets', 'marching-cubes', 'dual-contouring'];

interface Args {
  fixtures: string[];
  methods: RunId[];
  cells: number[];
  out: string;
  evidence: string | null;
  repeats: number;
  warmups: number;
  panelsCellMm: number;
  unpruned: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    fixtures: FIXTURES.map(f => f.id),
    methods: [...DEFAULT_METHODS],
    cells: [...LADDERS.bounded],
    out: '.scratch/mesher-comparison',
    evidence: null,
    repeats: 3,
    warmups: 1,
    panelsCellMm: 20,
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
      case '--unpruned': a.unpruned = true; break;
      case '--smoke':
        a.cells = [...LADDERS.smoke]; a.repeats = 1; a.warmups = 0; break;
      default: throw new Error(`unknown argument ${arg}`);
    }
  }
  return a;
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

  const root = process.cwd();
  const outDir = join(root, args.out);
  const meshDir = join(outDir, 'meshes');
  const panelDir = join(outDir, 'panels');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(meshDir, { recursive: true });
  mkdirSync(panelDir, { recursive: true });
  const evidenceDir = args.evidence ? join(root, args.evidence) : null;
  const evidenceMeshDir = evidenceDir ? join(evidenceDir, 'meshes') : null;
  const evidencePanelDir = evidenceDir ? join(evidenceDir, 'panels') : null;
  // Clear the committed sub-dirs so a re-run cannot leave stale artifacts
  // behind (results.json / summary.md / preview.html are overwritten).
  if (evidenceMeshDir) { rmSync(evidenceMeshDir, { recursive: true, force: true }); mkdirSync(evidenceMeshDir, { recursive: true }); }
  if (evidencePanelDir) { rmSync(evidencePanelDir, { recursive: true, force: true }); mkdirSync(evidencePanelDir, { recursive: true }); }

  const blobSource = readFileSync(join(root, 'src/lab/sdf-zombie/characters/goblin.blob'), 'utf8');
  let commit = 'unknown';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* not a repo */ }

  const selected = FIXTURES.filter(f => args.fixtures.includes(f.id));
  if (selected.length === 0) throw new Error(`no fixtures selected; known: ${FIXTURES.map(f => f.id).join(', ')}`);

  const methods: RunId[] = [...args.methods];
  if (args.unpruned && !methods.includes('surface-nets-unpruned')) methods.push('surface-nets-unpruned');

  const results: unknown[] = [];
  const exports: unknown[] = [];
  const panels: PanelRecord[] = [];

  console.log(`mesher comparison: ${selected.length} fixtures x ${args.cells.map(mmOf).join('/')}mm x ${methods.join(', ')}`);
  for (const def of selected) {
    const field = buildFixture(def, blobSource);
    for (const cell of args.cells) {
      const ref = buildReferenceMesh(field, cell);
      const timing = timeMeshers(field, cell, methods, args.warmups, args.repeats);
      const analyses: MethodAnalysis[] = [];
      const built: Partial<Record<string, IndexedMesh>> = {};
      for (const id of methods) {
        const t = timing[id]!;
        built[id] = t.mesh;
        const analysis = analyzeMesh(id, t.mesh, field, def.id, t, ref);
        analyses.push(analysis);
        const base = `${def.id}-${id}-${mmOf(cell)}mm`;
        const wrote = writeMeshPair(meshDir, base, t.mesh);
        exports.push({ fixture: def.id, method: id, cell, base, ...wrote });
        if (evidenceMeshDir) {
          // Commit only the representative (coarsest) cell, and only GLB for
          // every fixture plus OBJ for the two most inspectable ones, to keep
          // the committed evidence compact.
          if (cell === args.cells[0]) {
            if (id !== 'surface-nets-unpruned') writeFileSync(join(evidenceMeshDir, `${base}.glb`), meshToGlb(t.mesh));
            if (def.id === 'character-head' || def.id === 'control-sharp-box') {
              writeFileSync(join(evidenceMeshDir, `${base}.obj`), meshToObj(t.mesh, `${def.id} / ${id} / ${mmOf(cell)}mm`));
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
  const panelCell = args.panelsCellMm / 1000;
  {
    for (const def of selected) {
      const field = buildFixture(def, blobSource);
      const built: Partial<Record<string, IndexedMesh>> = {};
      for (const id of methods) {
        if (id === 'surface-nets-unpruned') continue;
        const grid = gridFor(field, panelCell);
        // Re-run at the panel cell (cheap at 20 mm) so the render owns a clean mesh.
        built[id] = runMesher(id, field, optionsFor(id, panelCell, grid));
      }
      const meshes = Object.values(built).filter((m): m is IndexedMesh => !!m && !m.invalid);
      if (meshes.length === 0) continue;
      const u = unionBounds(meshes);
      const camAll = defaultCamera(u.centre, u.radius);
      for (const id of methods) {
        const mesh = built[id];
        if (!mesh || mesh.invalid) continue;
        panels.push(renderPanel(panelDir, def.id, id, panelCell, 'main', mesh, camAll, 'shaded'));
      }
      // Wireframe on the first method only, same framing.
      const wireId = methods.find(id => id !== 'surface-nets-unpruned');
      if (wireId && built[wireId] && !built[wireId]!.invalid) {
        panels.push(renderPanel(panelDir, def.id, wireId, panelCell, 'main', built[wireId]!, camAll, 'wireframe'));
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
          panels.push(renderPanel(panelDir, def.id, id, panelCell, `closeup-${region.name}`, mesh, cam, 'shaded'));
        }
      }
    }
  }

  // ---- evidence copies ---------------------------------------------------
  const summary = buildSummary(results as ResultRow[], args, commit);
  if (evidenceDir) {
    for (const p of panels) {
      const src = join(panelDir, p.file);
      writeFileSync(join(evidencePanelDir!, p.file), readFileSync(src));
    }
    writeFileSync(join(evidenceDir, 'results.json'), JSON.stringify({ commit, generatedAt: new Date().toISOString(), environment: ENV(), args: { ...args }, results, exports: compactExports(exports), panels }, null, 2));
    writeFileSync(join(evidenceDir, 'summary.md'), summary);
  }
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ commit, generatedAt: new Date().toISOString(), environment: ENV(), args: { ...args }, results, exports, panels }, null, 2));
  writeFileSync(join(outDir, 'summary.md'), summary);
  writeFileSync(join(outDir, 'preview.html'), previewHtml('panels', panels, args, commit));
  if (evidenceDir) writeFileSync(join(evidenceDir, 'preview.html'), previewHtml('panels', panels, args, commit));

  console.log(`\nwrote ${outDir}`);
  if (evidenceDir) console.log(`wrote compact evidence ${evidenceDir}`);
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

function buildSummary(rows: ResultRow[], args: Args, commit: string): string {
  const lines: string[] = [];
  lines.push('# Mesher comparison — measured summary\n');
  lines.push(`commit \`${commit}\`, ${new Date().toISOString()}, node ${process.version}`);
  lines.push(`cells (mm): ${args.cells.map(mmOf).join(', ')}; repeats: ${args.repeats}; warmups: ${args.warmups}\n`);
  lines.push('`med` = median extraction ms; `resid` = median |field|/|grad| (metres, first-order); `off>10%` = vertices more than 0.1 cell from the field zero set.\n');
  for (const row of rows) {
    lines.push(`## ${row.fixture} @ ${mmOf(row.cell)} mm\n`);
    lines.push('| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |');
    for (const m of row.methods) {
      const r = m.normalizedResidual;
      const volSign = Number.isFinite(m.topology.signedVolume) ? (m.topology.signedVolume > 0 ? '+' : '−') : 'n/a';
      lines.push(`| ${m.run} | ${m.verts} | ${m.tris} | ${m.topology.boundaryEdges} | ${m.topology.nonManifoldEdges} | ${m.topology.connectedComponents} | ${m.topology.closed ? 'yes' : 'no'} | ${volSign} | ${fmtMm(r.median)}/${fmtMm(r.p95)}/${fmtMm(r.max)} | ${m.topology.vertsInsideField}/${m.topology.vertsOutsideField} | ${m.verticesOffSurface} | ${m.fieldEvals} | ${m.medianMs.toFixed(0)} (${m.minMs.toFixed(0)}–${m.maxMs.toFixed(0)}) | ${m.invalid ? m.invalidReason ?? 'yes' : ''} |`);
    }
    const withRef = row.methods.find(m => m.reference);
    if (withRef?.reference) {
      lines.push(`\nReference: ${withRef.reference.method} @ ${mmOf(withRef.reference.cell)} mm (approximate), tolerance ${fmtMm(withRef.reference.tolerance)} mm.`);
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
      lines.push('\nSharp crease probes (nearest mesh vertex to the designated point, mm):');
      lines.push('| probe | ' + row.methods.map(m => m.run).join(' | ') + ' |');
      lines.push('| --- | ' + row.methods.map(() => '---:').join(' | ') + ' |');
      for (const sp of sharp) {
        lines.push(`| ${sp.name} | ` + row.methods.map(m => {
          const x = m.sharpProbes.find(y => y.name === sp.name);
          return x ? fmtMm(x.minVertexDistance) : '—';
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
    const views = [...new Set(list.map(p => p.view))];
    for (const view of views) {
      parts.push(`<div class="viewlabel">${view} (${list.find(p => p.view === view)?.camera.halfSize.toFixed(3)} m half-extent)</div>`);
      parts.push('<div class="row">');
      for (const p of list.filter(x => x.view === view)) {
        const wire = p.file.includes('-wire');
        parts.push(`<figure><img src="${panelDirRel}/${p.file}" loading="lazy"><figcaption>${p.method}${wire ? ' (wireframe)' : ''} — ${p.tris} tris</figcaption></figure>`);
      }
      parts.push('</div>');
    }
  }
  parts.push('</body></html>');
  return parts.join('\n');
}

main();
