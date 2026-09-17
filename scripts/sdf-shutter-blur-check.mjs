// scripts/sdf-shutter-blur-check.mjs
//
// Task-3 focused reproducible runner for the selective shutter-blur lab
// (/sdf-blood-compare.html). It is the live-review + cost-measurement sibling
// of scripts/shutter-lab-capture.mjs (Task 1/2 evidence dump):
//
//   1. review   — sharp | efficient candidate | sampled oracle triples across
//                 the plan's motion classes, plus off-center/asymmetric
//                 framing, wall/body occlusion, static pools, spawn/contact/
//                 settle, a camera turn and a stopped-motion repeat.
//   2. cadence  — the SAME timed trajectory presented at 30/60/120 by driving
//                 the shared clock with 1/30, 1/60 and 1/120 s steps; the
//                 fixed shutter interval must not change with cadence.
//   3. bench    — frozen-frame off vs candidate with labeled GPU passes,
//                 fenced per-frame p50/p95, CPU prep, memory and cold/warm
//                 first-use (ordinary, heavy, empty, long-exposure cap).
//   4. clips    — one normal-speed playback clip and one play→pause clip to
//                 expose residual ghosts; assembled with ffmpeg.
//
// Owns its own vite + headless Chrome on an UNUSED port pair, with its own
// profile under .lab-tmp, and launches Chrome WITHOUT any unsafe flag (Chrome
// 152 stable has WebGPU on by default). Refuses to reuse a port it did not
// start. Stop only the processes it started.
//
// Usage:
//   node scripts/sdf-shutter-blur-check.mjs [vitePort] [cdpPort] [outDir] [--only=review,cadence,bench,clips]
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const VITE = Number(process.argv[2] ?? 5463);
const CDP = Number(process.argv[3] ?? 9463);
const OUT = resolve(process.argv[4] ?? 'docs/dev-notes/2026-09-16-shutter-blur/evidence');
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY = new Set(onlyArg ? onlyArg.slice('--only='.length).split(',') : ['review', 'cadence', 'bench', 'clips', 'game']);
const LAB_TMP = resolve('.lab-tmp');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const children = [];
function shutdown(code) {
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch {} }
  }
  setTimeout(() => process.exit(code), 500);
}
process.on('exit', () => { for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch {} } });

async function waitFor(url, what, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await sleep(500);
  }
  throw new Error(`${what} never came up at ${url}`);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(`${LAB_TMP}/tmp-${CDP}`, { recursive: true });

// Fail loudly if a port is already taken: never drive someone else's server.
for (const [port, what] of [[VITE, 'vite'], [CDP, 'chrome']]) {
  try {
    const r = await fetch(`http://localhost:${port}/`);
    if (r.status >= 0) { console.error(`port ${port} (${what}) is already answering — choose another`); process.exit(2); }
  } catch { /* connection refused = free */ }
}

console.log(`starting vite on ${VITE}`);
const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(VITE), '--strictPort'], {
  stdio: 'ignore', detached: true,
});
children.push(vite);
await waitFor(`http://localhost:${VITE}/`, 'vite');

console.log(`starting headless chrome (WebGPU defaults, no unsafe flags) on ${CDP}`);
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${LAB_TMP}/chrome-${CDP}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-crash-reporter', `--crash-dumps-dir=${LAB_TMP}/crashpad-${CDP}`,
  '--window-size=820,620',
  'about:blank',
], { stdio: 'ignore', detached: true, env: { ...process.env, TMPDIR: `${LAB_TMP}/tmp-${CDP}` } });
children.push(chrome);
await waitFor(`http://localhost:${CDP}/json/version`, 'chrome debug port');

// ---- CDP plumbing --------------------------------------------------------
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = () => err(new Error('ws')); });
let seq = 0; const pending = new Map(); const errors = [];
let screencast = null; // { dir, index }
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
  if (m.method === 'Page.screencastFrame' && screencast) {
    const name = `frame-${String(screencast.index++).padStart(4, '0')}.png`;
    writeFileSync(`${screencast.dir}/${name}`, Buffer.from(m.params.data, 'base64'));
    send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
  }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-blood-compare.html` });

const gpu = await evaluate(`(async () => {
  if (!navigator.gpu) return 'no navigator.gpu';
  const a = await navigator.gpu.requestAdapter();
  return a ? 'ok' : 'no adapter';
})()`);
console.log('WebGPU probe:', gpu);
if (gpu !== 'ok') { console.error('WebGPU unavailable in this headless Chrome'); shutdown(3); }

let booted = false;
for (let i = 0; i < 240 && !booted; i++) {
  await sleep(500);
  booted = await evaluate('typeof window.__bloodCompare === "object"');
  const err = await evaluate('document.getElementById("errors")?.textContent ?? ""');
  if (err) { console.error('page error:', err); shutdown(4); }
}
if (!booted) { console.error('blood-compare never booted', errors.slice(-5)); shutdown(5); }
console.log('page booted; backend =', await evaluate('__bloodCompare.state().backend'));
console.log('pass timing installed =', await evaluate('__bloodCompare.passTimingInstalled'));

// Hide the control panel AND the paused/status overlays so captures are the
// canvas alone. updateDiag() re-shows #paused on every draw, so a plain
// inline display:none is not enough — the !important rule wins.
await evaluate(`(() => {
  const st = document.createElement('style');
  st.textContent = '#ui,#paused,#status{display:none !important}';
  document.head.appendChild(st);
  return true;
})()`);
await evaluate('document.getElementById("ui").style.display="none"; true');
await sleep(300);

// ---- capture helpers -----------------------------------------------------
// Merge with any previous run's report so a targeted re-run (--only=...) does
// not erase sections it did not exercise.
const REPORT_PATH = `${OUT}/task3-report.json`;
let prevReport = {};
try { prevReport = JSON.parse(readFileSync(`${REPORT_PATH}`, 'utf8')); } catch { /* first run */ }
const report = {
  ...prevReport,
  branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
  gpu,
  only: [...ONLY],
  shots: { ...(prevReport.shots ?? {}) },
  hashes: { ...(prevReport.hashes ?? {}) },
  cadence: prevReport.cadence ?? {},
  bench: prevReport.bench ?? {},
  clips: prevReport.clips ?? {},
  errors: [],
};
async function state() { return evaluate('__bloodCompare.state()'); }
async function present(settleMs = 350) {
  await evaluate('__bloodCompare.present(); true');
  await sleep(settleMs);
}
async function capture(name) {
  const st = await state();
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(`${OUT}/${name}.png`, buf);
  writeFileSync(`${OUT}/${name}.state.json`, JSON.stringify(st, null, 2));
  const hash = execFileSync('shasum', ['-a', '256'], { input: buf, encoding: 'utf8' }).slice(0, 16);
  const key = st.shutter.reference;
  report.shots[name] = {
    reference: key,
    exposureMs: st.shutter.exposureMs,
    scenario: st.scenario,
    eventTime: st.eventTime,
    droplets: st.droplets,
    splats: st.splats,
    camera: st.camera,
    source: st.source,
    candidate: st.shutter.candidate ? {
      stamps: st.shutter.candidate.stamps, texels: st.shutter.candidate.texels,
      conflicts: st.shutter.candidate.conflicts, maxStreakPx: st.shutter.candidate.maxStreakPx,
      buildMs: st.shutter.candidate.buildMs,
    } : null,
  };
  report.hashes[name] = hash;
  return hash;
}
/** Apply state, present, capture. `expr` must be a full statement list. */
async function shot(name, expr, settleMs = 350) {
  await evaluate(`${expr}; true`);
  await present(settleMs);
  return capture(name);
}
/** sharp | candidate | sampled for one frozen state. */
async function triple(prefix, baseExpr, settleMs = 350) {
  await shot(`${prefix}-sharp`, `${baseExpr}; __bloodCompare.setShutter({reference:'sharp'});`, settleMs);
  await shot(`${prefix}-candidate`, `${baseExpr}; __bloodCompare.setShutter({reference:'efficient'});`, settleMs);
  await shot(`${prefix}-sampled`, `${baseExpr}; __bloodCompare.setShutter({reference:'sampled', samples:8});`, settleMs);
}
const H = s => report.hashes[s];

// =========================================================================
// 1. REVIEW MATRIX
// =========================================================================
if (ONLY.has('review')) {
  console.log('\n=== review matrix ===');
  const OFF_CENTER = "__bloodCompare.setCamera({yaw:0.55, pitch:0.45, distance:1.6})";
  const OCCLUDED = "__bloodCompare.setCamera({yaw:2.41, pitch:-0.28, distance:2.34})";
  const DEFAULT_CAM = "__bloodCompare.setCamera({yaw:0, pitch:0.14, distance:1.35})";

  // Slow wound bleed.
  await triple('r10-bleed-1-60',
    `__bloodCompare.setMode('shutter'); ${DEFAULT_CAM}; __bloodCompare.setScenario('bleed'); __bloodCompare.setSplashTime(0.85); __bloodCompare.setShutter({preset:'1-60', maxStreakPx:120, seedScale:1, depthBias:0.02, samples:8})`);
  // Fast trail fixture. NOTE: production trail droplets inherit 1/256 of the
  // source velocity (BLOOD_TRAIL.velScale), so this is a NEAR-STATIONARY check
  // (candidate must equal the oracle), not a long-streak demonstrator.
  await triple('r11-trail-1-60',
    `__bloodCompare.setScenario('trail'); __bloodCompare.setSplashTime(0.25); __bloodCompare.setShutter({preset:'1-60', maxStreakPx:120, seedScale:1, depthBias:0.02})`);
  // Impact spray (the real fast-motion fixture).
  await triple('r12-burst-1-30',
    `__bloodCompare.setScenario('burst'); __bloodCompare.setSplashTime(0.55); __bloodCompare.setShutter({preset:'1-30', maxStreakPx:120, seedScale:1, depthBias:0.02})`);
  // Opposed crossing streams.
  await triple('r13-crossing-1-30',
    `__bloodCompare.setScenario('crossing'); __bloodCompare.setSplashTime(0.85); __bloodCompare.setShutter({preset:'1-30', maxStreakPx:120, seedScale:1, depthBias:0.02})`);
  // Close-up heavy blood: two gouts, fresh (still high in frame).
  await triple('r14-overlap-closeup-1-30',
    `__bloodCompare.setScenario('overlap'); __bloodCompare.setSplashTime(0.28); __bloodCompare.setCamera({yaw:0, pitch:0.14, distance:1.2}); __bloodCompare.setShutter({preset:'1-30', maxStreakPx:120, seedScale:1, depthBias:0.02})`);
  // Static floor pools (landing) at contact and settle; pulled back so the
  // floor stream and its pools are inside the frame.
  await triple('r15-landing-contact-1-60',
    `__bloodCompare.setCamera({yaw:0, pitch:0.05, distance:2.6}); __bloodCompare.setScenario('landing'); __bloodCompare.setSplashTime(0.45); __bloodCompare.setShutter({preset:'1-60', maxStreakPx:120, seedScale:1, depthBias:0.02})`);
  await triple('r16-landing-settle-1-60',
    `__bloodCompare.setScenario('landing'); __bloodCompare.setSplashTime(1.10); __bloodCompare.setShutter({preset:'1-60', maxStreakPx:120, seedScale:1, depthBias:0.02})`);
  // Wall/body proxy occlusion: the obstacle edge crosses the wound, so the
  // streak must be CUT at the wall rather than painted over it.
  await triple('r17-occluded-1-30',
    `__bloodCompare.setCamera({yaw:1.75, pitch:0.0, distance:1.9}); __bloodCompare.setScenario('burst'); __bloodCompare.setSplashTime(0.55); __bloodCompare.setShutter({preset:'1-30', maxStreakPx:120, seedScale:1, depthBias:0.02})`);
  // Off-center/asymmetric framing: a Y flip would point the streak the wrong way.
  await triple('r18-offcenter-1-30',
    `${OFF_CENTER}; __bloodCompare.setScenario('burst'); __bloodCompare.setSplashTime(0.55); __bloodCompare.setShutter({preset:'1-30', maxStreakPx:120, seedScale:1, depthBias:0.02})`);
  // Object-only camera turn: the same settled landing frame from two yaws.
  // Static pools must stay sharp (no camera contribution), and each side's
  // object-motion streaks must match its own sharp reference.
  await triple('r19-camera-turn-left-1-60',
    `${DEFAULT_CAM}; __bloodCompare.setCamera({yaw:-0.6, pitch:0.1, distance:1.9}); __bloodCompare.setScenario('landing'); __bloodCompare.setSplashTime(1.10); __bloodCompare.setShutter({reference:'efficient', preset:'1-60', maxStreakPx:120, seedScale:1, depthBias:0.02})`);
  await triple('r19-camera-turn-right-1-60',
    `__bloodCompare.setCamera({yaw:0.6, pitch:0.1, distance:1.9}); __bloodCompare.setShutter({reference:'efficient', preset:'1-60', maxStreakPx:120, seedScale:1, depthBias:0.02})`);
  // Empty frame: zero droplets -> the resolve must be a no-op, not a ghost.
  await shot('r20-empty-candidate-1-30',
    `${DEFAULT_CAM}; __bloodCompare.setScenario('landing'); __bloodCompare.setSplashTime(0); __bloodCompare.setShutter({reference:'efficient', preset:'1-30', maxStreakPx:120, seedScale:1, depthBias:0.02})`);
  await shot('r20-empty-sharp',
    `__bloodCompare.setShutter({reference:'sharp'})`);
  // Stopped-motion repeat: two consecutive presents of the settled frame must
  // be identical (a stale seed would keep drawing a detached ghost).
  await shot('r21-stopped-candidate-a',
    `${DEFAULT_CAM}; __bloodCompare.setScenario('landing'); __bloodCompare.setSplashTime(1.10); __bloodCompare.setShutter({reference:'efficient', preset:'1-30', maxStreakPx:120, seedScale:1, depthBias:0.02})`);
  await shot('r21-stopped-candidate-b', `__bloodCompare.present(); true`);
  // Paused/stepped parity: step the same clock a different way and compare.
  await shot('r22-stepped-candidate',
    `__bloodCompare.setScenario('burst'); __bloodCompare.setSplashTime(0.55); __bloodCompare.driveSteps(1/60, 30); __bloodCompare.setSplashTime(0.55); __bloodCompare.setShutter({reference:'efficient', preset:'1-30'})`);
  await shot('r22-scripted-candidate',
    `__bloodCompare.setSplashTime(0.55); __bloodCompare.setShutter({reference:'efficient', preset:'1-30'})`);

  // Zero-exposure parity through every reference (byte-identical).
  await shot('r00-zero-sharp', `${DEFAULT_CAM}; __bloodCompare.setScenario('burst'); __bloodCompare.setSplashTime(0.55); __bloodCompare.setShutter({reference:'sharp', preset:'off'})`);
  await shot('r01-zero-candidate', `__bloodCompare.setShutter({reference:'efficient', preset:'off'})`);
  await shot('r02-zero-sampled', `__bloodCompare.setShutter({reference:'sampled', preset:'off'})`);

  const parity = {
    sharpVsCandidate: H('r00-zero-sharp') === H('r01-zero-candidate'),
    sharpVsSampled: H('r00-zero-sharp') === H('r02-zero-sampled'),
    emptyCandidateVsSharp: H('r20-empty-candidate-1-30') === H('r20-empty-sharp'),
    stoppedRepeatsIdentical: H('r21-stopped-candidate-a') === H('r21-stopped-candidate-b'),
    steppedVsScripted: H('r22-stepped-candidate') === H('r22-scripted-candidate'),
  };
  report.parity = parity;
  console.log('parity:', parity);
}

// =========================================================================
// 2. CADENCE 30/60/120 — same timed trajectory, fixed shutter seconds
// =========================================================================
if (ONLY.has('cadence')) {
  console.log('\n=== cadence 30/60/120 ===');
  const T = 0.6;
  const cadence = {};
  for (const c of [30, 60, 120]) {
    const steps = Math.round(T * c);
    await shot(`c30-cadence-${c}`,
      `__bloodCompare.setMode('shutter'); __bloodCompare.setCamera({yaw:0.35, pitch:0.3, distance:1.6}); __bloodCompare.setScenario('bleed'); __bloodCompare.setSplashTime(0); __bloodCompare.setShutter({reference:'efficient', preset:'1-60', maxStreakPx:120, seedScale:1, depthBias:0.02}); __bloodCompare.driveSteps(${1 / c}, ${steps}); __bloodCompare.present()`);
    const st = await state();
    cadence[c] = {
      steps,
      eventTimeAfterPlayback: st.eventTime,
      droplets: st.droplets,
      hash: report.hashes[`c30-cadence-${c}`],
      shot: `c30-cadence-${c}`,
      candidate: st.shutter.candidate ? { stamps: st.shutter.candidate.stamps, texels: st.shutter.candidate.texels, maxStreakPx: st.shutter.candidate.maxStreakPx } : null,
    };
  }
  // Snap back to the exact target time and re-render: proves the playback
  // cadence left no hidden frame-history state.
  const snapped = {};
  for (const c of [30, 60, 120]) {
    await shot(`c31-cadence-snap-${c}`,
      `__bloodCompare.setSplashTime(${T}); __bloodCompare.setShutter({reference:'efficient', preset:'1-60'}); __bloodCompare.present()`);
    snapped[c] = report.hashes[`c31-cadence-snap-${c}`];
  }
  report.cadence = {
    targetSec: T,
    playback: cadence,
    playbackHashesEqual: new Set([30, 60, 120].map(c => cadence[c].hash)).size === 1,
    snappedHashes: snapped,
    snappedHashesEqual: new Set([30, 60, 120].map(c => snapped[c])).size === 1,
    snappedMatchesPlayback: new Set([30, 60, 120].map(c => snapped[c])).size === 1
      && snapped[60] === cadence[60].hash,
  };
  console.log('cadence:', JSON.stringify(report.cadence));
}

// =========================================================================
// 3. BENCH — frozen frame, off vs candidate
// =========================================================================
if (ONLY.has('bench')) {
  console.log('\n=== bench ===');
  const bench = async (label, opts) => {
    const r = await evaluate(`__bloodCompare.benchShutter(${JSON.stringify(opts)})`);
    report.bench[label] = r;
    const f = r.fenced, p = r.cpuPrep;
    console.log(`${label}: ref=${r.reference} ${r.droplets} drops/${r.splats} splats  fenced p50=${f.p50.toFixed(3)} p95=${f.p95.toFixed(3)} ms`
      + `  drawCpu p50=${r.drawCpu.p50.toFixed(3)}  gpuSpan p50=${r.gpuSpan.p50.toFixed(3)}`
      + (p ? `  seedPrep p50=${p.p50.toFixed(3)}` : '')
      + `  cold=${r.coldFencedMs === null ? 'n/a' : r.coldFencedMs.toFixed(2)}  candidate=${r.candidateAvailable}`);
    return r;
  };
  const ORDINARY_CAM = { yaw: 0, pitch: 0.14, distance: 1.35 };
  const SOURCE = { width: 400, height: 300 };

  // Ordinary: burst 1/60, game march grid.
  await bench('ordinary-sharp', { reference: 'sharp', scenario: 'burst', seed: 12345, eventTime: 0.55, preset: '1-60', camera: ORDINARY_CAM, source: SOURCE, frames: 40, warmup: 8 });
  await bench('ordinary-candidate', { reference: 'efficient', scenario: 'burst', seed: 12345, eventTime: 0.55, preset: '1-60', maxStreakPx: 120, seedScale: 1, depthBias: 0.02, camera: ORDINARY_CAM, source: SOURCE, frames: 40, warmup: 8 });
  // Heavy: crossing at 1/30, max streak cap, seed scale 2.
  await bench('heavy-sharp', { reference: 'sharp', scenario: 'crossing', seed: 12345, eventTime: 0.85, preset: '1-30', camera: ORDINARY_CAM, source: SOURCE, frames: 40, warmup: 8 });
  await bench('heavy-candidate', { reference: 'efficient', scenario: 'crossing', seed: 12345, eventTime: 0.85, preset: '1-30', maxStreakPx: 200, seedScale: 2, depthBias: 0.02, camera: ORDINARY_CAM, source: SOURCE, frames: 40, warmup: 8 });
  // Long-exposure cap: burst 1/30 at the 200 px cap.
  await bench('longexposure-cap', { reference: 'efficient', scenario: 'burst', seed: 12345, eventTime: 0.55, preset: '1-30', maxStreakPx: 200, seedScale: 1, depthBias: 0.02, camera: ORDINARY_CAM, source: SOURCE, frames: 30, warmup: 6 });
  // Empty work: no droplets; the resolve must skip.
  await bench('empty-sharp', { reference: 'sharp', scenario: 'landing', seed: 12345, eventTime: 0, preset: '1-30', camera: ORDINARY_CAM, source: SOURCE, frames: 30, warmup: 6 });
  await bench('empty-candidate', { reference: 'efficient', scenario: 'landing', seed: 12345, eventTime: 0, preset: '1-30', maxStreakPx: 120, seedScale: 1, depthBias: 0.02, camera: ORDINARY_CAM, source: SOURCE, frames: 30, warmup: 6 });
  // First-use: force a resize (disposes the candidate) then bench cold.
  await evaluate("window.dispatchEvent(new Event('resize')); true");
  await sleep(400);
  await bench('cold-candidate', { reference: 'efficient', scenario: 'burst', seed: 12345, eventTime: 0.55, preset: '1-60', maxStreakPx: 120, seedScale: 1, depthBias: 0.02, camera: ORDINARY_CAM, source: SOURCE, frames: 20, warmup: 8 });
  // Output-resolution check: 800x600 source (NOT the game) for scale sensitivity.
  await bench('outputres-candidate', { reference: 'efficient', scenario: 'burst', seed: 12345, eventTime: 0.55, preset: '1-60', maxStreakPx: 120, seedScale: 1, depthBias: 0.02, camera: ORDINARY_CAM, source: { width: 800, height: 600 }, frames: 30, warmup: 6 });
}

// =========================================================================
// 4. CLIPS — normal-speed playback and play->pause ghost check
// =========================================================================
if (ONLY.has('clips')) {
  console.log('\n=== clips ===');
  async function recordClip(name, setupExpr, durationMs) {
    const dir = `${OUT}/clips/${name}`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    await evaluate(`${setupExpr || 'true'}; true`);
    await sleep(300);
    screencast = { dir, index: 0 };
    await send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    await sleep(durationMs);
    await send('Page.stopScreencast');
    const frames = screencast.index;
    screencast = null;
    const fps = Math.max(1, Math.round(frames / (durationMs / 1000)));
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps),
        '-i', `${dir}/frame-%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `${OUT}/clips/${name}.mp4`]);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps),
        '-i', `${dir}/frame-%04d.png`, '-vf', 'fps=12,scale=400:-1:flags=neighbor',
        `${OUT}/clips/${name}.gif`]);
    } catch (e) { console.log(`ffmpeg failed for ${name}: ${String(e).slice(0, 200)}`); }
    report.clips[name] = { frames, fps, durationMs, files: [`clips/${name}.mp4`, `clips/${name}.gif`] };
    console.log(`clip ${name}: ${frames} frames @ ~${fps} fps`);
  }
  // Normal-speed playback: slow bleed candidate, then the one-shot burst.
  await recordClip('normal-speed-bleed-candidate',
    `__bloodCompare.setMode('shutter'); __bloodCompare.setCamera({yaw:0.2, pitch:0.2, distance:1.5}); __bloodCompare.setScenario('bleed'); __bloodCompare.setSplashTime(0); __bloodCompare.setShutter({reference:'efficient', preset:'1-60', maxStreakPx:120, depthBias:0.02}); __bloodCompare.play()`,
    3500);
  await recordClip('normal-speed-burst-candidate',
    `__bloodCompare.setScenario('burst'); __bloodCompare.setSplashTime(0); __bloodCompare.setShutter({reference:'efficient', preset:'1-30', maxStreakPx:120, depthBias:0.02}); __bloodCompare.play()`,
    3500);
  // Play then pause: stopped motion must not keep an indefinite ghost. The
  // playing clip runs first; then a PAUSED hold clip is recorded and its first
  // and last frames compared byte-for-byte (a stale seed would drift/ghost).
  await recordClip('play-bleed',
    `__bloodCompare.setScenario('bleed'); __bloodCompare.setSplashTime(0); __bloodCompare.setShutter({reference:'efficient', preset:'1-60'}); __bloodCompare.play()`,
    2000);
  await evaluate('__bloodCompare.pause(); true');
  const pauseState = await state();
  await recordClip('paused-hold-bleed', '', 1500);
  const pd = `${OUT}/clips/paused-hold-bleed`;
  const pf = readdirSync(pd).filter(f => f.endsWith('.png')).sort();
  if (pf.length >= 2) {
    const first = readFileSync(`${pd}/${pf[0]}`);
    const last = readFileSync(`${pd}/${pf[pf.length - 1]}`);
    report.clips.pausedHold = {
      frames: pf.length,
      firstVsLastIdentical: first.equals(last),
      eventTime: pauseState.eventTime,
      droplets: pauseState.droplets,
      candidateStamps: pauseState.shutter.candidate?.stamps ?? null,
    };
    console.log('paused hold:', JSON.stringify(report.clips.pausedHold));
  }
}

// =========================================================================
// 5. GAME SMOKE — no shared module was touched, but the playable page must
//    still boot and present a WebGPU frame (a simple smoke, not a look gate).
// =========================================================================
if (ONLY.has('game')) {
  console.log('\n=== game smoke ===');
  const errsBefore = errors.length;
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });
  let gameOk = false;
  for (let i = 0; i < 180 && !gameOk; i++) {
    await sleep(500);
    gameOk = await evaluate('typeof window.__sdfGame === "object"');
    const err = await evaluate('document.getElementById("errors")?.textContent ?? ""');
    if (err) { console.log('game page error:', err); break; }
  }
  await sleep(2500);
  const gs = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/g00-game-smoke.png`, Buffer.from(gs.result.data, 'base64'));
  let gameBackend = 'absent';
  try {
    gameBackend = await evaluate(`(() => {
      const g = window.__sdfGame;
      if (!g) return 'absent';
      const st = typeof g.state === 'function' ? g.state() : null;
      return st ? (st.backend ?? 'no-backend-field') : 'no-state';
    })()`);
  } catch { /* keep 'absent' */ }
  report.gameSmoke = { booted: gameOk, backend: gameBackend, newErrors: errors.slice(errsBefore) };
  console.log('game smoke:', JSON.stringify(report.gameSmoke));
}

// ---- report --------------------------------------------------------------
report.consoleErrors = errors.slice(0, 10);
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
console.log('\nwrote', `${OUT}/task3-report.json`);
if (errors.length) console.log('console errors:', errors.length, errors.slice(-4));
console.log('DONE');
try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {}
ws.close();
shutdown(0);
