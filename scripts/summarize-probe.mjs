// Summarize startup-freeze-probe JSON records for matched before/after sets.
// Usage: node scripts/summarize-probe.mjs <dir> <prefix> [n]
import { readFileSync } from 'node:fs';

const dir = process.argv[2];
const prefix = process.argv[3];
const n = Number(process.argv[4] ?? 3);

const med = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);

const runs = [];
for (let i = 1; i <= n; i++) {
  try { runs.push(JSON.parse(readFileSync(`${dir}/${prefix}${i}.json`, 'utf8'))); }
  catch (e) { console.error(`missing ${prefix}${i}: ${e.message}`); }
}
if (!runs.length) process.exit(1);

const warm = runs.map((r) => r.warm?.ms);
const bootWall = runs.map((r) => r.warmWallMs);
const drawOnce = runs.map((r) => r.warm?.phases?.drawOnce);
const precompile = runs.map((r) => r.warm?.phases?.precompile);

const blastCreations = runs.map((r) => r.repeatedBlasts?.totalPipelinesCreated);
const blastP95 = runs.map((r) => r.repeatedBlasts?.maxP95);
const blastMax = runs.map((r) => r.repeatedBlasts?.maxFrameMs);
const blastLong = runs.map((r) => r.repeatedBlasts?.longFrames);
const shotCreations = runs.map((r) => r.repeatedShots?.totalPipelinesCreated);
const shotP95 = runs.map((r) => r.repeatedShots?.maxP95);
const shotMax = runs.map((r) => r.repeatedShots?.maxFrameMs);

const rebuilds = runs.map((r) => (r.pipelineLog?.rebuilds ?? []).reduce((a, b) => a + b.count, 0));
const evictions = runs.map((r) => r.pipelineLog?.evictions?.total);
const shaderModules = runs.map((r) => r.pipelineLog?.shaderModules);
const longFrames = runs.map((r) => r.pipelineLog?.longFrames ?? []);
const longWithCreations = longFrames.map((fs) => fs.filter((f) => f.creations > 0).length);
const longNoCreations = longFrames.map((fs) => fs.filter((f) => f.creations === 0).length);

// steady-state gather by cumulative spawn level
const levels = {};
for (const r of runs) {
  for (const s of r.probeStress ?? []) {
    const k = s.requested;
    (levels[k] ??= []).push({ rows: s.post?.capsules, steady: s.steadyFrames?.p95, steadyMax: s.steadyFrames?.max, spawn: s.spawnFrames?.p95, err: s.post?.errors });
  }
}

const out = {
  set: `${prefix} (${runs.length} runs)`,
  load: runs.map((r) => r.consoleTail?.[0] ?? null),
  warmMs: warm, warmMedian: med(warm),
  navToWarmWallMs: bootWall, bootDrawOnce: drawOnce, bootPrecompile: precompile,
  repeatedShots: { creations: shotCreations, p95: shotP95, max: shotMax },
  repeatedBlasts: { creations: blastCreations, p95: blastP95, max: blastMax, longFrames: blastLong },
  blastWindowsP95: runs.map((r) => (r.repeatedBlasts?.perWindow ?? []).map((w) => w.p95)),
  rebuildCountSum: rebuilds,
  evictions: evictions,
  longFramesTotal: longFrames.map((f) => f.length),
  longFramesWithCreations: longWithCreations,
  longFramesNoCreations: longNoCreations,
  descriptorGroups: runs[0].pipelineLog?.descriptorGroups,
  topRebuilds: runs[0].pipelineLog?.rebuilds?.slice(0, 8)?.map((b) => ({ key: b.key, name: b.name, count: b.count, first: b.firstFrame, last: b.lastFrame, objects: b.objects })),
  evictionByObject: runs[0].pipelineLog?.evictions?.byObject,
  shaderModules: shaderModules,
  steady: levels,
  gib: runs.map((r) => ({ firstLive: r.gibTimeline?.firstVisibleChunk?.t, firstBakeSubmit: r.gibTimeline?.firstBakeSubmit?.t, firstSwap: r.gibTimeline?.firstBakeSwap?.t, workerMs: r.gibTimeline?.firstBakeSwap?.lastBakeMs, firstFace: r.gibTimeline?.firstTexturedHeadDraw?.t })),
  lifecycle: runs.map((r) => r.lifecycle),
  warmGate: runs.map((r) => r.warmGate),
  viewport: runs[0].viewport,
  pageErrors: runs.map((r) => r.pageErrors),
  consoleCounts: runs.map((r) => r.consoleCounts),
  probeErrors: runs.map((r) => r.probeHealth?.errors),
  gpuLost: runs.map((r) => r.final?.gpuDiagnostics?.lost ?? null),
};
console.log(JSON.stringify(out, null, 2));
