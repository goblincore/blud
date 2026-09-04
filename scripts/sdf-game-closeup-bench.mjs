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
// Usage: LAB_VITE_PORT=5377 LAB_CDP_PORT=9377 node scripts/sdf-game-closeup-bench.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5377);
const CDP = Number(process.argv[3] ?? 9377);
const OUT = process.env.BENCH_OUT ?? '/tmp/sdf-closeup';
const REPEATS = Number(process.env.BENCH_REPEATS ?? 5);
const W = 1280, H = 800;
const TARGET_COVERAGE = Number(process.env.COVERAGE_MIN ?? 0.5);
const WOUND_COUNT = Number(process.env.WOUNDS ?? 5);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (25 min)'); process.exit(3); }, 1_500_000).unref();

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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, timeoutMs = 120_000) => {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs,
  });
  if (r.result?.exceptionDetails) fail(`page threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const url = `http://localhost:${VITE}/sdf-game.html?frozen=1`;
console.log(`closeup-bench ${url}  (${W}x${H}, repeats=${REPEATS}, wounds=${WOUND_COUNT})`);

// Fresh page per run — damage persists otherwise and every run would inherit
// the previous run's craters (the 583%-spread lesson, inherited verbatim).
async function bootPage() {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await send('Page.navigate', { url });
  let backend = null;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
    if (backend) break;
  }
  if (!backend) fail('game page never booted');
  if (backend !== 'webgpu') fail(`backend is ${backend}, not webgpu`);
  await sleep(2500); // settle: first-use pipeline stalls are real
  await evaluate('__sdfGame.installDebugProbe()');
}

// Ship defaults, pinned so legs cannot inherit each other's state. Occluder
// OFF (the shipped game state — see the module comment) and spillChance 0
// (a static scene is the instrument; the goo cost is task 4's question).
async function applyDefaults() {
  await evaluate(`(() => {
    __sdfGame.setOccluder(false);
    __sdfGame.setCone(false);
    __sdfGame.setFxaa(true);
    __sdfGame.setSdfScale(1.0);
    __sdfGame.setAdaptive(false);
    __sdfGame.setMarchSteps(96);
    __sdfGame.setShell(true);
    __sdfGame.setRelax(1.0);
    __sdfGame.setBleed(true);
    __sdfGame.setHullExitBound(false);
    __sdfGame.setDepthGate(false);
    __sdfGame.setHalfRate(false);
    __sdfGame.setFlatAlbedo(false);
    __sdfGame.setWoundTuning({ spillChance: 0 });
    return 1;
  })()`);
}

// Stage the fill-screen scene. Returns the staging record the report quotes.
async function stageScene() {
  const staged = await evaluate(`(async () => {
    __sdfGame.teleport(1);
    const z = __sdfGame.zombies().find(q => q.room === 1);
    if (!z) return { error: 'no body in room 1' };
    __sdfGame.freeze(true);
    const eyeH = 1.62, aimY = 1.0;
    const tryPose = (d, ang) => {
      const ex = z.pos[0] + Math.sin(ang) * d;
      const ez = z.pos[2] + Math.cos(ang) * d;
      const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
      const yaw = Math.atan2(dx, -dz);
      const pitch = Math.atan2(aimY - eyeH, Math.hypot(dx, dz));
      __sdfGame.setPose(ex, ez, yaw, pitch, 0);
      return { yaw, pitch };
    };
    // Coverage search: walk the whole distance ladder and KEEP THE BEST —
    // "one body filling the screen" wants the closest framing that still
    // renders, not the first rung past a threshold. Coverage = flesh pixels
    // / SDF-target pixels, from the occupancy counter (debug mode 4).
    let best = null;
    for (const d of [1.6, 1.4, 1.25, 1.1, 1.0, 0.9, 0.8, 0.7, 0.6]) {
      tryPose(d, 0);
      __sdfGame.step(2);
      const occ = await __sdfGame.occupancy();
      const cov = occ.hits / (occ.targetW * occ.targetH);
      if (!best || cov > best.cov) best = { d, cov, occ };
    }
    tryPose(best.d, 0);
    __sdfGame.step(2);
    return { d: best.d, cov: best.cov, body: z.id };
  })()`);
  if (staged.error) fail(staged.error);
  return staged;
}

// Stamp WOUND_COUNT wounds on the camera-facing side from the staged pose.
// slug/pellet mix: two blast craters (the wound-shadow lives near craters)
// and the rest pellets. spillChance 0 (set in applyDefaults) keeps the blood
// sim empty; asserted below via the bleed census.
async function stampWounds() {
  const r = await evaluate(`(async () => {
    const stamps = [];
    const offsets = [
      [0, 0, 'slug'], [0.14, 0.06, 'slug'],
      [0.07, -0.08, 'pellet'], [-0.07, 0.1, 'pellet'], [-0.16, -0.04, 'pellet'],
    ];
    for (const [dyaw, dpitch, kind] of offsets) {
      const base = __sdfGame.pose();
      __sdfGame.setPose(base.pos[0], base.pos[2], base.yaw + dyaw, base.pitch + dpitch, 0);
      const p = __sdfGame.predictSlugHit();
      if (p.actorId < 0 || !p.hit) continue;
      const ok = __sdfGame.stampWoundAt(p.origin[0], p.origin[1], p.origin[2],
        p.dir[0], p.dir[1], p.dir[2], kind, p.actorId);
      if (ok) stamps.push({ kind, actorId: p.actorId });
    }
    __sdfGame.step(5);
    const id = stamps[0]?.actorId;
    return {
      stamped: stamps.length,
      wounds: id !== undefined ? __sdfGame.zombie(id).woundList().length : null,
      bleed: __sdfGame.bleed,
      chunks: __sdfGame.chunkCount,
      bodies: __sdfGame.bodiesOnScreen,
    };
  })()`);
  if (r.stamped < 3) fail(`only ${r.stamped} wounds stamped — staging untrustworthy`);
  if (r.bleed.droplets !== 0 || r.bleed.splats !== 0) fail(`blood sim not empty: ${JSON.stringify(r.bleed)}`);
  if (r.chunks !== 0) fail(`${r.chunks} chunks in flight — a stamp severed something`);
  return r;
}

const LEGS = {
  normal:   { wounds: true,  flat: false },
  flat:     { wounds: true,  flat: true },
  normal0:  { wounds: false, flat: false },
  flat0:    { wounds: false, flat: true },
};
// Rotate the starting leg each rep so a thermal ramp cannot alias onto one
// leg (interleave discipline, inherited).
const order = (rep) => Object.keys(LEGS).map((_, i) => Object.keys(LEGS)[(i + rep) % 4]);

const results = [];
for (let rep = 0; rep < REPEATS; rep++) {
  for (const leg of order(rep)) {
    const L = LEGS[leg];
    await bootPage();
    await applyDefaults();
    const staging = await stageScene();
    let woundInfo = null;
    if (L.wounds) {
      woundInfo = await stampWounds();
      // Let viscera ropes and any settle-state physics come to rest BEFORE
      // the timing starts, or their settling drift lands inside the bench
      // chunks as cost drift (the 38% spread the first run showed).
      await evaluate('__sdfGame.step(600)');
    }
    await evaluate(`__sdfGame.setFlatAlbedo(${L.flat})`);
    await evaluate('__sdfGame.step(2)');
    const occ = await evaluate('__sdfGame.occupancy()');
    await evaluate(`__sdfGame.bench({ kind: 'closeup', mode: 'throughput', warmup: 120, chunkFrames: 10, closeupFrames: 240, label: ${JSON.stringify(leg)} })`);
    const r = JSON.parse(await evaluate('JSON.stringify(window.__gameBench)'));
    if (!r.valid) fail(`${leg} rep${rep}: ${r.hiddenSteps} hidden frames — INVALID`);
    const seg = r.segments.find((s) => s.name === 'closeup');
    const census = seg?.census?.last ?? seg?.census?.first ?? null;
    const row = {
      rep, leg,
      p50: seg.p50, p95: seg.p95, mean: seg.mean, max: seg.max,
      coverage: occ.hits / (occ.targetW * occ.targetH),
      dist: staging.d,
      wounds: woundInfo?.wounds ?? 0,
      bodies: census?.bodies ?? occ.bodiesOnScreen,
      meanStepsHit: occ.meanStepsHit, missStepShare: occ.missStepShare,
      uptime: await evaluate('__sdfGame.uptime()'),
    };
    results.push(row);
    process.stdout.write(`  rep${rep} ${leg}: p50 ${row.p50.toFixed(2)} ms  cov ${(row.coverage * 100).toFixed(0)}%  wounds ${row.wounds}  dist ${row.dist}  uptime ${row.uptime.toFixed(0)}s\n`);
  }
}

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
  results, summary, split,
}, null, 2));

console.log('\n## Close-up split (p50 of chunk means, median of reps)');
for (const [leg, s] of Object.entries(summary)) {
  console.log(`  ${leg.padEnd(8)} p50 ${s.p50.toFixed(2)} ms  [${s.min.toFixed(2)}..${s.max.toFixed(2)}]  spread ${s.spreadPct.toFixed(1)}%  cov ${(s.coverage * 100).toFixed(0)}%  dist ${s.dist}m  wounds ${s.wounds}  steps/hit ${s.meanStepsHit.toFixed(1)}`);
}
console.log('\n## Split, % of the wounded close-up frame');
for (const [k, v] of Object.entries(split)) console.log(`  ${k.padEnd(24)} ${v}%`);
console.log(`\nwrote ${OUT}/closeup-bench.json`);
await fetch(`http://localhost:${CDP}/json/close/${tab.id}`);
process.exit(0);
