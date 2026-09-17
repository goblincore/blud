// scripts/tmp/tstart-ab.mjs — temporal-start aggressiveness A/B (2026-09-10
// follow-up to docs/superpowers/plans/2026-09-10-temporal-march-start.md).
//
// Firefight passes-mode bench (room 4, walk/fire/gib), interleaved legs,
// fresh page per leg-run, load gate — the discipline of
// scripts/lib/sdf-closeup-stage.mjs without its close-up staging (the
// firefight scenario stages itself).
//
// Legs:
//   off      — temporal start disabled (?tstart=0 equivalent)
//   pinned   — temporal start on, margin PINNED at the shipped 0.25
//              (adaptive off): isolates the shader-side changes (bodyEntry
//              fold + recovery probes) from the adaptive margin
//   adaptive — temporal start on, adaptive margin (the full new behaviour)
//
// Usage: node scripts/tmp/tstart-ab.mjs <vitePort> <cdpPort> [reps]
import { loadavg } from 'node:os';
import { connectGame, bootCloseupPage, applyShipDefaults, sleep, passesLoadGate } from '../lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? 5299);
const CDP = Number(process.argv[3] ?? 9299);
const REPS = Number(process.argv[4] ?? 4);
const OUT = process.env.TSTART_OUT ?? '/tmp/sdf-tstart-ab/rows.json';

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const WATCHDOG_MIN = 30;
setTimeout(() => { console.error(`FAIL: watchdog (${WATCHDOG_MIN} min)`); process.exit(3); }, WATCHDOG_MIN * 60_000).unref();

const LEGS = {
  off:      `__sdfGame.setTemporalStart(false)`,
  pinned:   `__sdfGame.setTemporalStart(true, 0.25)`,
  adaptive: `__sdfGame.setTemporalStart(true)`,
};
// TSTART_LEGS=off,pinned — subset run (e.g. the old-shader baseline build,
// whose __sdfGame.temporalStart lacks the adaptiveMargin key).
const LEG_NAMES = (process.env.TSTART_LEGS ?? 'off,pinned,adaptive').split(',').filter((k) => k in LEGS);
if (LEG_NAMES.length === 0) fail(`TSTART_LEGS matched no known leg`);
// TSTART_BENCH='{"walkFrames":600}' — extends the bench scenario args (JSON
// object interpolated into the call; room 4 is the default).
const BENCH_ARGS = JSON.stringify({ room: 4, ...(process.env.TSTART_BENCH ? JSON.parse(process.env.TSTART_BENCH) : {}) });

const conn = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800 });
const evaluate = conn.evaluate;

const runLeg = async (leg, rep) => {
  await bootCloseupPage({ send: conn.send, evaluate, url: `http://localhost:${VITE}/sdf-game.html` });
  await applyShipDefaults(evaluate);
  await evaluate(`(async () => { ${LEGS[leg]} })()`);
  // Confirm the leg actually took (the seam returns the layer's view).
  const ts = await evaluate('__sdfGame.temporalStart');
  if (!ts || typeof ts.on !== 'boolean') fail(`leg ${leg}: could not read temporalStart state`);
  if (ts.on !== (leg !== 'off')) fail(`leg ${leg}: temporalStart.on is ${ts.on}, expected ${leg !== 'off'}`);
  if (leg === 'pinned' && ts.adaptiveMargin !== false) fail(`leg pinned: adaptive margin still on`);
  if (leg === 'adaptive' && ts.adaptiveMargin !== true) fail(`leg adaptive: adaptive margin off`);
  await evaluate('__sdfGame.step(30)');
  const loadStart = loadavg()[0];
  await evaluate(`__sdfGame.bench({ mode: 'passes', ...(${BENCH_ARGS}), label: ${JSON.stringify(`${leg}-r${rep}`)} })`, 300_000);
  const r = JSON.parse(await evaluate('JSON.stringify(window.__gameBench)'));
  if (!r.valid) fail(`${leg} rep${rep}: ${r.hiddenSteps} hidden steps — INVALID`);
  if (!r.passes?.available) fail(`${leg} rep${rep}: pass timings unavailable (no timestamp tracking?)`);
  const march = {};
  for (const seg of r.passes.segments) {
    const m = seg.labels['sdf:march'];
    march[seg.name] = m ? { p50: m.p50, p95: m.p95, mean: m.mean, n: m.n } : null;
  }
  // Scene census per segment (throughput summaries carry it even in passes
  // mode): the 2026-09-10 lesson — an on-run with fewer bodies reads faster
  // for the wrong reason.
  const census = {};
  for (const seg of r.segments ?? []) {
    census[seg.name] = seg.census?.last?.bodies ?? null;
  }
  const row = {
    rep, leg, temporalStart: ts, loadStart, census,
    load1: loadavg()[0],
    march,
    spanWalk: r.passes.segments.find((s) => s.name === 'walk')?.span?.p50 ?? null,
  };
  console.log(`  rep${rep} ${leg}: ` + Object.entries(march).map(([k, v]) => `${k} ${v ? v.p50.toFixed(2) : '—'}`).join('  ') + `  ms  bodies ${census.walk ?? '?'}  load ${row.load1.toFixed(1)}`);
  return row;
};

const rows = [];
for (let rep = 0; rep < REPS; rep++) {
  const names = LEG_NAMES;
  const order = names.map((_, i) => names[(i + rep) % names.length]);
  for (const leg of order) {
    let row = null;
    for (let attempt = 0; attempt < 2 && !row; attempt++) {
      try {
        row = await runLeg(leg, rep);
      } catch (e) {
        if (attempt === 1) fail(`${leg} rep${rep}: ${String(e).slice(0, 300)}`);
        console.warn(`  [retry] ${leg} rep${rep}: ${String(e).slice(0, 160)}`);
      }
    }
    // Load gate REPORTED, not enforced: this is an attended session run;
    // rows carry load1 so a hot leg can be excluded when quoting.
    if (!passesLoadGate(row, { maxRise: 8.0, maxAbs: 24.0 })) {
      row.hot = true;
      console.warn(`  [hot] ${leg} rep${rep}: load1 ${row.load1.toFixed(1)} (start ${row.loadStart.toFixed(1)}) — exclude when quoting`);
    }
    rows.push(row);
    await sleep(2000); // cool between legs
  }
}

const { writeFileSync, mkdirSync } = await import('node:fs');
mkdirSync(OUT.slice(0, OUT.lastIndexOf('/')), { recursive: true });
writeFileSync(OUT, JSON.stringify(rows, null, 2));

// Per-leg medians per segment, and per-rep pairing.
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
console.log(`\nrows: ${OUT}`);
for (const segName of ['walk', 'fire', 'gib']) {
  console.log(`\nsdf:march ${segName} p50 (ms):`);
  for (const leg of LEG_NAMES) {
    const rs = rows.filter((r) => r.leg === leg);
    const vals = rs.map((r) => r.march[segName]?.p50).filter((v) => v != null);
    console.log(`  ${leg.padEnd(9)} med ${vals.length ? med(vals).toFixed(2) : '—'}  all [${vals.map((v) => v.toFixed(2)).join(', ')}]`);
  }
}
console.log('\nper-rep pairing (walk):');
for (let rep = 0; rep < REPS; rep++) {
  const line = LEG_NAMES.map((leg) => {
    const r = rows.find((x) => x.rep === rep && x.leg === leg);
    return `${leg} ${r?.march.walk?.p50?.toFixed(2) ?? '—'}`;
  }).join('  ');
  console.log(`  rep${rep}: ${line}`);
}
process.exit(0);
