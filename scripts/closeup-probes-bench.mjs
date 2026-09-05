// scripts/closeup-probes-bench.mjs — close-up task 2: the interleaved A/B
// for the shading-normal modes (perfCfg.z).
//
// Scene: the WOUNDED fill-screen staging (task 1b's mandate — everything in
// this program is measured on the wounded scene, which stageCloseUp +
// stampFacingWounds IS). Legs, applied per run through runInterleaved's
// legJs hook before staging:
//   stencil — perfCfg.z 0, the tetrahedron stencil (the shipped behaviour)
//   forward — perfCfg.z 1, the 3-tap forward difference (one eval of six)
//   deriv   — perfCfg.z 2 (saved for the record; the look pass already
//             no-shipped it — its row documents what the saving would have
//             had to buy)
//
// Discipline inherited wholesale: fresh page per run, interleave rotation,
// load gate (reject + makeup, never average through), crash retry,
// `uptime` on every row, staging records quoted. Compare legs only WITHIN a
// rep index (GPU clock state swings within a run — see the task-4 warning).
//
// Usage: node scripts/closeup-probes-bench.mjs <vite> <cdp>
import { mkdirSync, writeFileSync } from 'node:fs';
import { runInterleaved } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? 5399);
const CDP = Number(process.argv[3] ?? 9399);
const OUT = process.env.PROBES_BENCH_OUT ?? '/tmp/sdf-probes-bench';
const REPEATS = Number(process.env.BENCH_REPEATS ?? 5);
const THRESH = process.env.PROBES_THRESH ?? '0.02';

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const WATCHDOG_MIN = Number(process.env.BENCH_WATCHDOG_MIN ?? (REPEATS + 3) * 6 + 5);
setTimeout(() => { console.error(`FAIL: watchdog (${WATCHDOG_MIN} min)`); process.exit(3); }, WATCHDOG_MIN * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const url = `http://localhost:${VITE}/sdf-game.html?frozen=1`;
console.log(`closeup-probes-bench ${url}  (repeats=${REPEATS}, deriv thresh=${THRESH})`);

const LEGS = {
  stencil: { wounds: true, legJs: `__sdfGame.setNormalMode(0);` },
  forward: { wounds: true, legJs: `__sdfGame.setNormalMode(1);` },
  deriv:   { wounds: true, legJs: `__sdfGame.setNormalMode(2, ${THRESH});` },
};

let out;
try {
  out = await runInterleaved(LEGS, REPEATS, {
    url,
    vite: VITE, cdp: CDP, width: 1280, height: 800,
    benchArgs: { closeupFrames: 240 },
    wounds: { minStamped: 3 },
    crashRetries: 3,
    loadGate: { maxRise: 8.0, maxAbs: 24.0 },
    minKept: REPEATS,
    makeupCap: 3,
    onRow: async (row) => {
      process.stdout.write(`  rep${row.rep} ${row.leg}: p50 ${row.p50.toFixed(2)} ms  p95 ${row.p95.toFixed(2)}  cov ${(row.coverage * 100).toFixed(0)}%  wounds ${row.wounds}  dist ${row.dist}  uptime ${row.uptime.toFixed(0)}s  load ${row.load1Start.toFixed(1)}→${row.load1.toFixed(1)}\n`);
    },
  });
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
const { rows, stagingRecords, crashRetries, loadRejected, makeupReps, kept } = out;
console.log(`\nstability: kept ${JSON.stringify(kept)}  crashRetries ${crashRetries}  loadRejected ${loadRejected}  makeupReps ${makeupReps}`);

// Per-leg medians AND per-rep-index pairing (the GPU-clock rule: compare
// within a rep, never medians of raw p50 alone).
const legs = Object.keys(LEGS);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const summary = {};
for (const leg of legs) {
  const rs = rows.filter((r) => r.leg === leg);
  summary[leg] = {
    n: rs.length,
    p50median: med(rs.map((r) => r.p50)),
    perRep: Object.fromEntries(rs.map((r) => [r.rep, r.p50])),
    meanStepsHit: med(rs.map((r) => r.meanStepsHit)),
    missStepShare: med(rs.map((r) => r.missStepShare)),
  };
}
const fwdDelta = summary.forward.p50median - summary.stencil.p50median;
const fwdPct = (fwdDelta / summary.stencil.p50median) * 100;
const drvDelta = summary.deriv.p50median - summary.stencil.p50median;
const drvPct = (drvDelta / summary.stencil.p50median) * 100;
console.log(`\nstencil p50(med) ${summary.stencil.p50median.toFixed(2)} ms  (n ${summary.stencil.n})`);
console.log(`forward p50(med) ${summary.forward.p50median.toFixed(2)} ms  (n ${summary.forward.n})  delta ${fwdDelta.toFixed(2)} (${fwdPct.toFixed(1)}%)`);
console.log(`deriv   p50(med) ${summary.deriv.p50median.toFixed(2)} ms  (n ${summary.deriv.n})  delta ${drvDelta.toFixed(2)} (${drvPct.toFixed(1)}%)`);
console.log(`\nper-rep pairing (stencil vs forward within each rep):`);
for (const r of rows.filter((q) => q.leg === 'stencil')) {
  const f = rows.find((q) => q.leg === 'forward' && q.rep === r.rep);
  if (f) console.log(`  rep${r.rep}: stencil ${r.p50.toFixed(2)}  forward ${f.p50.toFixed(2)}  delta ${(f.p50 - r.p50).toFixed(2)} (${(((f.p50 - r.p50) / r.p50) * 100).toFixed(1)}%)`);
}
writeFileSync(`${OUT}/rows.json`, JSON.stringify({ rows, stagingRecords, summary, crashRetries, loadRejected, makeupReps, kept }, null, 2));
console.log(`\nrows written to ${OUT}/rows.json`);
