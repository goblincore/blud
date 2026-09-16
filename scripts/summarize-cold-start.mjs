// scripts/summarize-cold-start.mjs — compact the cold-start probe records into
// a committable evidence set (2026-09-16 playtest follow-ups, task 1).
//
// Reads the probe's full `<run>.json` records from one directory and writes:
//   * `matrix.json` — one row per load with the fields a before/after claim
//     needs (readiness, spawn-block delta, mesh extraction, body-build memo,
//     long tasks, resources);
//   * `<run>.compact.json` — the full record minus the multi-megabyte raw
//     per-load `raf` arrays (already stripped by the probe);
// and prints a markdown table on stdout.
//
// Usage: node scripts/summarize-cold-start.mjs <probeDir> [outDir]
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.argv[2] ?? '.lab-tmp/cold-start';
const OUT = process.argv[3] ?? SRC;

const rows = [];
const compact = {};
for (const f of readdirSync(SRC).filter((n) => n.endsWith('.json') && !n.endsWith('.compact.json') && n !== 'matrix.json').sort()) {
  const d = JSON.parse(readFileSync(join(SRC, f), 'utf8'));
  const label = d.label ?? f.replace(/\.json$/, '');
  compact[label] = { ...d, samples: (d.samples ?? []).map((s) => ({
    ...s,
    // keep the profile summary (small) but never the raw samples array
    profile: s.profile ? { ...s.profile, top: (s.profile.top ?? []).slice(0, 24) } : s.profile,
  })) };
  for (const s of d.samples ?? []) {
    const md = s.markDeltas ?? {};
    const wp = s.warm?.phases ?? {};
    rows.push({
      run: label,
      load: s.load,
      mode: s.mode,
      backendMs: s.backendWallMs,
      warmMs: s.warmWallMs,
      readyMs: s.readyWallMs,
      spawnBlockMs: md['room-probes-start->player-start'] ?? null,
      meshSyncMs: md['mesh-sync-start->mesh-sync-end'] ?? null,
      drawOnceMs: wp.drawOnce != null ? Math.round(wp.drawOnce) : null,
      precompileMs: wp.precompile != null ? Math.round(wp.precompile) : null,
      bodyBuildMs: s.bodyBuild?.buildMs ?? null,
      bodyBuildMisses: s.bodyBuild?.misses ?? null,
      bodyBuildHits: s.bodyBuild?.hits ?? null,
      meshExtractMs: s.skeletonMesh?.cacheStats?.extractMs ?? null,
      meshExtractCount: s.skeletonMesh?.cacheStats?.extractCount ?? null,
      meshMaxKey: s.skeletonMesh?.cacheStats?.maxExtractKey ?? null,
      resourceCount: s.resources?.count ?? null,
      transferSize: s.resources?.transferSize ?? null,
      longTasks: s.longTasks?.n ?? null,
      longTaskTotalMs: s.longTasks?.totalMs ?? null,
      postReadyP50: s.postReadyFrames?.p50 ?? null,
      postReadyMax: s.postReadyFrames?.max ?? null,
      gpuLost: s.gpuDiagnostics?.lost ?? false,
      uncaptured: s.gpuDiagnostics?.uncapturedCount ?? null,
      warmGate: s.warmGate?.phase ?? null,
      pageErrors: (s.pageErrors ?? []).length,
    });
  }
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'matrix.json'), JSON.stringify(rows, null, 2));
for (const [label, d] of Object.entries(compact)) {
  writeFileSync(join(OUT, `${label}.compact.json`), JSON.stringify(d, null, 2));
}

const hdr = ['run','load','mode','backendMs','warmMs','readyMs','spawnBlockMs','meshSyncMs','drawOnceMs','precompileMs','bodyBuildMs','bbMiss','meshExtractMs','longTaskTotalMs','postReadyMax','gpuLost'];
console.log('| ' + hdr.join(' | ') + ' |');
console.log('|' + hdr.map(() => '---').join('|') + '|');
for (const r of rows) {
  console.log('| ' + hdr.map((h) => r[h] ?? '').join(' | ') + ' |');
}
console.log(`\n${rows.length} load rows from ${Object.keys(compact).length} runs; wrote matrix.json + ${Object.keys(compact).length} compact records to ${OUT}`);
