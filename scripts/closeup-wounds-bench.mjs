// scripts/closeup-wounds-bench.mjs — what the WOUNDS cost a fill-screen frame: the
// 0.6x conservative stepping near craters vs the carve loop itself.
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
const OUT = process.env.WOUNDS_BENCH_OUT ?? '/tmp/sdf-wounds-bench';
const REPEATS = Number(process.env.BENCH_REPEATS ?? 5);
const THRESH = process.env.PROBES_THRESH ?? '0.02';

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const WATCHDOG_MIN = Number(process.env.BENCH_WATCHDOG_MIN ?? (REPEATS + 3) * 6 + 5);
setTimeout(() => { console.error(`FAIL: watchdog (${WATCHDOG_MIN} min)`); process.exit(3); }, WATCHDOG_MIN * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const url = `http://localhost:${VITE}/sdf-game.html?frozen=1`;
console.log(`closeup-wounds-bench ${url}  (repeats=${REPEATS}, deriv thresh=${THRESH})`);

const LEGS = {
  ship:      { wounds: true,  legJs: `__sdfGame.setWoundStepDiag(false);` },
  stepFull:  { wounds: true,  legJs: `__sdfGame.setWoundStepDiag(true);` },
  unwounded: { wounds: false, legJs: `__sdfGame.setWoundStepDiag(false);` },
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
const base = summary.ship.p50median;
for (const leg of legs) { const m = summary[leg].p50median; console.log(`${leg.padEnd(10)} p50(med) ${m.toFixed(2)} ms  (n ${summary[leg].n})${leg === 'ship' ? '' : `  delta ${(m - base).toFixed(2)} (${(((m - base) / base) * 100).toFixed(1)}%)`}`); }
console.log('\nper-rep pairing (within each rep):');
const reps = [...new Set(rows.map((r) => r.rep))].sort((a, b) => a - b);
for (const rep of reps) { const line = legs.map((leg) => { const r = rows.find((x) => x.rep === rep && x.leg === leg); return r ? `${leg} ${r.p50.toFixed(1)}` : `${leg} —`; }).join('  '); console.log(`  rep${rep}: ${line}`); }
console.log(`\nrows written to ${OUT}/rows.json`);
