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
//   BENCH_LEGS=dungeon|wounds — the leg set. Default 'dungeon' (the original
//   gate, invocation unchanged). 'wounds' runs the wound-pass-r2 legs of
//   spec §4 gate 7: wounds-off / wounds-no-bone / wounds-bone, a MEASUREMENT
//   rather than a gate (the owner's call, 2026-09-01).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5279);
const CDP = Number(process.argv[3] ?? 9279);
const OUT = process.env.BENCH_OUT ?? 'docs/dev-notes/2026-09-01-dungeon-relight';
const W = Number(process.env.GAME_W ?? 1280);
const H = Number(process.env.GAME_H ?? 800);
const REPEATS = Number(process.env.BENCH_REPEATS ?? 3);
const ROOM = Number(process.env.BENCH_ROOM ?? 4);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

// The leg sets. BENCH_LEGS picks one; every leg in a set shares the firefight
// script and the boot params, so the ONLY difference inside a set is which
// feature is on.
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
//   tuning           <=> __sdfGame.setWoundTuning(tuning). One call applies
//       AND reads back (the applied record plus body 1's live surfCfg3), so
//       "did the value reach the field" is verified, not assumed. boneRatio
//       triggers a rebuildCast — bones derive at BUILD time — which happens
//       here, OUTSIDE the measured frames. The 0.38/0.6 numbers mirror
//       game-bench-scenario's WoundLeg pins (DEFAULT_BONE_RATIO, the panel
//       default fibre); the scenario module is the tested source of truth.
const LEG_SETS = {
  dungeon: {
    baseline: 'dungeon-no-shadow',
    headline: 'dungeon-shadow',
    gatePct: Number(process.env.BENCH_GATE_PCT ?? 40),
    legs: {
      'dungeon-off': { qs: '', dungeon: false },
      'dungeon-no-shadow': { qs: '?spotshadow=0', dungeon: true },
      'dungeon-shadow': { qs: '', dungeon: true },
    },
  },
  wounds: {
    // Spec §4 gate 7: a MEASUREMENT, not a gate. Report wounds-bone over
    // wounds-no-bone; if the delta sits under the per-leg spread the report
    // says UNRESOLVED — demanding more would stall on noise (5-11% within-run
    // spread at best). The amplitude guards are the real containment.
    baseline: 'wounds-no-bone',
    headline: 'wounds-bone',
    gatePct: null,
    legs: {
      // wounds-off also zeroes woundFibreAmp: fibre never ran on standing
      // bodies before r2, so the off leg must ablate it too.
      //
      // EVERY leg leads with the same scratch tuning ({boneRatio: 0.5}) and
      // then applies its real state. Contract: the scratch must differ from
      // the fresh-page default (0.38) AND from every leg's final value, so
      // both applies trigger a rebuildCast on every leg. This is the census
      // equaliser, not superstition: rebuildCast respawns all bodies at their
      // spawn points and re-seeds the wander from nextId, so a leg that does
      // NOT rebuild (wounds-bone on a fresh page: 0.38 is a no-op) benches a
      // cast with different seeds and different spawn-freshness from the
      // legs that do — measured 2026-09-02 as a 9-vs-5 on-screen census split
      // (frustum torso count, all rooms) worth more than the effect being
      // measured. Equal rebuild count + equal timing => equal seed sets and
      // spawn freshness; any residual census split is visible in the workload
      // table below and must be read before the delta is.
      'wounds-off': {
        qs: '', dungeon: true,
        tuningSeq: [{ woundDepthAmp: 1, woundFibreAmp: 0.6, boneRatio: 0.5 },
                    { woundDepthAmp: 0, woundFibreAmp: 0, boneRatio: 0 }],
        tuning: { woundDepthAmp: 0, woundFibreAmp: 0, boneRatio: 0 },
      },
      'wounds-no-bone': {
        qs: '', dungeon: true,
        tuningSeq: [{ woundDepthAmp: 1, woundFibreAmp: 0.6, boneRatio: 0.5 },
                    { woundDepthAmp: 1, woundFibreAmp: 0.6, boneRatio: 0 }],
        tuning: { woundDepthAmp: 1, woundFibreAmp: 0.6, boneRatio: 0 },
      },
      'wounds-bone': {
        qs: '', dungeon: true,
        tuningSeq: [{ woundDepthAmp: 1, woundFibreAmp: 0.6, boneRatio: 0.5 },
                    { woundDepthAmp: 1, woundFibreAmp: 0.6, boneRatio: 0.38 }],
        tuning: { woundDepthAmp: 1, woundFibreAmp: 0.6, boneRatio: 0.38 },
      },
    },
  },
};
const SET_NAME = process.env.BENCH_LEGS ?? 'dungeon';
if (!LEG_SETS[SET_NAME]) fail(`unknown BENCH_LEGS '${SET_NAME}' (have: ${Object.keys(LEG_SETS).join(', ')})`);
const SET = LEG_SETS[SET_NAME];
const LEGS = SET.legs;
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

// Apply the wound leg's tuning and verify it reached the page AND the field.
// setWoundTuning applies AND reads back (the applied record plus body 1's
// live surfCfg3), so verification is a property check, not a hope.
async function applyTuning(name, tuning) {
  const w = await evaluate(`(() => {
    const t = __sdfGame.setWoundTuning(${JSON.stringify(tuning)});
    return { depth: t.woundDepthAmp, fibre: t.woundFibreAmp, bone: t.boneRatio, surf: t.surfCfg3 };
  })()`);
  for (const [k, v] of Object.entries(tuning)) {
    const got = { woundDepthAmp: w.depth, woundFibreAmp: w.fibre, boneRatio: w.bone }[k];
    if (got !== v) fail(`${name}: woundTuning.${k} is ${got}, want ${v}`);
  }
  if (tuning.woundDepthAmp === 0 && Array.isArray(w.surf) && w.surf[0] !== 0) {
    fail(`${name}: surfCfg3.x is ${w.surf[0]}, want 0 — the ramp never reached the field`);
  }
  return w;
}

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
  if (want.tuningSeq) {
    // Applied HERE, not at boot, deliberately. The final apply triggers a
    // rebuildCast that respawns every body at its spawn point, so the bench
    // opens on the clustered spawn configuration the teleport/aim logic
    // expects (aimSurface shoots the group centroid; bodies first, walls
    // never). Boot-time application measured 2026-09-02: bodies wandered
    // ~4.5s before the first shot, EVERY shot missed, 0 realised wounds on
    // every leg — a clean but WRONG workload where the wound shading and the
    // bone fold never render at all. The seq itself is the census equaliser:
    // equal rebuild count and timing on every leg => equal seed sets and
    // spawn freshness (see the LEG_SETS comment). The trailing apply of
    // want.tuning is an idempotent re-assert whose readback proves the
    // final state held.
    for (const t of want.tuningSeq) await applyTuning(name, t);
    state.wound = await applyTuning(name, want.tuning);
  }
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
    tuning: SET.legs[leg].tuning ?? null,
    bodies: ROOM,
  };
}

// Deltas vs the set's baseline leg, within this run. Cross-run comparisons
// are meaningless here (bench-baseline.md: absolute numbers drift ~45% on
// machine state alone) — only these within-run numbers are reported.
const BASE = SET.baseline;
const headlinePct = (baselines[SET.headline].p50 / baselines[BASE].p50 - 1) * 100;
const gatePass = SET.gatePct == null ? null : headlinePct <= SET.gatePct;

// Repeatability: a spread wider than the delta means the delta is unresolved.
const spread = {};
for (const leg of LEG_NAMES) {
  const vals = results.filter((r) => r.leg === leg).map((r) => r.overall.p50);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  spread[leg] = { lo: +lo.toFixed(2), hi: +hi.toFixed(2), pct: +(((hi - lo) / lo) * 100).toFixed(0) };
}

mkdirSync(OUT, { recursive: true });
// A delta smaller than the baseline leg's spread is UNRESOLVED — reporting a
// sub-noise delta as a measurement is the recorded mistake of the goo
// fire-segment bench; demanding the noise clear first is the second, larger
// mistake the spec calls out by name.
const unresolved = Math.abs(headlinePct) < spread[BASE].pct;
writeFileSync(`${OUT}/baselines.json`, JSON.stringify({
  when: new Date().toISOString(),
  legSet: SET_NAME,
  viewport: `${W}x${H}`,
  room: ROOM,
  repeats: REPEATS,
  warmup: WARMUP,
  chunkFrames: CHUNK,
  gate: SET.gatePct == null ? null
    : { maxOverheadPct: SET.gatePct, measuredPct: +headlinePct.toFixed(1), pass: gatePass },
  measurement: SET.gatePct == null
    ? { headline: SET.headline, baseline: BASE, deltaPct: +headlinePct.toFixed(1),
        baselineSpreadPct: spread[BASE].pct, unresolved }
    : null,
  // NOTE: the harness computes p95, not p90 — p95 is the conservative
  // neighbour and the same shape the 2026-08-24 baselines use.
  scenarios: baselines,
  spread,
}, null, 2) + '\n');

const lines = [];
lines.push('');
lines.push(`# ${SET_NAME} bench — ` + new Date().toISOString());
lines.push('');
lines.push(`Room ${ROOM} (${ROOM} bodies), throughput mode (chunk ${CHUNK}, warmup ${WARMUP}), ${REPEATS} repeats per leg, legs alternating. Same firefight script on every leg — the only difference between legs is what is enabled. Only within-run deltas are reported: absolute numbers drift ~45% across runs on machine state alone.`);
lines.push('');
lines.push(`| leg | overall p50 | p95 | walk | fire | gib | vs ${BASE} |`);
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const leg of LEG_NAMES) {
  const b = baselines[leg];
  const vs = leg === BASE ? '—'
    : (b.p50 / baselines[BASE].p50 - 1) >= 0 ? '+' + (((b.p50 / baselines[BASE].p50 - 1) * 100)).toFixed(1) + '%'
    : (((b.p50 / baselines[BASE].p50 - 1) * 100)).toFixed(1) + '%';
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
if (SET.gatePct != null) {
  lines.push(`## Gate: ${SET.headline} over ${BASE} <= +${SET.gatePct}%`);
  lines.push('');
  lines.push(`**Measured: +${headlinePct.toFixed(1)}% — ${gatePass ? 'PASS' : 'FAIL — surface to the owner with the 512² shadow-map trade before shipping'}**`);
} else {
  lines.push(`## Measurement: ${SET.headline} over ${BASE} — a number, not a gate (spec §4 gate 7, owner call 2026-09-01)`);
  lines.push('');
  lines.push(`**Measured: ${headlinePct >= 0 ? '+' : ''}${headlinePct.toFixed(1)}% — ${unresolved ? `UNRESOLVED (under the baseline leg's ${spread[BASE].pct}% within-run spread; recorded as such, not as a measurement)` : 'above the within-run spread'}**`);
}
lines.push('');
if (SET_NAME === 'dungeon') {
  lines.push(`(dungeon-off reads ${(baselines['dungeon-off'].p50 / baselines[BASE].p50 - 1) >= 0 ? '+' : ''}${((baselines['dungeon-off'].p50 / baselines[BASE].p50 - 1) * 100).toFixed(1)}% vs the shadowless dungeon — that is the flashlight-and-rig rest of the relighting.)`);
  lines.push('');
}
lines.push('Census (first leg run): ' + JSON.stringify(results[0].segments.map((s) => ({ seg: s.name, bodies: s.census ? `${s.census.first.bodies}→${s.census.last.bodies}` : 'n/a', wounds: s.census ? `${s.census.first.wounds}→${s.census.last.wounds}` : 'n/a' }))));
lines.push('');
lines.push('## Workload census per run — the wound pin is the SHOTS (4: three buckshot + the slug, fixed by the script); realised wounds and on-screen bodies vary with the wander, and a leg whose census splits from the others is measuring a different room');
lines.push('');
lines.push('| rep | leg | max bodies | fire wounds | gib wounds |');
lines.push('| --- | --- | ---: | --- | --- |');
for (const r of results) {
  const seg = (n) => { const s = r.segments.find((x) => x.name === n); return s?.census; };
  const f = seg('fire'); const g = seg('gib');
  lines.push(`| ${r.rep} | ${r.leg} | ${r.bodiesSeen} | ${f ? `${f.first.wounds}→${f.last.wounds}` : 'n/a'} | ${g ? `${g.first.wounds}→${g.last.wounds}` : 'n/a'} |`);
}
lines.push('');

const report = lines.join('\n');
console.log(report);
writeFileSync(`${OUT}/bench.md`, report);
console.log(`wrote ${OUT}/baselines.json and ${OUT}/bench.md`);
if (SET.gatePct != null) {
  console.log(`GATE ${gatePass ? 'PASS' : 'FAIL'}: ${SET.headline} overhead +${headlinePct.toFixed(1)}% (gate +${SET.gatePct}%)`);
} else {
  console.log(`MEASUREMENT: ${SET.headline} over ${BASE} ${headlinePct >= 0 ? '+' : ''}${headlinePct.toFixed(1)}% — ${unresolved ? 'UNRESOLVED (under spread)' : 'above spread'} (not a gate)`);
}

const badConsole = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (badConsole.length > 0) {
  for (const e of badConsole.slice(0, 10)) console.error('  |', e.type, e.text.slice(0, 300));
  fail(`${badConsole.length} console error/exception event(s) during the run`);
}

ws.close();
process.exit(0);
