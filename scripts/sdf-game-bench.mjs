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
// BENCH_PRELUDE — an optional JS expression evaluated in the page AFTER the
// leg's ship-defaults + overrides, right before any timing, so it always
// wins. One prelude per invocation; pair it with BENCH_LEGS to A/B a lever
// the static leg table does not model, e.g. perf round 2 task 9's sweep:
//   BENCH_LEGS=baseline BENCH_PRELUDE='__sdfGame.setOmega(0.6)' ...
// Results rows and meta record it, so a stored bench.json is never ambiguous
// about what state the page was in.
const PRELUDE = process.env.BENCH_PRELUDE ?? '';
// BENCH_PASSES=1 — per-pass GPU timestamp attribution (gpu-pass-timing.ts).
// Runs the matrix in the harness's 'passes' mode: the same fence-per-chunk
// frame timing as throughput, PLUS every render/compute pass summed by its
// site label per frame. Writes passes.md / passes.json and SKIPS the spike
// pass. Pass durations are GPU pass time only (no CPU submit, no gaps), so
// their sum sits below the fenced frame — read SHARES, and read the gap.
const PASSES = process.env.BENCH_PASSES === '1';
// BENCH_QUERY — extra URL query appended to sdf-game.html, for levers gated
// on a page flag (the tile-culling playtest needs `tiles-playtest`).
const QUERY = process.env.BENCH_QUERY ?? '';

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

const url = `http://localhost:${VITE}/sdf-game.html${QUERY ? `?${QUERY}` : ''}`;
console.log(`bench ${url}  (${W}x${H}, repeats=${REPEATS}, rooms=${ROOM_IDS.join(',')}${PRELUDE ? `, prelude: ${PRELUDE}` : ''})`);

/**
 * Load the page fresh.
 *
 * CALLED BEFORE EVERY RUN, and that is not paranoia — it is the fix for the
 * defect that made the 2026-08-31 matrix unreadable. Wounds, severed limbs and
 * collapsed bodies PERSIST on the page: run N inherits every crater run N-1
 * carved. The census caught it (room 3's walk segment opened at `wounds 20`,
 * carried over from room 2's run, with `bodies 0 -> 0` because the survivors
 * had been shot to pieces). Cost then depends on cumulative damage rather than
 * on the leg under test, and identical repeats spread by up to 583%.
 *
 * A reload costs ~10 s. Sharing one page across 76 runs costs the whole
 * measurement.
 */
async function bootPage(settleMs = 5000) {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
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
  // Settle: let the boot loop render and the shaders finish compiling before
  // anything is timed. First-use pipeline stalls are real.
  await sleep(settleMs);
  return backend;
}

const backend = await bootPage();
console.log('backend: webgpu');

// ---------------------------------------------------------------------------
// The legs. Each is a named set of overrides applied on top of ship defaults.
// ---------------------------------------------------------------------------
const ALL_LEGS = {
  baseline: {},
  // BLEED (bleeding-wounds, 2026-08-31) SHIPS ON, so baseline includes it;
  // this leg is the "before" column — setBleed(false) is pixel-identical to
  // the pre-feature page (the off-state parity gate proves that in pixels),
  // so the fire-segment delta between these legs IS the feature's cost.
  'bleed-off': { setBleed: false },
  // The shell march SHIPS ON as of 2026-08-31 (owner-passed; -40%/-54%).
  // baseline above therefore includes it; this leg measures what turning it
  // OFF costs — the ablation direction flipped with the default.
  'shell-off': { setShell: false },
  'occluder-off': { setOccluder: false },
  // Perf round 2 task 5b: the accumulated-depth gate SHIPS OFF (measured as
  // a net pass-structure loss at 3-4 bodies); this leg turns it ON — the
  // ablation direction of 'cone-on', not 'shell-off'.
  'depth-gate-on': { setDepthGate: true },
  'cone-on': { setCone: true },
  'fxaa-off': { setFxaa: false },
  'scale-0.7': { setSdfScale: 0.7 },
  'scale-0.5': { setSdfScale: 0.5 },
  // STEP-BUDGET SWEEP — the shell-march decision experiment. See
  // __sdfGame.setMarchSteps: the slope of cost against budget is what the
  // MISS pixels cost, and miss pixels are exactly what a bounded entry/exit
  // shell deletes. These legs degrade the image on purpose; they are a
  // measurement, not a config.
  'steps-96': { setMarchSteps: 96 },
  'steps-64': { setMarchSteps: 64 },
  'steps-48': { setMarchSteps: 48 },
  'steps-32': { setMarchSteps: 32 },
  'steps-24': { setMarchSteps: 24 },
  'steps-16': { setMarchSteps: 16 },
  // TILE-LIST LEGS — need BENCH_QUERY=tiles-playtest or setTiles is a no-op
  // (the controller is not `allowed` without the page flag). 'tiles-on' is
  // the existing per-tile group list; 'tiles-raycull' adds the per-ray
  // sphere compaction prototype at the march entry (march.wgsl.ts, tileCfg.x
  // == 2). Baseline is the cluster walk with tiles OFF, as shipped.
  'tiles-on': { setTiles: true },
  'tiles-raycull': { setTiles: true, setTileRayCull: true },
  // GOO DENSITY LEVERS (pass attribution 2026-09-07: goo:density equals the
  // march once blood flies). Run with BENCH_PASSES=1 and read the
  // goo:density row. 'goo-density-off' is the diagnostic ceiling — a wrong
  // frame on purpose — that bounds what any lever can recover.
  'goo-dens-0.35': { setGooPerf: { densityScale: 0.35 } },
  'goo-dens-0.25': { setGooPerf: { densityScale: 0.25 } },
  'goo-dens-0.125': { setGooPerf: { densityScale: 0.125 } },
  'goo-cap-300': { setGooPerf: { particleCap: 300, areaPriority: true } },
  'goo-cap-150': { setGooPerf: { particleCap: 150, areaPriority: true } },
  'goo-mintexel-1': { setGooPerf: { minTexelRadius: 1 } },
  'goo-density-off': { setGooPerf: { passGate: { density: false } } },
  // MARCH ATTRIBUTION LEGS (2026-09-07: the march is the whole GPU frame and
  // grows 8 -> 19 -> 31 ms walk/fire/gib). Each prices one wound/chunk
  // mechanism against the shipped state. 'chunks-skip' is a diagnostic
  // ceiling (wrong frame on purpose); the rest are real levers or the old
  // values of levers that already shipped.
  'wstep-0.6': { setWoundStep: 0.6 },
  'wound-earlyout-off': { setWoundEarlyOut: false },
  'wound-cull-off': { setWoundCull: false },
  'chunks-skip': { setChunkPass: 'skip' },
  // The per-limb owner re-fold (march.wgsl.ts ~L1505): the one wound-path
  // mechanism never priced. OFF is a wrong frame on purpose.
  'owner-refold-off': { setOwnerRefold: false },
  // PER-RAY WOUND LIST (march.wgsl.ts, counts2.w): build the reachable wound
  // set once per pixel and fold only those. OFF is bit-identical, so this
  // leg prices the preload against the per-step full-wound fold.
  'wound-list-on': { setWoundList: true },
  // Bone tubes ON: skeleton drawn as instanced tubes in the polygon pass
  // instead of folded into the field inside wounds (bone-tubes, default OFF
  // pending the look verdict). Prices the inside-flesh rows the nearWound
  // gate opens.
  'bone-mesh-on': { setBoneMesh: true },
  // Bone-cluster sphere cull ON: one per-flesh-cluster sphere culls the
  // inside-flesh rows (bones/organs) before folding them inside wounds. The
  // spatially-culled alternative to bone-mesh-on — keeps the bones in the
  // field, recovers a fraction of the bone-mesh-on win (gib -25-30%).
  'bone-cull-on': { setBoneCull: true },
  // Bone-SEGMENT sphere cull ON: one sphere per rigid segment (skull / axial
  // BoneFrame / limb bone / organs) culls the inside-flesh rows. The finer
  // granularity the cluster verdict asked for — a chest pixel should skip
  // the pelvis, the skull and the shins.
  // Bone cull SHIPS 'segment' (2026-09-07); baseline includes it. These legs
  // are the ablations: 'bone-cull-off' = the pre-cull flat fold, 'bone-seg-on'
  // kept as an explicit no-op leg for scripts that name it.
  'bone-cull-off': { setBoneCullMode: 'off' },
  'bone-seg-on': { setBoneCullMode: 'segment' },
};
// BENCH_LEGS lets a validation pass run one leg without the whole matrix.
const LEGS = process.env.BENCH_LEGS
  ? Object.fromEntries(process.env.BENCH_LEGS.split(',').map((k) => [k, ALL_LEGS[k] ?? {}]))
  : ALL_LEGS;

async function applyLeg(name) {
  // Fall back to ALL_LEGS: the spike pass always runs 'baseline', which a
  // BENCH_LEGS filter may have excluded from the throughput matrix.
  const overrides = LEGS[name] ?? ALL_LEGS[name] ?? {};
  // Ship defaults first, so legs cannot contaminate each other.
  await evaluate(`(() => {
    __sdfGame.setOccluder(true);
    __sdfGame.setCone(false);
    __sdfGame.setFxaa(true);
    __sdfGame.setSdfScale(1.0);
    __sdfGame.setAdaptive(false);
    __sdfGame.setMarchSteps(96);
    __sdfGame.setShell(true);
    __sdfGame.setRelax(1.0);
    __sdfGame.setBleed(true);
    // Perf round 2 task 5b: the depth gate DEFAULTS OFF (its pass structure
    // measured as a net loss at 3-4 bodies — see game-main.ts). Pinned here
    // so legs cannot inherit state; the 'depth-gate-on' leg is the A/B.
    // Perf round 2 task 1's GAME_HULL_EXIT_BOUND = 1 FAILS render parity
    // (task 1b: whole background bodies vanish past a foreground hull; see
    // notes.md). Until the owner resolves that, benches measure the bound OFF
    // — the state every baseline in these notes was taken in — and task 9's
    // table keeps it OFF per the plan.
    __sdfGame.setHullExitBound(false);
    // Tiles ship OFF (playtest-gated); pinned so the tile legs are the A/B.
    __sdfGame.setTiles(false);
    __sdfGame.setTileRayCull(false);
    // Wound levers at the GAME's shipped state (game-main.ts GAME_* consts:
    // near-wound step 1.0, early-out on, union-reach cull on).
    __sdfGame.setWoundStep(1.0);
    __sdfGame.setWoundEarlyOut(true);
    __sdfGame.setWoundCull(true);
    __sdfGame.setOwnerRefold(true);
    __sdfGame.setWoundList(false);
    __sdfGame.setBoneMesh(false);
    __sdfGame.setBoneCullMode('segment');
    // Chunk pass: split ONLY in passes mode, so the timer can label chunks;
    // every other mode benches the shipped single pass.
    __sdfGame.setChunkPass(${JSON.stringify(PASSES ? 'split' : 'merged')});
    // Goo perf seams at their shipped state (goo-layer.ts defaults).
    __sdfGame.setGooPerf({ densityScale: 0.5, particleCap: 1000, minTexelRadius: 0, areaPriority: false, splatFadeTail: 0, surfaceAtDensityRes: false, passGate: { density: true, blur: true, surface: true } });
    return 1;
  })()`);
  for (const [fn, arg] of Object.entries(overrides)) {
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
  // Fresh page per run — see bootPage. Damage does not survive a reload,
  // which is the entire point.
  await bootPage(2500);
  await applyLeg(name);
  if (PRELUDE) await evaluate(PRELUDE);
  const label = `${name}/room${room}/${mode}`;
  const opts = mode === 'spike'
    ? `{ room: ${room}, mode: "spike", warmup: ${WARMUP}, label: ${JSON.stringify(label)} }`
    : `{ room: ${room}, mode: ${JSON.stringify(mode)}, warmup: ${WARMUP}, chunkFrames: ${CHUNK}, label: ${JSON.stringify(label)} }`;
  await evaluate(`__sdfGame.bench(${opts})`);
  const raw = await evaluate('JSON.stringify(window.__gameBench)');
  const r = JSON.parse(raw);
  if (!r.valid) fail(`${label}: ${r.hiddenSteps} hidden frames — INVALID (a hidden page renders nothing)`);
  // A run that saw no bodies measured an empty room, whatever its timings say.
  const seen = Math.max(0, ...r.segments.flatMap((sg) => sg.census ? [sg.census.first.bodies, sg.census.last.bodies] : [0]));
  if (seen === 0) console.warn(`  WARN ${label}: census saw ZERO bodies — this run measured an empty room`);
  r.bodiesSeen = seen;
  return r;
}

// ---------------------------------------------------------------------------
// 1. THROUGHPUT MATRIX — the comparison numbers.
// ---------------------------------------------------------------------------
const results = [];
for (let rep = 0; rep < REPEATS; rep++) {
  for (const leg of Object.keys(LEGS)) {
    for (const room of ROOM_IDS) {
      const r = await runLeg(leg, room, PASSES ? 'passes' : 'throughput');
      results.push({ rep, leg, room, prelude: PRELUDE, ...r });
      process.stdout.write(`  rep${rep} ${leg} room${room}: median ${r.overall.p50.toFixed(2)} ms (max chunk ${r.overall.max.toFixed(2)})\n`);
      if (PASSES && r.passes) {
        if (!r.passes.available) console.warn(`  WARN ${leg}/room${room}: no pass samples — timestamp tracking absent?`);
        const top = Object.values(r.passes.overall.labels).slice(0, 4).map((l) => `${l.name} ${l.p50.toFixed(2)}`).join(', ');
        process.stdout.write(`      passes: ${top}\n`);
      }
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
if (PASSES) writePassReport();
for (const room of PASSES ? [] : ROOM_IDS) {
  const r = await runLeg('baseline', room, 'spike');
  spikes.push({ room, prelude: PRELUDE, ...r });
  process.stdout.write(`  spike room${room}: p50 ${r.overall.p50.toFixed(2)} max ${r.overall.max.toFixed(2)} ms\n`);
}

writeFileSync(`${OUT}/bench.json`, JSON.stringify({
  meta: { url, W, H, repeats: REPEATS, rooms: ROOM_IDS, backend, prelude: PRELUDE, when: new Date().toISOString() },
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
lines.push('## Repeatability — READ THIS BEFORE ANY DELTA');
lines.push('');
lines.push('Spread of the overall median across identical repeats. A leg whose');
lines.push('spread exceeds the delta you care about has not measured anything.');
lines.push('On 2026-08-31 three identical runs read 10.1 / 5.6 / 56.1 ms on a busy');
lines.push('machine, which is why this section exists.');
lines.push('');
lines.push('| leg | room | reps (overall median ms) | spread | spread % of min |');
lines.push('| --- | ---: | --- | ---: | ---: |');
let worstSpreadPct = 0;
for (const leg of Object.keys(LEGS)) {
  for (const room of ROOM_IDS) {
    const rs = results.filter((r) => r.leg === leg && r.room === room);
    if (rs.length < 2) continue;
    const vals = rs.map((r) => r.overall.p50);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pct = ((hi - lo) / lo) * 100;
    worstSpreadPct = Math.max(worstSpreadPct, pct);
    lines.push(`| ${leg} | ${room} | ${vals.map((v) => v.toFixed(2)).join(' / ')} | ${(hi - lo).toFixed(2)} | ${pct.toFixed(0)}% |`);
  }
}
lines.push('');
lines.push(`**Worst repeat spread: ${worstSpreadPct.toFixed(0)}%.** Judge each delta`);
lines.push('against ITS OWN legs\' spread, not against this worst case — one noisy leg');
lines.push('does not invalidate a delta measured between two quiet ones. A delta smaller');
lines.push('than either leg\'s spread is UNRESOLVED, not zero.');
lines.push('');
lines.push('## Census — what was ON SCREEN while those numbers were taken');
lines.push('');
lines.push('A cost column is unreadable without this. Read `bodies` first: if it');
lines.push('falls through the run, the cheap segments were timing an empty room.');
lines.push('');
lines.push('| room | segment | bodies in→out | wounds in→out | chunks in→out | droplets in→out | goo quads in→out |');
lines.push('| ---: | --- | ---: | ---: | ---: | ---: | ---: |');
for (const room of ROOM_IDS) {
  // Prefer baseline, but fall back to ANY leg for this room — a BENCH_LEGS
  // filter can exclude baseline, and an empty census table is worse than a
  // census from a different leg (the scene is the same either way).
  const r = results.find((x) => x.leg === 'baseline' && x.room === room)
    ?? results.find((x) => x.room === room);
  if (!r) continue;
  for (const seg of r.segments) {
    if (!seg.census) continue;
    const { first: a, last: b } = seg.census;
    lines.push(`| ${room} | ${seg.name} | ${a.bodies}→${b.bodies} | ${a.wounds}→${b.wounds} | ${a.chunks}→${b.chunks} | ${a.droplets ?? '-'}→${b.droplets ?? '-'} | ${a.gooQuads ?? '-'}→${b.gooQuads ?? '-'} |`);
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

// ---------------------------------------------------------------------------
// PASS ATTRIBUTION REPORT (BENCH_PASSES=1). Per leg: one table, rows = pass
// labels, one column per room = median across repeats of the overall p50 of
// that pass's per-frame GPU time, with its share of the labelled total. The
// last rows are the labelled total, the fenced frame p50, and the GAP between
// them — CPU submit, inter-pass bubbles, and anything the timestamps cannot
// see. A large gap is itself a finding.
// ---------------------------------------------------------------------------
function writePassReport() {
  const out = [];
  out.push('# Per-pass GPU attribution');
  out.push('');
  out.push(`${W}x${H}, repeats=${REPEATS}, rooms=${ROOM_IDS.join(',')}${PRELUDE ? `, prelude: ${PRELUDE}` : ''}${QUERY ? `, query: ${QUERY}` : ''}`);
  out.push('');
  out.push('Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,');
  out.push('all segments). Share = of the labelled total. Gap = fenced frame p50 minus');
  out.push('the labelled total: CPU submit, inter-pass bubbles, unlabelled work.');
  out.push('');
  const perSeg = {};
  for (const leg of Object.keys(LEGS)) {
    const rs = results.filter((r) => r.leg === leg && r.passes?.available);
    if (!rs.length) { out.push(`## ${leg}: NO PASS SAMPLES`); out.push(''); continue; }
    const allLabels = [...new Set(rs.flatMap((r) => Object.keys(r.passes.overall.labels)))];
    const labels = allLabels.filter((l) => !l.startsWith('cpu:'));
    const cpuLabels = allLabels.filter((l) => l.startsWith('cpu:'));
    const cell = (room, label) => {
      const xs = results.filter((r) => r.leg === leg && r.room === room && r.passes?.available)
        .map((r) => r.passes.overall.labels[label]?.p50 ?? 0);
      return xs.length ? med(xs) : 0;
    };
    const totals = Object.fromEntries(ROOM_IDS.map((room) => [room, labels.reduce((n, l) => n + cell(room, l), 0)]));
    const frameP50 = Object.fromEntries(ROOM_IDS.map((room) => {
      const xs = results.filter((r) => r.leg === leg && r.room === room).map((r) => r.overall.p50);
      return [room, xs.length ? med(xs) : 0];
    }));
    // Order labels by their cost in the LAST room (the busiest), largest first.
    const last = ROOM_IDS[ROOM_IDS.length - 1];
    labels.sort((a, b) => cell(last, b) - cell(last, a));
    out.push(`## ${leg}`);
    out.push('');
    out.push(`| pass | ${ROOM_IDS.map((r) => `room ${r} ms | share`).join(' | ')} |`);
    out.push(`| --- | ${ROOM_IDS.map(() => '---: | ---:').join(' | ')} |`);
    for (const l of labels) {
      out.push(`| ${l} | ${ROOM_IDS.map((room) => { const v = cell(room, l); const t = totals[room]; return `${v.toFixed(2)} | ${t > 0 ? (100 * v / t).toFixed(0) : '0'}%`; }).join(' | ')} |`);
    }
    // Per-label medians do not add: the "labelled total" is the sum of
    // medians (a share denominator), while the GPU SPAN row is the median of
    // per-frame first-start-to-last-end — the honest per-frame GPU time.
    const spanP50 = Object.fromEntries(ROOM_IDS.map((room) => {
      const xs = results.filter((r) => r.leg === leg && r.room === room && r.passes?.available).map((r) => r.passes.overall.span.p50);
      return [room, xs.length ? med(xs) : 0];
    }));
    out.push(`| **labelled total (sum of medians)** | ${ROOM_IDS.map((room) => `**${totals[room].toFixed(2)}** | 100%`).join(' | ')} |`);
    out.push(`| GPU span p50 (first start → last end) | ${ROOM_IDS.map((room) => `${spanP50[room].toFixed(2)} | `).join(' | ')} |`);
    out.push(`| fenced frame p50 | ${ROOM_IDS.map((room) => `${frameP50[room].toFixed(2)} | `).join(' | ')} |`);
    out.push(`| gap (frame − span) | ${ROOM_IDS.map((room) => `${(frameP50[room] - spanP50[room]).toFixed(2)} | ${frameP50[room] > 0 ? (100 * (frameP50[room] - spanP50[room]) / frameP50[room]).toFixed(0) : '0'}% of frame`).join(' | ')} |`);
    out.push('');
    if (cpuLabels.length) {
      // CPU side, per stepped frame: tick (sim) and draw (encode + submit)
      // totals, then the telemetry phases inside the tick. Phases overlap
      // nothing and nest inside cpu:tick; they do not add to a total.
      cpuLabels.sort((a, b) => cell(last, b) - cell(last, a));
      out.push(`CPU per frame (ms, median over repeats of p50):`);
      out.push('');
      out.push(`| cpu | ${ROOM_IDS.map((r) => `room ${r}`).join(' | ')} |`);
      out.push(`| --- | ${ROOM_IDS.map(() => '---:').join(' | ')} |`);
      for (const l of cpuLabels) out.push(`| ${l} | ${ROOM_IDS.map((room) => cell(room, l).toFixed(2)).join(' | ')} |`);
      out.push('');
    }
    // Per-segment view of the same leg, one line per segment: top three passes.
    out.push(`Per segment (top passes, room ${last}):`);
    out.push('');
    for (const segName of ['walk', 'fire', 'gib']) {
      const rows = results.filter((r) => r.leg === leg && r.room === last && r.passes?.available)
        .map((r) => r.passes.segments.find((s) => s.name === segName)).filter(Boolean);
      if (!rows.length) continue;
      const segLabels = [...new Set(rows.flatMap((s) => Object.keys(s.labels)))];
      const segCell = (l) => med(rows.map((s) => s.labels[l]?.p50 ?? 0));
      const ranked = segLabels.map((l) => [l, segCell(l)]).sort((a, b) => b[1] - a[1]);
      const tot = ranked.reduce((n, [, v]) => n + v, 0);
      perSeg[`${leg}/${segName}`] = ranked;
      const cen = results.find((r) => r.leg === leg && r.room === last)?.segments.find((s) => s.name === segName)?.census;
      const cenTxt = cen ? ` — droplets ${cen.first.droplets ?? '-'}→${cen.last.droplets ?? '-'}, goo quads ${cen.first.gooQuads ?? '-'}→${cen.last.gooQuads ?? '-'}` : '';
      out.push(`- **${segName}** (${tot.toFixed(2)} ms labelled${cenTxt}): ${ranked.slice(0, 5).map(([l, v]) => `${l} ${v.toFixed(2)}`).join(', ')}`);
    }
    out.push('');
  }
  out.push('## Repeatability (fenced frame p50 across repeats)');
  out.push('');
  out.push('| leg | room | reps | spread % of min |');
  out.push('| --- | ---: | --- | ---: |');
  for (const leg of Object.keys(LEGS)) {
    for (const room of ROOM_IDS) {
      const xs = results.filter((r) => r.leg === leg && r.room === room).map((r) => r.overall.p50);
      if (!xs.length) continue;
      const mn = Math.min(...xs), mx = Math.max(...xs);
      out.push(`| ${leg} | ${room} | ${xs.map((x) => x.toFixed(2)).join(' / ')} | ${mn > 0 ? (100 * (mx - mn) / mn).toFixed(0) : '0'}% |`);
    }
  }
  out.push('');
  const text = out.join('\n');
  console.log(text);
  writeFileSync(`${OUT}/passes.md`, text);
  writeFileSync(`${OUT}/passes.json`, JSON.stringify({
    meta: { url, W, H, repeats: REPEATS, rooms: ROOM_IDS, backend, prelude: PRELUDE, when: new Date().toISOString() },
    results, perSeg,
  }, null, 2));
  console.log(`wrote ${OUT}/passes.md and ${OUT}/passes.json`);
}
