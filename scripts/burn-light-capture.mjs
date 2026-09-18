// scripts/burn-light-capture.mjs
//
// BURNING-FEEDBACK TASK 1 capture (fire lights the room + neighbour molten
// look). Proves, with numbers, the two claims the task makes:
//
//   A. ROOM LIGHT. A floor crop beside a burning body is measurably brighter
//      (mean luminance) with fire light than the SAME frozen frame with
//      lightGatherPeak/lightMeshPeak forced to 0. Arms: both on, gather-only,
//      both off. Also reports the boot pipeline-count delta across the first
//      ignite (no LitNode re-key) and the gather cost with 4 burners vs 0
//      (the probe gather's own `compute:probe-gather` pass timing).
//
//   B. NEIGHBOUR. One burning zombie with a non-burning neighbour ~1.5 m away.
//      30 frames (~1 s) of a 40x40 crop over the neighbour's torso; mean
//      absolute frame-to-frame luma change. Arms: fire on (full flicker), fire
//      on with lightFlicker 0, and no fire (the baseline the fix is measured
//      against). Logs the neighbour's burnCfg and the crowd REC_BURN scan.
//
// Headless only. Warm gate must reach 'ready'; renderer pipeline errors fail
// the run. Own vite + Chrome on an unused port pair; only what it started is
// stopped.
//
// Usage: node scripts/burn-light-capture.mjs [vitePort] [cdpPort] [outDir]

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5496);
const CDP = Number(process.argv[3] ?? 9496);
const OUT = resolve(process.argv[4] ?? 'docs/dev-notes/2026-09-18-burning-feedback/task-1-captures');
const LAB_TMP = resolve('.lab-tmp');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN_LUMA_STD = 5;
const W = 960, H = 600;
const CROP = 40;          // neighbour diagnosis crop (px)
const FLOOR_CROP = 60;    // room-light crop (px)

const report = {
  branch: (() => { try { return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })(),
  shots: {}, checks: {}, consoleErrors: [],
};
const consoleErrors = [];

const children = [];
let finished = false;
function shutdown(code) {
  if (finished) return;
  finished = true;
  try { writeFileSync(`${OUT}/burn-light-report.json`, JSON.stringify(report, null, 2)); } catch { /* best effort */ }
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch { /* gone */ } }
  }
  setTimeout(() => process.exit(code), 500);
}
process.on('exit', () => { for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } } });
setTimeout(() => { console.error('WATCHDOG: capture exceeded 12 minutes'); shutdown(9); }, 12 * 60 * 1000);
const fail = (msg) => { throw new Error(msg); };

// ---------------------------------------------------------------------------
// PNG decode + luma stats (flare-ingame-capture.mjs's flat-frame gate).
// ---------------------------------------------------------------------------
function decodePng(png) {
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  let plte = null, trns = null;
  while (off < png.length) {
    const len = png.readUInt32BE(off); const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    if (type === 'PLTE') plte = Buffer.from(data);
    if (type === 'tRNS') trns = Buffer.from(data);
    if (type === 'IEND') break;
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8 || ![2, 3, 6].includes(colorType)) return { unsupported: true };
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 3 ? 1 : colorType === 6 ? 4 : 3;
  const unfilter = (stride) => {
    const out = Buffer.alloc(h * stride);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)];
      const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      const cur = out.subarray(y * stride, (y + 1) * stride);
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let v = line[i];
        if (f === 1) v = (v + a) & 0xff;
        else if (f === 2) v = (v + b) & 0xff;
        else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
        else if (f === 4) {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
        }
        cur[i] = v;
      }
      prev = cur;
    }
    return out;
  };
  if (colorType === 3) {
    const idx = unfilter(w);
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const p = idx[i];
      rgba[i * 4] = plte[p * 3]; rgba[i * 4 + 1] = plte[p * 3 + 1]; rgba[i * 4 + 2] = plte[p * 3 + 2];
      rgba[i * 4 + 3] = trns && p < trns.length ? trns[p] : 255;
    }
    return { w, h, rgba };
  }
  const chans = colorType === 6 ? 4 : 3;
  const out = unfilter(w * chans);
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = out[i * chans]; rgba[i * 4 + 1] = out[i * chans + 1]; rgba[i * 4 + 2] = out[i * chans + 2];
    rgba[i * 4 + 3] = chans === 4 ? out[i * chans + 3] : 255;
  }
  return { w, h, rgba };
}
function lumaAt(rgba, w, x, y) {
  const i = (y * w + x) * 4;
  return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
}
function pngStats(png) {
  const d = decodePng(png);
  if (d.unsupported) return d;
  const { w, h, rgba } = d;
  let n = 0, s = 0, s2 = 0;
  const stepX = Math.max(1, Math.floor(w / 256)), stepY = Math.max(1, Math.floor(h / 256));
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      const l = lumaAt(rgba, w, x, y);
      n++; s += l; s2 += l * l;
    }
  }
  const mean = s / n;
  return { w, h, mean: +mean.toFixed(2), std: +Math.sqrt(s2 / n - mean * mean).toFixed(2) };
}
function meanOf(arr) { let s = 0; for (const v of arr) s += v; return arr.length ? s / arr.length : 0; }
function meanAbsDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return n ? s / n : 0;
}
/** A fixed crop centred on (cx, cy), clamped into the frame. */
function cropAt(rgba, w, h, cx, cy, size) {
  const x0 = Math.max(0, Math.min(w - size, Math.round(cx - size / 2)));
  const y0 = Math.max(0, Math.min(h - size, Math.round(cy - size / 2)));
  const px = new Float64Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) px[y * size + x] = lumaAt(rgba, w, x0 + x, y0 + y);
  return { x: x0, y: y0, size, mean: meanOf(px), px };
}

async function waitFor(url, what, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up */ }
    await sleep(500);
  }
  throw new Error(`${what} never came up at ${url}`);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(`${LAB_TMP}/tmp-${CDP}`, { recursive: true });

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
  `--user-data-dir=${LAB_TMP}/chrome-burnlight-${CDP}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-crash-reporter', `--crash-dumps-dir=${LAB_TMP}/crashpad-burnlight-${CDP}`,
  `--window-size=${W},${H}`,
  'about:blank',
], { stdio: 'ignore', detached: true, env: { ...process.env, TMPDIR: `${LAB_TMP}/tmp-${CDP}` } });
children.push(chrome);
await waitFor(`http://localhost:${CDP}/json/version`, 'chrome debug port');

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = () => err(new Error('ws')); });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    consoleErrors.push(text);
    report.consoleErrors.push(text.slice(0, 300));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const text = JSON.stringify(m.params.exceptionDetails).slice(0, 300);
    consoleErrors.push(text);
    report.consoleErrors.push(text);
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
  if (reply.__timeout) throw new Error(`Runtime.evaluate timed out after ${timeoutMs}ms: ${expression.slice(0, 90)}`);
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 600));
  return reply.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

async function bootGame(query = '') {
  const q = new URLSearchParams(query.replace(/^\?/, ''));
  if (!q.has('seed')) q.set('seed', '20260918');
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${q.toString()}` });
  let ok = false;
  for (let i = 0; i < 240 && !ok; i++) {
    await sleep(500);
    ok = await evaluate('typeof window.__sdfGame === "object"').catch(() => false);
  }
  if (!ok) throw new Error(`__sdfGame never booted (${query || 'no query'})`);
  let gate = null;
  for (let i = 0; i < 180 && !gate; i++) {
    gate = await evaluate('window.__warmGate ?? null').catch(() => null);
    if (!gate) await sleep(500);
  }
  if (!gate) {
    const loader = await evaluate(`document.getElementById('loader')?.textContent?.trim() ?? ''`).catch(() => '?');
    throw new Error(`warm gate never settled after 90 s (${query}); loader says: ${loader.slice(0, 120)}`);
  }
  if (gate.phase !== 'ready') {
    throw new Error(`boot did not reach READY: warm gate phase '${gate.phase}'`
      + (gate.phase === 'device-lost' ? ' — often GPU contention from another WebGPU page or capture running' : ''));
  }
  await sleep(1500);
  await evaluate(`(() => {
    const g = window.__sdfGame;
    for (const fn of ['shutterPanel','gooPanel','vhsPanel','dynamitePanel','woundPanel']) {
      try { if (typeof g[fn] === 'function') g[fn](false); } catch {}
    }
    return true;
  })()`);
  await sleep(2500);
}

async function capturePng() {
  const shot = await Promise.race([
    send('Page.captureScreenshot', { format: 'png' }),
    sleep(30000).then(() => ({ __timeout: true })),
  ]);
  if (shot.__timeout) fail('Page.captureScreenshot timed out');
  return Buffer.from(shot.result.data, 'base64');
}

/** Full screenshot + flat-frame gate; returns the decoded rgba. */
async function shot(name, note = '') {
  await evaluate('window.__sdfGame.resolveGpu()');
  const buf = await capturePng();
  const stats = pngStats(buf);
  if (stats.unsupported) fail(`${name}: not a decodable 8-bit RGB(A) PNG`);
  if ((stats.std ?? 0) < MIN_LUMA_STD) fail(`${name}: flat frame (luma std ${stats.std} < ${MIN_LUMA_STD})`);
  writeFileSync(`${OUT}/${name}.png`, buf);
  report.shots[name] = { note, ...stats };
  console.log(`  ${name}: luma std=${stats.std}`);
  return { buf, stats };
}

const aimAt = (actorId, limb = 'torso') => `(() => {
  const g = window.__sdfGame;
  const eye = g.cameraWorld();
  const p = g.playerPos();
  const c = g.actorLimbCenter(${actorId}, '${limb}');
  if (!c) return null;
  const yaw = Math.atan2(c[0] - eye[0], -(c[2] - eye[2]));
  const pitch = Math.atan2(c[1] - eye[1], Math.hypot(c[0] - eye[0], c[2] - eye[2]));
  g.setPose(p[0], p[2], yaw, pitch, 0);
  return { yaw, pitch };
})()`;

/** Record `n` frames of a 40x40 crop that FOLLOWS an actor's limb, stepping
 *  the sim 1/60 each. Following the torso keeps the crop on the body's own
 *  surface instead of drifting onto the background as the body sways. */
async function recordFrames(n, actorId, limb, label) {
  const frames = [];
  // Settle the room-light dispatches after whatever tuning change preceded
  // this arm; a moving transition would dominate the frame-to-frame change.
  for (let i = 0; i < 12; i++) await evaluate('window.__sdfGame.step(1, 0)');
  for (let i = 0; i < n; i++) {
    // dt 0: the sim, the bodies and the shader clock are all pinned, so the
    // ONLY thing left to change is the wall-clock fire-light flicker. That is
    // what this measurement is for.
    await evaluate('window.__sdfGame.step(1, 0)');
    // Fence before the screenshot: a capture that races the submitted frame
    // would return the previous one and understate the change.
    await evaluate('window.__sdfGame.resolveGpu()');
    const c = await evaluate(`window.__sdfGame.actorLimbCenter(${actorId}, '${limb}')`);
    if (!c) fail(`${label}: actor ${actorId} ${limb} vanished`);
    const s = await evaluate(`window.__sdfGame.worldToScreen(${c[0]}, ${c[1]}, ${c[2]}, ${W}, ${H})`);
    if (!s) fail(`${label}: ${limb} went behind the camera`);
    const png = await capturePng();
    const d = decodePng(png);
    if (d.unsupported) fail(`${label}: undecodable frame`);
    frames.push({ png, crop: cropAt(d.rgba, d.w, d.h, s.x, s.y, CROP) });
  }
  let change = 0;
  for (let i = 1; i < frames.length; i++) change += meanAbsDiff(frames[i - 1].crop.px, frames[i].crop.px);
  change /= Math.max(1, frames.length - 1);
  const crop = frames[Math.floor(frames.length / 2)].crop;
  writeFileSync(`${OUT}/${label}-first.png`, frames[0].png);
  writeFileSync(`${OUT}/${label}-last.png`, frames[frames.length - 1].png);
  const out = {
    label, frames: n,
    crop: { x: crop.x, y: crop.y, size: CROP },
    meanLuma: +meanOf(frames.map(f => f.crop.mean)).toFixed(3),
    changePerFrame: +change.toFixed(4),
  };
  console.log(`  ${label}: crop@(${crop.x},${crop.y}) mean=${out.meanLuma} change/frame=${out.changePerFrame}`);
  return out;
}

try {
  await bootGame('?crowd=1');
  report.checks.coldCards = await evaluate('window.__sdfGame.flameCards()');
  report.checks.coldBurning = await evaluate('window.__sdfGame.burning()');
  if (report.checks.coldCards.created) fail('flame cards created without an ignite');
  if (report.checks.coldBurning.length !== 0) fail('burn state existed without an ignite');

  await evaluate('window.__sdfGame.setBloodBlur(false)');
  await evaluate('window.__sdfGame.teleport(4)');
  await evaluate('window.__sdfGame.step(20)');
  // Demo hold pins the gather's per-dispatch ray seed (0) and drives the actor
  // animation clock from the SIM clock, so two zero-dt renders of one instant
  // differ only by what changed them (the fire light) — the A/B the room-light
  // arms depend on.
  await evaluate('window.__sdfGame.setDemoHold(true)');

  // Four zombies: burner, neighbour, and two spares for the 4-burner gather
  // cost. The neighbour sits ~1.5 m from the burner.
  const spawned = await evaluate(`(() => {
    const g = window.__sdfGame;
    const p = g.playerPos();
    const out = [];
    out.push(g.spawnDebugCharacter('zombie', [p[0] + 2.4, 0, p[2] + 0.5]));
    out.push(g.spawnDebugCharacter('zombie', [p[0] + 3.4, 0, p[2] - 0.7]));
    out.push(g.spawnDebugCharacter('zombie', [p[0] + 4.4, 0, p[2] + 0.6]));
    out.push(g.spawnDebugCharacter('zombie', [p[0] + 5.2, 0, p[2] - 0.4]));
    return out;
  })()`);
  report.checks.spawned = spawned;
  if (spawned.some((s) => !s || s.errors?.length)) fail(`spawn errors: ${JSON.stringify(spawned)}`);
  const burnerId = spawned[0].id;
  const neighbourId = spawned[1].id;
  await evaluate('window.__sdfGame.step(30)');
  await evaluate(aimAt(burnerId));
  await evaluate('window.__sdfGame.step(10)');

  // Pure-estimate gather: the with/without frames must not be contaminated by
  // the dynamic layer's afterglow (blend/fall only delay the off-state).
  await evaluate('window.__sdfGame.setProbeBlend(1); window.__sdfGame.setProbeFall(1)');

  // =======================================================================
  // A. ROOM LIGHT
  // =======================================================================
  console.log('\n=== A. room light ===');
  await evaluate('window.__sdfGame.setPipelineLog(true)');
  const pipeBefore = await evaluate('window.__sdfGame.pipelineLog()');
  await evaluate(`window.__sdfGame.igniteActor(${burnerId})`);
  await evaluate('window.__sdfGame.step(120)');          // ~2 s of fire (sim dt)
  await evaluate('window.__sdfGame.setLightClockFrozen(true)');
  await evaluate('window.__sdfGame.setLoopRunning(false)');
  await evaluate('window.__sdfGame.step(12, 0)');         // settle at the frozen phase
  const pipeAfter = await evaluate('window.__sdfGame.pipelineLog()');
  report.checks.pipelines = {
    before: { total: pipeBefore.totalPipelines, compileMs: pipeBefore.totalCompileMs, evictions: pipeBefore.evictions?.total ?? null },
    after: { total: pipeAfter.totalPipelines, compileMs: pipeAfter.totalCompileMs, evictions: pipeAfter.evictions?.total ?? null },
    delta: pipeAfter.totalPipelines - pipeBefore.totalPipelines,
    evictionDelta: (pipeAfter.evictions?.total ?? 0) - (pipeBefore.evictions?.total ?? 0),
    rebuilds: (pipeAfter.rebuilds ?? []).length,
    longFrames: (pipeAfter.frames ?? []).length,
  };
  console.log('pipelines:', JSON.stringify(report.checks.pipelines));

  // A floor crop beside the burner: project a point ~1.3 m off the feet and
  // take the first candidate that lands well inside the frame.
  const foot = await evaluate(`(() => { const p = window.__sdfGame.zombie(${burnerId}).pose().pos; return [p[0], p[1], p[2]]; })()`);
  let floorCenter = null;
  for (const [dx, dz] of [[1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3], [1.0, 1.0], [-1.0, -1.0], [1.0, -1.0], [-1.0, 1.0]]) {
    const s = await evaluate(`window.__sdfGame.worldToScreen(${foot[0] + dx}, 0.05, ${foot[2] + dz}, ${W}, ${H})`);
    if (s && s.x > FLOOR_CROP && s.x < W - FLOOR_CROP && s.y > FLOOR_CROP && s.y < H - FLOOR_CROP) {
      floorCenter = { x: s.x, y: s.y };
      break;
    }
  }
  if (!floorCenter) fail('no on-screen floor point beside the burner');
  report.checks.floorCrop = { x: floorCenter.x, y: floorCenter.y, size: FLOOR_CROP };

  const arms = {};
  const tune0 = await evaluate('window.__sdfGame.burnTuning()');
  report.checks.tuneDefaults = { lightGatherPeak: tune0.lightGatherPeak, lightMeshPeak: tune0.lightMeshPeak, lightFlicker: tune0.lightFlicker };
  // Direct proof the gather path is wired: the dynamic probe buffer's radiance
  // with fire vs with lightGatherPeak 0. Independent of any screen crop.
  const dynSummary = () => evaluate(`(async () => {
    const a = await window.__sdfGame.probeDynReadback();
    const stride = 16; let n = 0, s = 0, mx = 0, sum = 0;
    for (let p = 0; p < a.length; p += stride) {
      const v = a[p] + a[p+1] + a[p+2];
      if (v > 0) { n++; s += v; if (v > mx) mx = v; }
      for (let i = 0; i < 12; i++) sum += Math.abs(a[p+i]);
    }
    return { points: a.length / stride, lit: n, meanLit: n ? +(s/n).toFixed(4) : 0, max: +mx.toFixed(4), radianceAbsSum: +sum.toFixed(2) };
  })()`);
  report.checks.dynBuffer = {
    fireOn: await dynSummary(),
    gatherDebug: await evaluate('window.__sdfGame.burnGatherDebug()'),
    gatesOn: await evaluate('window.__sdfGame.probeGates()'),
    dispatchesOn: await evaluate('window.__sdfGame.probeDispatchCount()'),
  };

  const shotArm = async (name, note) => {
    const { buf, stats } = await shot(name, note);
    const d = decodePng(buf);
    return { crop: cropAt(d.rgba, d.w, d.h, floorCenter.x, floorCenter.y, FLOOR_CROP), frameMean: stats.mean };
  };
  // Arm 1: both room lights on (the shipped look).
  arms.bothOn = await shotArm('burn-light-10-both-on', 'gather + mesh');
  // Arm 2: mesh OFF (gather only) — isolates the probe-gather contribution.
  await evaluate('window.__sdfGame.setBurnTuning({ lightMeshPeak: 0 })');
  await evaluate('window.__sdfGame.step(12, 0)');
  arms.meshOff = await shotArm('burn-light-20-mesh-off', 'lightMeshPeak 0, gather on');
  // Arm 3: both off.
  await evaluate('window.__sdfGame.setBurnTuning({ lightGatherPeak: 0 })');
  await evaluate('window.__sdfGame.step(12, 0)');
  arms.bothOff = await shotArm('burn-light-30-both-off', 'both peaks 0');
  report.checks.dynBuffer.fireOff = await dynSummary();
  report.checks.dynBuffer.gatherDebugOff = await evaluate('window.__sdfGame.burnGatherDebug()');
  report.checks.dynBuffer.gatesOff = await evaluate('window.__sdfGame.probeGates()');
  report.checks.dynBuffer.dispatchesOff = await evaluate('window.__sdfGame.probeDispatchCount()');
  // Restore the shipped peaks before the neighbour phase.
  await evaluate(`window.__sdfGame.setBurnTuning({ lightGatherPeak: ${tune0.lightGatherPeak}, lightMeshPeak: ${tune0.lightMeshPeak} })`);
  report.checks.roomLight = {
    crop: { x: floorCenter.x, y: floorCenter.y, size: FLOOR_CROP },
    mean: {
      bothOn: +arms.bothOn.crop.mean.toFixed(3),
      meshOff: +arms.meshOff.crop.mean.toFixed(3),
      bothOff: +arms.bothOff.crop.mean.toFixed(3),
    },
    frameMean: { bothOn: arms.bothOn.frameMean, meshOff: arms.meshOff.frameMean, bothOff: arms.bothOff.frameMean },
    delta: {
      total: +(arms.bothOn.crop.mean - arms.bothOff.crop.mean).toFixed(3),
      gather: +(arms.meshOff.crop.mean - arms.bothOff.crop.mean).toFixed(3),
      mesh: +(arms.bothOn.crop.mean - arms.meshOff.crop.mean).toFixed(3),
    },
  };
  console.log('room light:', JSON.stringify(report.checks.roomLight));
  console.log('dyn buffer:', JSON.stringify(report.checks.dynBuffer));

  // =======================================================================
  // B. NEIGHBOUR MOLTEN DIAGNOSIS
  // =======================================================================
  console.log('\n=== B. neighbour diagnosis ===');
  // Flicker must run for this phase.
  await evaluate('window.__sdfGame.setLightClockFrozen(false)');
  const tuneN = await evaluate('window.__sdfGame.burnTuning()');
  const bodyFlash0 = await evaluate('window.__sdfGame.bodyFlash');
  // Aim at the NEIGHBOUR so its torso is centred and unoccluded; the burner
  // sits beside it in frame and is the only light source on it.
  await evaluate(aimAt(neighbourId));
  await evaluate('window.__sdfGame.step(2, 0)');
  const neighbourTorso = await evaluate(`window.__sdfGame.actorLimbCenter(${neighbourId}, 'torso')`);
  if (!neighbourTorso) fail('neighbour torso missing');
  const neighbourScreen = await evaluate(`window.__sdfGame.worldToScreen(${neighbourTorso[0]}, ${neighbourTorso[1]}, ${neighbourTorso[2]}, ${W}, ${H})`);
  if (!neighbourScreen) fail('neighbour torso off screen');
  report.checks.neighbourScreen = neighbourScreen;

  // The pose is POSE-MATCHED across arms by never advancing the sim (dt 0), and
  // the "no fire" baseline is the SAME frame with every fire LIGHT path zeroed
  // — not extinguished — so only the light differs. (Extinguishing needs sim
  // time, which walks the neighbour and moves the crop.)
  const nbArms = {};
  nbArms.fireOn = await recordFrames(30, neighbourId, 'torso', 'burn-light-40-neighbour-fire-on');
  await evaluate('window.__sdfGame.setBodyFlash(0)');
  nbArms.bodyFlashOff = await recordFrames(30, neighbourId, 'torso', 'burn-light-50-neighbour-bodyflash-0');
  await evaluate(`window.__sdfGame.setBodyFlash(${bodyFlash0})`);
  const flickerBefore = tuneN.lightFlicker;
  await evaluate('window.__sdfGame.setBurnTuning({ lightFlicker: 0 })');
  nbArms.flickerOff = await recordFrames(30, neighbourId, 'torso', 'burn-light-55-neighbour-flicker-0');
  await evaluate(`window.__sdfGame.setBurnTuning({ lightPeak: 0, lightGatherPeak: 0, lightMeshPeak: 0, lightFlicker: ${flickerBefore} })`);
  nbArms.lightsOff = await recordFrames(30, neighbourId, 'torso', 'burn-light-60-neighbour-lights-off');
  await evaluate(`window.__sdfGame.setBurnTuning({ lightPeak: ${tuneN.lightPeak}, lightGatherPeak: ${tuneN.lightGatherPeak}, lightMeshPeak: ${tuneN.lightMeshPeak}, lightFlicker: ${tuneN.lightFlicker} })`);
  report.checks.neighbour = {
    ...nbArms,
    // The Step 11 gate: after the fix, fire-on change must be within 1.5x the
    // no-fire-light baseline.
    ratioFireVsBaseline: +(nbArms.fireOn.changePerFrame / Math.max(1e-4, nbArms.lightsOff.changePerFrame)).toFixed(3),
  };

  // (c) the neighbour's own burn values must be 0 (read while it is alight).
  const nbValues = await evaluate(`(() => {
    const g = window.__sdfGame;
    const z = g.zombie(${neighbourId});
    const v = z.view.uniforms.burnCfg.value;
    return { burnCfg: { x: v.x, y: v.y, z: v.z, w: v.w }, burning: g.burning().find(s => s.id === ${neighbourId}) ?? null };
  })()`);
  const recScan = await evaluate(`(() => {
    window.__sdfGame.installDebugProbe();
    const d = window.__sdfGameDebug.normalCaptureState();
    const STRIDE = 64, BURN = 15 * 4;
    const out = [];
    for (const p of d.pieces) {
      if (!p.records || p.records.length < STRIDE) continue;
      const n = Math.floor(p.records.length / STRIDE);
      let hot = 0, maxBurn = 0;
      for (let i = 0; i < n; i++) { const b = p.records[i * STRIDE + BURN]; if (b > 0.001) hot++; if (b > maxBurn) maxBurn = b; }
      out.push({ key: p.key, instances: n, hot, maxBurn: +maxBurn.toFixed(4) });
    }
    return { stride: STRIDE, views: out };
  })()`);
  report.checks.neighbourBurn = { perView: nbValues, crowdRecords: recScan };
  report.checks.burnDistortion = { wiredInGame: false, note: 'burn-distort.ts is used only by flame-lab-main.ts; no game seam pushes it' };
  console.log('neighbour burn:', JSON.stringify(report.checks.neighbourBurn));

  // =======================================================================
  // C. GATHER COST (4 burners vs 0), via the probe gather's own pass timing
  // =======================================================================
  console.log('\n=== C. gather cost ===');
  await evaluate('window.__sdfGame.setLightClockFrozen(true)');
  const benchPasses = async (label, ignite) => {
    if (ignite) await evaluate('window.__sdfGame.igniteAll()');
    else { await evaluate('window.__sdfGame.extinguishAll()'); await evaluate('window.__sdfGame.step(60)'); }
    await evaluate('window.__sdfGame.step(30)');
    const r = await evaluate(`(async () => {
      const g = window.__sdfGame;
      const b = await g.bench({ mode: 'passes', kind: 'closeup', closeupFrames: 30, warmup: 8, room: 4, label: '${label}' });
      const l = b.passes?.overall?.labels ?? {};
      return { available: b.passes?.available ?? false, frames: b.passes?.overall?.frames ?? 0,
        gather: l['compute:probe-gather'] ?? null, span: b.passes?.overall?.span ?? null, meanWall: b.overall?.mean ?? null };
    })()`, 300000);
    console.log(`  gather-cost ${label}:`, JSON.stringify(r.gather ?? {}));
    return r;
  };
  const cold = await benchPasses('burn-light-cold-0', false);
  const hot = await benchPasses('burn-light-hot-4', true);
  report.checks.gatherCost = {
    burnerCount: (await evaluate('window.__sdfGame.burning()')).filter(s => s.burn > 0 || s.dying).length,
    cold, hot,
    deltaMeanMs: +(((hot.gather?.mean ?? 0) - (cold.gather?.mean ?? 0))).toFixed(4),
    deltaP50Ms: +(((hot.gather?.p50 ?? 0) - (cold.gather?.p50 ?? 0))).toFixed(4),
  };
  console.log('gather cost delta mean ms:', report.checks.gatherCost.deltaMeanMs, 'p50 ms:', report.checks.gatherCost.deltaP50Ms);

  // =======================================================================
  // GUARDS
  // =======================================================================
  const rendererErrors = consoleErrors.filter((t) => /THREE\.WebGPURenderer.*(pipeline|ShaderModule|fragment error|unresolved value)/i.test(t));
  if (rendererErrors.length > 0) fail(`renderer pipeline error: ${rendererErrors[0].slice(0, 300)}`);

  writeFileSync(`${OUT}/captures.json`, JSON.stringify(report, null, 2));
  console.log('\nDONE');
  shutdown(0);
} catch (err) {
  console.error('CAPTURE FAILED:', err?.message ?? err);
  report.failed = String(err?.message ?? err);
  try { writeFileSync(`${OUT}/burn-light-report.json`, JSON.stringify(report, null, 2)); } catch { /* best effort */ }
  shutdown(1);
}
