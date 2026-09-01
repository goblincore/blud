// scripts/dungeon-bench.mjs — the dungeon relighting cost gate (task 9).
//
// Runs the three lighting legs of game-bench-scenario.ts (`dungeon-off`,
// `dungeon-no-shadow`, `dungeon-shadow`) against sdf-game.html through
// __sdfGame.bench, then writes baselines.json + bench.md.
//
// Plumbing is the proven sdf-game-bench pattern: no-deps CDP, fresh page per
// run (damage persists on the page — a run that inherits run N-1's craters
// measures cumulative damage, not the leg), ship defaults re-applied before
// every leg, legs alternating across repeats, hidden frames invalidate.
//
// HOW EACH LEG IS APPLIED — the page seams, per the scenario module:
//   rig GALLERY_RIG  <=> __dungeon.setDungeon(false)  (applyRig hides the spot)
//   rig DUNGEON_RIG  <=> __dungeon.setDungeon(true)
//   castShadow       <=> ?spotshadow= BOOT PARAM. NOT a live toggle: three
//       r185 WebGPU crashes rebuilding a disposed shadow map, and
//       shadow.intensity=0 still RENDERS the 1024^2 map every frame (it only
//       zeroes the sampling term) — it would measure the wrong split. At boot
//       with castShadow=false the shadow node is never created, so the
//       no-shadow leg is a true zero-cost ablation.
//
// Usage: scripts/dungeon-bench.sh  (owns vite + Chrome via lab-servers.sh)
//   BENCH_REPEATS=3 BENCH_OUT=docs/dev-notes/2026-09-01-dungeon-relight
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5279);
const CDP = Number(process.argv[3] ?? 9279);
const OUT = process.env.BENCH_OUT ?? 'docs/dev-notes/2026-09-01-dungeon-relight';
const W = Number(process.env.GAME_W ?? 1280);
const H = Number(process.env.GAME_H ?? 800);
const REPEATS = Number(process.env.BENCH_REPEATS ?? 3);
const ROOM = Number(process.env.BENCH_ROOM ?? 4);
// The gate from the plan: shadow cost over the shadowless dungeon, overall.
const GATE_PCT = Number(process.env.BENCH_GATE_PCT ?? 40);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

// The legs, mirroring scenarioByName. castShadow true legs boot without the
// kill param; the no-shadow leg boots with ?spotshadow=0.
const LEGS = {
  'dungeon-off': { qs: '', dungeon: false },
  'dungeon-no-shadow': { qs: '?spotshadow=0', dungeon: true },
  'dungeon-shadow': { qs: '', dungeon: true },
};
const LEG_NAMES = Object.keys(LEGS);

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
    consoleEvents.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, timeoutMs = 300_000) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs });
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

// Fresh page per run — damage (wounds, severed limbs, collapsed bodies)
// persists across runs on a shared page and every number becomes about
// cumulative damage. The qs carries the leg's boot param.
async function bootPage(qs, settleMs = 2500) {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html${qs}` });
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
  if (backend !== 'webgpu') fail(`backend is ${backend}, not webgpu — meaningless here`);
  await sleep(settleMs);
  return backend;
}

// Ship defaults first, so a leg cannot inherit the previous one's state.
// Then the lighting leg, then a READBACK of what the page actually applied —
// a leg that silently failed to apply measures nothing.
async function applyLeg(name) {
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
    __dungeon.setDungeon(${LEGS[name].dungeon});
    return 1;
  })()`);
  const state = await evaluate(`(() => ({
    on: __dungeon.on,
    visible: __dungeon.spot.visible,
    castShadow: __dungeon.spot.castShadow,
    mapSize: __dungeon.spot.shadow.mapSize.x,
  }))()`);
  const want = LEGS[name];
  if (state.on !== want.dungeon) fail(`${name}: dungeon.on is ${state.on}, want ${want.dungeon}`);
  if (state.on) {
    if (!state.visible) fail(`${name}: spot.visible is false with the dungeon on — the beam would not render`);
    const wantShadow = !want.qs.includes('spotshadow=0');
    if (state.castShadow !== wantShadow) {
      fail(`${name}: spot.castShadow is ${state.castShadow}, want ${wantShadow} — boot param did not apply`);
    }
  }
  if (!state.on && state.visible) fail('dungeon-off: spot.visible should be false (applyRig hides it)');
  return state;
}

const WARMUP = Number(process.env.BENCH_WARMUP ?? 120);
const CHUNK = Number(process.env.BENCH_CHUNK ?? 10);

async function runLeg(name) {
  await bootPage(LEGS[name].qs);
  const state = await applyLeg(name);
  const label = `${name}/room${ROOM}`;
  await evaluate(`__sdfGame.bench({ room: ${ROOM}, mode: "throughput", warmup: ${WARMUP}, chunkFrames: ${CHUNK}, label: ${JSON.stringify(label)} })`);
  const raw = await evaluate('JSON.stringify(window.__gameBench)');
  const r = JSON.parse(raw);
  if (!r.valid) fail(`${label}: ${r.hiddenSteps} hidden frames — INVALID (a hidden page renders nothing)`);
  const seen = Math.max(0, ...r.segments.flatMap((sg) => sg.census ? [sg.census.first.bodies, sg.census.last.bodies] : [0]));
  if (seen === 0) console.warn(`  WARN ${label}: census saw ZERO bodies — this run measured an empty room`);
  r.bodiesSeen = seen;
  r.legState = state;
  return r;
}

// ---------------------------------------------------------------------------
// Legs alternate across repeats (A B C A B C, never A A A then B B B) so the
// thermal ramp lands on every leg equally.
// ---------------------------------------------------------------------------
const results = [];
for (let rep = 0; rep < REPEATS; rep++) {
  for (const leg of LEG_NAMES) {
    const r = await runLeg(leg);
    results.push({ rep, leg, ...r });
    process.stdout.write(`  rep${rep} ${leg}: median ${r.overall.p50.toFixed(2)} ms, p95 ${r.overall.p95.toFixed(2)} ms (bodies ${r.bodiesSeen})\n`);
  }
}

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };

// One summary row per leg: median of per-run numbers (one thermal outlier
// must not move the reported value).
const baselines = {};
for (const leg of LEG_NAMES) {
  const rs = results.filter((r) => r.leg === leg);
  const seg = (n, k) => med(rs.map((r) => r.segments.find((s) => s.name === n)[k]));
  baselines[leg] = {
    n: rs.reduce((a, r) => a + r.overall.n, 0),
    runs: rs.length,
    p50: +med(rs.map((r) => r.overall.p50)).toFixed(2),
    p95: +med(rs.map((r) => r.overall.p95)).toFixed(2),
    p99: +med(rs.map((r) => r.overall.p99)).toFixed(2),
    mean: +med(rs.map((r) => r.overall.mean)).toFixed(2),
    walkP50: +seg('walk', 'p50').toFixed(2),
    fireP50: +seg('fire', 'p50').toFixed(2),
    gibP50: +seg('gib', 'p50').toFixed(2),
    bodies: ROOM,
  };
}

const shadowPct = ((baselines['dungeon-shadow'].p50 / baselines['dungeon-no-shadow'].p50 - 1) * 100);
const offPct = ((baselines['dungeon-off'].p50 / baselines['dungeon-no-shadow'].p50 - 1) * 100);
const gatePass = shadowPct <= GATE_PCT;

// Repeatability: a spread wider than the delta means the delta is unresolved.
const spread = {};
for (const leg of LEG_NAMES) {
  const vals = results.filter((r) => r.leg === leg).map((r) => r.overall.p50);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  spread[leg] = { lo: +lo.toFixed(2), hi: +hi.toFixed(2), pct: +(((hi - lo) / lo) * 100).toFixed(0) };
}

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/baselines.json`, JSON.stringify({
  when: new Date().toISOString(),
  viewport: `${W}x${H}`,
  room: ROOM,
  repeats: REPEATS,
  warmup: WARMUP,
  chunkFrames: CHUNK,
  gate: { maxShadowOverheadPct: GATE_PCT, measuredPct: +shadowPct.toFixed(1), pass: gatePass },
  // NOTE: the harness computes p95, not p90 — p95 is the conservative
  // neighbour and the same shape the 2026-08-24 baselines use.
  scenarios: baselines,
  spread,
}, null, 2) + '\n');

const lines = [];
lines.push('');
lines.push('# Dungeon relighting cost gate — ' + new Date().toISOString());
lines.push('');
lines.push(`Room ${ROOM} (${ROOM} bodies), throughput mode (chunk ${CHUNK}, warmup ${WARMUP}), ${REPEATS} repeats per leg, legs alternating. Same firefight script on every leg — deltas are lighting only.`);
lines.push('');
lines.push('| leg | overall p50 | p95 | walk | fire | gib | vs no-shadow |');
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const leg of LEG_NAMES) {
  const b = baselines[leg];
  const vs = leg === 'dungeon-no-shadow' ? '—'
    : '+' + (((b.p50 / baselines['dungeon-no-shadow'].p50 - 1) * 100)).toFixed(1) + '%';
  lines.push(`| ${leg} | ${b.p50} | ${b.p95} | ${b.walkP50} | ${b.fireP50} | ${b.gibP50} | ${vs} |`);
}
lines.push('');
lines.push('## Repeatability — a delta smaller than a leg\'s spread is UNRESOLVED');
lines.push('');
lines.push('| leg | p50 across reps | spread % |');
lines.push('| --- | --- | ---: |');
for (const leg of LEG_NAMES) {
  lines.push(`| ${leg} | ${results.filter((r) => r.leg === leg).map((r) => r.overall.p50.toFixed(2)).join(' / ')} | ${spread[leg].pct}% |`);
}
lines.push('');
lines.push(`## Gate: dungeon-shadow over dungeon-no-shadow <= +${GATE_PCT}%`);
lines.push('');
lines.push(`**Measured: +${shadowPct.toFixed(1)}% — ${gatePass ? 'PASS' : 'FAIL — surface to the owner with the 512² shadow-map trade before shipping'}**`);
lines.push('');
lines.push(`(dungeon-off reads ${offPct >= 0 ? '+' : ''}${offPct.toFixed(1)}% vs the shadowless dungeon — that is the flashlight-and-rig rest of the relighting.)`);
lines.push('');
lines.push('Census (first leg run): ' + JSON.stringify(results[0].segments.map((s) => ({ seg: s.name, bodies: s.census ? `${s.census.first.bodies}→${s.census.last.bodies}` : 'n/a' }))));
lines.push('');

const report = lines.join('\n');
console.log(report);
writeFileSync(`${OUT}/bench.md`, report);
console.log(`wrote ${OUT}/baselines.json and ${OUT}/bench.md`);
console.log(`GATE ${gatePass ? 'PASS' : 'FAIL'}: shadow overhead +${shadowPct.toFixed(1)}% (gate +${GATE_PCT}%)`);

const badConsole = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (badConsole.length > 0) {
  for (const e of badConsole.slice(0, 10)) console.error('  |', e.type, e.text.slice(0, 300));
  fail(`${badConsole.length} console error/exception event(s) during the run`);
}

ws.close();
process.exit(0);
