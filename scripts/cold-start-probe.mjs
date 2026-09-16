// scripts/cold-start-probe.mjs — COLD-SESSION (first-ever page load) vs
// SAME-SESSION RELOAD attribution probe (2026-09-16, task 1).
//
// WHAT IT ANSWERS. The owner reports a random long pause on a COLD start but
// smoother subsequent reloads. The existing startup-freeze-probe always runs in
// an already-warm browser profile and measures one boot; it cannot separate
// "the work everybody pays every load" from "the work only the first-ever load
// pays" (module download/parse, V8 code cache, WebGPU pipeline disk cache,
// HTTP cache). This probe drives ONE tab through LOADS navigations:
//   load 0 = cold navigation in a fresh profile,
//   load 1..N-1 = Page.reload in the same tab/profile (warm).
// Every load records the same phase marks, warm sub-phases, skeleton-mesh
// extraction counters, pipeline totals, resource-timing census, long tasks,
// rAF intervals and (optionally) a CDP CPU profile.
//
// It never clears a profile it did not create, never touches the owner's
// servers, and does not pause the loop except as the game itself does.
//
// Usage: node scripts/cold-start-probe.mjs <vitePort> <cdpPort> <outDir> <label> [extraQS]
// Env:   LOADS=3 PROFILE=1 PROBE_DPR=2 PROBE_W=1512 PROBE_H=982
//        START_URL overrides the whole page URL.
import { connectGame, sleep } from './lib/sdf-closeup-stage.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5490);
const CDP = Number(process.argv[3] ?? 9490);
const OUT = process.argv[4] ?? '.lab-tmp/cold-start';
const LABEL = process.argv[5] ?? 'run';
const QS = process.argv[6] ?? '';
const LOADS = Number(process.env.LOADS ?? 3);
const PROFILE = process.env.PROFILE !== '0';
const W = Number(process.env.PROBE_W ?? 1512);
const H = Number(process.env.PROBE_H ?? 982);
const DPR = Number(process.env.PROBE_DPR ?? 2);

mkdirSync(OUT, { recursive: true });
const url = process.env.START_URL
  ?? `http://localhost:${VITE}/sdf-game.html?seed=7${QS}`;
console.log(`[${LABEL}] opening ${url} (${LOADS} loads, ${W}x${H} DPR${DPR})`);

const result = {
  label: LABEL, url, qs: QS, loads: LOADS,
  viewport: { width: W, height: H, dpr: DPR },
  startedAt: new Date().toISOString(), samples: [],
};

process.on('uncaughtException', (e) => {
  try { writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify({ ...result, fatal: String(e?.stack ?? e) }, null, 2)); } catch {}
  console.error(`[${LABEL}] FATAL`, e);
  process.exit(1);
});

function profileTop(profile, limit = 30) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas ?? [];
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0) / 1000);
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

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: W, height: H });
if (DPR !== 1) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
}

// Installed on EVERY new document (cold navigation AND reloads). Capture from
// document start, before the game script runs.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const cs = { longTasks: [], raf: [], errors: [], t0: performance.timeOrigin };
    window.__cs = cs;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (cs.longTasks.length < 4000) cs.longTasks.push({ s: Math.round(e.startTime), d: Math.round(e.duration) });
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch (e) { cs.noLongTask = String(e); }
    let last = performance.now();
    const tick = () => {
      const n = performance.now();
      if (cs.raf.length < 30000) cs.raf.push(Math.round(n - last));
      last = n; requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.addEventListener('error', (e) => cs.errors.push('error: ' + e.message));
    window.addEventListener('unhandledrejection', (e) => cs.errors.push('reject: ' + String(e.reason)));
  })();`,
});

const snapshot = () => evaluate(`(() => {
  const g = window.__sdfGame; const cs = window.__cs || {};
  const res = performance.getEntriesByType('resource');
  const byType = {}; let transfer = 0, encoded = 0, dur = 0;
  for (const r of res) {
    byType[r.initiatorType] = (byType[r.initiatorType] || 0) + 1;
    transfer += r.transferSize || 0; encoded += r.encodedBodySize || 0; dur += r.duration || 0;
  }
  const nav = performance.getEntriesByType('navigation')[0];
  const lts = cs.longTasks || [];
  const loader = document.getElementById('loader');
  return {
    t: Math.round(performance.now()),
    backend: g ? g.backend : null,
    bootMarks: g && g.bootMarks ? g.bootMarks() : (window.__bootMarks ?? null),
    warmDone: window.__warmDone ?? null,
    warmGate: window.__warmGate ?? null,
    loader: { status: document.getElementById('loader-status')?.textContent ?? null,
              hidden: !!loader?.classList.contains('loader-hidden'),
              ready: !!loader?.classList.contains('loader-ready') },
    loopRunning: g && g.loopRunning ? g.loopRunning() : null,
    gunReady: g ? g.gunReady : null,
    frames: g ? g.frames : null,
    skeletonMesh: g && g.skeletonMesh ? g.skeletonMesh() : null,
    bodyBuild: g && g.bodyBuild ? g.bodyBuild() : null,
    gpuDiagnostics: g && g.gpuDiagnostics ? g.gpuDiagnostics() : null,
    resources: { count: res.length, byType, transferSize: transfer, encodedBodySize: encoded, totalDuration: Math.round(dur) },
    navigation: nav ? { responseEnd: Math.round(nav.responseEnd), domContentLoaded: Math.round(nav.domContentLoadedEventEnd), loadEvent: Math.round(nav.loadEventEnd) } : null,
    longTasks: { n: lts.length, totalMs: Math.round(lts.reduce((a, e) => a + e.d, 0)),
                 longest: lts.slice().sort((a, b) => b.d - a.d).slice(0, 15) },
    raf: cs.raf ? cs.raf.slice() : null,
    pageErrors: cs.errors ? cs.errors.slice(0, 20) : null,
  };
})()`);

const frameStats = (arr) => {
  if (!arr || !arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { n: arr.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] };
};

const marksDelta = (marks) => {
  const out = {};
  if (!marks) return out;
  const get = (n) => marks.find((m) => m.n === n)?.t ?? null;
  const names = [...new Set(marks.map((m) => m.n))];
  for (const n of names) {
    const i = marks.findIndex((m) => m.n === n);
    const next = marks[i + 1];
    if (next) out[`${n}->${next.n}`] = next.t - marks[i].t;
  }
  return out;
};

for (let load = 0; load < LOADS; load++) {
  const navWall = Date.now();
  if (PROFILE) {
    await send('Profiler.enable');
    await send('Profiler.setSamplingInterval', { interval: 300 });
    await send('Profiler.start');
  }
  // CDP-driven navigation: survives the context swap without an evaluate throw.
  if (load === 0) await send('Page.navigate', { url });
  else await send('Page.reload', { ignoreCache: false });

  // 1) game object (backend) — module eval + renderer construction.
  let backend = null;
  for (let i = 0; i < 480; i++) {
    await sleep(250);
    try { backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null'); } catch { backend = null; }
    if (backend) break;
  }
  if (backend !== 'webgpu') throw new Error(`load ${load}: backend is ${backend}, not webgpu`);
  const backendWallMs = Date.now() - navWall;

  // 2) warm done (the blocking compile/extract window behind the loader).
  let warm = null;
  for (let i = 0; i < 480; i++) {
    await sleep(250);
    try { warm = await evaluate('window.__warmDone ?? null'); } catch { warm = null; }
    if (warm) break;
  }
  const warmWallMs = Date.now() - navWall;

  // 3) loader settles READY (actual readiness).
  let readyWallMs = null;
  for (let i = 0; i < 80; i++) {
    const g = await evaluate('typeof window.__warmGate === "object" ? window.__warmGate : null');
    if (g) { readyWallMs = Date.now() - navWall; break; }
    await sleep(250);
  }

  let profile = null;
  if (PROFILE) {
    let prof = null;
    try { prof = (await send('Profiler.stop')).result.profile; } catch (e) { console.log('profile stop failed', e.message); }
    await send('Profiler.disable');
    if (prof) {
      writeFileSync(`${OUT}/${LABEL}-load${load}.cpuprofile`, JSON.stringify(prof));
      profile = { file: `${LABEL}-load${load}.cpuprofile`, ...profileTop(prof) };
    }
  }

  // 4) Post-READY live frames: clear the rAF buffer, then sample 2.5 s.
  await sleep(1200);
  await evaluate('window.__cs.raf.length = 0');
  await sleep(2500);
  const liveRaf = await evaluate('window.__cs.raf.slice()');

  const snap = await snapshot();
  snap.load = load;
  snap.mode = load === 0 ? 'cold' : 'warm-reload';
  snap.backendWallMs = backendWallMs;
  snap.warmWallMs = warmWallMs;
  snap.readyWallMs = readyWallMs;
  snap.warm = warm;
  snap.markDeltas = marksDelta(snap.bootMarks);
  snap.postReadyFrames = frameStats(liveRaf);
  delete snap.raf;
  if (profile) snap.profile = profile;
  result.samples.push(snap);
  console.log(`[${LABEL}] load ${load} (${snap.mode}) backend=${backendWallMs}ms warm=${warmWallMs}ms ready=${readyWallMs}ms`);
  console.log(`   warm.phases=${JSON.stringify(snap.warm?.phases)}`);
  console.log(`   mesh.cacheStats=${JSON.stringify(snap.skeletonMesh?.cacheStats)}`);
  console.log(`   bodyBuild=${JSON.stringify(snap.bodyBuild)}`);
  console.log(`   resources=${JSON.stringify(snap.resources)}`);
  console.log(`   longTasks=${JSON.stringify(snap.longTasks)}`);
  console.log(`   postReady=${JSON.stringify(snap.postReadyFrames)}`);
  console.log(`   markDeltas=${JSON.stringify(snap.markDeltas)}`);
  if (snap.profile) {
    console.log(`   cpu total ${snap.profile.totalMs} ms; top:`);
    for (const r of snap.profile.top.slice(0, 12)) console.log(`      ${String(r.ms).padStart(6)} ms ${String(r.pct).padStart(5)}%  ${r.fn}`);
  }
}

// OPTIONAL APPEARANCE SHOT (SHOT=1): stand near the arena horde and capture a
// PNG so a body-build change can be checked with native vision, not inferred
// from telemetry. Uses the same live page; no extra boot.
if (process.env.SHOT) {
  try {
    await evaluate('window.__sdfGame.teleport(6)');
    await sleep(1200);
    const near = await evaluate(`(() => {
      const pp = window.__sdfGame.playerPos();
      const list = window.__sdfGame.actorList().sort((a,b)=>Math.hypot(a.pos[0]-pp[0],a.pos[2]-pp[2])-Math.hypot(b.pos[0]-pp[0],b.pos[2]-pp[2]));
      return list[0] ?? null;
    })()`);
    if (near) {
      // Stand 2.6 m south of the body and aim at its chest, the same framing the
      // close-up scripts use, so the head and limbs fill the frame.
      await evaluate(`window.__sdfGame.setPose(${near.pos[0]}, ${near.pos[2] + 2.6}, 0, 0)`);
      await evaluate(`window.__sdfGame.aimSurface(undefined, ${near.id})`);
      await sleep(900);
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/${LABEL}-arena.png`, Buffer.from(shot.result.data, 'base64'));
    console.log(`[${LABEL}] wrote ${OUT}/${LABEL}-arena.png (target ${near ? near.id : 'none'})`);
  } catch (e) {
    console.log(`[${LABEL}] SHOT failed: ${e.message}`);
  }
}

result.finishedAt = new Date().toISOString();
writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(result, null, 2));
console.log(`[${LABEL}] wrote ${OUT}/${LABEL}.json`);
process.exit(0);
