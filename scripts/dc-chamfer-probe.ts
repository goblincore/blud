// scripts/dc-chamfer-probe.ts
//
// 2026-09-15 DC chamfer follow-up evidence generator.
//
//   npx tsx scripts/dc-chamfer-probe.ts --help
//   npx tsx scripts/dc-chamfer-probe.ts --smoke
//   npx tsx scripts/dc-chamfer-probe.ts \
//       --out .scratch/dc-chamfer-run \
//       --evidence docs/dev-notes/2026-09-15-dc-chamfer
//
// It records, for the synthetic `chamfer-groove` fixture, the DENSE FIELD
// cross-sections (ground truth), the baseline/candidate/marching-cubes slices
// over the same plane, region-scoped distance diagnostics, QEF clamp tallies
// per region, and calibration/regression checks. The original comparison's
// evidence directory and CLI are not touched; this script reuses the CLI's
// ownership guards (marker + exact-file manifest, no recursive deletion).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';

import {
  EVIDENCE_MANIFEST, assertDisjoint, assertEvidencePlan, cleanEvidenceDir, encodePng,
  codeFingerprint, jsonText, prepareOwnedDir, resolveWithinRoot,
} from './blob-mesh-compare';
import { FIXTURES, GOBLIN_HEAD_REGION } from '../src/lab/sdf-zombie/mesher-comparison/fixtures';
import { CHAMFER_REGIONS, buildRegionReferences, evaluateChamferCell, evaluateVariant, renderSlice, type VariantMetrics } from '../src/lab/sdf-zombie/mesher-comparison/dc-chamfer';
import { DC_BASELINE, DC_CANDIDATE, DC_VARIANTS, dcOptionsFor, dcVariantById, type DcVariant } from '../src/lab/sdf-zombie/mesher-comparison/dc-variants';
import { marchingCubes } from '../src/lab/sdf-zombie/mesher-comparison/marching-cubes';
import { dualContouring } from '../src/lab/sdf-zombie/mesher-comparison/dual-contouring';
import { gridFor } from '../src/lab/sdf-zombie/mesher-comparison/runner';
import { analyzeMesh, buildReferenceMesh, SHARP_PROBES, type MethodAnalysis } from '../src/lab/sdf-zombie/mesher-comparison/analysis';
import { meshSliceSegments, type Segment } from '../src/lab/sdf-zombie/mesher-comparison/field-slice';
import { meshToGlb, meshToObj } from '../src/lab/sdf-zombie/mesher-comparison/export';
import { renderMesh, defaultCamera, meshBounds, unionBounds, type CameraSpec } from '../src/lab/sdf-zombie/mesher-comparison/render';
import { sharpBoxSensitivity, sharpBoxSensitivityVariants } from '../src/lab/sdf-zombie/mesher-comparison/sensitivity';
import type { IndexedMesh, ScalarField } from '../src/lab/sdf-zombie/mesher-comparison/types';
import type { Vec3 } from '../src/lab/sdf-zombie/types';

const ALL_CELLS = [0.02, 0.01, 0.005] as const;
const SMOKE_CELLS = [0.02] as const;
const HEAD_10 = 0.01;

const SOURCE_FILES = [
  'src/lab/sdf-zombie/mesher-comparison/field-slice.ts',
  'src/lab/sdf-zombie/mesher-comparison/dc-variants.ts',
  'src/lab/sdf-zombie/mesher-comparison/dc-chamfer.ts',
  'src/lab/sdf-zombie/mesher-comparison/dual-contouring.ts',
  'scripts/dc-chamfer-probe.ts',
];

interface Args { out: string; evidence: string | null; smoke: boolean; help: boolean }

function parseArgs(argv: string[]): Args {
  const a: Args = { out: '.scratch/dc-chamfer-run', evidence: 'docs/dev-notes/2026-09-15-dc-chamfer', smoke: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case '--help': case '-h': a.help = true; break;
      case '--out': a.out = next(); break;
      case '--evidence': { const v = next(); a.evidence = (v === '' || v === 'none') ? null : v; break; }
      case '--smoke': a.smoke = true; break;
      default: throw new Error(`unknown argument ${arg}`);
    }
  }
  return a;
}

const HELP = `DC chamfer follow-up evidence

Usage: npx tsx scripts/dc-chamfer-probe.ts [options]

  --out DIR        run output dir (default .scratch/dc-chamfer-run)
  --evidence DIR   committed evidence dir (default docs/dev-notes/2026-09-15-dc-chamfer)
  --smoke          one coarse cell (fast end-to-end check)
  -h, --help       this text

Outputs: results.json, preview.html, meshes/*.glb, panels/*.png. README.md is
human-authored and is never touched (only manifest-owned files are replaced).`;

const mm = (cell: number): number => Math.round(cell * 1000);
const f3 = (v: number): string => Number.isFinite(v) ? v.toFixed(3) : 'n/a';
const mmv = (v: number): string => Number.isFinite(v) ? (v * 1000).toFixed(3) : 'n/a';

interface PanelRec { fixture: string; method: string; cell: number; view: string; file: string; tris: number; note: string }

function cam(centre: Vec3, halfSize: number, yaw: number, pitch: number, w = 420, h = 420): CameraSpec {
  return { yaw, pitch, centre, halfSize, width: w, height: h, light: [0.4, 0.8, 0.35] };
}

function writePng(dir: string, name: string, rgba: Uint8Array, w: number, h: number): void {
  writeFileSync(join(dir, name), encodePng(rgba, w, h));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  const root = realpathSync(process.cwd());
  const outDir = resolveWithinRoot(root, args.out, '--out');
  const evidenceDir = args.evidence ? resolveWithinRoot(root, args.evidence, '--evidence') : null;
  if (evidenceDir) assertDisjoint(outDir, evidenceDir, '--out', '--evidence');

  const cells: readonly number[] = args.smoke ? SMOKE_CELLS : ALL_CELLS;
  const blobSource = readFileSync(join(root, 'src/lab/sdf-zombie/characters/goblin.blob'), 'utf8');

  // Fields. The head is only built when a head regression is recorded.
  const chamfer = FIXTURES.find(f => f.id === 'chamfer-groove')!.build();
  const box = FIXTURES.find(f => f.id === 'control-sharp-box')!.build();
  const sphere = FIXTURES.find(f => f.id === 'control-sphere')!.build();
  const head = FIXTURES.find(f => f.id === 'character-head')!.build(blobSource);
  const torn = FIXTURES.find(f => f.id === 'torn-chunk')!.build();

  console.log('building dense field references (ground truth)…');
  const references = buildRegionReferences(chamfer, 0.0002);
  for (const r of references) {
    console.log(`  ${r.region.id.padEnd(14)} crossings=${String(r.reference.crossings).padStart(5)} unresolved=${String(r.reference.unresolvedCrossings).padStart(4)} max|f|@crossing=${mmv(r.reference.maxResidualAtCrossing)}mm maxBracket=${mmv(r.reference.maxBracketWidth)}mm`);
  }

  // ---- mutations after all inputs are built ------------------------------
  prepareOwnedDir(outDir, '--out');
  const meshDir = join(outDir, 'meshes');
  const panelDir = join(outDir, 'panels');
  mkdirSync(meshDir, { recursive: true });
  mkdirSync(panelDir, { recursive: true });
  const cleanup = evidenceDir ? cleanEvidenceDir(evidenceDir) : null;
  const runFiles = new Set<string>();
  const plan: { rel: string; srcPath?: string; data?: string }[] = [];
  const panels: PanelRec[] = [];

  const addPanel = (name: string, rgba: Uint8Array, w: number, h: number): void => {
    writePng(panelDir, name, rgba, w, h);
    runFiles.add(`panels/${name}`);
    plan.push({ rel: `panels/${name}`, srcPath: join(panelDir, name) });
  };
  const addGlb = (base: string, mesh: IndexedMesh): void => {
    writeFileSync(join(meshDir, `${base}.glb`), meshToGlb(mesh));
    runFiles.add(`meshes/${base}.glb`);
    plan.push({ rel: `meshes/${base}.glb`, srcPath: join(meshDir, `${base}.glb`) });
  };

  // ---- 1. chamfer-groove slices + metrics --------------------------------
  console.log('evaluating DC variants on chamfer-groove…');
  const focusVariants: DcVariant[] = [DC_BASELINE, DC_CANDIDATE, dcVariantById('dc-eps-002cell'), dcVariantById('dc-eps-1mm'), dcVariantById('dc-baseline-noclamp')];
  interface CellResult { cell: number; variants: VariantMetrics[]; sn: VariantMetrics; mc: VariantMetrics }
  const cellResults: CellResult[] = [];
  const colorOf: Record<string, readonly [number, number, number]> = {
    'dc-baseline': [240, 120, 80],
    'dc-eps-candidate': [90, 200, 235],
    'marching-cubes': [120, 220, 120],
    'surface-nets': [200, 160, 230],
  };
  for (const cell of cells) {
    const all = evaluateChamferCell(chamfer, 'chamfer-groove', cell, focusVariants, references, true);
    const sn = all.find(v => v.id === 'surface-nets')!;
    const mc = all.find(v => v.id === 'marching-cubes')!;
    const variants = all.filter(v => v.id !== 'surface-nets' && v.id !== 'marching-cubes');
    cellResults.push({ cell, variants, sn, mc });
    // Keep the committed GLB set small: baseline vs candidate at every cell,
    // MC only at the focus cell (context), and the real-fixture/box files below.
    for (const v of variants.filter(x => x.id === DC_BASELINE.id || x.id === DC_CANDIDATE.id)) addGlb(`chamfer-groove-${v.id}-${mm(cell)}mm`, v.mesh);
    if (cell === HEAD_10) addGlb(`chamfer-groove-marching-cubes-${mm(cell)}mm`, mc.mesh);
    for (const v of variants) {
      console.log(`  ${mm(cell)}mm ${v.id.padEnd(22)} notch+ t2r ${f3(v.regions[1]!.testedToRef.median * 1000)}/${f3(v.regions[1]!.testedToRef.p95 * 1000)}/${f3(v.regions[1]!.testedToRef.max * 1000)}mm r2t ${f3(v.regions[1]!.refToTested.p95 * 1000)}/${f3(v.regions[1]!.refToTested.max * 1000)}mm clamps ${v.qefClamped} (notch+ ${v.clampedInRegion['notch-plus-z'] ?? 0}/${v.cellsInRegion['notch-plus-z'] ?? 0})`);
    }

    // slice panels per region
    for (let ri = 0; ri < CHAMFER_REGIONS.length; ri++) {
      const region = CHAMFER_REGIONS[ri]!;
      const ref = references[ri]!;
      const layerFor = (m: VariantMetrics): Segment[] => meshSliceSegments(m.mesh, region.plane, region.window);
      const mk = (layers: { segments: Segment[]; color: readonly [number, number, number] }[], name: string, method: string): void => {
        const img = renderSlice(region, layers, 480, 400, ref.reference.segments);
        addPanel(name, img.rgba, img.width, img.height);
        panels.push({ fixture: 'chamfer-groove', method, cell, view: `slice-${region.id}`, file: name, tris: 0, note: region.note });
      };
      const base = variants.find(v => v.id === DC_BASELINE.id)!;
      const cand = variants.find(v => v.id === DC_CANDIDATE.id)!;
      mk([{ segments: layerFor(base), color: colorOf['dc-baseline']! }], `chamfer-groove__dc-baseline__${mm(cell)}mm__slice-${region.id}.png`, DC_BASELINE.id);
      mk([{ segments: layerFor(cand), color: colorOf['dc-eps-candidate']! }], `chamfer-groove__dc-eps-candidate__${mm(cell)}mm__slice-${region.id}.png`, DC_CANDIDATE.id);
      mk([{ segments: layerFor(mc), color: colorOf['marching-cubes']! }], `chamfer-groove__marching-cubes__${mm(cell)}mm__slice-${region.id}.png`, 'marching-cubes');
      mk([{ segments: layerFor(sn), color: colorOf['surface-nets']! }], `chamfer-groove__surface-nets__${mm(cell)}mm__slice-${region.id}.png`, 'surface-nets');
      mk([
        { segments: layerFor(mc), color: colorOf['marching-cubes']! },
        { segments: layerFor(base), color: colorOf['dc-baseline']! },
        { segments: layerFor(cand), color: colorOf['dc-eps-candidate']! },
      ], `chamfer-groove__compare__${mm(cell)}mm__slice-${region.id}.png`, 'compare');
    }
  }

  // ---- 1b. reference-resolution convergence at the focus cell -------------
  // The ~2-3x pit conclusion must not rest on one arbitrary contour spacing.
  // Re-run the 10 mm baseline/candidate against a FINER dense field contour
  // (0.1 mm vs the 0.2 mm reference) and confirm the ratio is stable. The
  // reference is a fixed, documented spacing per evidence run, not adaptive;
  // this bracket shows the conclusion is not an artifact of that choice.
  // Skipped in --smoke, which only runs the 20 mm cell.
  const c10res = cellResults.find(c => c.cell === HEAD_10);
  const referenceConvergence = (() => {
    if (!c10res) return [];
    console.log('reference convergence @10mm (finer field contour)…');
    const refsFine = buildRegionReferences(chamfer, 0.0001);
    const convBase = evaluateVariant(chamfer, 'chamfer-groove', HEAD_10, DC_BASELINE, refsFine);
    const convCand = evaluateVariant(chamfer, 'chamfer-groove', HEAD_10, DC_CANDIDATE, refsFine);
    const regionOf = (v: VariantMetrics, id: string) => v.regions.find(r => r.region.id === id)!;
    return CHAMFER_REGIONS.map(region => {
      const b = regionOf(c10res.variants.find(v => v.id === DC_BASELINE.id)!, region.id);
      const c = regionOf(c10res.variants.find(v => v.id === DC_CANDIDATE.id)!, region.id);
      const bf = regionOf(convBase, region.id);
      const cf = regionOf(convCand, region.id);
      const ratio = (a: number, z: number): number => z > 0 ? a / z : NaN;
      return {
        id: region.id,
        coarseResolutionMm: b.reference.resolution * 1000,
        fineResolutionMm: bf.reference.resolution * 1000,
        coarseCrossings: b.reference.crossings, fineCrossings: bf.reference.crossings,
        baseline: {
          coarse: { t2rP95Mm: b.testedToRef.p95 * 1000, t2rMaxMm: b.testedToRef.max * 1000, r2tP95Mm: b.refToTested.p95 * 1000, r2tMaxMm: b.refToTested.max * 1000 },
          fine: { t2rP95Mm: bf.testedToRef.p95 * 1000, t2rMaxMm: bf.testedToRef.max * 1000, r2tP95Mm: bf.refToTested.p95 * 1000, r2tMaxMm: bf.refToTested.max * 1000 },
        },
        candidate: {
          coarse: { t2rP95Mm: c.testedToRef.p95 * 1000, t2rMaxMm: c.testedToRef.max * 1000, r2tP95Mm: c.refToTested.p95 * 1000, r2tMaxMm: c.refToTested.max * 1000 },
          fine: { t2rP95Mm: cf.testedToRef.p95 * 1000, t2rMaxMm: cf.testedToRef.max * 1000, r2tP95Mm: cf.refToTested.p95 * 1000, r2tMaxMm: cf.refToTested.max * 1000 },
        },
        candidateOverBaseline: {
          coarseT2rP95: ratio(c.testedToRef.p95, b.testedToRef.p95),
          fineT2rP95: ratio(cf.testedToRef.p95, bf.testedToRef.p95),
          coarseR2tP95: ratio(c.refToTested.p95, b.refToTested.p95),
          fineR2tP95: ratio(cf.refToTested.p95, bf.refToTested.p95),
        },
      };
    });
  })();

  // ---- 2. shaded / wireframe closeups at 10 mm ---------------------------
  console.log('rendering closeups…');
  const c10 = cellResults.find(c => c.cell === 0.01) ?? cellResults[0]!;
  const closeups: { view: string; cam: CameraSpec; note: string }[] = [
    { view: 'closeup-notch', cam: cam([0, 0.03, 0.129], 0.032, 0.55, 0.42), note: 'the +z groove pit (x-z), tight' },
    { view: 'closeup-seam', cam: cam([0.02, 0.129, 0], 0.062, 0.6, 0.95), note: 'the chamfer bevel (x-y), tight' },
  ];
  for (const cu of closeups) {
    for (const m of [c10.variants.find(v => v.id === DC_BASELINE.id)!, c10.variants.find(v => v.id === DC_CANDIDATE.id)!, c10.mc]) {
      for (const mode of ['shaded', 'wireframe'] as const) {
        const img = renderMesh(m.mesh, cu.cam, mode);
        const suffix = mode === 'wireframe' ? '-wire' : '';
        const name = `chamfer-groove__${m.id}__10mm__${cu.view}${suffix}.png`;
        addPanel(name, img.rgba, img.width, img.height);
        panels.push({ fixture: 'chamfer-groove', method: m.id, cell: 0.01, view: cu.view, file: name, tris: m.tris, note: cu.note });
      }
    }
  }
  // Overview at 20 mm.
  {
    const c20 = cellResults[0]!;
    const meshes = [c20.variants.find(v => v.id === DC_BASELINE.id)!.mesh, c20.variants.find(v => v.id === DC_CANDIDATE.id)!.mesh, c20.mc.mesh];
    const u = unionBounds(meshes);
    const camAll = defaultCamera(u.centre, u.radius);
    for (const m of [c20.variants.find(v => v.id === DC_BASELINE.id)!, c20.variants.find(v => v.id === DC_CANDIDATE.id)!, c20.mc]) {
      const img = renderMesh(m.mesh, camAll, 'shaded');
      const name = `chamfer-groove__${m.id}__20mm__main.png`;
      addPanel(name, img.rgba, img.width, img.height);
      panels.push({ fixture: 'chamfer-groove', method: m.id, cell: 0.02, view: 'main', file: name, tris: m.tris, note: 'whole fixture overview' });
    }
  }

  // ---- 3. calibration: sharp box + sphere --------------------------------
  console.log('calibration: sharp box + sphere…');
  interface CalRow { cell: number; method: string; worstCornerMm: number; cornerMm: number[]; closed: boolean; boundaryEdges: number; nonManifoldEdges: number }
  const calibration: CalRow[] = [];
  for (const cell of cells) {
    const grid = gridFor(box, cell);
    const methods: [string, IndexedMesh][] = [
      [DC_BASELINE.id, dualContouring(box, dcOptionsFor(DC_BASELINE, cell, grid))],
      [DC_CANDIDATE.id, dualContouring(box, dcOptionsFor(DC_CANDIDATE, cell, grid))],
      ['marching-cubes', marchingCubes(box, { cell, grid })],
    ];
    for (const [name, mesh] of methods) {
      const an = analyzeMesh('dual-contouring', mesh, box, 'control-sharp-box', { timesMs: [], medianMs: 0, minMs: 0, maxMs: 0 }, null);
      const d = an.sharpProbes.map(p => p.minSurfaceDistance);
      calibration.push({ cell, method: name, worstCornerMm: Math.max(...d) * 1000, cornerMm: d.map(x => x * 1000), closed: an.topology.closed, boundaryEdges: an.topology.boundaryEdges, nonManifoldEdges: an.topology.nonManifoldEdges });
    }
  }
  // Box corner closeup at 10 mm.
  {
    const grid = gridFor(box, 0.01);
    const camBox = cam([0.11, 0.11, 0.11], 0.09, 0.72, 0.42);
    for (const [name, mesh] of [
      [DC_BASELINE.id, dualContouring(box, dcOptionsFor(DC_BASELINE, 0.01, grid))],
      [DC_CANDIDATE.id, dualContouring(box, dcOptionsFor(DC_CANDIDATE, 0.01, grid))],
      ['marching-cubes', marchingCubes(box, { cell: 0.01, grid })],
    ] as [string, IndexedMesh][]) {
      const img = renderMesh(mesh, camBox, 'shaded');
      const n = `control-sharp-box__${name}__10mm__closeup-corner.png`;
      addPanel(n, img.rgba, img.width, img.height);
      panels.push({ fixture: 'control-sharp-box', method: name, cell: 0.01, view: 'closeup-corner', file: n, tris: mesh.indices.length / 3, note: 'convex corner, tight' });
      addGlb(`control-sharp-box-${name}-10mm`, mesh);
    }
  }
  // Sphere sanity (topology + residual).
  const sphereRows: unknown[] = [];
  for (const cell of cells) {
    const grid = gridFor(sphere, cell);
    const ref = buildReferenceMesh(sphere, cell);
    for (const [name, mesh] of [
      [DC_BASELINE.id, dualContouring(sphere, dcOptionsFor(DC_BASELINE, cell, grid))],
      [DC_CANDIDATE.id, dualContouring(sphere, dcOptionsFor(DC_CANDIDATE, cell, grid))],
    ] as [string, IndexedMesh][]) {
      const an = analyzeMesh('dual-contouring', mesh, sphere, 'control-sphere', { timesMs: [], medianMs: 0, minMs: 0, maxMs: 0 }, ref);
      sphereRows.push({ cell, method: name, residualMedianMm: an.normalizedResidual.median * 1000, residualP95Mm: an.normalizedResidual.p95 * 1000, closed: an.topology.closed, boundaryEdges: an.topology.boundaryEdges, nonManifoldEdges: an.topology.nonManifoldEdges, signedVolumePositive: an.topology.signedVolume > 0 });
    }
  }

  // ---- 4. regression: goblin head + torn chunk at 10 mm ------------------
  console.log('regressions: head + torn chunk @10mm…');
  interface RegRow { fixture: string; method: string; verts: number; tris: number; residualMedianMm: number; surfMedianMm: number; meshToRefMedMm: number | null; meshToRefP95Mm: number | null; refToMeshMedMm: number | null; refToMeshP95Mm: number | null; boundaryEdges: number; nonManifoldEdges: number; invalid: boolean }
  const regressions: RegRow[] = [];
  for (const [fid, fx, refCell] of [['character-head', head, 0.005], ['torn-chunk', torn, 0.005]] as [string, ScalarField, number][]) {
    const grid = gridFor(fx, HEAD_10);
    const ref = buildReferenceMesh(fx, HEAD_10, refCell);
    for (const [name, mesh] of [
      [DC_BASELINE.id, dualContouring(fx, dcOptionsFor(DC_BASELINE, HEAD_10, grid))],
      [DC_CANDIDATE.id, dualContouring(fx, dcOptionsFor(DC_CANDIDATE, HEAD_10, grid))],
      ['marching-cubes', marchingCubes(fx, { cell: HEAD_10, grid })],
    ] as [string, IndexedMesh][]) {
      const an = analyzeMesh('dual-contouring', mesh, fx, fid, { timesMs: [], medianMs: 0, minMs: 0, maxMs: 0 }, ref);
      // `analyzeMesh` calls `bidirectionalDistance(mesh, reference)`, so
      // aToB = MESH -> reference and bToA = reference -> MESH. Store both
      // directions explicitly and label them by their real direction.
      regressions.push({
        fixture: fid, method: name, verts: an.verts, tris: an.tris,
        residualMedianMm: an.normalizedResidual.median * 1000, surfMedianMm: an.surfaceResidual.median * 1000,
        meshToRefMedMm: an.reference ? an.reference.aToB.median * 1000 : null,
        meshToRefP95Mm: an.reference ? an.reference.aToB.p95 * 1000 : null,
        refToMeshMedMm: an.reference ? an.reference.bToA.median * 1000 : null,
        refToMeshP95Mm: an.reference ? an.reference.bToA.p95 * 1000 : null,
        boundaryEdges: an.topology.boundaryEdges, nonManifoldEdges: an.topology.nonManifoldEdges, invalid: an.invalid,
      });
    }
    addGlb(`${fid}-${DC_BASELINE.id}-10mm`, dualContouring(fx, dcOptionsFor(DC_BASELINE, HEAD_10, grid)));
    addGlb(`${fid}-${DC_CANDIDATE.id}-10mm`, dualContouring(fx, dcOptionsFor(DC_CANDIDATE, HEAD_10, grid)));
  }

  // ---- 5. box sensitivity (phase/rotation) -------------------------------
  // The original API is re-emitted UNCHANGED for continuity; the candidate is
  // measured separately because a rotated frame is exactly where a normal-step
  // change can move the answer, and the axis-aligned rows cannot show that.
  const sensitivity = cells.map(cell => ({ cell, rows: sharpBoxSensitivity(cell) }));
  const candidateSensitivity = cells.map(cell => ({
    cell,
    rows: sharpBoxSensitivityVariants(cell, [DC_BASELINE, DC_CANDIDATE]),
  }));

  // ---- 6. serialize ------------------------------------------------------
  const commit = git(root, ['rev-parse', 'HEAD']);
  const dirty = git(root, ['status', '--porcelain']);
  const fp = codeFingerprint(root) + ':' + SOURCE_FILES.map(f => readFileSync(join(root, f))).reduce((h, b) => h + createHash('sha256').update(b).digest('hex').slice(0, 8), '').slice(0, 8);

  const mmStats = (s: { samples: number; median: number; p95: number; max: number }): { samples: number; median: number; p95: number; max: number } =>
    ({ samples: s.samples, median: s.median * 1000, p95: s.p95 * 1000, max: s.max * 1000 });

  const variantJson = (v: VariantMetrics): unknown => ({
    id: v.id, label: v.label, note: v.note, normalEpsilonMm: v.normalEpsilon * 1000, clampToCell: v.clampToCell,
    verts: v.verts, tris: v.tris,
    boundaryEdges: v.topology.boundaryEdges, nonManifoldEdges: v.topology.nonManifoldEdges,
    connectedComponents: v.topology.connectedComponents, closed: v.topology.closed, signedVolume: v.topology.signedVolume,
    degenerateTris: v.topology.degenerateTris, duplicateFaces: v.topology.duplicateFaces, nonManifoldVertices: v.topology.nonManifoldVertices, boundaryCrossings: v.topology.boundaryCrossings, orientationFlips: v.topology.orientationFlips,
    residualMedianMm: v.normalizedResidual.median * 1000, residualP95Mm: v.normalizedResidual.p95 * 1000, residualMaxMm: v.normalizedResidual.max * 1000,
    surfaceResidualMedianMm: v.surfaceResidual.median * 1000,
    qefClamped: v.qefClamped, qefFallbacks: v.qefFallbacks, qefResidualMeanMm: v.qefResidualMean * 1000, qefResidualMaxMm: v.qefResidualMax * 1000,
    clampedInRegion: v.clampedInRegion, cellsInRegion: v.cellsInRegion,
    invalid: v.mesh.invalid, invalidReason: v.mesh.invalidReason ?? null,
    regions: v.regions.map(r => ({
      id: r.region.id,
      reference: {
        crossings: r.reference.crossings, resolvedCrossings: r.reference.resolvedCrossings,
        unresolvedCrossings: r.reference.unresolvedCrossings,
        resolutionMm: r.reference.resolution * 1000, maxResidualAtCrossingMm: r.reference.maxResidualAtCrossing * 1000,
        maxEndpointJumpMm: r.reference.maxEndpointJump * 1000,
        spatialTolMm: r.reference.spatialTol * 1000, maxBracketWidthMm: r.reference.maxBracketWidth * 1000,
      },
      testedToRefMm: mmStats(r.testedToRef), refToTestedMm: mmStats(r.refToTested),
    })),
  });

  const results = {
    commit, dirty: dirty || null, codeFingerprint: fp,
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: platform(), release: release(), cpus: String(cpus().length) },
    groundTruth: {
      fixture: 'chamfer-groove',
      summary: 'The chamfer fold inflates the solid into a broad bevel (top near y=+0.14, lobes reach ~0.085); the groove cutter is buried mid-span and only reaches the surface near its ±z caps, producing annular pits with a central pillar. The groove rim is a sign boundary of the sdGroove band gate: the two one-sided bracket samples differ by ~14 mm, yet the refined crossing residual is small (the boundary is spatially resolvable). Discontinuity is established by that formula plus the one-sided samples, never by residual alone.',
      regions: references.map(r => ({
        id: r.region.id, label: r.region.label, note: r.region.note,
        plane: r.region.plane, window: r.region.window, core: r.region.core,
        crossings: r.reference.crossings, resolvedCrossings: r.reference.resolvedCrossings,
        unresolvedCrossings: r.reference.unresolvedCrossings,
        resolutionMm: r.reference.resolution * 1000, maxResidualAtCrossingMm: r.reference.maxResidualAtCrossing * 1000,
        maxEndpointJumpMm: r.reference.maxEndpointJump * 1000,
        spatialTolMm: r.reference.spatialTol * 1000, maxBracketWidthMm: r.reference.maxBracketWidth * 1000,
      })),
    },
    slices: cellResults.map(c => ({ cell: c.cell, baseline: variantJson(c.variants.find(v => v.id === DC_BASELINE.id)!), candidate: variantJson(c.variants.find(v => v.id === DC_CANDIDATE.id)!), context: { marchingCubes: variantJson(c.mc), surfaceNets: variantJson(c.sn) }, sweep: c.variants.filter(v => v.id !== DC_BASELINE.id && v.id !== DC_CANDIDATE.id).map(variantJson) })),
    variants: DC_VARIANTS.map(v => ({ id: v.id, label: v.label, note: v.note, normalEpsilonAt10mmMm: v.normalEpsilon(HEAD_10) === null ? 5 : v.normalEpsilon(HEAD_10)! * 1000, clampToCell: v.clampToCell })),
    calibration: {
      sharpBox: calibration, sphere: sphereRows,
      sensitivity: sensitivity.map(s => ({ cell: s.cell, rows: s.rows })),
      candidateSensitivity: candidateSensitivity.map(s => ({ cell: s.cell, rows: s.rows })),
    },
    referenceConvergence,
    regressions,
    panels,
    evidencePlan: plan.map(p => p.rel),
  };

  // ---- 7. write + copy evidence ------------------------------------------
  runFiles.add('results.json'); runFiles.add('preview.html');
  writeFileSync(join(outDir, 'results.json'), jsonText(results));
  const preview = previewHtml(panels, { candidateSensitivity, referenceConvergence });
  writeFileSync(join(outDir, 'preview.html'), preview);

  if (evidenceDir && cleanup) {
    plan.push({ rel: 'results.json', data: jsonText(results) });
    plan.push({ rel: 'preview.html', data: preview });
    assertEvidencePlan(plan as never, cleanup);
    for (const w of plan) {
      const target = join(evidenceDir, w.rel);
      mkdirSync(dirname(target), { recursive: true });
      if (w.srcPath) writeFileSync(target, readFileSync(w.srcPath));
      else writeFileSync(target, w.data!);
    }
    writeFileSync(join(evidenceDir, EVIDENCE_MANIFEST), JSON.stringify({ generated: plan.map(w => w.rel).sort() }, null, 2) + '\n');
  }
  writeFileSync(join(outDir, '.blob-mesh-compare-generated.json'), JSON.stringify({ generated: [...runFiles].sort() }, null, 2) + '\n');

  console.log(`\nwrote ${outDir}`);
  if (evidenceDir) console.log(`wrote compact evidence ${evidenceDir}`);
  console.log(`  open ${join(relative(root, evidenceDir ?? outDir), 'preview.html')}`);
}

function git(root: string, args: string[]): string {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return ''; }
}

interface PreviewCandidateSensitivityRow {
  readonly cell: number;
  readonly rotationDeg: number;
  readonly phaseCells: readonly [number, number, number];
  readonly dc: Readonly<Record<string, { surfaceMm: number; normalEpsilonMm: number }>>;
}

interface PreviewConvergenceRow {
  readonly id: string;
  readonly coarseResolutionMm: number;
  readonly fineResolutionMm: number;
  readonly baseline: { readonly coarse: { readonly r2tP95Mm: number }; readonly fine: { readonly r2tP95Mm: number } };
  readonly candidate: { readonly coarse: { readonly r2tP95Mm: number }; readonly fine: { readonly r2tP95Mm: number } };
  readonly candidateOverBaseline: { readonly coarseR2tP95: number; readonly fineR2tP95: number };
}

export interface PreviewExtras {
  readonly candidateSensitivity?: readonly { readonly cell: number; readonly rows: readonly PreviewCandidateSensitivityRow[] }[];
  readonly referenceConvergence?: readonly PreviewConvergenceRow[];
}

function previewHtml(panels: PanelRec[], extras: PreviewExtras = {}): string {
  const regions = ['seam', 'notch-plus-z', 'notch-minus-z'];
  const cells = [...new Set(panels.filter(p => p.view.startsWith('slice-')).map(p => p.cell))].sort((a, b) => b - a);
  const legend = `<p style="font:13px/1.6 monospace">` +
    `<span style="color:#f07850">■</span> DC baseline (cell*0.5 normals) &nbsp;` +
    `<span style="color:#5ac8eb">■</span> DC candidate (0.1*cell bounded) &nbsp;` +
    `<span style="color:#78dc78">■</span> marching cubes &nbsp;` +
    `<span style="color:#c8a0e6">■</span> surface nets &nbsp;` +
    `<span style="color:#e1e1e8">■</span> dense field contour (ground truth) &nbsp;` +
    `<span style="color:#464c58">▢</span> core metric window</p>`;
  const p: string[] = [];
  p.push('<!doctype html><html><head><meta charset="utf-8"><title>DC chamfer follow-up</title>');
  p.push('<style>body{background:#14161a;color:#dfe3ea;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:24px}');
  p.push('h1{font-size:20px} h2{font-size:16px;margin-top:26px;border-bottom:1px solid #2a2e36;padding-bottom:6px} h3{font-size:14px;color:#aab2c0;margin:16px 0 4px}');
  p.push('.row{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:8px 0} .row.cu{grid-template-columns:repeat(6,minmax(0,1fr))}');
  p.push('figure{margin:0;background:#1b1e24;border:1px solid #2a2e36;border-radius:6px;overflow:hidden}');
  p.push('figure img{display:block;width:100%;height:auto} figcaption{padding:3px 6px;font-size:11px;color:#aab2c0}');
  p.push('code{color:#e1e1e8}</style></head><body>');
  p.push('<h1>DC chamfer / groove follow-up — slice evidence</h1>');
  p.push(`<p>Static CPU renders. Slice panels draw the <b>dense field contour</b> (ground truth) under the mesh slice; shading is absent so a defect cannot hide behind it. Core rectangle = the window the distance metrics use.</p>`);
  p.push(legend);
  const file = (fixture: string, method: string, cell: number, view: string): string | undefined =>
    panels.find(x => x.fixture === fixture && x.method === method && x.cell === cell && x.view === view)?.file;
  for (const cell of cells) {
    p.push(`<h2>chamfer-groove @ ${mm(cell)} mm</h2>`);
    for (const region of regions) {
      const view = `slice-${region}`;
      p.push(`<h3>${region} — field contour vs mesh slice</h3><div class="row">`);
      for (const [method, label] of [['dc-baseline', 'old DC'], ['dc-eps-candidate', 'new DC'], ['marching-cubes', 'MC'], ['surface-nets', 'SN'], ['compare', 'compare (MC+old+new)']] as [string, string][]) {
        const f = file('chamfer-groove', method, cell, view);
        if (!f) continue;
        p.push(`<figure><img src="panels/${f}" loading="lazy"><figcaption>${label}</figcaption></figure>`);
      }
      p.push('</div>');
    }
  }
  p.push('<h2>tight 3-D closeups @ 10 mm (shaded + wireframe)</h2>');
  for (const view of ['closeup-notch', 'closeup-seam']) {
    p.push(`<h3>${view}</h3><div class="row cu">`);
    for (const method of ['dc-baseline', 'dc-eps-candidate', 'marching-cubes']) {
      for (const wire of [false, true]) {
        // Match the generator's EXACT filename, so a shaded panel can never be
        // mistaken for a wireframe panel (or vice versa) by a loose lookup.
        const expected = `chamfer-groove__${method}__10mm__${view}${wire ? '-wire' : ''}.png`;
        const rec = panels.find(x => x.file === expected);
        if (rec) p.push(`<figure><img src="panels/${rec.file}" loading="lazy"><figcaption>${method}${wire ? ' wire' : ' shaded'}</figcaption></figure>`);
      }
    }
    p.push('</div>');
  }
  p.push('<h2>calibration @ 10 mm: sharp box corner</h2><div class="row">');
  for (const method of ['dc-baseline', 'dc-eps-candidate', 'marching-cubes']) {
    const f = panels.find(x => x.fixture === 'control-sharp-box' && x.method === method)?.file;
    if (f) p.push(`<figure><img src="panels/${f}" loading="lazy"><figcaption>${method}</figcaption></figure>`);
  }
  p.push('</div>');

  if (extras.candidateSensitivity && extras.candidateSensitivity.length > 0) {
    p.push('<h2>sharp-box candidate sensitivity — the normal step matters under rotation</h2>');
    p.push('<p>Nearest TRIANGLE SURFACE distance from the true box corner (mm). Axis-aligned phases are step-insensitive (three orthogonal planes); the 20&deg; rotated row is where a normal-step change moves the answer, so it is measured per variant, not inferred from the axis-aligned results.</p>');
    p.push('<table style="border-collapse:collapse;font:12px/1.4 monospace"><tr><th style="padding:2px 8px">cell mm</th><th>phase</th><th>rot&deg;</th><th>baseline surf mm</th><th>candidate surf mm</th><th>baseline eps mm</th><th>candidate eps mm</th></tr>');
    for (const cell of extras.candidateSensitivity) {
      for (const r of cell.rows) {
        const b = r.dc['dc-baseline']; const c = r.dc['dc-eps-candidate'];
        p.push(`<tr><td style="padding:2px 8px">${mm(cell.cell)}</td><td>${JSON.stringify(r.phaseCells)}</td><td>${r.rotationDeg}</td><td>${b ? b.surfaceMm.toFixed(3) : '&mdash;'}</td><td>${c ? c.surfaceMm.toFixed(3) : '&mdash;'}</td><td>${b ? b.normalEpsilonMm.toFixed(2) : '&mdash;'}</td><td>${c ? c.normalEpsilonMm.toFixed(2) : '&mdash;'}</td></tr>`);
      }
    }
    p.push('</table>');
  }
  if (extras.referenceConvergence && extras.referenceConvergence.length > 0) {
    p.push('<h2>reference-resolution convergence @ 10 mm (pit metrics)</h2>');
    p.push('<p>r2t p95 (mm) with the 0.2&nbsp;mm reference vs a finer 0.1&nbsp;mm reference. A stable candidate/baseline ratio is what lets the improvement be quoted.</p>');
    p.push('<table style="border-collapse:collapse;font:12px/1.4 monospace"><tr><th style="padding:2px 8px">region</th><th>baseline 0.2</th><th>baseline 0.1</th><th>candidate 0.2</th><th>candidate 0.1</th><th>ratio 0.2</th><th>ratio 0.1</th></tr>');
    for (const r of extras.referenceConvergence) {
      p.push(`<tr><td style="padding:2px 8px">${r.id}</td><td>${r.baseline.coarse.r2tP95Mm.toFixed(3)}</td><td>${r.baseline.fine.r2tP95Mm.toFixed(3)}</td><td>${r.candidate.coarse.r2tP95Mm.toFixed(3)}</td><td>${r.candidate.fine.r2tP95Mm.toFixed(3)}</td><td>${r.candidateOverBaseline.coarseR2tP95.toFixed(2)}x</td><td>${r.candidateOverBaseline.fineR2tP95.toFixed(2)}x</td></tr>`);
    }
    p.push('</table>');
  }
  p.push('</body></html>');
  return p.join('\n');
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return realpathSync(entry) === realpathSync(new URL(import.meta.url).pathname); } catch { return false; }
})();
if (invokedDirectly) main();

export { parseArgs, previewHtml, HELP };
