// scripts/sdf-gib-assets-perf.mjs — Task 3's performance probe for the offline
// gib assets (docs/superpowers/plans/2026-09-16-offline-gib-assets.md).
//
// WHAT IT MEASURES, and why each number is the right one:
//
//   * LOADER: a `resetGibAssets()` -> `preloadGibAssets()` cycle, timed, with the
//     HTTP cache DISABLED (cold) and again warm, plus the library's own
//     `builtMs` (decode + BufferAttribute wrapping) and the fetched bytes. This
//     is the "cold/reload loader time" and "load/parse bytes and memory" rows.
//   * EXPLOSION: three detonations on three different bodies, reporting the
//     planner/spawn CPU time the page already tracks (`lastBlastMs`), the frames
//     from the blast to the first released piece (the tear window), the pieces
//     spawned, and the asset counters (hits, fallbacks, extraction jobs, bakes).
//     `runtimeExtractionJobs` is 0 by construction and is reported so the claim
//     "assets remove runtime extraction" is checkable.
//   * MOVING-GIB FRAME COST: real rAF cadence with the pieces SHOWN vs HIDDEN in
//     alternating bursts at a fixed piece count (the method sdf-piece-cost.mjs
//     settled on after two wrong measurements). Per-arm, and with an A/A boot as
//     the noise floor.
//
// The loop is LIVE for the cadence leg and STOPPED for the explosion leg (the
// page's own `step()` stops it). Order matters: cadence first would accumulate a
// bigger pile; this runs explosions first, then prices the pile they made.
//
// Usage: node scripts/sdf-gib-assets-perf.mjs <vitePort> <cdpPort> <outDir> [qs]
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5297);
const CDP = Number(process.argv[3] ?? 9297);
const OUT = process.argv[4] ?? '/tmp/gib-assets-perf';
const QS = process.argv[5] ?? '';
const BURSTS = Number(process.env.GA_PERF_BURSTS ?? 8);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, e) => { ws.onopen = ok; ws.onerror = e; });
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (mm, p = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method: mm, params: p })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
  if (r?.result?.exceptionDetails) throw new Error(`page threw: ${r.result.exceptionDetails.exception?.description}`);
  return r.result?.result?.value;
};
const pageErrors = [];
await send('Runtime.enable');
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params).slice(0, 240));
});

const url = `http://localhost:${VITE}/sdf-game.html?room=arena&frozen=1&seed=7&vhs=off`
  + (QS ? `&${QS.replace(/^\?/, '')}` : '');
console.log(`opening ${url}`);
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url });
for (let i = 0; i < 240; i++) {
  await sleep(500);
  if (await ev('typeof window.__sdfGame === "object"').catch(() => false)) break;
  if (i === 239) fail('__sdfGame never appeared');
}
for (let i = 0; i < 60; i++) {
  if (await ev('window.__sdfGame.gunReady === true').catch(() => false)) break;
  await sleep(500);
  if (i === 59) fail('the view-model never became ready');
}
for (let i = 0; i < 80; i++) {
  if (await ev('!!window.__sdfGame.roomProbesReady && window.__sdfGame.roomProbesReady()').catch(() => false)) break;
  await sleep(250);
  if (i === 79) console.log('WARNING: room probes never reported ready');
}
await sleep(600);
await ev('window.__sdfGame.setDemoHold(true)');
await ev('window.__sdfGame.setVhs(null)');
await ev('window.__sdfGame.setViewModelVisible(false)');

const modeAtBoot = await ev('window.__sdfGame.gibRenderMode()');
console.log(`boot mode ${JSON.stringify(modeAtBoot.mode)} assets ${JSON.stringify(modeAtBoot.assets)}`);

// ——— LOADER ————————————————————————————————————————————————————————————
let loader = null;
if (modeAtBoot.mode === 'assets') {
  loader = await ev(`(async () => {
    const g = window.__sdfGame;
    g.resetGibAssets();
    const t0 = performance.now();
    const armed = await g.preloadGibAssets();
    const coldMs = performance.now() - t0;
    const coldLib = g.gibAssetLibrary();
    // WARM: the bytes are in the browser cache now (the page's own fetch does
    // not set no-store), so this is the reload path a returning player pays.
    g.resetGibAssets();
    const t1 = performance.now();
    const armed2 = await g.preloadGibAssets();
    const warmMs = performance.now() - t1;
    return { coldMs, warmMs, armed, armed2, coldLib, warmLib: g.gibAssetLibrary(), stats: g.gibAssetStats() };
  })()`);
  console.log(`loader: cold ${loader.coldMs.toFixed(1)} ms, warm ${loader.warmMs.toFixed(1)} ms, `
    + `bytes ${loader.stats.loadBytes}`);
}

// ——— EXPLOSION COST (loop stopped, hand-stepped) ———————————————————————
await ev('window.__sdfGame.teleport(6)');
await ev('window.__sdfGame.setLoopRunning(false)');
await ev('window.__sdfGame.step(30)');
const explosion = await ev(`(async () => {
  const g = window.__sdfGame;
  const out = [];
  for (let k = 0; k < 3; k++) {
    const list = g.actorList().filter(a => a.room === 6);
    const a = list[k];
    if (!a) break;
    const before = g.gibAssetStats();
    const liveBefore = g.chunkStates().length;
    const spriteBefore = g.spriteCensus().live;
    const t0 = performance.now();
    const r = g.detonate(a.pos[0], a.pos[1] + 0.6, a.pos[2]);
    const detMs = performance.now() - t0;
    // STEP PAST THE TEAR WINDOW. The first version broke out as soon as
    // chunkStates() was non-empty — which is immediately, because the PREVIOUS
    // blast's pieces are still live — and then reported the new blast as "asset
    // 0". A fixed 20-frame window (0.33 s > the 0.2 s tear) makes each row the
    // blast's own.
    for (let i = 0; i < 20; i++) g.step(1);
    const after = g.gibAssetStats();
    const cs = g.chunkStats();
    out.push({
      body: k, detMs, planMs: r.lastBlastMs, tearFrames: 20,
      gibbed: r.gibbed, gibPieces: r.gibPieces,
      piecesDelta: g.chunkStates().length - liveBefore,
      spriteDelta: g.spriteCensus().live - spriteBefore,
      assetPieces: after.assetPieces - before.assetPieces,
      fallbacks: after.fallbacks, runtimeExtractionJobs: after.runtimeExtractionJobs,
      totalBakes: cs.totalBakes, spriteLive: g.spriteCensus().live, live: cs.live,
    });
  }
  return out;
})()`);
for (const e of explosion) {
  console.log(`explosion ${e.body}: det ${e.detMs.toFixed(1)} ms plan ${e.planMs?.toFixed?.(1)} `
    + `pieces +${e.piecesDelta} (asset ${e.assetPieces}, sprite +${e.spriteDelta}) bakes ${e.totalBakes}`);
}

// ——— MOVING-GIB FRAME COST (real rAF, shown vs hidden, paired bursts) ————
const settle = await ev(`(() => {
  const g = window.__sdfGame;
  g.setLoopRunning(true);
  return { mode: g.gibRenderMode().mode, sprite: g.spriteCensus(), chunks: g.chunkCensus() };
})()`);
await sleep(1200);
const pacing = await ev(`(async () => {
  const g = window.__sdfGame;
  const BURST = 30, BURSTS = ${BURSTS};
  const byArm = { shown: [], hidden: [] };
  const pairs = [];
  let arm = 'hidden';
  g.setChunksVisible(false);
  await new Promise(res => {
    let last = 0, n = 0, burstSum = 0, burstN = 0, otherSum = 0, otherN = 0;
    const frame = (t) => {
      if (last) { const d = t - last; byArm[arm].push(d); burstSum += d; burstN++; }
      last = t; n++;
      if (n % BURST === 0) {
        if (arm === 'shown') pairs.push([otherSum / Math.max(1, otherN), burstSum / Math.max(1, burstN)]);
        arm = arm === 'shown' ? 'hidden' : 'shown';
        g.setChunksVisible(arm === 'shown');
        otherSum = burstSum; otherN = burstN; burstSum = 0; burstN = 0;
      }
      if (n >= BURST * BURSTS * 2) { res(); return; }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  g.setChunksVisible(true);
  const stat = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return { n: s.length, median: s[Math.floor(s.length / 2)] ?? 0, p95: s[Math.floor(s.length * 0.95)] ?? 0,
             max: s[s.length - 1] ?? 0 };
  };
  return { shown: stat(byArm.shown), hidden: stat(byArm.hidden), pairs };
})()`);
const finalStats = await ev('window.__sdfGame.gibAssetStats()');
const finalChunk = await ev('window.__sdfGame.chunkStats()');
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
const diffs = pacing.pairs.map(([h, s]) => s - h);
console.log(`cadence ${pacing.shown.n} frames/arm: pieces shown median ${pacing.shown.median.toFixed(2)} ms `
  + `p95 ${pacing.shown.p95.toFixed(2)} max ${pacing.shown.max.toFixed(2)}; hidden median `
  + `${pacing.hidden.median.toFixed(2)} p95 ${pacing.hidden.p95.toFixed(2)}; paired delta median `
  + `${med(diffs).toFixed(2)} ms`);

// ——— GPU PASS ROWS, PAIRED (the cadence is vsync-limited, so a cost that fits
// the 16.7 ms budget is invisible in the deltas above; a GPU timestamp row can
// still show it). Rounds alternate shown/hidden; `passTimings()` DRAINS its
// history, so it is flushed before each arm or the first arm swallows the
// session. A row that MOVES is the one the pieces are billed to.
const passRows = await ev(`(async () => {
  const g = window.__sdfGame;
  const drain = async () => { await g.passTimings(); };
  const rows = async () => {
    await drain();
    const acc = {};
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 200));
      const s = await g.passTimings();
      const latest = {};
      for (const x of (s?.samples ?? [])) latest[x.label ?? x.name] = x.ms;
      for (const [k, v] of Object.entries(latest)) (acc[k] ??= []).push(v);
    }
    const out = {};
    for (const [k, v] of Object.entries(acc)) out[k] = v.sort((a, b) => a - b)[v.length >> 1];
    return out;
  };
  const shown = [], hidden = [];
  for (let r = 0; r < 3; r++) {
    g.setChunksVisible(true);
    shown.push(await rows());
    g.setChunksVisible(false);
    hidden.push(await rows());
  }
  g.setChunksVisible(true);
  const m = (arr, k) => { const v = arr.map(x => x[k]).filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
  const labels = new Set([...shown.flatMap(Object.keys), ...hidden.flatMap(Object.keys)]);
  const deltas = {};
  for (const k of labels) {
    const s = m(shown, k), h = m(hidden, k);
    if (s !== null && h !== null) deltas[k] = { shown: s, hidden: h, delta: s - h };
  }
  return { deltas };
})()`);
const movingRows = Object.entries(passRows.deltas)
  .filter(([, v]) => Math.abs(v.delta) >= 0.05)
  .sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta));
for (const [k, v] of movingRows.slice(0, 8)) {
  console.log(`  pass row ${k}: ${v.shown.toFixed(2)} shown vs ${v.hidden.toFixed(2)} hidden -> ${v.delta.toFixed(2)} ms`);
}
if (movingRows.length === 0) console.log('  pass rows: none moved by >= 0.05 ms (or timestamps unavailable)');

const out = {
  qs: QS, url, modeAtBoot, loader, explosion, settle, pacing, diffs, passRows,
  finalStats, finalChunk: {
    live: finalChunk.live, baked: finalChunk.baked, totalBakes: finalChunk.totalBakes,
    gibAssets: finalChunk.gibAssets, faceBaked: finalChunk.faceBaked,
  },
  pageErrors,
};
writeFileSync(`${OUT}/perf.json`, JSON.stringify(out, null, 2));
console.log(`perf -> ${OUT}/perf.json`);
if (pageErrors.length) { console.error(`PAGE ERRORS (${pageErrors.length})`); pageErrors.slice(0, 5).forEach(e => console.error('  ' + e)); }
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
