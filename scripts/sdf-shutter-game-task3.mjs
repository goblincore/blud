#!/usr/bin/env node
// scripts/sdf-shutter-game-task3.mjs
//
// TASK-3 in-game evidence rig for FLYING-GIB shutter blur. Owns its vite +
// headless Chrome on an UNUSED port pair, its own profile under .lab-tmp, no
// unsafe flags, and stops only what it started. It drives the REAL
// /sdf-game.html (shipped graphics, VHS, asset gibs) — the lab is not evidence
// for appearance.
//
// Usage:
//   node scripts/sdf-shutter-game-task3.mjs [vitePort] [cdpPort] [outDir] [--only=defaults,gib,gibdet,fallback,head,clip,cost,checks]
//
// Legs boot their own game instance so a mode flag (?gibrender=march) cannot
// leak into another leg. Captures are frozen (dt=0 re-renders the same sim
// instant) and matched by construction; the per-shot state JSON records the
// live gib diagnostics and the piece census so a claim can be checked.

import { spawn, execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const ONLY = new Set(
  (argv.find((a) => a.startsWith('--only='))?.split('=')[1] ?? 'defaults,gib,gibdet,fallback,head,modes,clip,cost,checks')
    .split(',').map((s) => s.trim()).filter(Boolean),
);
const VITE = Number(positional[0] ?? 5493);
const CDP = Number(positional[1] ?? 9493);
const OUT = resolve(positional[2] ?? 'docs/dev-notes/2026-09-17-shutter-blur-game/evidence');
const CLIPDIR = resolve(OUT, 'clips');
const LAB_TMP = resolve('.lab-tmp');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
mkdirSync(CLIPDIR, { recursive: true });

// Merge into a previous report so `--only=` legs can run incrementally without
// discarding the other legs' evidence (the same contract the task-2 rig uses).
let previous = {};
try { previous = JSON.parse(readFileSync(`${OUT}/task3-report.json`, 'utf8')); } catch {}
const report = {
  task: 'shutter-blur-game-task3',
  startedAt: new Date().toISOString(),
  git: (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } })(),
  shots: previous.shots ?? {}, checks: previous.checks ?? {},
  benches: previous.benches ?? {}, clips: previous.clips ?? {},
};

const children = [];
function shutdown(code) {
  for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { try { c.kill('SIGKILL'); } catch {} } }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

async function waitFor(url, what, tries = 160) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (r.ok) return; } catch {}
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${what} (${url})`);
}

console.log(`starting vite on ${VITE}`);
const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(VITE), '--strictPort'], { stdio: 'ignore', detached: true });
children.push(vite);
await waitFor(`http://localhost:${VITE}/`, 'vite');

console.log(`starting headless chrome on ${CDP}`);
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${LAB_TMP}/chrome-task3-${CDP}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-crash-reporter', `--crash-dumps-dir=${LAB_TMP}/crashpad-task3-${CDP}`,
  '--window-size=980,640',
  'about:blank',
], { stdio: 'ignore', detached: true, env: { ...process.env, TMPDIR: `${LAB_TMP}/tmp-${CDP}` } });
children.push(chrome);
await waitFor(`http://localhost:${CDP}/json/version`, 'chrome debug port');

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = () => err(new Error('ws')); });
let seq = 0; const pending = new Map(); const errors = [];
let screencast = null;
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
const evaluate = async (expression, timeoutMs = 60000) => {
  const reply = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
    sleep(timeoutMs).then(() => ({ __timeout: true })),
  ]);
  if (reply.__timeout) throw new Error(`Runtime.evaluate timed out after ${timeoutMs}ms: ${expression.slice(0, 80)}`);
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 600));
  return reply.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
const CONTENT = { width: 960, height: 600 };
const setMetrics = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });

// ---------------------------------------------------------------------------
// Boot / shipped look / capture
// ---------------------------------------------------------------------------
const SEED = '20260917';
const SHIPPED_VHS = `(() => {
  const g = window.__sdfGame;
  g.setVhs('blud'); g.setVhsTerm('intensity', 0.81); g.setVhsTerm('blurAmount', 0.17);
  return g.vhs;
})()`;

async function bootGame(query = '') {
  const q = new URLSearchParams(query.replace(/^\?/, ''));
  if (!q.has('seed')) q.set('seed', SEED);
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${q.toString()}` });
  let ok = false;
  for (let i = 0; i < 240 && !ok; i++) { await sleep(500); ok = await evaluate('typeof window.__sdfGame === "object"').catch(() => false); }
  if (!ok) throw new Error(`__sdfGame never booted (${query || 'no query'})`);
  for (let i = 0; i < 200; i++) {
    const ready = await evaluate(`(() => {
      const l = document.getElementById('loader'); const warm = window.__warmGate;
      return (l && l.classList.contains('loader-hidden')) || (warm && warm.phase === 'ready')
        || (l && getComputedStyle(l).display === 'none');
    })()`).catch(() => false);
    if (ready) break;
    await sleep(500);
  }
  await sleep(1800);
  await evaluate(`(() => {
    const g = window.__sdfGame;
    for (const fn of ['shutterPanel','gooPanel','vhsPanel','dynamitePanel','woundPanel','gibPanel']) {
      try { if (typeof g[fn] === 'function') g[fn](false); } catch {}
    }
    return true;
  })()`);
  await sleep(300);
}
const applyShippedVhs = () => evaluate(SHIPPED_VHS);
const applyHold = async (on) => {
  await evaluate(`window.__sdfGame.setDemoHold(${on})`);
  await evaluate(`window.__sdfGame.setLightClockFrozen(${on})`);
};

const shotIndex = {};
async function capture(name, tag = 't3') {
  const shot = await Promise.race([
    send('Page.captureScreenshot', { format: 'png' }),
    sleep(20000).then(() => ({ __timeout: true })),
  ]);
  if (shot.__timeout) throw new Error(`Page.captureScreenshot timed out for ${name}`);
  const buf = Buffer.from(shot.result.data, 'base64');
  const file = `${tag}-${name}`;
  writeFileSync(`${OUT}/${file}.png`, buf);
  const gibDiag = await evaluate('window.__sdfGame.gibBlur').catch(() => null);
  const bloodDiag = await evaluate('window.__sdfGame.bloodBlur').catch(() => null);
  const pieces = await evaluate('window.__sdfGame.chunkStates()').catch(() => null);
  const state = {
    file, gibDiag, bloodDiag,
    pieces: Array.isArray(pieces) ? pieces.length : null,
    flying: Array.isArray(pieces) ? pieces.filter(p => !p.settled).length : null,
    heads: Array.isArray(pieces) ? pieces.filter(p => p.limb === 'head' && !p.settled).length : null,
    sha256_16: execFileSync('shasum', ['-a', '256'], { input: buf, encoding: 'utf8' }).slice(0, 16),
  };
  writeFileSync(`${OUT}/${file}.state.json`, JSON.stringify(state, null, 2));
  report.shots[file] = state;
  shotIndex[name] = file;
  console.log(`  ${file}: gib=${gibDiag?.enabled} pieces=${state.pieces} flying=${state.flying} heads=${state.heads} `
    + `selected=${gibDiag?.selectedPieces} stamps=${gibDiag?.stamps} maxPx=${gibDiag?.last?.maxStreakPx?.toFixed?.(1)} err=${gibDiag?.error}`);
  return file;
}

// ---------------------------------------------------------------------------
// Gib variants (blood off so the gib delta is attributable; both-on shipped set)
// ---------------------------------------------------------------------------
const M44 = 44.44444444444444;
const M67 = 66.66666666666667;
async function setModes({ blood, gib, ms, maxStreak }) {
  await evaluate(`window.__sdfGame.setBloodBlur(${!!blood})`);
  await evaluate(`window.__sdfGame.setGibBlur(${!!gib})`);
  if (ms) await evaluate(`window.__sdfGame.setBloodBlurExposure(${ms})`);
  await evaluate(`window.__sdfGame.setBloodBlurMaxStreak(${maxStreak ?? 120})`);
}
const GIB_VARIANTS = [
  { id: 'sharp', blood: false, gib: false, ms: 0 },
  { id: 'm44', blood: false, gib: true, ms: M44 },
  { id: 'm67', blood: false, gib: true, ms: M67 },
  { id: 'm100', blood: false, gib: true, ms: 100 },
  { id: 'm44both', blood: true, gib: true, ms: M44 },
  { id: 'm44bloodonly', blood: true, gib: false, ms: M44 },
];
async function captureVariants(prefix, variants, settle = 6) {
  const out = [];
  for (const v of variants) {
    await setModes(v);
    if (settle > 0) await evaluate(`window.__sdfGame.step(${settle}, 0)`);
    out.push(await capture(`${prefix}__${v.id}`));
  }
  report.checks[`counts:${prefix}`] = out.map((f) => ({
    file: f, pieces: report.shots[f]?.pieces, flying: report.shots[f]?.flying, heads: report.shots[f]?.heads,
    selected: report.shots[f]?.gibDiag?.selectedPieces, stamps: report.shots[f]?.gibDiag?.stamps,
  }));
  return out;
}

// ---------------------------------------------------------------------------
// Blast staging
// ---------------------------------------------------------------------------
async function bestCrowdRoom() {
  const zs = await evaluate('window.__sdfGame.zombies()');
  const byRoom = new Map();
  for (const z of zs) byRoom.set(z.room, (byRoom.get(z.room) ?? 0) + 1);
  let best = 4, n = -1;
  for (const [room, count] of byRoom) if (count > n) { n = count; best = room; }
  return { room: best, count: n };
}

async function detonateOnCrowd(room) {
  const zs = (await evaluate('window.__sdfGame.zombies()')).filter((z) => z.room === room);
  if (!zs.length) return null;
  let best = null;
  for (const a of zs) {
    let n = 0;
    for (const b of zs) if (Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]) < 3.5) n++;
    if (!best || n > best.n) best = { a, n };
  }
  const c = (await evaluate(`window.__sdfGame.actorLimbCenter(${best.a.id},'torso')`)) ?? best.a.pos;
  const p = await evaluate('window.__sdfGame.playerPos()');
  let dx = p[0] - c[0], dz = p[2] - c[2];
  const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
  const x = c[0] + dx * 5.0, z = c[2] + dz * 5.0;
  const yaw = Math.atan2(-dx, dz);
  const pitch = Math.atan2(c[1] - 1.62, 5.0);
  await evaluate(`window.__sdfGame.placePlayer({x:${x},z:${z},yaw:${yaw},pitch:${pitch}})`);
  await evaluate('window.__sdfGame.step(6)');
  const blast = await evaluate(`window.__sdfGame.detonate(${c[0]},${c[1] + 0.4},${c[2]})`);
  return { room, target: { id: best.a.id, neighbours: best.n, c }, blast };
}

/** Step frame by frame, tracking the gib blur seed, and stop near its peak. */
async function advanceToGibFlight({ maxFrames = 70 } = {}) {
  let peak = { stamps: 0, selected: 0, pieces: 0, frame: -1, maxStreakPx: 0 };
  for (let i = 0; i < maxFrames; i++) {
    await evaluate('window.__sdfGame.step(1)');
    const gb = await evaluate('window.__sdfGame.gibBlur');
    const cs = await evaluate('window.__sdfGame.chunkStates()');
    const stamps = gb?.stamps ?? 0;
    if (stamps > peak.stamps) {
      peak = { stamps, selected: gb?.selectedPieces ?? 0, pieces: cs?.length ?? 0, frame: i, maxStreakPx: gb?.last?.maxStreakPx ?? 0 };
    }
    if (peak.frame >= 0 && i - peak.frame >= 6) break;
  }
  return peak;
}

// ---------------------------------------------------------------------------
// LEGS
// ---------------------------------------------------------------------------
async function defaultsLeg() {
  console.log('\n================ DEFAULTS ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  const gib = await evaluate('window.__sdfGame.gibBlur');
  const blood = await evaluate('window.__sdfGame.bloodBlur');
  report.checks.defaults = {
    gib: { enabled: gib.enabled, ready: gib.ready, warmed: gib.warmed, exposureMs: gib.exposureMs,
      maxStreakPx: gib.maxStreakPx, seed: gib.seed, layer: gib.layer, depthBiasM: gib.depthBiasM },
    blood: { enabled: blood.enabled, exposureMs: blood.exposureMs, seed: blood.seed },
    renderMode: await evaluate('window.__sdfGame.renderMode'),
    gibAssets: await evaluate('window.__sdfGame.gibAssetStats').catch(() => null),
    vhs: await evaluate('window.__sdfGame.vhs'),
  };
  console.log('defaults:', JSON.stringify(report.checks.defaults));
}

async function gibLeg() {
  console.log('\n================ GIB LOOK ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  const crowd = await bestCrowdRoom();
  const det = await detonateOnCrowd(crowd.room);
  report.checks.gibBlastStage = det;
  const peak = await advanceToGibFlight();
  report.checks.gibFlightPeak = peak;
  console.log(`  flight peak: stamps=${peak.stamps} selected=${peak.selected} pieces=${peak.pieces} frame=${peak.frame}`);
  if (!peak.stamps) console.log('  WARNING: no gib seed stamps were produced — see the capture states');
  await evaluate('window.__sdfGame.step(3, 0)');
  await captureVariants('gib', GIB_VARIANTS, 6);
  // Restore shipped both-on at the accepted exposure for the final framing.
  await setModes({ blood: true, gib: true, ms: M44 });
  await evaluate('window.__sdfGame.step(6, 0)');
  await capture('gib__shipped', 't3');
}

async function gibDetLeg() {
  console.log('\n================ GIB DETERMINISTIC (vhs off) ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  const crowd = await bestCrowdRoom();
  await detonateOnCrowd(crowd.room);
  await advanceToGibFlight();
  await evaluate('window.__sdfGame.setVhs(null)');
  await evaluate('window.__sdfGame.step(10, 0)');
  await captureVariants('gibdet', [
    { id: 'on-a', blood: false, gib: true, ms: M44 },
    { id: 'off', blood: false, gib: false, ms: 0 },
    { id: 'on-b', blood: false, gib: true, ms: M44 },
    { id: 'm67', blood: false, gib: true, ms: M67 },
    { id: 'cap200', blood: false, gib: true, ms: M44, maxStreak: 200 },
  ], 4);
  await evaluate(SHIPPED_VHS);
}

async function fallbackLeg() {
  console.log('\n================ MARCHED FALLBACK (?gibrender=march) ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame('?gibrender=march');
  await applyShippedVhs();
  await applyHold(true);
  report.checks.fallbackRender = await evaluate('window.__sdfGame.gibRender').catch(() => null);
  const crowd = await bestCrowdRoom();
  await detonateOnCrowd(crowd.room);
  const peak = await advanceToGibFlight();
  report.checks.fallbackFlightPeak = peak;
  console.log(`  march flight peak: stamps=${peak.stamps} selected=${peak.selected} pieces=${peak.pieces}`);
  await evaluate('window.__sdfGame.step(3, 0)');
  await captureVariants('gibmarch', [
    { id: 'sharp', blood: false, gib: false, ms: 0 },
    { id: 'm44', blood: false, gib: true, ms: M44 },
    { id: 'm67', blood: false, gib: true, ms: M67 },
  ], 4);
}

async function headLeg() {
  console.log('\n================ FLYING HEAD ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  // `gibbones=all` releases the skeleton groups so a severed head survives as a
  // real piece; `gib=parts` keeps the per-part split.
  await bootGame('?gib=parts&gibbones=all');
  await applyShippedVhs();
  await applyHold(true);
  const crowd = await bestCrowdRoom();
  await detonateOnCrowd(crowd.room);
  let peak = { stamps: 0, heads: 0, frame: -1, selected: 0 };
  for (let i = 0; i < 70; i++) {
    await evaluate('window.__sdfGame.step(1)');
    const gb = await evaluate('window.__sdfGame.gibBlur');
    const cs = await evaluate('window.__sdfGame.chunkStates()');
    const heads = (cs ?? []).filter(p => p.limb === 'head' && !p.settled).length;
    const stamps = gb?.stamps ?? 0;
    if (heads > 0 && stamps >= peak.stamps) peak = { stamps, heads, frame: i, selected: gb?.selectedPieces ?? 0 };
    if (peak.heads > 0 && i - peak.frame >= 6) break;
  }
  report.checks.headPeak = peak;
  console.log(`  head peak: heads=${peak.heads} stamps=${peak.stamps} selected=${peak.selected}`);
  await evaluate('window.__sdfGame.step(3, 0)');
  await captureVariants('gibhead', [
    { id: 'sharp', blood: false, gib: false, ms: 0 },
    { id: 'm44', blood: false, gib: true, ms: M44 },
  ], 4);
}

async function modesLeg() {
  console.log('\n================ ALTERNATE MODES ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  const modes = [
    ['carve', '?gibrender=carve'],
    ['sprite', '?gibrender=sprite'],
    ['deferred', '?renderer=deferred'],
    ['deferred-off', '?renderer=deferred&gibblur=0'],
  ];
  for (const [id, query] of modes) {
    const errBefore = errors.length;
    await bootGame(query);
    await applyShippedVhs();
    await applyHold(true);
    const crowd = await bestCrowdRoom();
    await detonateOnCrowd(crowd.room);
    const peak = await advanceToGibFlight();
    const diag = await evaluate('window.__sdfGame.gibBlur');
    report.checks[`mode:${id}`] = {
      query,
      renderMode: await evaluate('window.__sdfGame.renderMode'),
      peak: { stamps: peak.stamps, selected: peak.selected, pieces: peak.pieces },
      enabled: diag.enabled, ready: diag.ready, error: diag.error,
      consoleErrors: errors.length - errBefore,
    };
    // Visual A/B for the mode: same frozen instant, gib on then off.
    await setModes({ blood: false, gib: true, ms: M44 });
    await evaluate('window.__sdfGame.step(4, 0)');
    await capture(`mode-${id}-on`, 't3');
    await setModes({ blood: false, gib: false, ms: 0 });
    await evaluate('window.__sdfGame.step(4, 0)');
    await capture(`mode-${id}-off`, 't3');
    console.log(`  ${id}: ${JSON.stringify(report.checks[`mode:${id}`])}`);
  }
}

async function clipLeg() {
  console.log('\n================ CLIP ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  const crowd = await bestCrowdRoom();
  await detonateOnCrowd(crowd.room);
  await evaluate('window.__sdfGame.step(20)'); // let pieces be airborne
  await setModes({ blood: true, gib: true, ms: M44 });
  await evaluate('window.__sdfGame.setLoopRunning(false)');
  await recordClip('gib-dynamite-on-44', 'window.__sdfGame.setLoopRunning(true)', 3600);
  await evaluate('window.__sdfGame.setLoopRunning(false)');
}

async function recordClip(name, setupExpr, sustainMs) {
  const dir = resolve(CLIPDIR, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await evaluate(`${setupExpr || 'true'}; true`);
  await sleep(300);
  screencast = { dir, index: 0 };
  await send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await sleep(sustainMs);
  await send('Page.stopScreencast');
  const frames = screencast.index;
  screencast = null;
  const fps = Math.max(1, Math.round(frames / (sustainMs / 1000)));
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps),
      '-i', `${dir}/frame-%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `${CLIPDIR}/${name}.mp4`]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps),
      '-i', `${dir}/frame-%04d.png`, '-vf', 'fps=14,scale=480:-1:flags=neighbor', `${CLIPDIR}/${name}.gif`]);
  } catch (e) { console.log(`ffmpeg failed for ${name}: ${String(e).slice(0, 200)}`); }
  report.clips[name] = { frames, fps, sustainMs, files: [`clips/${name}.mp4`, `clips/${name}.gif`] };
  console.log(`clip ${name}: ${frames} frames @ ~${fps} fps`);
}

async function benchVariant(variant, frames, label) {
  await setModes(variant);
  await evaluate('window.__sdfGame.step(4, 0)');
  const expr = `(async () => {
    const g = window.__sdfGame;
    const times = []; const buildMs = [];
    let stamps = 0, selected = 0, maxStreakPx = 0;
    for (let i = 0; i < ${frames}; i++) {
      const t0 = performance.now();
      g.step(1, 0);
      await g.resolveGpu();
      times.push(performance.now() - t0);
      const gb = g.gibBlur;
      buildMs.push(gb.last.buildMs ?? 0);
      stamps = Math.max(stamps, gb.stamps); selected = Math.max(selected, gb.selectedPieces);
      maxStreakPx = Math.max(maxStreakPx, gb.last.maxStreakPx ?? 0);
    }
    return { times, buildMs, stamps, selected, maxStreakPx };
  })()`;
  const r = await evaluate(expr, 240000);
  const pct = (arr, p) => {
    const s = [...arr].sort((a, b) => a - b);
    return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(3);
  };
  const out = {
    label, variant: variant.id, frames,
    totalMsPerFrame: { p50: pct(r.times, 50), p95: pct(r.times, 95), mean: +(r.times.reduce((a, b) => a + b, 0) / r.times.length).toFixed(3) },
    buildMs: { p50: pct(r.buildMs, 50), p95: pct(r.buildMs, 95), max: +Math.max(...r.buildMs).toFixed(3) },
    stamps: r.stamps, selected: r.selected, maxStreakPx: +r.maxStreakPx.toFixed(1),
  };
  report.benches[label] = out;
  console.log(`  bench ${label}: p50=${out.totalMsPerFrame.p50} p95=${out.totalMsPerFrame.p95} ms build p50=${out.buildMs.p50} stamps=${r.stamps} selected=${r.selected}`);
  return out;
}

async function costLeg() {
  console.log('\n================ COST ================');
  report.checks.costLoadStart = loadavg().map((v) => +v.toFixed(2));
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  const boot = await evaluate('window.__sdfGame.gibBlur');
  report.checks.costBootReady = { ready: boot.ready, warmed: boot.warmed, seed: boot.seed, layer: boot.layer };
  const crowd = await bestCrowdRoom();
  await detonateOnCrowd(crowd.room);
  const peak = await advanceToGibFlight();
  report.checks.costFlightPeak = peak;
  await evaluate('window.__sdfGame.step(3, 0)');
  const variants = [
    { id: 'sharp', blood: false, gib: false, ms: 0 },
    { id: 'gibm44', blood: false, gib: true, ms: M44 },
    { id: 'gibm67', blood: false, gib: true, ms: M67 },
  ];
  const reps = 4, frames = 24;
  const perRep = [];
  for (let r = 0; r < reps; r++) {
    const row = {};
    for (const v of variants) row[v.id] = (await benchVariant(v, frames, `gibcost-${v.id}-r${r}`)).totalMsPerFrame.p50;
    perRep.push(row);
    console.log(`  cost rep${r}: sharp=${row.sharp} m44=${row.gibm44} m67=${row.gibm67} ms`);
  }
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  report.benches['gibcost-summary'] = {
    reps, framesPerVariant: frames, perRep,
    sharpP50Median: +med(perRep.map((r) => r.sharp)).toFixed(3),
    m44P50Median: +med(perRep.map((r) => r.gibm44)).toFixed(3),
    m67P50Median: +med(perRep.map((r) => r.gibm67)).toFixed(3),
    deltaM44Median: +med(perRep.map((r) => r.gibm44 - r.sharp)).toFixed(3),
    deltaM67Median: +med(perRep.map((r) => r.gibm67 - r.sharp)).toFixed(3),
  };
  report.checks.costLoadEnd = loadavg().map((v) => +v.toFixed(2));
  console.log('  cost summary:', JSON.stringify(report.benches['gibcost-summary']));
}

async function checksLeg() {
  console.log('\n================ CHECKS ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  // Empty / idle: no pieces, blur on must be an exact no-op and surface no error.
  // VHS off so the only possible delta is the resolve (VHS owns temporal drift).
  await evaluate('window.__sdfGame.setVhs(null)');
  await evaluate('window.__sdfGame.setGibBlur(true)');
  await evaluate('window.__sdfGame.setBloodBlur(false)');
  await evaluate('window.__sdfGame.step(8, 0)');
  await capture('check-empty-on', 't3');
  await evaluate('window.__sdfGame.setGibBlur(false)');
  await evaluate('window.__sdfGame.step(8, 0)');
  await capture('check-empty-off', 't3');
  report.checks.checkEmpty = {
    on: report.shots['t3-check-empty-on']?.gibDiag,
    off: report.shots['t3-check-empty-off']?.gibDiag,
  };
  // Clamp surface.
  const clamps = await evaluate(`(() => {
    const g = window.__sdfGame;
    const a = g.setBloodBlurMaxStreak(1e6);
    const b = g.setBloodBlurMaxStreak(-5);
    const c = g.setBloodBlurExposure(1e6);
    const d = g.setBloodBlurExposure(-1);
    return { streakHigh: a, streakLow: b, msHigh: c, msLow: d };
  })()`);
  report.checks.clamps = clamps;
  // Off parity: gib-blur off at the frozen instant must equal the boot sharp
  // frame in a scene with no moving pieces (the empty case above).
  // Query off.
  await bootGame('?gibblur=0');
  report.checks.queryOff = await evaluate('window.__sdfGame.gibBlur');
  console.log('  checks:', JSON.stringify({ checkEmpty: report.checks.checkEmpty, clamps: report.checks.clamps, queryOffEnabled: report.checks.queryOff?.enabled }));
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
try {
  const legs = [
    ['defaults', defaultsLeg], ['gib', gibLeg], ['gibdet', gibDetLeg],
    ['fallback', fallbackLeg], ['head', headLeg], ['modes', modesLeg],
    ['clip', clipLeg], ['cost', costLeg], ['checks', checksLeg],
  ];
  for (const [name, fn] of legs) {
    if (!ONLY.has(name)) continue;
    try { await fn(); } catch (err) {
      report.checks[`legError:${name}`] = String(err?.stack ?? err).slice(0, 800);
      console.error(`LEG ${name} FAILED:`, report.checks[`legError:${name}`]);
    }
  }
} catch (err) {
  report.failed = String(err?.stack ?? err);
  console.error('RUN FAILED:', report.failed);
}
report.consoleErrors = errors.slice(0, 40);
report.finishedAt = new Date().toISOString();
writeFileSync(`${OUT}/task3-report.json`, JSON.stringify(report, null, 2));
console.log(`\nwrote ${OUT}/task3-report.json (${Object.keys(report.shots).length} shots)`);
if (report.consoleErrors.length) console.log(`console errors: ${report.consoleErrors.length}`, report.consoleErrors.slice(0, 5));
shutdown(report.failed ? 1 : 0);
