// scripts/startup-freeze-probe.mjs — STARTUP + FIRST-GIB ATTRIBUTION probe
// (2026-09-16). One real live-loop run of the shipped game page, from a fresh
// tab, that records every phase the task needs to separate:
//
//   * navigation -> backend -> boot phase marks -> warm sub-phases -> READY;
//   * a CDP CPU profile of the whole boot (the synchronous main() block);
//   * the loader's own status/visibility transitions;
//   * live-loop frames through room entry, the first shot, the first dynamite
//     detonation + rupture release + first visible chunk, the first worker bake
//     submit/reply/upload and the first textured-head draw, then repeats;
//   * probe-gather health (errors / capsules / lights), long frames with their
//     pipeline creations, device.lost / uncaptured-error evidence.
//
// It does NOT pause the loop (except as the game itself does during warm), does
// not use frozen stepping, and does not touch the owner's servers: it drives a
// Vite/Chrome pair the caller started on the given ports.
//
// Usage: node scripts/startup-freeze-probe.mjs <vitePort> <cdpPort> <outDir> <label> [extraQS]
// Env:   PROFILE=0 to skip the CPU profile; START_URL to override the page URL.
import { connectGame, sleep } from './lib/sdf-closeup-stage.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5480);
const CDP = Number(process.argv[3] ?? 9480);
const OUT = process.argv[4] ?? '.lab-tmp/startup-probe';
const LABEL = process.argv[5] ?? 'run';
const QS = process.argv[6] ?? '';
const PROFILE = process.env.PROFILE !== '0';
const W = Number(process.env.PROBE_W ?? 960), H = Number(process.env.PROBE_H ?? 720);
// DPR is a stated limit of the default rig (960x720 @ DPR 1 is NOT the owner's
// headed viewport). PROBE_DPR=2 + PROBE_W/H lets a headed-equivalent run be
// measured; the value is recorded in result.viewport.
const DPR = Number(process.env.PROBE_DPR ?? 1);

mkdirSync(OUT, { recursive: true });
const url = process.env.START_URL
  ?? `http://localhost:${VITE}/sdf-game.html?room=arena&gibbones=core&pipelinelog=1&seed=7${QS}`;
console.log(`[${LABEL}] opening ${url}`);

const result = { label: LABEL, url, startedAt: new Date().toISOString(), qs: QS };
// A read error late in the run must not throw away the measurements already
// collected: persist the partial record, then fail loudly.
process.on('uncaughtException', (e) => {
  try { writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify({ ...result, fatal: String(e?.stack ?? e) }, null, 2)); } catch {}
  console.error(`[${LABEL}] FATAL`, e);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Console / browser-log tap on its own websocket (CDP events are per session).
// ---------------------------------------------------------------------------
const tap = { lines: [], counts: { queriesExceeded: 0, indexCount0: 0, gpuLost: 0, uncaptured: 0, probeGatherFail: 0, errors: 0, warnings: 0 } };

async function attachConsoleTap(tab) {
  const scan = (ts, text, level) => {
    if (!text) return;
    const t = String(text);
    if (t.includes('Maximum number of queries exceeded')) tap.counts.queriesExceeded++;
    if (/index count of 0/.test(t)) tap.counts.indexCount0++;
    if (t.includes('device lost') || t.includes('Device lost')) tap.counts.gpuLost++;
    if (/Uncaptured|uncaptured/i.test(t)) tap.counts.uncaptured++;
    if (t.includes('[probe-gather] update failed')) tap.counts.probeGatherFail++;
    if (level === 'error' || /console\.error/.test(t)) tap.counts.errors++;
    if (level === 'warning') tap.counts.warnings++;
    if (tap.lines.length < 500) tap.lines.push({ ts, level, text: t.slice(0, 240) });
  };
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      const level = m.params?.type === 'error' ? 'error' : m.params?.type === 'warning' ? 'warning' : 'log';
      scan(m.params?.timestamp, (m.params?.args ?? []).map((a) => (typeof a.value === 'string' ? a.value : a.description)).join(' '), level);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params?.entry ?? {};
      scan(m.params?.timestamp ?? e.timestamp, e.text, e.level === 'error' ? 'error' : e.level === 'warning' ? 'warning' : 'log');
    }
  };
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable', params: {} }));
  ws.send(JSON.stringify({ id: 2, method: 'Log.enable', params: {} }));
  return { close: () => ws.close() };
}

// ---------------------------------------------------------------------------
// CDP profile aggregation: top self-time functions over the boot window.
// ---------------------------------------------------------------------------
function profileTop(profile, limit = 30) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas ?? [];
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    const ms = (dt[i] ?? 0) / 1000;
    self.set(id, (self.get(id) ?? 0) + ms);
  }
  const agg = new Map();
  for (const [id, ms] of self) {
    const cf = byId.get(id)?.callFrame ?? {};
    const u = String(cf.url ?? '');
    const short = u.replace(/^.*\/src\//, 'src/').replace(/^.*\/deps\//, 'three/').replace(/^.*\/node_modules\//, '').replace(/\?.*$/, '');
    const key = `${cf.functionName || '(anon)'}  ${short}:${(cf.lineNumber ?? 0) + 1}`;
    agg.set(key, (agg.get(key) ?? 0) + ms);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  return {
    totalMs: Math.round(total),
    top: [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
      .map(([k, ms]) => ({ fn: k, ms: Math.round(ms), pct: Math.round((ms / total) * 1000) / 10 })),
  };
}

const { tab, send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: W, height: H });
if (DPR !== 1) {
  // connectGame pins deviceScaleFactor 1; raise it for a headed-equivalent run
  // BEFORE the game navigates, so the whole boot sees the real DPR.
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
}
const consoleTap = await attachConsoleTap(tab);

// Frame-time sampler in the page (real rAF, live loop).
const installFrameSampler = () => evaluate(`(() => {
  if (window.__ft) return;
  window.__ft = []; let last = performance.now();
  const tick = () => { const n = performance.now(); window.__ft.push(n - last); last = n; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})()`);
const frameStats = async () => evaluate(`(() => {
  const a = window.__ft ? window.__ft.slice() : []; if (window.__ft) window.__ft.length = 0;
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { n: a.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1) };
})()`);

// Page-level error channel is installed AFTER the page lands (a navigation
// wipes anything set on about:blank). Boot errors are covered by the console
// tap; this covers the live phase.
const installErrorChannel = () => evaluate(`(() => {
  if (window.__errs) return;
  window.__errs = []; window.__warns = [];
  window.addEventListener('error', e => window.__errs.push('error: ' + e.message));
  window.addEventListener('unhandledrejection', e => window.__errs.push('reject: ' + String(e.reason)));
  const ce = console.error.bind(console); console.error = (...a) => { window.__errs.push('console.error: ' + a.map(String).join(' ')); ce(...a); };
  const cw = console.warn.bind(console); console.warn = (...a) => { window.__warns.push(a.map(String).join(' ')); cw(...a); };
})()`);

if (PROFILE) {
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 300 });
  await send('Profiler.start');
}

const navWall = Date.now();
await evaluate(`location.href = ${JSON.stringify(url)}`);

// --- Boot gate: wait for the driver surface, then the warm record. --------
let backend = null;
const bootPoll = [];
for (let i = 0; i < 480; i++) {
  await sleep(250);
  try {
    backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
  } catch { backend = null; }
  if (backend) break;
  if (i % 20 === 19) bootPoll.push({ t: Date.now() - navWall, backend });
}
if (backend !== 'webgpu') throw new Error(`backend is ${backend}, not webgpu`);
result.backend = backend;
result.backendWallMs = Date.now() - navWall;
await installErrorChannel();

let warm = null;
for (let i = 0; i < 480; i++) {
  await sleep(250);
  try { warm = await evaluate('window.__warmDone ?? null'); } catch { warm = null; }
  if (warm) break;
}
result.warmWallMs = Date.now() - navWall;
result.warm = warm;
result.bootPoll = bootPoll;

if (PROFILE) {
  let prof = null;
  try { prof = (await send('Profiler.stop')).result.profile; } catch (e) { console.log('profile stop failed', e.message); }
  await send('Profiler.disable');
  if (prof) {
    writeFileSync(`${OUT}/${LABEL}-boot.cpuprofile`, JSON.stringify(prof));
    result.cpuProfile = { file: `${LABEL}-boot.cpuprofile`, ...profileTop(prof) };
  }
}

// --- Phase + loader + device + probe state at the warm boundary. -----------
const snapshot = () => evaluate(`(() => {
  const g = window.__sdfGame;
  const loader = document.getElementById('loader');
  return {
    t: Math.round(performance.now()),
    bootMarks: g.bootMarks ? g.bootMarks() : (window.__bootMarks ?? null),
    warmDone: window.__warmDone ?? null,
    loader: { status: document.getElementById('loader-status')?.textContent ?? null,
              hidden: !!loader?.classList.contains('loader-hidden'),
              ready: !!loader?.classList.contains('loader-ready') },
    loopRunning: g.loopRunning ? g.loopRunning() : null,
    gpuDiagnostics: g.gpuDiagnostics ? g.gpuDiagnostics() : (window.__gpuDiagnostics ?? null),
    gibRenderer: g.gibRenderer ? g.gibRenderer() : null,
    probeDynamic: g.probeDynamic ?? null,
    chunkStats: g.chunkStats ? g.chunkStats() : null,
    gunReady: g.gunReady ?? null,
    frames: g.frames ?? null,
  };
})()`);
result.atWarm = await snapshot();
// Did the loader honestly stay up on a slow warm?
for (let i = 0; i < 8; i++) {
  await sleep(1000);
  result.atWarmSettle = await snapshot();
  if (result.atWarmSettle.loader.hidden) break;
}

await installFrameSampler();
// LIFECYCLE CONTRACT (warm-gate.ts), verified on the real warm path: a warm
// that finishes while the loop is deliberately paused must LEAVE IT PAUSED,
// and one that runs with the loop armed must leave it armed. The old code
// forced setLoopRunning(true) in its finally, so the first case returned true.
result.lifecycle = await evaluate(`(async () => {
  const g = window.__sdfGame;
  if (typeof g.rewarm !== 'function') return { skipped: 'no rewarm seam' };
  g.setLoopRunning(true); await g.rewarm();
  const afterRunning = g.loopRunning();
  g.setLoopRunning(false); await g.rewarm();
  const afterPaused = g.loopRunning();
  // PAUSE DURING WARM (reviewer correction 2026-09-16): the old finally
  // reapplied the state snapshotted at warm START, so this pause was lost.
  g.setLoopRunning(true);
  const inFlight = g.rewarm();
  g.setLoopRunning(false); // deliberate pause while the warm is running
  await inFlight;
  const afterPauseDuringWarm = g.loopRunning();
  g.setLoopRunning(true);
  return { loopAfterRunningWarm: afterRunning, loopAfterPausedWarm: afterPaused, loopAfterPauseDuringWarm: afterPauseDuringWarm };
})()`);
result.warmGate = await evaluate('window.__warmGate ?? null');

// Let the loop run clean for a moment; sample baseline frames.
await sleep(1500);
await frameStats(); // clear
await sleep(2000);
result.perf = { postWarmIdle: await frameStats() };

// --- Live-loop actions -----------------------------------------------------
const dmg = () => evaluate('window.__sdfGame.dynamite()');
const chunks = () => evaluate('window.__sdfGame.chunkCensus()');
const cstats = () => evaluate('window.__sdfGame.chunkStats()');
const errors = () => evaluate('window.__errs ? window.__errs.slice() : []');

const actionLog = {};
// Pipeline-log cursor: every action window reports how many pipelines were
// created inside it and how many long frames it added, so a stall is attributed
// to creations (or explicitly NOT — a long frame with no creation is its own
// finding).
const plogCursor = () => evaluate(`(() => {
  const l = window.__sdfGame.pipelineLog();
  return { total: l.totalPipelines, totalMs: l.totalCompileMs, longFrames: (l.frames || []).length };
})()`);
/** The long frames recorded since a cursor, with their creation counts. */
const longFramesSince = async (beforeLen) => evaluate(`(() => {
  const all = (window.__sdfGame.pipelineLog().frames || []);
  return all.slice(${JSON.stringify(beforeLen)}).map(f => ({
    frame: f.frame, ms: f.ms, creations: (f.pipelines || []).length,
    names: [...new Set((f.pipelines || []).map(p => p.name))].slice(0, 6),
  }));
})()`);
const action = async (name, fn) => {
  const t0 = Date.now();
  await frameStats(); // clear before
  const pre = await cstats();
  const pl0 = await plogCursor();
  await fn();
  const frames = await frameStats();
  const pl1 = await plogCursor();
  actionLog[name] = {
    wallMs: Date.now() - t0,
    frames,
    pipelinesCreated: pl1.total - pl0.total,
    compileMs: Math.round((pl1.totalMs - pl0.totalMs) * 10) / 10,
    longFramesAdded: pl1.longFrames - pl0.longFrames,
    longFrames: await longFramesSince(pl0.longFrames),
  };
  return pre;
};

result.actions = actionLog;

// Room entry: leave the arena and come back.
const arenaRoom = await evaluate('window.__sdfGame.playerPos && window.__sdfGame.room ? window.__sdfGame.room() : null');
result.arenaRoom = arenaRoom;
await action('roomEntry', async () => {
  await evaluate('window.__sdfGame.teleport(1)');
  await sleep(700);
  await evaluate(`window.__sdfGame.teleport(${Number.isFinite(Number(arenaRoom)) ? Number(arenaRoom) : 6})`);
  await sleep(700);
});

// First shot.
if ((await evaluate('window.__sdfGame.gunReady')) === true) {
  await action('firstShot', async () => {
    await evaluate('window.__sdfGame.fire(2)');
    await sleep(500);
  });
  await evaluate('window.__sdfGame.pinReloadSeed && window.__sdfGame.pinReloadSeed(1)');
  await evaluate('window.__sdfGame.setInfiniteAmmo && window.__sdfGame.setInfiniteAmmo(true)');
  await evaluate('window.__sdfGame.refillShells && window.__sdfGame.refillShells()');
}

// First dynamite detonation, tracked from the blast frame through release,
// worker submit/reply/upload and the first textured-head bake.
const pickNearest = `(() => {
  const pp = window.__sdfGame.playerPos();
  const list = window.__sdfGame.actorList().filter(a => a.kind === 'zombie')
    .sort((a, b) => Math.hypot(a.pos[0]-pp[0],a.pos[2]-pp[2]) - Math.hypot(b.pos[0]-pp[0],b.pos[2]-pp[2]));
  return list[0] ?? null;
})()`;
const target = await evaluate(pickNearest);
result.target = target;
if (target) {
  // Stand the player near it and aim so the blast is visible to the camera.
  await evaluate(`window.__sdfGame.setPose(${target.pos[0]}, ${target.pos[2] + 2.4}, 0, 0)`);
  await evaluate(`window.__sdfGame.aimSurface(undefined, ${target.id})`);
  await sleep(400);
  await frameStats();
  const blast = await action('firstDetonation', async () => {
    await evaluate(`window.__sdfGame.detonate(${target.pos[0]}, ${target.pos[1] + 0.6}, ${target.pos[2]})`);
  });
  // Poll the transition timeline for 4 s.
  const tl = [];
  const t0 = Date.now();
  let firstLive = null, firstBakePending = null, firstBake = null, firstFace = null;
  for (let i = 0; i < 80; i++) {
    await sleep(50);
    const [d, c, cs] = await Promise.all([dmg(), chunks(), cstats()]);
    const rec = {
      t: Date.now() - t0, pendingGibs: d.pendingGibs ?? null, tearing: d.tearing ?? null,
      tier: d.pendingTiers?.[0] ?? d.lastTier ?? null, blastMs: d.lastBlastMs ?? null,
      live: c.live, baked: c.baked, pendingBake: cs.pendingBake, totalBakes: cs.totalBakes,
      lastBakeMs: cs.lastBakeMs, lastBakeSwapMs: cs.lastBakeSwapMs, faceBaked: cs.faceBaked,
    };
    tl.push(rec);
    if (firstLive === null && c.live > 0) firstLive = rec;
    if (firstBakePending === null && cs.pendingBake != null) firstBakePending = rec;
    if (firstBake === null && cs.totalBakes > 0) firstBake = rec;
    if (firstFace === null && (cs.faceBaked ?? 0) > 0) firstFace = rec;
    if (firstFace && firstBake && i > 20) break;
  }
  result.gibTimeline = {
    blastWallMs: blast.wallMs, blastFrames: blast.frames,
    firstVisibleChunk: firstLive, firstBakeSubmit: firstBakePending,
    firstBakeSwap: firstBake, firstTexturedHeadDraw: firstFace,
    samples: tl.filter((r, i) => i % 4 === 0 || r === firstLive || r === firstBake || r === firstFace),
  };
  result.actions.firstDetonation = blast.frames;
  await frameStats();
  // MATCHED CADENCE. Repeated shots and repeated explosions, one measured
  // window each, with a FIXED 450 ms gap so the before/after runs are
  // comparable. Per-window creation counts separate "long frame WITH pipeline
  // creation" from "long frame with none" (the latter is its own finding).
  const shotWindows = [];
  for (let k = 0; k < 6; k++) {
    const name = `repeatShot${k}`;
    await action(name, async () => {
      await evaluate('window.__sdfGame.fire(2)');
      await sleep(450);
    });
    shotWindows.push(actionLog[name]);
  }
  const blastWindows = [];
  for (let k = 0; k < 6; k++) {
    const q = await evaluate(pickNearest);
    const name = `repeatBlast${k}`;
    await action(name, async () => {
      if (q) await evaluate(`window.__sdfGame.detonate(${q.pos[0]}, ${q.pos[1] + 0.6}, ${q.pos[2]})`);
      await sleep(450);
    });
    blastWindows.push(actionLog[name]);
  }
  const summarizeWindows = (wins) => ({
    windows: wins.length,
    totalPipelinesCreated: wins.reduce((a, w) => a + (w.pipelinesCreated ?? 0), 0),
    maxFrameMs: wins.reduce((a, w) => Math.max(a, w.frames?.max ?? 0), 0),
    maxP95: wins.reduce((a, w) => Math.max(a, w.frames?.p95 ?? 0), 0),
    longFrames: wins.reduce((a, w) => a + (w.longFramesAdded ?? 0), 0),
    perWindow: wins.map((w) => ({
      created: w.pipelinesCreated, compileMs: w.compileMs, long: w.longFramesAdded,
      p95: w.frames?.p95 ?? null, max: w.frames?.max ?? null,
      longFrameDetail: (w.longFrames ?? []).filter((f) => f.ms >= 100).slice(0, 4),
    })),
  });
  result.repeatedShots = summarizeWindows(shotWindows);
  result.repeatedBlasts = summarizeWindows(blastWindows);
}

// Probe-gather STRESS: pack >512 bone rows near the room, then push toward the
// admitted 1024-row maximum. The probe fix (fdf20ad0) must keep errors at 0
// instead of throwing "N capsules exceed max 1024".
//
// SPAWN vs STEADY ARE SEPARATE (reviewer correction 2026-09-16): the old table
// measured one window that contained the spawning itself and called it gather
// cost. Each level now measures a spawn window, waits for spawn to settle, then
// measures a clean 2 s steady-state window with no spawning in it.
const stress = [];
const charName = await evaluate('(() => { const n = window.__sdfGame.characterNames?.() ?? []; return n[0] ?? "zombie"; })()');
for (const n of [6, 9, 12, 20]) {
  const pre = await evaluate('(() => { const p = window.__sdfGame.probeDynamic; return { frames: p.frames, errors: p.errors, capsules: p.gates?.capsules ?? null }; })()');
  const pl0 = await plogCursor();
  await frameStats(); // clear before spawn
  const spawn = await evaluate(`(() => { try { return window.__sdfGame.spawnCrowd(${JSON.stringify(charName)}, ${n}, { spacing: 0.9 }); } catch (e) { return { error: String(e) }; } })()`);
  await sleep(500);
  const spawnFrames = await frameStats(); // includes the spawn's own CPU
  await sleep(3000); // let the spawn settle so the next window has no spawn CPU
  await frameStats(); // clear
  const steadyT0 = Date.now();
  await sleep(2000);
  const steadyFrames = await frameStats(); // steady-state gather only
  const post = await evaluate('(() => { const p = window.__sdfGame.probeDynamic; return { frames: p.frames, errors: p.errors, bound: p.bound, capsules: p.gates?.capsules ?? null, lights: p.gates?.lights ?? null, dynOn: p.gates?.dynOn, radianceGain: p.radianceGain, visStrength: p.visStrength }; })()');
  const pl1 = await plogCursor();
  stress.push({
    requested: n, charName, spawn, pre, post,
    spawnFrames, steadyFrames, steadyWallMs: Date.now() - steadyT0,
    steadyGainFrames: (post.frames ?? 0) - (pre.frames ?? 0),
    pipelinesCreated: pl1.total - pl0.total,
  });
}
result.probeStress = stress;

// Probe-gather health while bodies are near the room.
result.probeHealth = await evaluate(`(() => {
  const p = window.__sdfGame.probeDynamic;
  return { errors: p.errors, frames: p.frames, bound: p.bound, rate: p.rate,
           gates: p.gates, radianceGain: p.radianceGain, visStrength: p.visStrength };
})()`);

// Long frames + pipeline creations after warm, plus final device state.
// CORRECTED ATTRIBUTION (reviewer 2026-09-16): the payload now carries three's
// own render-cache-key rebuild census, the full-descriptor groups with their
// distinct-key counts, the shader-module census and the cache evictions — so a
// "rebuilt" claim can be tied to the actual cache key and to the release that
// preceded it, instead of to a partial signature.
result.pipelineLog = await evaluate(`(() => {
  const l = window.__sdfGame.pipelineLog();
  return { totalPipelines: l.totalPipelines, totalCompileMs: l.totalCompileMs,
    longFrames: (l.frames || []).map(f => ({ frame: f.frame, ms: f.ms, creations: (f.pipelines || []).length,
      names: [...new Set((f.pipelines || []).map(p => p.name))].slice(0, 8) })),
    slowest: (l.slowest || []).slice(0, 12).map(p => ({ name: p.name, ms: Math.round(p.ms), async: p.async, via: p.via, frame: p.frame })),
    rebuilds: (l.rebuilds || []).slice(0, 16).map(r => ({ key: r.key, name: r.name, count: r.count,
      firstFrame: r.firstFrame, lastFrame: r.lastFrame, objects: r.objects,
      releases: (r.releases || []).map(x => ({ frame: x.frame, via: x.via, object: x.objectType + (x.objectName ? ':' + x.objectName : ''), material: x.material })) })),
    descriptorGroups: (l.descriptorGroups || []).slice(0, 16).map(d => ({ name: d.name, count: d.count,
      distinctThreeKeys: d.distinctThreeKeys, firstFrame: d.firstFrame, lastFrame: d.lastFrame, sig: d.sig.slice(0, 240) })),
    shaderModules: l.shaderModules,
    evictions: { total: l.evictions?.total, byObject: (l.evictions?.byObject || []).slice(0, 12),
      events: (l.evictions?.events || []).slice(-24).map(e => ({ key: e.key, frame: e.frame, via: e.via,
        object: e.objectType + (e.objectName ? ':' + e.objectName : ''), material: e.material })) },
    compute: l.compute };
})()`);
result.viewport = await evaluate(`(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
  canvasW: document.querySelector('canvas')?.width ?? null, canvasH: document.querySelector('canvas')?.height ?? null }))()`);
result.final = await evaluate(`(() => {
  const g = window.__sdfGame;
  return { chunkStats: g.chunkStats(), chunkCensus: g.chunkCensus(),
           probeDynamic: g.probeDynamic, gpuDiagnostics: g.gpuDiagnostics(),
           gibRenderer: g.gibRenderer(), frames: g.frames, loopRunning: g.loopRunning(),
           bootMarks: g.bootMarks() };
})()`);
result.pageErrors = await errors();
result.consoleCounts = tap.counts;
result.consoleTail = tap.lines.slice(-40);

writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(result, null, 2));
console.log(`[${LABEL}] wrote ${OUT}/${LABEL}.json`);
console.log(`[${LABEL}] warm=${JSON.stringify(warm)}`);
console.log(`[${LABEL}] actions=${JSON.stringify(actionLog)}`);
console.log(`[${LABEL}] probeErrors=${result.probeHealth?.errors} capsules=${result.probeHealth?.gates?.capsules} lights=${result.probeHealth?.gates?.lights}`);
console.log(`[${LABEL}] gpuLost=${JSON.stringify(result.final?.gpuDiagnostics?.lost)} uncaptured=${result.final?.gpuDiagnostics?.uncapturedCount}`);
console.log(`[${LABEL}] pageErrors=${JSON.stringify(result.pageErrors)}`);
console.log(`[${LABEL}] longFrames=${result.pipelineLog?.longFrames?.length} slowest=${JSON.stringify((result.pipelineLog?.slowest ?? []).slice(0, 6))}`);
console.log(`[${LABEL}] rebuilds=${JSON.stringify((result.pipelineLog?.rebuilds ?? []).slice(0, 6).map(r => ({ key: r.key, name: r.name, count: r.count, first: r.firstFrame, last: r.lastFrame, releases: r.releases.length })))}`);
console.log(`[${LABEL}] descriptorGroups=${JSON.stringify((result.pipelineLog?.descriptorGroups ?? []).slice(0, 6).map(d => ({ name: d.name, count: d.count, keys: d.distinctThreeKeys })))}`);
console.log(`[${LABEL}] evictions=${result.pipelineLog?.evictions?.total} byObject=${JSON.stringify(result.pipelineLog?.evictions?.byObject ?? [])}`);
console.log(`[${LABEL}] shaderModules=${JSON.stringify(result.pipelineLog?.shaderModules)}`);
console.log(`[${LABEL}] viewport=${JSON.stringify(result.viewport)}`);
console.log(`[${LABEL}] repeatedShots=${JSON.stringify({ created: result.repeatedShots?.totalPipelinesCreated, max: result.repeatedShots?.maxFrameMs, p95: result.repeatedShots?.maxP95, long: result.repeatedShots?.longFrames })}`);
console.log(`[${LABEL}] repeatedBlasts=${JSON.stringify({ created: result.repeatedBlasts?.totalPipelinesCreated, max: result.repeatedBlasts?.maxFrameMs, p95: result.repeatedBlasts?.maxP95, long: result.repeatedBlasts?.longFrames })}`);
console.log(`[${LABEL}] probeStress=${JSON.stringify((result.probeStress ?? []).map(s => ({ n: s.requested, ok: s.spawn?.ok, rows: s.post?.capsules, lights: s.post?.lights, errors: s.post?.errors, dynOn: s.post?.dynOn, spawnP95: s.spawnFrames?.p95, steadyP95: s.steadyFrames?.p95, steadyMax: s.steadyFrames?.max, steadyN: s.steadyFrames?.n, gathered: s.steadyGainFrames, created: s.pipelinesCreated })))}`);
if (result.gibTimeline) {
  const g = result.gibTimeline;
  console.log(`[${LABEL}] gib: firstLive=${g.firstVisibleChunk?.t}ms(=${g.firstVisibleChunk?.live}) firstBakeSubmit=${g.firstBakeSubmit?.t}ms firstSwap=${g.firstBakeSwap?.t}ms worker=${Math.round(g.firstBakeSwap?.lastBakeMs || 0)}ms swap=${g.firstBakeSwap?.lastBakeSwapMs}ms firstFace=${g.firstTexturedHeadDraw?.t ?? 'none'}ms`);
}
if (result.cpuProfile) {
  console.log(`[${LABEL}] cpu profile total ${result.cpuProfile.totalMs} ms; top self:`);
  for (const r of result.cpuProfile.top.slice(0, 18)) console.log(`   ${String(r.ms).padStart(7)} ms ${String(r.pct).padStart(5)}%  ${r.fn}`);
}

consoleTap.close();
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
process.exit(0);
