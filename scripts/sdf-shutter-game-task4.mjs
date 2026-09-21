#!/usr/bin/env node
// scripts/sdf-shutter-game-task4.mjs
//
// TASK-4 combined in-game verification rig for SELECTIVE SHUTTER BLUR on blood
// AND flying gibs. Successor to `sdf-shutter-game-task3.mjs` (which it does not
// replace): the task-3 rig attributed the gib delta in isolation; this one
// verifies the SHIPPED combined look, rotation, transitions, occlusion,
// regression seams and a split cost.
//
// Owns its vite + headless Chrome on an UNUSED port pair, its own profile under
// .lab-tmp, no unsafe flags, and stops only what it started. It drives the REAL
// /sdf-game.html (shipped graphics/upscale/VHS/asset gibs) — the lab is not
// evidence for appearance.
//
// Usage:
//   node scripts/sdf-shutter-game-task4.mjs [vitePort] [cdpPort] [outDir] [--only=...]
//   --only legs: defaults,combined,rotation,transitions,occlusion,regression,fallback,clip,cost
//
// Legs boot their own game instance so a mode flag cannot leak across legs.
// Every capture is frozen (`step(N, 0)` re-renders the SAME sim instant), so
// particle/piece counts are identical across variants by construction and are
// read back per shot.

import { spawn, execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForLoader } from './lib/wait-loader.mjs';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const ONLY = new Set(
  (argv.find((a) => a.startsWith('--only='))?.split('=')[1]
    ?? 'defaults,combined,rotation,transitions,occlusion,regression,fallback,clip,cost')
    .split(',').map((s) => s.trim()).filter(Boolean),
);
const VITE = Number(positional[0] ?? 5497);
const CDP = Number(positional[1] ?? 9497);
const OUT = resolve(positional[2] ?? 'docs/dev-notes/2026-09-17-shutter-blur-game/evidence');
const CLIPDIR = resolve(OUT, 'clips');
const LAB_TMP = resolve('.lab-tmp');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
mkdirSync(CLIPDIR, { recursive: true });

let previous = {};
try { previous = JSON.parse(readFileSync(`${OUT}/task4-report.json`, 'utf8')); } catch {}
const report = {
  task: 'shutter-blur-game-task4',
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

async function waitFor(url, what, tries = 200) {
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
  `--user-data-dir=${LAB_TMP}/chrome-task4-${CDP}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-crash-reporter', `--crash-dumps-dir=${LAB_TMP}/crashpad-task4-${CDP}`,
  '--window-size=980,640',
  'about:blank',
], { stdio: 'ignore', detached: true, env: { ...process.env, TMPDIR: `${LAB_TMP}/tmp-task4-${CDP}` } });
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
const evaluate = async (expression, timeoutMs = 90000) => {
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

async function bootGame(query = '', { settleMs = 1800 } = {}) {
  const q = new URLSearchParams(query.replace(/^\?/, ''));
  if (!q.has('seed')) q.set('seed', SEED);
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${q.toString()}` });
  let ok = false;
  for (let i = 0; i < 240 && !ok; i++) { await sleep(500); ok = await evaluate('typeof window.__sdfGame === "object"').catch(() => false); }
  if (!ok) throw new Error(`__sdfGame never booted (${query || 'no query'})`);
  // scripts/lib/wait-loader.mjs: waits up to 10 min, THROWS on timeout and
  // dismisses the overlay. The loop this replaces gave up silently after
  // 100 s and never dismissed, so a cold mode (task3's deferred-off) was
  // captured as "READY — CLICK TO START" frames and diffed against itself.
  await waitForLoader(evaluate, { settleMs: 0 });
  await sleep(settleMs);
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
async function capture(name, tag = 't4') {
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
  const flying = Array.isArray(pieces) ? pieces.filter(p => !p.settled) : [];
  const state = {
    file, gibDiag, bloodDiag,
    pieces: Array.isArray(pieces) ? pieces.length : null,
    flying: flying.length,
    heads: flying.filter(p => p.limb === 'head').length,
    sha256_16: execFileSync('shasum', ['-a', '256'], { input: buf, encoding: 'utf8' }).slice(0, 16),
  };
  // The default `?gibrender=assets` route draws pieces through the sprite/mesh
  // set (not `liveChunks`), so `chunkStats().livePieces` is empty there; the
  // rotation census is taken separately by the rotation leg from quat deltas.
  writeFileSync(`${OUT}/${file}.state.json`, JSON.stringify(state, null, 2));
  report.shots[file] = state;
  shotIndex[name] = file;
  console.log(`  ${file}: gib=${gibDiag?.enabled} blood=${bloodDiag?.enabled} pieces=${state.pieces} flying=${state.flying} heads=${state.heads} `
    + `gibsel=${gibDiag?.selectedPieces} gibstamps=${gibDiag?.stamps} bloodstamps=${bloodDiag?.last?.stamps} `
    + `gibmaxPx=${gibDiag?.last?.maxStreakPx?.toFixed?.(1)} err=${gibDiag?.error ?? bloodDiag?.error}`);
  return file;
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------
const M44 = 44.44444444444444;
const M67 = 66.66666666666667;
const M100 = 100;
/** sharp | blood-only | gib-only | both44 | both67 | both100. */
const COMBINED_VARIANTS = [
  { id: 'sharp', blood: false, gib: false, ms: 0 },
  { id: 'blood44', blood: true, gib: false, ms: M44 },
  { id: 'blood67', blood: true, gib: false, ms: M67 },
  { id: 'gib44', blood: false, gib: true, ms: M44 },
  { id: 'gib67', blood: false, gib: true, ms: M67 },
  { id: 'both44', blood: true, gib: true, ms: M44 },
  { id: 'both67', blood: true, gib: true, ms: M67 },
  { id: 'both100', blood: true, gib: true, ms: M100, maxStreak: 200 },
];
const PAIR_VARIANTS = [
  { id: 'sharp', blood: false, gib: false, ms: 0 },
  { id: 'm44', blood: true, gib: true, ms: M44 },
  { id: 'm67', blood: true, gib: true, ms: M67 },
];

async function setModes({ blood, gib, ms, maxStreak }) {
  await evaluate(`window.__sdfGame.setBloodBlur(${!!blood})`);
  await evaluate(`window.__sdfGame.setGibBlur(${!!gib})`);
  if (ms !== undefined) await evaluate(`window.__sdfGame.setBloodBlurExposure(${ms})`);
  await evaluate(`window.__sdfGame.setBloodBlurMaxStreak(${maxStreak ?? 120})`);
}
async function captureVariants(prefix, variants, settle = 6) {
  const out = [];
  for (const v of variants) {
    await setModes(v);
    if (settle > 0) await evaluate(`window.__sdfGame.step(${settle}, 0)`);
    out.push(await capture(`${prefix}__${v.id}`));
  }
  report.checks[`counts:${prefix}`] = out.map((f) => ({
    file: f, pieces: report.shots[f]?.pieces, flying: report.shots[f]?.flying, heads: report.shots[f]?.heads,
    gibSelected: report.shots[f]?.gibDiag?.selectedPieces, gibStamps: report.shots[f]?.gibDiag?.stamps,
    bloodStamps: report.shots[f]?.bloodDiag?.last?.stamps,
    bloodTexels: report.shots[f]?.bloodDiag?.last?.texels,
  }));
  return out;
}

// ---------------------------------------------------------------------------
// Fight staging helpers (from the task-2/3 rigs)
// ---------------------------------------------------------------------------
const AIM_JS = `(() => {
  const g = window.__sdfGame;
  const eye = g.cameraWorld();
  const p = g.playerPos();
  const cands = [];
  for (const a of g.actorList()) {
    const z = g.zombie(a.id);
    if (!z) continue;
    const clusters = z.posed().clusters || [];
    const torso = clusters.find(c => (c.limb === 'torso') && c.center) || clusters.find(c => c.center);
    if (!torso || !torso.center) continue;
    const c = torso.center;
    const d = Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]);
    if (d >= 0.7) cands.push({ id: a.id, c, d });
  }
  cands.sort((x, y) => x.d - y.d);
  for (const cand of cands) {
    const yaw = Math.atan2(cand.c[0] - eye[0], -(cand.c[2] - eye[2]));
    const pitch = Math.atan2(cand.c[1] - eye[1], Math.hypot(cand.c[0] - eye[0], cand.c[2] - eye[2]));
    g.setPose(p[0], p[2], yaw, pitch, 0);
    const hit = g.predictSlugHit();
    if (hit && hit.actorId >= 0) return { id: cand.id, dist: cand.d, yaw, pitch, hit: hit.actorId, c: cand.c };
  }
  return null;
})()`;
const aimAtNearest = () => evaluate(AIM_JS);

async function fireConfirmed(barrels = 1, slug = false, tries = 60) {
  for (let t = 0; t < tries; t++) {
    const expr = slug ? 'window.__sdfGame.fireSlug()' : `window.__sdfGame.fire(${barrels})`;
    const ok = await evaluate(expr).catch(() => false);
    if (ok) return true;
    await sleep(250);
    await evaluate('window.__sdfGame.step(3, 0)').catch(() => {});
  }
  return false;
}

async function stageWound(room, { extraVolleys = 0 } = {}) {
  await evaluate(`window.__sdfGame.teleport(${room})`);
  await evaluate('window.__sdfGame.step(12)');
  const aim = await aimAtNearest();
  await evaluate('window.__sdfGame.step(8)');
  const fired = [];
  fired.push(await fireConfirmed(1));
  for (let i = 0; i < extraVolleys; i++) {
    await evaluate('window.__sdfGame.step(28)');
    await aimAtNearest();
    fired.push(await fireConfirmed(1));
  }
  await evaluate('window.__sdfGame.step(28)');
  await aimAtNearest();
  fired.push(await fireConfirmed(1, true));
  return { room, aim, fired };
}

async function advanceToSpray({ minTexels = 400, maxFrames = 70 } = {}) {
  let peak = { texels: 0, stamps: 0, frame: -1, drops: 0 };
  let sawMin = false;
  for (let i = 0; i < maxFrames; i++) {
    await evaluate('window.__sdfGame.step(1)');
    const bb = await evaluate('window.__sdfGame.bloodBlur');
    const bl = await evaluate('window.__sdfGame.bleed');
    const tex = bb?.last?.texels ?? 0;
    if (tex > peak.texels) peak = { texels: tex, stamps: bb.last.stamps, frame: i, drops: bl?.droplets ?? 0 };
    if (tex >= minTexels) sawMin = true;
    if (sawMin && tex < peak.texels) break;
    if (sawMin && i - peak.frame >= 2) break;
  }
  return { ...peak, sawMin };
}

async function bestCrowdRoom() {
  const zs = await evaluate('window.__sdfGame.zombies()');
  const byRoom = new Map();
  for (const z of zs) byRoom.set(z.room, (byRoom.get(z.room) ?? 0) + 1);
  let best = 4, n = -1;
  for (const [room, count] of byRoom) if (count > n) { n = count; best = room; }
  return { room: best, count: n, byRoom: Object.fromEntries(byRoom) };
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

/** Frame the camera on a world point at a standoff, looking at it. */
async function frameOn(c, standoff = 1.3, pitchOffset = 0, yOffset = 0) {
  const p = await evaluate('window.__sdfGame.playerPos()');
  let dx = p[0] - c[0], dz = p[2] - c[2];
  const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
  const x = c[0] + dx * standoff, z = c[2] + dz * standoff;
  const yaw = Math.atan2(c[0] - x, -(c[2] - z));
  const pitch = Math.atan2(c[1] + yOffset - 1.62, standoff) + pitchOffset;
  await evaluate(`window.__sdfGame.placePlayer({x:${x},z:${z},yaw:${yaw},pitch:${pitch}})`);
  await evaluate('window.__sdfGame.step(6, 0)');
  return { x, z, yaw, pitch, standoff };
}

/** Step frame by frame and stop near the joint gib+blood peak. */
async function advanceToCombinedPeak({ maxFrames = 70 } = {}) {
  let peak = { gibStamps: 0, bloodStamps: 0, selected: 0, pieces: 0, frame: -1, score: 0 };
  for (let i = 0; i < maxFrames; i++) {
    await evaluate('window.__sdfGame.step(1)');
    const gb = await evaluate('window.__sdfGame.gibBlur');
    const bb = await evaluate('window.__sdfGame.bloodBlur');
    const cs = await evaluate('window.__sdfGame.chunkStates()');
    const gibStamps = gb?.stamps ?? 0;
    const bloodStamps = bb?.last?.stamps ?? 0;
    const score = gibStamps * 2 + bloodStamps; // gibs matter twice (rotation set)
    if (score > peak.score) {
      peak = { gibStamps, bloodStamps, selected: gb?.selectedPieces ?? 0, pieces: cs?.length ?? 0, frame: i, score };
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
    gib: { enabled: gib.enabled, supported: gib.supported, ready: gib.ready, warmed: gib.warmed,
      exposureMs: gib.exposureMs, maxStreakPx: gib.maxStreakPx, seed: gib.seed, layer: gib.layer,
      depthBiasM: gib.depthBiasM, taps: blood.taps },
    blood: { enabled: blood.enabled, exposureMs: blood.exposureMs, seed: blood.seed, route: blood.route },
    renderMode: await evaluate('window.__sdfGame.renderMode'),
    gibAssets: await evaluate('window.__sdfGame.gibAssetStats').catch(() => null),
    sscsTerms: await evaluate('window.__sdfGame.sscsTerms').catch(() => null),
    vhs: await evaluate('window.__sdfGame.vhs'),
    vhsTerms: await evaluate('window.__sdfGame.vhsTerms').catch(() => null),
    skeleton: await evaluate('window.__sdfGame.skeletonMode').catch(() => null),
    upscale: await evaluate('window.__sdfGame.upscaleInfo').catch(() => null),
    player: await evaluate('window.__sdfGame.playerPos()').catch(() => null),
  };
  console.log('defaults:', JSON.stringify(report.checks.defaults));
}

async function combinedLeg() {
  console.log('\n================ COMBINED LOOK ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  const crowd = await bestCrowdRoom();
  const det = await detonateOnCrowd(crowd.room);
  report.checks.combinedStage = det;
  const peak = await advanceToCombinedPeak();
  report.checks.combinedPeak = peak;
  console.log(`  combined peak: gibStamps=${peak.gibStamps} bloodStamps=${peak.bloodStamps} selected=${peak.selected} pieces=${peak.pieces} frame=${peak.frame}`);
  await evaluate('window.__sdfGame.step(3, 0)');
  // WIDE framing (the blast as staged).
  await captureVariants('combined', COMBINED_VARIANTS, 6);
  // ASYMMETRIC CLOSE-UP: frame the densest airborne cluster.
  const cs = await evaluate('window.__sdfGame.chunkStates()');
  const flying = (cs ?? []).filter(p => !p.settled);
  if (flying.length) {
    const c = flying.reduce((a, b) => (b.pos[1] > a.pos[1] ? b : a), flying[0]).pos;
    const placed = await frameOn(c, 1.4, 0, 0);
    report.checks.combinedCloseup = { piece: c, placed };
    await captureVariants('combinedclose', COMBINED_VARIANTS, 6);
  }
  // HEAD / LIMB close-up: frame the flying head if one exists.
  const head = flying.find(p => p.limb === 'head');
  if (head) {
    const placed = await frameOn(head.pos, 1.0, 0, 0);
    report.checks.combinedHead = { piece: head.pos, placed };
    await captureVariants('combinedhead', PAIR_VARIANTS, 6);
  }
  // DETERMINISTIC (VHS off) combined attribution set at the same frozen instant,
  // so the blood/gib/both contributions are measurable without tape history.
  await frameOn(flying[0].pos, 1.6, 0, 0);
  await evaluate('window.__sdfGame.setVhs(null)');
  await captureVariants('combineddet', [
    { id: 'sharp', blood: false, gib: false, ms: 0 },
    { id: 'bloodonly', blood: true, gib: false, ms: M44 },
    { id: 'gibonly', blood: false, gib: true, ms: M44 },
    { id: 'both44', blood: true, gib: true, ms: M44 },
    { id: 'both67', blood: true, gib: true, ms: M67 },
    { id: 'off', blood: false, gib: false, ms: 0 },
    { id: 'both44b', blood: true, gib: true, ms: M44 },
  ], 6);
  await evaluate(SHIPPED_VHS);
  await setModes({ blood: true, gib: true, ms: M44 });
}

async function rotationLeg() {
  console.log('\n================ ROTATION ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  // 1. PURE-SPIN FIXED-CENTRE FIXTURE. Place it on the live camera ray (so it
  //    is guaranteed in frame and unoccluded). The first tick passes the
  //    newborn age gate (no pre-birth streak); the upward kick cancelled that
  //    tick's gravity, so at the SECOND tick linear velocity is one frame of
  //    gravity (~0.16 m/s, < 1 px of translation at this standoff) while the
  //    piece turns at ~10 rad/s. A rotation-only blur is the claim.
  const spot = await evaluate('window.__sdfGame.screenRayToWorld(0.12,-0.12,1.7)');
  const id = await evaluate(`window.__sdfGame.spawnSpinFixture(${spot[0]},${spot[1]},${spot[2]},0.22,[0,0,10])`);
  await evaluate('window.__sdfGame.step(1)');
  await evaluate('window.__sdfGame.step(1)');
  report.checks.spinFixture = { id, spot };
  await frameOn(spot, 1.5, 0, 0);
  // Shipped-VHS look pair, then a VHS-off deterministic set so the radial
  // rotation signature is not swamped by tape temporal history.
  await captureVariants('spin', PAIR_VARIANTS, 4);
  await evaluate('window.__sdfGame.setVhs(null)');
  await captureVariants('spindet', [
    { id: 'sharp', blood: false, gib: false, ms: 0 },
    { id: 'on-a', blood: true, gib: true, ms: M44 },
    { id: 'off', blood: false, gib: false, ms: 0 },
    { id: 'on-b', blood: true, gib: true, ms: M44 },
    { id: 'm67', blood: true, gib: true, ms: M67 },
  ], 4);
  await evaluate(SHIPPED_VHS);
  // THEN track the spin over real frames (quat changes, centre ~fixed).
  const track = [];
  for (let i = 0; i < 4; i++) {
    const row = (await evaluate('window.__sdfGame.chunkStats()')).livePieces.find(q => q.id === id);
    track.push(row ? { pos: row.centre, quat: row.quat, angVel: row.angVel } : null);
    await evaluate('window.__sdfGame.step(1)');
  }
  report.checks.spinFixtureTrack = track;
  console.log(`  spin fixture id=${id} track=${JSON.stringify(track.map(t => t && { p: t.pos.map(v => +v.toFixed(3)), w: t.angVel.map(v => +v.toFixed(2)) }))}`);
  // 2. REAL BLAST tumbling: fresh boot, crowd blast, frame a flying head + limb.
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  const crowd = await bestCrowdRoom();
  await detonateOnCrowd(crowd.room);
  const peak = await advanceToCombinedPeak();
  report.checks.rotationPeak = peak;
  const cs = await evaluate('window.__sdfGame.chunkStates()');
  const flying = (cs ?? []).filter(q => !q.settled);
  const head = flying.find(q => q.limb === 'head');
  const limb = flying.filter(q => q.limb !== 'head').sort((a, b) => b.radius - a.radius)[0];
  const qAt = async (pid) => (await evaluate('window.__sdfGame.chunkStates()')).find(q => q.id === pid) ?? null;
  const qAngle = (a, b) => {
    if (!a || !b) return null;
    const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    return +(2 * Math.acos(Math.min(1, d))).toFixed(4);
  };
  const rotTrack = [];
  for (const piece of [head, limb].filter(Boolean)) {
    const before = await qAt(piece.id);
    await evaluate('window.__sdfGame.step(1)');
    const after = await qAt(piece.id);
    const sweep = qAngle(before?.quat, after?.quat);
    rotTrack.push({
      id: piece.id, limb: piece.limb, radius: piece.radius,
      quatBefore: before?.quat, quatAfter: after?.quat,
      sweepRadPerFrame: sweep,
      angularSpeedRadPerSec: sweep === null ? null : +(sweep * 60).toFixed(2),
      posBefore: before?.pos, posAfter: after?.pos,
      translationM: before && after
        ? +Math.hypot(after.pos[0] - before.pos[0], after.pos[1] - before.pos[1], after.pos[2] - before.pos[2]).toFixed(4)
        : null,
    });
  }
  report.checks.rotationTrack = rotTrack;
  console.log(`  rotation track: ${JSON.stringify(rotTrack.map(t => ({ id: t.id, limb: t.limb, wRadS: t.angularSpeedRadPerSec, dM: t.translationM })))}`);
  if (head) {
    await frameOn(head.pos, 1.0, 0, 0);
    await captureVariants('rothead', PAIR_VARIANTS, 6);
  }
  if (limb) {
    await frameOn(limb.pos, 1.1, 0, 0);
    await captureVariants('rotlimb', PAIR_VARIANTS, 6);
  }
  // 3. WIDE real-blast pair for context.
  await captureVariants('rotwide', PAIR_VARIANTS, 6);
  // Deterministic (VHS off) rotation pair on the real head, for the metric.
  if (head) {
    await frameOn(head.pos, 1.0, 0, 0);
    await evaluate('window.__sdfGame.setVhs(null)');
    await captureVariants('rotheaddet', [
      { id: 'sharp', blood: false, gib: false, ms: 0 },
      { id: 'on-a', blood: true, gib: true, ms: M44 },
      { id: 'off', blood: false, gib: false, ms: 0 },
      { id: 'on-b', blood: true, gib: true, ms: M44 },
    ], 6);
    await evaluate(SHIPPED_VHS);
  }
  await setModes({ blood: true, gib: true, ms: M44 });
}

async function transitionsLeg() {
  console.log('\n================ TRANSITIONS (stationary/sliding/settled) ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  // Keep settled pieces LIVE (the shipped bake would retire them into a baked
  // mesh and drop them from `chunkStates`, hiding the settled-sharp evidence).
  await evaluate('window.__sdfGame.setChunkBake(false)');
  const p = await evaluate('window.__sdfGame.playerPos()');
  // A piece thrown ACROSS the view at a controlled slow slide (linear + spin),
  // so it blurs while sliding and must return sharp once settled. Velocity is
  // built from the LIVE camera right vector so the slide stays in frame.
  const c0 = await evaluate('window.__sdfGame.screenRayToWorld(0,0,2.0)');
  const cr = await evaluate('window.__sdfGame.screenRayToWorld(0.25,0,2.0)');
  let rx = cr[0] - c0[0], ry = cr[1] - c0[1], rz = cr[2] - c0[2];
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  // Spawn LOW so a short slide settles well inside the trace window; a piece at
  // eye height would still be falling at frame 90 and never reach `settled`.
  c0[1] = 0.34;
  const id = await evaluate(`window.__sdfGame.spawnTestChunk(${c0[0]},${c0[1]},${c0[2]},0.16,false,[${(rx * 0.7).toFixed(3)},0.1,${(rz * 0.7).toFixed(3)}])`);
  await frameOn(c0, 1.9, 0, 0);
  // Trace while it slides (fixed 1/60 steps), then capture the SLIDING instant.
  const frames = [];
  let lastPos = null;
  for (let i = 0; i < 4; i++) {
    await evaluate('window.__sdfGame.step(1)');
    const cs = (await evaluate('window.__sdfGame.chunkStates()')).find(q => q.id === id);
    const st = (await evaluate('window.__sdfGame.chunkStats()')).livePieces.find(q => q.id === id);
    if (cs) { frames.push({ i, y: +cs.pos[1].toFixed(3), speed: +Math.hypot(...cs.vel).toFixed(3), ang: +Math.hypot(...(st?.angVel ?? [0, 0, 0])).toFixed(2), settled: !!cs.settled }); lastPos = cs.pos; }
  }
  await captureVariants('slide', PAIR_VARIANTS, 4);
  // Continue to rest, tracking the transition, then reframe on the piece.
  for (let i = 0; i < 240; i++) {
    await evaluate('window.__sdfGame.step(1)');
    const cs = (await evaluate('window.__sdfGame.chunkStates()')).find(q => q.id === id);
    if (!cs) break;
    const st = (await evaluate('window.__sdfGame.chunkStats()')).livePieces.find(q => q.id === id);
    frames.push({ i: i + 4, y: +cs.pos[1].toFixed(3), speed: +Math.hypot(...cs.vel).toFixed(3), ang: +Math.hypot(...(st?.angVel ?? [0, 0, 0])).toFixed(2), settled: !!cs.settled });
    if (cs.settled && i > 3) { lastPos = cs.pos; break; }
    lastPos = cs.pos;
  }
  report.checks.transitionTrace = { id, frames: frames.slice(0, 8).concat(frames.slice(-3)) };
  console.log(`  transition trace: ${JSON.stringify(report.checks.transitionTrace.frames.slice(-3))}`);
  // STATIONARY twin: blur must be a no-op. Spawn ON the floor (y = 0 puts the
  // origin at its support radius) so gravity cannot make it drift; a piece
  // held at eye height with zero velocity simply falls and is selected.
  const s0 = await evaluate('window.__sdfGame.screenRayToWorld(0.32,-0.28,1.9)');
  s0[1] = 0.0;
  const sid = await evaluate(`window.__sdfGame.spawnTestChunk(${s0[0]},${s0[1]},${s0[2]},0.16,true,undefined,[0,0,0])`);
  report.checks.stationaryId = sid;
  if (lastPos) await frameOn(lastPos, 1.4, 0, 0);
  await evaluate('window.__sdfGame.step(6, 0)');
  await captureVariants('still', PAIR_VARIANTS, 4);
  // SETTLED: the SAME piece at rest, reframed — on/off must be a no-op.
  await captureVariants('settled', PAIR_VARIANTS, 4);
  // Deterministic (VHS off) rest pair, GIB-ONLY (blood off) so any diff is
  // gib blur: both the settled slide piece and the stationary twin are in
  // frame and neither is selected, so the result must be a no-op.
  await evaluate('window.__sdfGame.setVhs(null)');
  await captureVariants('restdet', [
    { id: 'sharp', blood: false, gib: false, ms: 0 },
    { id: 'on-a', blood: false, gib: true, ms: M44 },
    { id: 'off', blood: false, gib: false, ms: 0 },
    { id: 'on-b', blood: false, gib: true, ms: M44 },
  ], 4);
  await evaluate(SHIPPED_VHS);
  await setModes({ blood: true, gib: true, ms: M44 });
}

async function occlusionLeg() {
  console.log('\n================ OCCLUSION / CROSSING ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  // Wound a body, then put a fast moving chunk between camera and the spray so
  // a blurred gib overlaps airborne blood. Compare gib-only, blood-only, both.
  const wound = await stageWound(4);
  report.checks.occlusionWound = wound;
  await evaluate('window.__sdfGame.step(20)');
  const p = await evaluate('window.__sdfGame.playerPos()');
  const aim = await aimAtNearest();
  let chunkId = -1;
  if (aim) {
    // Place the crossing piece 1.0 m in front of the camera along the aim ray.
    const dir = [aim.c[0] - p[0], aim.c[1] - 1.62, aim.c[2] - p[2]];
    const L = Math.hypot(...dir); dir[0] /= L; dir[1] /= L; dir[2] /= L;
    const cx = p[0] + dir[0] * 1.0, cy = 1.62 + dir[1] * 1.0, cz = p[2] + dir[2] * 1.0;
    chunkId = await evaluate(`window.__sdfGame.spawnTestChunk(${cx},${cy},${cz},0.18,false)`);
    await evaluate('window.__sdfGame.step(2)');
  }
  report.checks.occlusionChunkId = chunkId;
  await captureVariants('occl', [
    { id: 'sharp', blood: false, gib: false, ms: 0 },
    { id: 'gibonly', blood: false, gib: true, ms: M44 },
    { id: 'bloodonly', blood: true, gib: false, ms: M44 },
    { id: 'both', blood: true, gib: true, ms: M44 },
  ], 6);
  // Deterministic (VHS off) copy for the ordering metric.
  await evaluate('window.__sdfGame.setVhs(null)');
  await captureVariants('occldet', [
    { id: 'sharp', blood: false, gib: false, ms: 0 },
    { id: 'gibonly', blood: false, gib: true, ms: M44 },
    { id: 'bloodonly', blood: true, gib: false, ms: M44 },
    { id: 'both', blood: true, gib: true, ms: M44 },
  ], 6);
  // SAME FROZEN FRAME, gib occluder ON vs OFF. `occlab` carries the masks
  // (sharp/gibonly/bloodonly) plus the ON combined frame; `occlaboff` is the
  // identical instant with the second occluder disabled, so the difference is
  // exactly the mutual-occlusion correction.
  await evaluate('window.__sdfGame.setGibOccluder(true)');
  await captureVariants('occlab', [
    { id: 'sharp', blood: false, gib: false, ms: 0 },
    { id: 'gibonly', blood: false, gib: true, ms: M44 },
    { id: 'bloodonly', blood: true, gib: false, ms: M44 },
    { id: 'bothocclon', blood: true, gib: true, ms: M44 },
  ], 6);
  await evaluate('window.__sdfGame.setGibOccluder(false)');
  await captureVariants('occlaboff', [
    { id: 'bothoccloff', blood: true, gib: true, ms: M44 },
    { id: 'bothoccloff-b', blood: true, gib: true, ms: M44 },
  ], 6);
  await evaluate('window.__sdfGame.setGibOccluder(true)');
  await evaluate(SHIPPED_VHS);
  // WALL/CRATE framing: same blast, camera turned so streaks cross a wall.
  await frameOn([p[0] + 1.2, 1.2, p[2] - 2.0], 2.6, 0.15, 0);
  await captureVariants('occlwall', [
    { id: 'sharp', blood: false, gib: false, ms: 0 },
    { id: 'both', blood: true, gib: true, ms: M44 },
  ], 6);
  await setModes({ blood: true, gib: true, ms: M44 });
}

async function regressionLeg() {
  console.log('\n================ REGRESSION SEAMS ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  // --- empty/zero parity (vhs off, empty scene) -----------------------------
  await evaluate('window.__sdfGame.setVhs(null)');
  await setModes({ blood: false, gib: false, ms: 0 });
  await evaluate('window.__sdfGame.step(8, 0)');
  await capture('reg-empty-off');
  await setModes({ blood: true, gib: true, ms: M44 });
  await evaluate('window.__sdfGame.step(8, 0)');
  await capture('reg-empty-on');
  await setModes({ blood: true, gib: true, ms: 0 });
  await evaluate('window.__sdfGame.step(8, 0)');
  await capture('reg-empty-zero');
  // --- pause/resume ---------------------------------------------------------
  const before = await evaluate('window.__sdfGame.gibBlur');
  await evaluate('window.__sdfGame.setLoopRunning(false)');
  await sleep(1500);
  const after = await evaluate('window.__sdfGame.gibBlur');
  report.checks.pause = { beforeMaxPx: before?.last?.maxStreakPx, afterMaxPx: after?.last?.maxStreakPx,
    beforeStamps: before?.stamps, afterStamps: after?.stamps, err: after?.error ?? before?.error };
  await evaluate('window.__sdfGame.setLoopRunning(true)');
  // --- live toggle + repeated blasts ---------------------------------------
  const crowd = await bestCrowdRoom();
  let repeatErr = null;
  for (let b = 0; b < 3; b++) {
    await detonateOnCrowd(crowd.room);
    await evaluate('window.__sdfGame.step(30)');
    const gb = await evaluate('window.__sdfGame.gibBlur');
    const bb = await evaluate('window.__sdfGame.bloodBlur');
    if (gb?.error || bb?.error) { repeatErr = { blast: b, gib: gb?.error, blood: bb?.error }; break; }
  }
  report.checks.repeatedBlasts = { count: 3, error: repeatErr,
    gib: await evaluate('window.__sdfGame.gibBlur'), blood: await evaluate('window.__sdfGame.bloodBlur') };
  // live toggle on a live (non-frozen) frame
  await evaluate('window.__sdfGame.setGibBlur(false)'); await evaluate('window.__sdfGame.step(2)');
  const off = await evaluate('window.__sdfGame.gibBlur');
  await evaluate('window.__sdfGame.setGibBlur(true)'); await evaluate('window.__sdfGame.step(2)');
  const on = await evaluate('window.__sdfGame.gibBlur');
  report.checks.liveToggle = { offEnabled: off.enabled, onEnabled: on.enabled, offErr: off.error, onErr: on.error };
  // --- query flags ----------------------------------------------------------
  for (const [id, q] of [['gibblur0', '?gibblur=0'], ['bloodblur0', '?bloodblur=0'],
    ['blurms', '?blurms=66.67'], ['blurmax', '?blurmax=200']]) {
    await bootGame(q);
    report.checks[`query:${id}`] = { gib: await evaluate('window.__sdfGame.gibBlur'),
      blood: await evaluate('window.__sdfGame.bloodBlur') };
  }
  // --- resize / graphics switch --------------------------------------------
  for (const [id, q] of [['res640', '?res=640'], ['graphics-high', '?graphics=high']]) {
    await bootGame(q);
    const gb = await evaluate('window.__sdfGame.gibBlur');
    const bb = await evaluate('window.__sdfGame.bloodBlur');
    report.checks[`realloc:${id}`] = { query: q,
      gib: { enabled: gb.enabled, ready: gb.ready, seed: gb.seed, layer: gb.layer, error: gb.error },
      blood: { enabled: bb.enabled, seed: bb.seed, error: bb.error },
      renderMode: await evaluate('window.__sdfGame.renderMode') };
  }
  console.log('  regression:', JSON.stringify({ pause: report.checks.pause, repeated: report.checks.repeatedBlasts.error,
    liveToggle: report.checks.liveToggle, realloc640: report.checks['realloc:res640'].gib }));
}

async function fallbackLeg() {
  console.log('\n================ MARCHED FALLBACK / ASSET ROUTE ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  for (const [id, q] of [['march', '?gibrender=march'], ['carve', '?gibrender=carve'], ['assets', '']]) {
    const errBefore = errors.length;
    await bootGame(q);
    await applyShippedVhs();
    await applyHold(true);
    const crowd = await bestCrowdRoom();
    await detonateOnCrowd(crowd.room);
    const peak = await advanceToCombinedPeak();
    const gb = await evaluate('window.__sdfGame.gibBlur');
    report.checks[`fallback:${id}`] = {
      query: q || '(default)',
      peak: { gibStamps: peak.gibStamps, bloodStamps: peak.bloodStamps, selected: peak.selected, pieces: peak.pieces },
      enabled: gb.enabled, error: gb.error,
      gibAssets: await evaluate('window.__sdfGame.gibAssetStats').catch(() => null),
      renderModes: await evaluate('window.__sdfGame.chunkStates()')
        .then(cs => [...new Set((cs ?? []).map(c => c.render))]).catch(() => null),
      consoleErrors: errors.length - errBefore,
    };
    await evaluate('window.__sdfGame.step(3, 0)');
    await captureVariants(`fall-${id}`, PAIR_VARIANTS, 4);
    console.log(`  ${id}: ${JSON.stringify(report.checks[`fallback:${id}`].peak)} err=${gb.error}`);
  }
}

async function clipLeg() {
  console.log('\n================ CLIPS ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  const crowd = await bestCrowdRoom();
  await detonateOnCrowd(crowd.room);
  await evaluate('window.__sdfGame.step(18)');
  await setModes({ blood: true, gib: true, ms: M44 });
  await evaluate('window.__sdfGame.setLoopRunning(false)');
  await recordClip('combined-blast-both44', 'window.__sdfGame.setLoopRunning(true)', 3600);
  await evaluate('window.__sdfGame.setLoopRunning(false)');
  await setModes({ blood: false, gib: true, ms: M44 });
  await recordClip('combined-blast-gibonly44', 'window.__sdfGame.setLoopRunning(true)', 2400);
  await evaluate('window.__sdfGame.setLoopRunning(false)');
  await setModes({ blood: true, gib: false, ms: M44 });
  await recordClip('combined-blast-bloodonly44', 'window.__sdfGame.setLoopRunning(true)', 2400);
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

// ---------------------------------------------------------------------------
// Cost bench
// ---------------------------------------------------------------------------
async function benchVariant(variant, frames, label) {
  await setModes(variant);
  await evaluate('window.__sdfGame.step(4, 0)');
  const expr = `(async () => {
    const g = window.__sdfGame;
    const times = []; const buildGib = []; const buildBlood = [];
    let gibStamps = 0, gibSelected = 0, bloodStamps = 0, bloodTexels = 0;
    for (let i = 0; i < ${frames}; i++) {
      const t0 = performance.now();
      g.step(1, 0);
      await g.resolveGpu();
      times.push(performance.now() - t0);
      const gb = g.gibBlur; const bb = g.bloodBlur;
      buildGib.push(gb.last.buildMs ?? 0); buildBlood.push(bb.last.buildMs ?? 0);
      gibStamps = Math.max(gibStamps, gb.stamps); gibSelected = Math.max(gibSelected, gb.selectedPieces);
      bloodStamps = Math.max(bloodStamps, bb.last.stamps ?? 0); bloodTexels = Math.max(bloodTexels, bb.last.texels ?? 0);
    }
    return { times, buildGib, buildBlood, gibStamps, gibSelected, bloodStamps, bloodTexels };
  })()`;
  const r = await evaluate(expr, 300000);
  const pct = (arr, p) => {
    const s = [...arr].sort((a, b) => a - b);
    return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(3);
  };
  const out = {
    label, variant: variant.id, frames,
    totalMsPerFrame: { p50: pct(r.times, 50), p95: pct(r.times, 95), mean: +(r.times.reduce((a, b) => a + b, 0) / r.times.length).toFixed(3) },
    buildGibMs: { p50: pct(r.buildGib, 50), p95: pct(r.buildGib, 95), max: +Math.max(...r.buildGib).toFixed(3) },
    buildBloodMs: { p50: pct(r.buildBlood, 50), p95: pct(r.buildBlood, 95), max: +Math.max(...r.buildBlood).toFixed(3) },
    gibStamps: r.gibStamps, gibSelected: r.gibSelected, bloodStamps: r.bloodStamps, bloodTexels: r.bloodTexels,
  };
  report.benches[label] = out;
  console.log(`  bench ${label}: p50=${out.totalMsPerFrame.p50} p95=${out.totalMsPerFrame.p95} gibStamps=${r.gibStamps} bloodStamps=${r.bloodStamps}`);
  return out;
}

async function passTimingSnapshot(label) {
  const r = await evaluate(`(async () => {
    const g = window.__sdfGame;
    const out = await g.passTimings();
    return out;
  })()`).catch(() => null);
  // Aggregate to per-label means/counts (the raw per-pass samples are ~14k
  // lines and would bloat the committed report; the means are what is read).
  let summary = null;
  if (r && Array.isArray(r.samples)) {
    const by = new Map();
    for (const s of r.samples) {
      const e = by.get(s.label) ?? { label: s.label, n: 0, sumMs: 0 };
      e.n++; e.sumMs += s.ms; by.set(s.label, e);
    }
    summary = {
      installed: r.installed, sampleCount: r.samples.length,
      labels: [...by.values()].map((e) => ({ label: e.label, n: e.n, meanMs: +(e.sumMs / e.n).toFixed(3) }))
        .sort((a, b) => b.meanMs - a.meanMs),
    };
  }
  report.checks[`passTimings:${label}`] = summary;
  return summary;
}

async function memorySnapshot(label) {
  const gib = await evaluate('window.__sdfGame.gibBlur');
  const blood = await evaluate('window.__sdfGame.bloodBlur');
  const bytes = (s, l) => (s.width * s.height * 4) * (l === 'rgba16f' ? 2 : 4);
  const mem = {
    gibSeedBytes: gib.seed.width * gib.seed.height * 16,
    gibLayerBytes: gib.layer.width * gib.layer.height * 8,
    gibLayerDepthBytes: gib.layer.width * gib.layer.height * 4,
    gibStageBytes: gib.layer.width * gib.layer.height * 8,
    bloodSeedBytes: blood.seed.width * blood.seed.height * 16,
    bloodLayerBytes: blood.layer ? blood.layer.width * blood.layer.height * 8 : null,
    note: 'analytic from diagnostics dims; RGBA16F colour, DepthTexture 32-bit, seed RGBA32F',
  };
  mem.gibTotalBytes = mem.gibSeedBytes + mem.gibLayerBytes + mem.gibLayerDepthBytes + mem.gibStageBytes;
  report.checks[`memory:${label}`] = mem;
  return mem;
}

async function costLeg() {
  console.log('\n================ COST (heavy crowd blast) ================');
  report.checks.costLoadStart = loadavg().map((v) => +v.toFixed(2));
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  const boot = await evaluate('window.__sdfGame.gibBlur');
  report.checks.costBootReady = { ready: boot.ready, warmed: boot.warmed, seed: boot.seed, layer: boot.layer };
  await memorySnapshot('boot');
  const crowd = await bestCrowdRoom();
  await detonateOnCrowd(crowd.room);
  const peak = await advanceToCombinedPeak();
  report.checks.costHeavyPeak = peak;
  await evaluate('window.__sdfGame.step(3, 0)');
  const variants = [
    { id: 'sharp', blood: false, gib: false, ms: 0 },
    { id: 'bloodonly44', blood: true, gib: false, ms: M44 },
    { id: 'gibonly44', blood: false, gib: true, ms: M44 },
    { id: 'both44', blood: true, gib: true, ms: M44 },
    { id: 'both67', blood: true, gib: true, ms: M67 },
  ];
  const reps = 4, frames = 20;
  const perRep = [];
  for (let r = 0; r < reps; r++) {
    const row = {};
    for (const v of variants) row[v.id] = (await benchVariant(v, frames, `cost-heavy-${v.id}-r${r}`)).totalMsPerFrame.p50;
    perRep.push(row);
    console.log(`  heavy rep${r}: ${JSON.stringify(row)}`);
  }
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const delta = (id) => +med(perRep.map((r) => r[id] - r.sharp)).toFixed(3);
  report.benches['cost-heavy-summary'] = {
    reps, framesPerVariant: frames, perRep,
    sharpP50Median: +med(perRep.map((r) => r.sharp)).toFixed(3),
    deltaBloodOnly: delta('bloodonly44'), deltaGibOnly: delta('gibonly44'),
    deltaBoth44: delta('both44'), deltaBoth67: delta('both67'),
  };
  console.log('  heavy summary:', JSON.stringify(report.benches['cost-heavy-summary']));
  // First vs repeated: the first blurred frame cost after switching ON.
  await setModes({ blood: false, gib: false, ms: 0 });
  await evaluate('window.__sdfGame.step(4, 0)');
  const first = await evaluate(`(async () => {
    const g = window.__sdfGame;
    g.setBloodBlur(true); g.setGibBlur(true); g.setBloodBlurExposure(${M44}); g.setBloodBlurMaxStreak(120);
    const t0 = performance.now(); g.step(1, 0); await g.resolveGpu(); const firstMs = performance.now() - t0;
    const t1 = performance.now(); g.step(1, 0); await g.resolveGpu(); const secondMs = performance.now() - t1;
    return { firstMs, secondMs };
  })()`);
  report.checks.firstVsRepeated = first;
  console.log(`  first=${first?.firstMs?.toFixed?.(1)}ms second=${first?.secondMs?.toFixed?.(1)}ms`);
  await passTimingSnapshot('heavy');
  await memorySnapshot('heavy');
  // Settled: step until pieces settle, then bench (should be ~sharp).
  await evaluate('window.__sdfGame.step(900)');
  const settledStates = await evaluate('window.__sdfGame.chunkStates()');
  report.checks.costSettledCensus = { pieces: settledStates?.length ?? 0, flying: (settledStates ?? []).filter(p => !p.settled).length };
  const settled = await benchVariant({ id: 'settled-both44', blood: true, gib: true, ms: M44 }, frames, 'cost-settled-both44');
  const settledSharp = await benchVariant({ id: 'settled-sharp', blood: false, gib: false, ms: 0 }, frames, 'cost-settled-sharp');
  report.benches['cost-settled-summary'] = { both44P50: settled.totalMsPerFrame.p50, sharpP50: settledSharp.totalMsPerFrame.p50 };
  // Ordinary: fresh boot, ONE body blast (fewer pieces).
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  const zs = await evaluate('window.__sdfGame.zombies()');
  if (zs.length) {
    const one = zs[0];
    await evaluate(`window.__sdfGame.placePlayer({x:${one.pos[0] + 4},z:${one.pos[2] + 3},yaw:${Math.atan2(-4, -3)},pitch:-0.1})`);
    await evaluate('window.__sdfGame.step(6)');
    const blast = await evaluate(`window.__sdfGame.detonate(${one.pos[0]},${one.pos[1] + 0.5},${one.pos[2]})`);
    report.checks.costOrdinaryBlast = blast;
    const opeak = await advanceToCombinedPeak();
    report.checks.costOrdinaryPeak = opeak;
    await evaluate('window.__sdfGame.step(3, 0)');
    const ob = [];
    for (let r = 0; r < 3; r++) {
      const row = {};
      for (const v of variants) row[v.id] = (await benchVariant(v, frames, `cost-ordinary-${v.id}-r${r}`)).totalMsPerFrame.p50;
      ob.push(row);
    }
    report.benches['cost-ordinary-summary'] = {
      perRep: ob,
      sharpP50Median: +med(ob.map((r) => r.sharp)).toFixed(3),
      deltaBloodOnly: +med(ob.map((r) => r.bloodonly44 - r.sharp)).toFixed(3),
      deltaGibOnly: +med(ob.map((r) => r.gibonly44 - r.sharp)).toFixed(3),
      deltaBoth44: +med(ob.map((r) => r.both44 - r.sharp)).toFixed(3),
    };
    console.log('  ordinary summary:', JSON.stringify(report.benches['cost-ordinary-summary']));
  }
  report.checks.costLoadEnd = loadavg().map((v) => +v.toFixed(2));
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
try {
  const legs = [
    ['defaults', defaultsLeg], ['combined', combinedLeg], ['rotation', rotationLeg],
    ['transitions', transitionsLeg], ['occlusion', occlusionLeg], ['regression', regressionLeg],
    ['fallback', fallbackLeg], ['clip', clipLeg], ['cost', costLeg],
  ];
  for (const [name, fn] of legs) {
    if (!ONLY.has(name)) continue;
    try { await fn(); } catch (err) {
      report.checks[`legError:${name}`] = String(err?.stack ?? err).slice(0, 900);
      console.error(`LEG ${name} FAILED:`, report.checks[`legError:${name}`]);
    }
  }
} catch (err) {
  report.failed = String(err?.stack ?? err);
  console.error('RUN FAILED:', report.failed);
}
report.consoleErrors = errors.slice(0, 60);
report.finishedAt = new Date().toISOString();
writeFileSync(`${OUT}/task4-report.json`, JSON.stringify(report, null, 2));
console.log(`\nwrote ${OUT}/task4-report.json (${Object.keys(report.shots).length} shots)`);
if (report.consoleErrors.length) console.log(`console errors: ${report.consoleErrors.length}`, report.consoleErrors.slice(0, 5));
shutdown(report.failed ? 1 : 0);
