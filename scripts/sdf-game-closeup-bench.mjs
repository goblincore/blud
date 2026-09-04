// scripts/sdf-game-closeup-bench.mjs — QUESTION A of the close-up
// diagnostics (2026-09-04): at fill-screen, is the frame marching or
// shading?
//
// Scene: ONE body (room 1) filling the screen, WOUNDED (stamped craters on
// the camera-facing side), frozen (?frozen=1 boot + freeze(true) in the
// scenario), no blood particles (spillChance 0 — the goo layer is task 4's
// target and a live sim would only add cross-run noise to the split).
//
// Legs (interleaved, fresh page per run):
//   normal   — wounded,  seam off   → the frame
//   flat     — wounded,  seam on    → the walk + crater path, shading skipped
//   normal0  — clean,    seam off   → the frame without wounds
//   flat0    — clean,    seam on    → the walk alone, no crater path
//
//   shading share        = (normal - flat) / normal
//   wound total          = (normal - normal0) / normal
//   wound walk-side      = (flat - flat0) / normal
//   wound shading-side   = (normal0 - flat0) / normal
//
// Ship defaults are pinned and quoted; the one deliberate departure from
// the shipped state is the occluder pre-pass (ships disabled; the older
// perf harness's applyLeg turned it ON — this scene is the owner's play
// state, so it stays off) and spillChance 0 (above).
//
// TASK 1B (2026-09-04): the harness below the legs — tab lifecycle, the
// ship-default pin, the staging search, the wound stamp and the interleaved
// fresh-page loop — moved verbatim into scripts/lib/sdf-closeup-stage.mjs so
// tasks 2-5 import the same staging instead of re-deriving it. This file is
// now the thin caller: leg table, run, summarise. The staging record it
// writes is byte-identical to the pre-extraction script's (proven by diff,
// see the task report).
//
// Usage: LAB_VITE_PORT=5377 LAB_CDP_PORT=9377 node scripts/sdf-game-closeup-bench.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  connectGame, bootCloseupPage, applyShipDefaults, stageCloseUp,
  stampFacingWounds, runInterleaved,
} from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? 5377);
const CDP = Number(process.argv[3] ?? 9377);
const OUT = process.env.BENCH_OUT ?? '/tmp/sdf-closeup';
const REPEATS = Number(process.env.BENCH_REPEATS ?? 5);
const W = 1280, H = 800;
const TARGET_COVERAGE = Number(process.env.COVERAGE_MIN ?? 0.5);
const WOUND_COUNT = Number(process.env.WOUNDS ?? 5);

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (25 min)'); process.exit(3); }, 1_500_000).unref();

mkdirSync(OUT, { recursive: true });

const url = `http://localhost:${VITE}/sdf-game.html?frozen=1`;
console.log(`closeup-bench ${url}  (${W}x${H}, repeats=${REPEATS}, wounds=${WOUND_COUNT})`);

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: W, height: H, onFail: fail });

const LEGS = {
  normal:   { wounds: true,  flat: false },
  flat:     { wounds: true,  flat: true },
  normal0:  { wounds: false, flat: false },
  flat0:    { wounds: false, flat: true },
};

const { rows: results, stagingRecords } = await runInterleaved(LEGS, REPEATS, {
  url,
  send,
  evaluate,
  benchArgs: { closeupFrames: 240 },
  wounds: { minStamped: 3 },  // the original's loud floor (WOUNDS only labels meta)
  onRow: async (row) => {
    process.stdout.write(`  rep${row.rep} ${row.leg}: p50 ${row.p50.toFixed(2)} ms  cov ${(row.coverage * 100).toFixed(0)}%  wounds ${row.wounds}  dist ${row.dist}  uptime ${row.uptime.toFixed(0)}s\n`);
  },
});

// ---- summarise -------------------------------------------------------------
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const summary = {};
for (const leg of Object.keys(LEGS)) {
  const rs = results.filter((r) => r.leg === leg);
  const vals = rs.map((r) => r.p50);
  summary[leg] = {
    p50: med(vals), min: Math.min(...vals), max: Math.max(...vals),
    spreadPct: ((Math.max(...vals) - Math.min(...vals)) / Math.min(...vals)) * 100,
    coverage: med(rs.map((r) => r.coverage)),
    dist: med(rs.map((r) => r.dist)),
    wounds: rs[0].wounds,
    meanStepsHit: med(rs.map((r) => r.meanStepsHit)),
  };
}
const N = summary.normal.p50;
const pct = (x) => +((x / N) * 100).toFixed(1);
const split = {
  frame: pct(N),
  walkAloneWithCraters: pct(summary.flat.p50),
  shadingShare: pct(N - summary.flat.p50),
  frameNoWounds: pct(summary.normal0.p50),
  walkAloneNoWounds: pct(summary.flat0.p50),
  woundTotal: pct(N - summary.normal0.p50),
  woundWalkSide: pct(summary.flat.p50 - summary.flat0.p50),
  woundShadingSide: pct(summary.normal0.p50 - summary.flat0.p50),
};

writeFileSync(`${OUT}/closeup-bench.json`, JSON.stringify({
  meta: { url, W, H, repeats: REPEATS, targetCoverage: TARGET_COVERAGE, wounds: WOUND_COUNT, when: new Date().toISOString() },
  results, stagingRecords, summary, split,
}, null, 2));

console.log('\n## Close-up split (p50 of chunk means, median of reps)');
for (const [leg, s] of Object.entries(summary)) {
  console.log(`  ${leg.padEnd(8)} p50 ${s.p50.toFixed(2)} ms  [${s.min.toFixed(2)}..${s.max.toFixed(2)}]  spread ${s.spreadPct.toFixed(1)}%  cov ${(s.coverage * 100).toFixed(0)}%  dist ${s.dist}m  wounds ${s.wounds}  steps/hit ${s.meanStepsHit.toFixed(1)}`);
}
console.log('\n## Split, % of the wounded close-up frame');
for (const [k, v] of Object.entries(split)) console.log(`  ${k.padEnd(24)} ${v}%`);
console.log(`\nwrote ${OUT}/closeup-bench.json`);
process.exit(0);
