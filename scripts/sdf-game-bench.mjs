// scripts/sdf-game-bench.mjs — the honest perf baseline for sdf-game.html.
//
// No-deps CDP, same plumbing as scripts/sdf-game.mjs. Drives __sdfGame.bench
// (see src/lab/sdf-zombie/webgpu/game-bench.ts) across a matrix of ablation
// legs and rooms, then a spike pass.
//
// THREE RULES THIS SCRIPT EXISTS TO ENFORCE:
//
//   1. LEGS ALTERNATE. Running leg A five times and then leg B five times
//      measures the thermal ramp as much as the change. A B A B A B does not.
//   2. LEGS RESET FIRST. Every leg re-applies ship defaults before its own
//      overrides, so a leg cannot inherit the previous one's state.
//   3. A HIDDEN PAGE IS AN INVALID RUN, not a fast one. A hidden page has no
//      swapchain texture, so the passes do nothing and the fence resolves to
//      ~0.065 ms — which reads as a 70x speedup. The harness counts hidden
//      frames; this script fails the run on any of them.
//
// Usage: LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 node scripts/sdf-game-bench.mjs
// (or scripts/sdf-game-bench.sh, which owns the vite + Chrome lifecycle)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5277);
const CDP = Number(process.argv[3] ?? 9277);
const OUT = process.env.BENCH_OUT ?? '/tmp/sdf-game-bench';
const W = Number(process.env.GAME_W ?? 1280);
const H = Number(process.env.GAME_H ?? 800);
const REPEATS = Number(process.env.BENCH_REPEATS ?? 3);
const ROOM_IDS = (process.env.BENCH_ROOMS ?? '1,2,3,4').split(',').map(Number);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

mkdirSync(OUT, { recursive: true });

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' }); } catch {}
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({
      type: m.params.type,
      text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
    });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, timeoutMs = 300_000) => {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs,
  });
  if (r.result?.exceptionDetails) {
    fail(`page threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
  }
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: 1, mobile: false,
});

const url = `http://localhost:${VITE}/sdf-game.html`;
console.log(`bench ${url}  (${W}x${H}, repeats=${REPEATS}, rooms=${ROOM_IDS.join(',')})`);
await send('Page.navigate', { url });

let backend = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
  if (backend) break;
}
if (!backend) {
  console.error('console tail:', consoleEvents.slice(-8));
  fail('game page never booted (__sdfGame absent)');
}
if (backend !== 'webgpu') fail(`backend is ${backend}, not webgpu — a WebGL fallback bench means nothing here`);
console.log('backend: webgpu');

// Settle: let the boot loop render and the shaders finish compiling before
// anything is timed. First-use pipeline stalls are real and would land
// entirely in whichever leg happened to run first.
await sleep(5000);

// ---------------------------------------------------------------------------
// The legs. Each is a named set of overrides applied on top of ship defaults.
// ---------------------------------------------------------------------------
const LEGS = {
  baseline: {},
  'occluder-off': { setOccluder: false },
  'cone-on': { setCone: true },
  'fxaa-off': { setFxaa: false },
  'scale-0.7': { setSdfScale: 0.7 },
  'scale-0.5': { setSdfScale: 0.5 },
};

async function applyLeg(name) {
  // Ship defaults first, so legs cannot contaminate each other.
  await evaluate(`(() => {
    __sdfGame.setOccluder(true);
    __sdfGame.setCone(false);
    __sdfGame.setFxaa(true);
    __sdfGame.setSdfScale(1.0);
    __sdfGame.setAdaptive(false);
    return 1;
  })()`);
  for (const [fn, arg] of Object.entries(LEGS[name])) {
    await evaluate(`__sdfGame.${fn}(${JSON.stringify(arg)})`);
  }
}

// Warmup is deliberately long. Switching a leg reallocates render targets
// (a scale change) and rebuilds pipelines, and 40 frames does not absorb it —
// the first smoke run put that cost squarely in the walk segment and made
// every leg's walk column its own setup cost. 120 frames is two seconds.
const WARMUP = Number(process.env.BENCH_WARMUP ?? 120);
// Small chunks so a segment yields enough samples for a percentile to mean
// anything. 120 frames / 10 = 12 samples per segment; at the old 20 the p95
// index landed on the last element, i.e. it WAS the max.
const CHUNK = Number(process.env.BENCH_CHUNK ?? 10);

async function runLeg(name, room, mode) {
  await applyLeg(name);
  const label = `${name}/room${room}/${mode}`;
  const opts = mode === 'spike'
    ? `{ room: ${room}, mode: "spike", warmup: ${WARMUP}, label: ${JSON.stringify(label)} }`
    : `{ room: ${room}, mode: "throughput", warmup: ${WARMUP}, chunkFrames: ${CHUNK}, label: ${JSON.stringify(label)} }`;
  await evaluate(`__sdfGame.bench(${opts})`);
  const raw = await evaluate('JSON.stringify(window.__gameBench)');
  const r = JSON.parse(raw);
  if (!r.valid) fail(`${label}: ${r.hiddenSteps} hidden frames — INVALID (a hidden page renders nothing)`);
  return r;
}

// ---------------------------------------------------------------------------
// 1. THROUGHPUT MATRIX — the comparison numbers.
// ---------------------------------------------------------------------------
const results = [];
for (let rep = 0; rep < REPEATS; rep++) {
  for (const leg of Object.keys(LEGS)) {
    for (const room of ROOM_IDS) {
      const r = await runLeg(leg, room, 'throughput');
      results.push({ rep, leg, room, ...r });
      process.stdout.write(`  rep${rep} ${leg} room${room}: median ${r.overall.p50.toFixed(2)} ms (max chunk ${r.overall.max.toFixed(2)})\n`);
    }
  }
}

// Median across repeats, not mean: one thermal outlier should not move the
// reported number.
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const table = [];
for (const leg of Object.keys(LEGS)) {
  for (const room of ROOM_IDS) {
    const rs = results.filter((r) => r.leg === leg && r.room === room);
    if (!rs.length) continue;
    // MEDIAN of chunk means, not p95. A throughput segment yields ~12
    // samples; a p95 over 12 is an order statistic one element from the top,
    // which is a max wearing a percentile's name. The spike pass below is
    // where p95 is answered, on real per-frame samples.
    const seg = (n) => med(rs.map((r) => r.segments.find((s) => s.name === n).p50));
    table.push({
      leg, room, bodies: room,
      overallP50: med(rs.map((r) => r.overall.p50)),
      overallMax: med(rs.map((r) => r.overall.max)),
      walkP50: seg('walk'), fireP50: seg('fire'), gibP50: seg('gib'),
    });
  }
}

// ---------------------------------------------------------------------------
// 2. SPIKE PASS — baseline only. NOT comparable to the table above: fencing
//    every frame drains the queue and lets the GPU clock down between frames.
//    Read the max/p50 RATIO, which is what says whether a moment blows up.
// ---------------------------------------------------------------------------
const spikes = [];
for (const room of ROOM_IDS) {
  const r = await runLeg('baseline', room, 'spike');
  spikes.push({ room, ...r });
  process.stdout.write(`  spike room${room}: p50 ${r.overall.p50.toFixed(2)} max ${r.overall.max.toFixed(2)} ms\n`);
}

writeFileSync(`${OUT}/bench.json`, JSON.stringify({
  meta: { url, W, H, repeats: REPEATS, rooms: ROOM_IDS, backend, when: new Date().toISOString() },
  results, table, spikes,
}, null, 2));

const lines = [];
lines.push('');
lines.push('## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats');
lines.push('');
lines.push('| leg | room | spawned | overall | walk | fire | gib | worst chunk |');
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const t of table) {
  lines.push(`| ${t.leg} | ${t.room} | ${t.bodies} | ${t.overallP50.toFixed(2)} | ${t.walkP50.toFixed(2)} | ${t.fireP50.toFixed(2)} | ${t.gibP50.toFixed(2)} | ${t.overallMax.toFixed(2)} |`);
}
lines.push('');
lines.push('## Census — what was ON SCREEN while those numbers were taken');
lines.push('');
lines.push('A cost column is unreadable without this. Read `bodies` first: if it');
lines.push('falls through the run, the cheap segments were timing an empty room.');
lines.push('');
lines.push('| room | segment | bodies in→out | wounds in→out | chunks in→out |');
lines.push('| ---: | --- | ---: | ---: | ---: |');
for (const room of ROOM_IDS) {
  const r = results.find((x) => x.leg === 'baseline' && x.room === room);
  if (!r) continue;
  for (const seg of r.segments) {
    if (!seg.census) continue;
    const { first: a, last: b } = seg.census;
    lines.push(`| ${room} | ${seg.name} | ${a.bodies}→${b.bodies} | ${a.wounds}→${b.wounds} | ${a.chunks}→${b.chunks} |`);
  }
}
lines.push('');
lines.push('## Spike (fenced per frame, baseline only) — ratios within a run ONLY');
lines.push('');
lines.push('| room | bodies | p50 | p95 | max | max/p50 | worst segment |');
lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | --- |');
for (const s of spikes) {
  const worst = [...s.segments].sort((a, b) => b.max - a.max)[0];
  lines.push(`| ${s.room} | ${s.room} | ${s.overall.p50.toFixed(2)} | ${s.overall.p95.toFixed(2)} | ${s.overall.max.toFixed(2)} | ${(s.overall.max / s.overall.p50).toFixed(1)}x | ${worst.name} (${worst.max.toFixed(1)} ms) |`);
}
lines.push('');

const report = lines.join('\n');
console.log(report);
writeFileSync(`${OUT}/bench.md`, report);
console.log(`wrote ${OUT}/bench.json and ${OUT}/bench.md`);
process.exit(0);
