// scripts/sdf-shutter-game-task2.mjs
//
// TASK 2 — IN-GAME VISUAL ACCEPTANCE EVIDENCE AND COST (selective shutter blur).
//
// The Task-1 smoke (sdf-shutter-game-check.mjs) proves the wiring boots and a
// real spray produces seed stamps. This harness is the measured form the plan's
// stage-3 gate asks for:
//
//   look   — matched frozen pairs (sharp / 44.44 ms / 66.67 ms / 100 ms) over
//            several real in-game scenarios, under the SHIPPED VHS stack, plus
//            a deterministic vhs=off set for pixel diffs.
//   clips  — normal-speed screencast clips (wound on/off, dynamite, camera turn).
//   checks — regression seams: off|zero parity, finite clamps, matched counts,
//            pause/resume, resize/render-scale, empty bypass, no newborn streak.
//   cost   — quiet-machine matched fenced frame cost (sharp / 44.44 / 66.67) on
//            an ordinary and a heavy frozen fight at identical particle counts.
//
// Own vite + headless Chrome on an UNUSED port pair, own profile under
// .lab-tmp, no unsafe flags. Stops only what it started.
//
// Usage: node scripts/sdf-shutter-game-task2.mjs [vitePort] [cdpPort] [outDir] [--only=look,clips,checks,cost]

import { spawn, execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const ONLY = new Set(
  (argv.find((a) => a.startsWith('--only='))?.split('=')[1]
    ?? 'look,checks,clips,cost,tiers').split(',').map((s) => s.trim()).filter(Boolean),
);
const VITE = Number(positional[0] ?? 5492);
const CDP = Number(positional[1] ?? 9492);
const OUT = resolve(positional[2] ?? 'docs/dev-notes/2026-09-17-shutter-blur-game/evidence');
const CLIPDIR = resolve(OUT, 'clips');
const LAB_TMP = resolve('.lab-tmp');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = {
  task: '2026-09-17-shutter-blur-game-task-2',
  hash: (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })(),
  branch: (() => { try { return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })(),
  startedAt: new Date().toISOString(),
  modes: [...ONLY],
  shots: {}, checks: {}, benches: {}, clips: {}, consoleErrors: [],
};

const children = [];
let finished = false;
function shutdown(code) {
  if (finished) return;
  finished = true;
  try { writeFileSync(`${OUT}/task2-report.json`, JSON.stringify(report, null, 2)); } catch { /* best effort */ }
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch { /* gone */ } }
  }
  setTimeout(() => process.exit(code), 600);
}
process.on('exit', () => { for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } } });
setTimeout(() => { console.error('WATCHDOG: task2 harness exceeded 40 minutes'); shutdown(9); }, 40 * 60 * 1000);

async function waitFor(url, what, tries = 160) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up */ }
    await sleep(500);
  }
  throw new Error(`${what} never came up at ${url}`);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(CLIPDIR, { recursive: true });
mkdirSync(`${LAB_TMP}/tmp-${CDP}`, { recursive: true });

// Merge into a previous report so `--only=` legs can run incrementally without
// discarding the other legs' evidence.
try {
  const prev = JSON.parse(readFileSync(`${OUT}/task2-report.json`, 'utf8'));
  for (const k of ['shots', 'checks', 'benches', 'clips']) {
    if (prev[k]) report[k] = { ...prev[k], ...report[k] };
  }
  report.previousRun = prev.startedAt;
} catch { /* no previous report */ }

for (const [port, what] of [[VITE, 'vite'], [CDP, 'chrome']]) {
  try {
    const r = await fetch(`http://localhost:${port}/`);
    if (r.status >= 0) { console.error(`port ${port} (${what}) is already answering — choose another`); process.exit(2); }
  } catch { /* connection refused = free */ }
}

console.log(`starting vite on ${VITE}`);
const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(VITE), '--strictPort'], { stdio: 'ignore', detached: true });
children.push(vite);
await waitFor(`http://localhost:${VITE}/`, 'vite');

console.log(`starting headless chrome on ${CDP}`);
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${LAB_TMP}/chrome-task2-${CDP}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-crash-reporter', `--crash-dumps-dir=${LAB_TMP}/crashpad-task2-${CDP}`,
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
async function setMetrics(w, h) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
}

/**
 * A REAL viewport resize. `Emulation.setDeviceMetricsOverride` does not move
 * `window.innerWidth` in this headless build (the game's cap reads it), so the
 * post-aa refit never fires. Browser.setWindowBounds does change it; fall back
 * to an explicit resize event if the bounds call is refused.
 */
async function resizeWindow(w, h) {
  try {
    const info = await send('Browser.getWindowForTarget');
    const windowId = info.result?.windowId;
    if (windowId !== undefined) {
      await send('Browser.setWindowBounds', { windowId, bounds: { width: w, height: h } });
      await sleep(500);
      return 'window-bounds';
    }
  } catch { /* fall through */ }
  await setMetrics(w, h);
  await evaluate("window.dispatchEvent(new Event('resize'))");
  await sleep(400);
  return 'resize-event';
}

// ---------------------------------------------------------------------------
// Boot / shipped look
// ---------------------------------------------------------------------------
const SEED = '20260917';
const SHIPPED_VHS = `(() => {
  const g = window.__sdfGame;
  g.setVhs('blud');
  g.setVhsTerm('intensity', 0.81);
  g.setVhsTerm('blurAmount', 0.17);
  return g.vhs;
})()`;

async function bootGame(query = '') {
  const q = new URLSearchParams(query.replace(/^\?/, ''));
  if (!q.has('seed')) q.set('seed', SEED);
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${q.toString()}` });
  let ok = false;
  for (let i = 0; i < 240 && !ok; i++) {
    await sleep(500);
    ok = await evaluate('typeof window.__sdfGame === "object"').catch(() => false);
  }
  if (!ok) throw new Error(`__sdfGame never booted (${query || 'no query'})`);
  for (let i = 0; i < 200; i++) {
    const ready = await evaluate(`(() => {
      const l = document.getElementById('loader');
      const warm = window.__warmGate;
      return (l && l.classList.contains('loader-hidden'))
        || (warm && warm.phase === 'ready')
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

async function applyShippedVhs() {
  await evaluate(SHIPPED_VHS);
}

/** Determinism for matched frozen captures: pin render-side clocks. */
async function applyHold(on) {
  await evaluate(`window.__sdfGame.setDemoHold(${on})`);
  await evaluate(`window.__sdfGame.setLightClockFrozen(${on})`);
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------
const shotIndex = {};
async function capture(name, tag = 't2') {
  const shot = await Promise.race([
    send('Page.captureScreenshot', { format: 'png' }),
    sleep(20000).then(() => ({ __timeout: true })),
  ]);
  if (shot.__timeout) throw new Error(`Page.captureScreenshot timed out for ${name}`);
  const buf = Buffer.from(shot.result.data, 'base64');
  const file = `${tag}-${name}`;
  writeFileSync(`${OUT}/${file}.png`, buf);
  const diag = await evaluate('window.__sdfGame.bloodBlur').catch(() => null);
  const bleed = await evaluate('window.__sdfGame.bleed').catch(() => null);
  const state = { file, diag, bleed, sha256_16: execFileSync('shasum', ['-a', '256'], { input: buf, encoding: 'utf8' }).slice(0, 16) };
  writeFileSync(`${OUT}/${file}.state.json`, JSON.stringify(state, null, 2));
  report.shots[file] = state;
  shotIndex[name] = file;
  console.log(`  ${file}: enabled=${diag?.enabled} ms=${diag?.exposureMs?.toFixed?.(2)} stamps=${diag?.last?.stamps} texels=${diag?.last?.texels} maxPx=${diag?.last?.maxStreakPx?.toFixed?.(1)} drops=${bleed?.droplets}`);
  return file;
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------
const M44 = 44.44444444444444;
const M67 = 66.66666666666667;
const VARIANTS = [
  { id: 'sharp', blur: false, ms: 0 },
  { id: 'm44', blur: true, ms: M44 },
  { id: 'm67', blur: true, ms: M67 },
  { id: 'm100', blur: true, ms: 100 },
];

async function applyVariant(v) {
  await evaluate(`window.__sdfGame.setBloodBlur(${v.blur})`);
  if (v.blur) await evaluate(`window.__sdfGame.setBloodBlurExposure(${v.ms})`);
  await evaluate(`window.__sdfGame.setBloodBlurMaxStreak(${v.maxStreak ?? 120})`);
}

/** Primary wound variants, including the stronger 200 px streak cap option. */
const WOUND_VARIANTS = [
  ...VARIANTS,
  { id: 'm44cap200', blur: true, ms: M44, maxStreak: 200 },
];

/**
 * Capture every variant at the CURRENT frozen sim instant. dt=0 re-renders the
 * same state, so particle counts are identical by construction; they are read
 * back per shot as proof. `settle` dt=0 frames let VHS temporal history settle.
 */
async function captureVariants(prefix, variants = VARIANTS, settle = 10, { restore = true } = {}) {
  const out = [];
  for (const v of variants) {
    await applyVariant(v);
    if (settle > 0) await evaluate(`window.__sdfGame.step(${settle}, 0)`);
    out.push(await capture(`${prefix}__${v.id}`));
  }
  if (restore) await applyVariant(VARIANTS[1]);
  report.checks[`counts:${prefix}`] = out.map((f) => ({
    file: f, droplets: report.shots[f]?.bleed?.droplets, splats: report.shots[f]?.bleed?.splats,
    stamps: report.shots[f]?.diag?.last?.stamps, texels: report.shots[f]?.diag?.last?.texels,
  }));
  return out;
}

// ---------------------------------------------------------------------------
// Fight staging
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

/** Teleport, aim, open a wound with buckshot then sever with a slug. */
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

/**
 * Step one frame at a time, tracking selected blood, and stop when the airborne
 * spray peaks at/above `minTexels`. Returns the peak readout.
 */
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

/** Aim at the nearest body and place the camera at `standoff` metres along the aim. */
async function closeupOnNearest(standoff = 1.4, pitchOffset = 0) {
  const aim = await aimAtNearest();
  if (!aim) return null;
  const p = await evaluate('window.__sdfGame.playerPos()');
  const dx = aim.c[0] - p[0], dz = aim.c[2] - p[2];
  const L = Math.hypot(dx, dz) || 1;
  const x = aim.c[0] - (dx / L) * standoff;
  const z = aim.c[2] - (dz / L) * standoff;
  const yaw = Math.atan2(aim.c[0] - x, -(aim.c[2] - z));
  const eyeY = 1.62;
  const pitch = Math.atan2(aim.c[1] - eyeY, standoff) + pitchOffset;
  await evaluate(`window.__sdfGame.placePlayer({x:${x},z:${z},yaw:${yaw},pitch:${pitch}})`);
  await evaluate('window.__sdfGame.step(4, 0)');
  return { ...aim, placed: { x, z, yaw, pitch } };
}

/** Pick the room with the most live actors (a multi-body dynamite target). */
async function bestCrowdRoom() {
  const zs = await evaluate('window.__sdfGame.zombies()');
  const byRoom = new Map();
  for (const z of zs) byRoom.set(z.room, (byRoom.get(z.room) ?? 0) + 1);
  let best = 4, n = -1;
  for (const [room, count] of byRoom) if (count > n) { n = count; best = room; }
  return { room: best, count: n, byRoom: Object.fromEntries(byRoom) };
}

/**
 * A REAL multi-body blast placed ON the densest actor cluster. `detonate()` is
 * the same call a thrown bundle makes (gibs and all), so it is not a still-frame
 * reproducible fixture — but it is deterministic enough across the frozen
 * variants because the blast happens once, before any variant is captured.
 * Positions the camera 5 m back along the direction the player already stands,
 * so the framing stays inside the room the crowd is in.
 */
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

// ---------------------------------------------------------------------------
// LOOK leg
// ---------------------------------------------------------------------------
async function lookLeg() {
  console.log('\n================ LOOK ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  const defaults = await evaluate('window.__sdfGame.bloodBlur');
  report.checks.defaults = {
    enabled: defaults.enabled, exposureMs: defaults.exposureMs, taps: defaults.taps,
    depthBiasM: defaults.depthBiasM, maxStreakPx: defaults.maxStreakPx, seed: defaults.seed,
    sscsTerms: await evaluate('window.__sdfGame.sscsTerms').catch(() => null),
    vhs: await evaluate('window.__sdfGame.vhs'),
    vhsTerms: await evaluate('window.__sdfGame.vhsTerms').catch(() => null),
    renderMode: await evaluate('window.__sdfGame.renderMode'),
    sdfScale: await evaluate('window.__sdfGame.sdfScale').catch(() => null),
    frameCap: await evaluate('window.__sdfGame.frameCap').catch(() => null),
  };
  console.log('defaults:', JSON.stringify(report.checks.defaults));

  // --- scenario: wound spray (sustained bleeding) -------------------------
  console.log('\n--- look: wound spray ---');
  let wound = null;
  for (let attempt = 0; attempt < 6 && !wound; attempt++) {
    const room = attempt % 2 === 0 ? 4 : 5;
    await stageWound(room);
    const peak = await advanceToSpray({ minTexels: 300 });
    console.log(`  attempt ${attempt} room ${room}: texels=${peak.texels} stamps=${peak.stamps} drops=${peak.drops}`);
    if (peak.texels >= 300) wound = { room, ...peak };
  }
  if (!wound) throw new Error('look: could not stage a wound spray');
  report.checks.woundStage = wound;
  await captureVariants('wound-44', WOUND_VARIANTS, 10);

  // Deterministic vhs=off set at the SAME frozen spray (pixel-diff evidence).
  console.log('--- look: deterministic vhs=off pair ---');
  await evaluate('window.__sdfGame.setVhs(null)');
  await evaluate('window.__sdfGame.step(14, 0)');
  await captureVariants('det', [
    { id: 'on-a', blur: true, ms: M44 },
    { id: 'off', blur: false, ms: 0 },
    { id: 'on-b', blur: true, ms: M44 },
    { id: 'm67', blur: true, ms: M67 },
    { id: 'cap200', blur: true, ms: M44, maxStreak: 200 },
  ], 6, { restore: false });
  await evaluate(SHIPPED_VHS);
  await applyVariant(VARIANTS[1]);

  // Close on the same wound (heavier on-screen area).
  await closeupOnNearest(1.15);
  await evaluate('window.__sdfGame.step(6)');
  await captureVariants('woundclose', VARIANTS, 10);

  // --- scenario: slug impact burst ---------------------------------------
  console.log('\n--- look: slug impact ---');
  const impact = await stageWound(4);
  let impactShots = 0;
  for (let i = 0; i < 40; i++) {
    await evaluate('window.__sdfGame.step(1)');
    const bb = await evaluate('window.__sdfGame.bloodBlur');
    if ((bb?.last?.stamps ?? 0) > 40) impactShots++;
    if (impactShots >= 2) break;
  }
  report.checks.impactStage = { aim: impact.aim, framesWithBurst: impactShots };
  await captureVariants('impact', [
    { id: 'sharp', blur: false, ms: 0 }, { id: 'm44', blur: true, ms: M44 }, { id: 'm67', blur: true, ms: M67 },
  ], 10);

  // --- scenario: dynamite multi-body (real blast on the densest cluster) --
  console.log('\n--- look: dynamite multi-body ---');
  const crowd = await bestCrowdRoom();
  report.checks.crowd = crowd;
  const dyn = await detonateOnCrowd(crowd.room);
  report.checks.dynamiteStage = dyn;
  // The real blast is destructive and one-shot; track the goo-droplet peak over
  // the next second and freeze there. Only the resolve differs between variants.
  let dynPeak = { drops: 0, frame: -1, splats: 0 };
  for (let i = 0; i < 90; i++) {
    await evaluate('window.__sdfGame.step(1)');
    const bl = await evaluate('window.__sdfGame.bleed');
    if (bl.droplets > dynPeak.drops) dynPeak = { drops: bl.droplets, frame: i, splats: bl.splats };
    if (i === 1) {
      await captureVariants('dyn-blast', [
        { id: 'sharp', blur: false, ms: 0 }, { id: 'm44', blur: true, ms: M44 }, { id: 'm67', blur: true, ms: M67 },
      ], 6);
    }
  }
  report.checks.dynamitePeak = dynPeak;
  console.log('dynamite peak:', JSON.stringify(dynPeak));
  await captureVariants('dyn-spray', [
    { id: 'sharp', blur: false, ms: 0 }, { id: 'm44', blur: true, ms: M44 }, { id: 'm67', blur: true, ms: M67 },
  ], 8);
  await evaluate('window.__sdfGame.step(8)');
  await captureVariants('dyn-trail', [
    { id: 'sharp', blur: false, ms: 0 }, { id: 'm44', blur: true, ms: M44 }, { id: 'm67', blur: true, ms: M67 },
  ], 8);

  // --- scenario: droplet removal / death (no huge newborn streak) --------
  // Stage a FRESH wound first: the dynamite leg may already have consumed the
  // earlier spray, and an empty sim would prove nothing.
  console.log('\n--- look: removal ---');
  await stageWound(5);
  await advanceToSpray({ minTexels: 200 });
  let deathTrace = { maxStreak: 0, minDrops: Infinity, frames: 0, removed: false };
  const drops0 = (await evaluate('window.__sdfGame.bleed')).droplets;
  for (let i = 0; i < 240; i++) {
    await evaluate('window.__sdfGame.step(1)');
    const bb = await evaluate('window.__sdfGame.bloodBlur');
    const bl = await evaluate('window.__sdfGame.bleed');
    deathTrace.frames = i;
    deathTrace.maxStreak = Math.max(deathTrace.maxStreak, bb?.last?.maxStreakPx ?? 0);
    deathTrace.minDrops = Math.min(deathTrace.minDrops, bl.droplets);
    if (bl.droplets < drops0) deathTrace.removed = true;
    if (bl.droplets === 0) break;
  }
  report.checks.removal = { drops0, ...deathTrace };
  console.log('removal:', JSON.stringify(report.checks.removal));
  await captureVariants('removal', [
    { id: 'sharp', blur: false, ms: 0 }, { id: 'm44', blur: true, ms: M44 },
  ], 8);

  // --- scenario: stationary pools/guts (should be sharp) ------------------
  console.log('\n--- look: settled pools ---');
  await evaluate('window.__sdfGame.step(240)'); // let any remaining airborne blood settle
  const settled = await evaluate('window.__sdfGame.bleed');
  report.checks.settled = settled;
  await captureVariants('pools', [
    { id: 'sharp', blur: false, ms: 0 }, { id: 'm44', blur: true, ms: M44 }, { id: 'm100', blur: true, ms: 100 },
  ], 8);
}

// ---------------------------------------------------------------------------
// CLIPS leg
// ---------------------------------------------------------------------------
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

async function clipsLeg() {
  console.log('\n================ CLIPS ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);

  // Wound fight, blur ON — staged then played at normal speed.
  const wound = await stageWound(4);
  report.checks.clipWoundStage = { aim: wound.aim, fired: wound.fired };
  await evaluate('window.__sdfGame.setLoopRunning(false)');
  await evaluate("window.__sdfGame.setBloodBlur(true); window.__sdfGame.setBloodBlurExposure(44.44444444444444)");
  await recordClip('wound-on-44', 'window.__sdfGame.setLoopRunning(true)', 3600);
  await evaluate('window.__sdfGame.setLoopRunning(false)');

  // Same fight, blur OFF (fresh seed + script).
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  await stageWound(4);
  await evaluate('window.__sdfGame.setBloodBlur(false)');
  await recordClip('wound-off', 'window.__sdfGame.setLoopRunning(true)', 3600);
  await evaluate('window.__sdfGame.setLoopRunning(false)');

  // Dynamite, blur ON.
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  const crowd = await bestCrowdRoom();
  await evaluate(`window.__sdfGame.teleport(${crowd.room})`);
  await evaluate('window.__sdfGame.step(20)');
  await evaluate("window.__sdfGame.selectSlot('dynamite')");
  await evaluate('window.__sdfGame.step(30)');
  await aimAtNearest();
  await evaluate('window.__sdfGame.dynamitePress()');
  await evaluate('window.__sdfGame.step(40)');
  await evaluate('window.__sdfGame.dynamiteRelease()');
  await evaluate('window.__sdfGame.step(2)');
  await recordClip('dynamite-on-44', 'window.__sdfGame.setLoopRunning(true)', 8500);
  await evaluate('window.__sdfGame.setLoopRunning(false)');

  // Moving camera while blood is airborne (blur must stay on the blood).
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  await stageWound(4);
  await evaluate('window.__sdfGame.step(20)');
  await recordClip('camera-turn-on-44',
    `(() => { const g = window.__sdfGame; const p = g.playerPos();
      window.__camT = 0;
      window.__camTurn = setInterval(() => { window.__camT += 0.06;
        g.setPose(p[0], p[2], Math.sin(window.__camT) * 0.8, 0.03, 0); }, 40);
      g.setLoopRunning(true); return true; })()`, 3200);
  await evaluate('clearInterval(window.__camTurn); window.__sdfGame.setLoopRunning(false)');
}

// ---------------------------------------------------------------------------
// CHECKS leg
// ---------------------------------------------------------------------------
async function checksLeg() {
  console.log('\n================ CHECKS ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);

  // Finite clamps.
  const clamps = await evaluate(`(() => {
    const g = window.__sdfGame;
    return {
      exposureHigh: g.setBloodBlurExposure(1000),
      exposureNeg: g.setBloodBlurExposure(-5),
      exposureDefault: (g.setBloodBlurExposure(44.44444444444444), g.bloodBlur.exposureMs),
      streakHigh: g.setBloodBlurMaxStreak(10000),
      streakZero: g.setBloodBlurMaxStreak(0),
      streakDefault: g.setBloodBlurMaxStreak(120),
      seedHigh: g.setBloodBlurSeedScale(99),
      seedLow: g.setBloodBlurSeedScale(-3),
      seedDefault: g.setBloodBlurSeedScale(1),
      biasHigh: g.setBloodBlurDepthBias(999),
      biasDefault: (g.setBloodBlurDepthBias(0.02), g.bloodBlur.depthBiasM),
    };
  })()`);
  report.checks.clamps = clamps;
  console.log('clamps:', JSON.stringify(clamps));
  const clampOk = clamps.exposureHigh === 200 && clamps.exposureNeg === 0
    && clamps.streakHigh === 400 && clamps.streakZero === 1
    && clamps.seedHigh === 2 && clamps.seedLow === 0.25 && clamps.biasHigh === 50;
  report.checks.clampsOk = clampOk;
  if (!clampOk) throw new Error('finite clamp check failed');

  // Empty bypass: idle (no airborne blood) must skip the layer + resolve.
  await evaluate('window.__sdfGame.teleport(1)');
  await evaluate('window.__sdfGame.step(40)');
  await evaluate('window.__sdfGame.setBloodBlur(false)');
  await evaluate('window.__sdfGame.setBloodBlur(true)');
  await evaluate('window.__sdfGame.step(3, 0)');
  const idle = await evaluate('window.__sdfGame.bloodBlur');
  report.checks.emptyBypass = { stamps: idle.last.stamps, texels: idle.last.texels, error: idle.error, ready: idle.ready };
  console.log('empty bypass:', JSON.stringify(report.checks.emptyBypass));
  await capture('check-empty-idle');

  // off | zero parity on a real spray.
  const wound = await stageWound(4);
  const peak = await advanceToSpray({ minTexels: 250 });
  report.checks.parityStage = { aim: wound.aim, peak };
  await captureVariants('parity', [
    { id: 'sharp', blur: false, ms: 0 },
    { id: 'zero', blur: true, ms: 0 },
    { id: 'm44', blur: true, ms: M44 },
  ], 10, { restore: false });

  // Deterministic off|zero parity: vhs=off removes the temporal history that
  // otherwise contaminates a shipped-stack off/on diff.
  await evaluate('window.__sdfGame.setVhs(null)');
  await evaluate('window.__sdfGame.step(16, 0)');
  await captureVariants('detparity', [
    { id: 'sharp', blur: false, ms: 0 },
    { id: 'zero', blur: true, ms: 0 },
    { id: 'sharp2', blur: false, ms: 0 },
  ], 6, { restore: false });
  await evaluate(SHIPPED_VHS);
  await applyVariant(VARIANTS[1]);

  // EMPTY-BYPASS parity under vhs=off: clear the sim AND leave bleeding off, so
  // no new wound droplets are emitted while the frames are captured. A blur-on
  // frame must then equal the sharp frame (the empty fast path returns null).
  await evaluate('window.__sdfGame.setBleed(false)');
  await evaluate('window.__sdfGame.setVhs(null)');
  await evaluate('window.__sdfGame.step(14, 0)');
  await captureVariants('still', [
    { id: 'sharp', blur: false, ms: 0 },
    { id: 'm44', blur: true, ms: M44 },
    { id: 'm100', blur: true, ms: 100 },
    { id: 'sharp2', blur: false, ms: 0 },
  ], 6, { restore: false });
  await evaluate('window.__sdfGame.setBleed(true)');
  await evaluate(SHIPPED_VHS);
  await applyVariant(VARIANTS[1]);

  // Pause / resume of the render loop: no burst, no unbounded streak. Stage a
  // live spray first (the empty-bypass block above cleared the sim).
  await stageWound(4);
  await advanceToSpray({ minTexels: 120, maxFrames: 50 });
  await evaluate('window.__sdfGame.setBloodBlur(true); window.__sdfGame.setBloodBlurExposure(44.44444444444444)');
  await evaluate('window.__sdfGame.step(2, 0)');
  const before = await evaluate('window.__sdfGame.bloodBlur');
  await sleep(1500); // wall-clock pause with the loop stopped
  await evaluate('window.__sdfGame.step(2, 0)');
  const after = await evaluate('window.__sdfGame.bloodBlur');
  report.checks.pauseResume = {
    beforeMaxPx: before.last.maxStreakPx, afterMaxPx: after.last.maxStreakPx,
    beforeTexels: before.last.texels, afterTexels: after.last.texels, error: after.error,
  };
  console.log('pause/resume:', JSON.stringify(report.checks.pauseResume));

  // Resize / render-scale cycles: dims track, no error, no growth in draw calls.
  const sizeTrace = [];
  const readSize = async () => {
    const d = await evaluate('window.__sdfGame.bloodBlur');
    const inner = await evaluate('[window.innerWidth, window.innerHeight]');
    return {
      inner, layer: d.layer, seed: d.seed, error: d.error,
      draws: (await evaluate('window.__sdfGame.drawStats(true)')),
    };
  };
  for (const [w, h] of [[720, 480], [960, 600], [1280, 720], [960, 600]]) {
    const how = await resizeWindow(w, h);
    await evaluate('window.__sdfGame.step(4, 0)');
    sizeTrace.push({ w, h, how, ...(await readSize()) });
  }
  report.checks.resizeTrace = sizeTrace;
  console.log('resize trace:', JSON.stringify(sizeTrace));

  // Render-scale / "graphics tier" switch.
  const scaleTrace = [];
  for (const s of [0.5, 1.0]) {
    await evaluate(`window.__sdfGame.setSdfScale(${s})`);
    await evaluate('window.__sdfGame.step(3, 0)');
    const d = await evaluate('window.__sdfGame.bloodBlur');
    const ble = await evaluate('window.__sdfGame.bleed');
    scaleTrace.push({ sdfScale: await evaluate('window.__sdfGame.sdfScale'), layer: d.layer, seed: d.seed, error: d.error, drops: ble.droplets });
  }
  report.checks.renderScaleTrace = scaleTrace;
  console.log('render scale trace:', JSON.stringify(scaleTrace));

  // SCENE RESET: rebuild the cast and clear the sim, then a fresh spray. The
  // shutter layer must survive the reset with its targets and no stale seed.
  await evaluate('window.__sdfGame.resetCast()');
  await evaluate('window.__sdfGame.setBleed(false)');
  await evaluate('window.__sdfGame.setBleed(true)');
  await evaluate('window.__sdfGame.step(10)');
  await stageWound(4);
  const resetPeak = await advanceToSpray({ minTexels: 120, maxFrames: 50 });
  const resetDiag = await evaluate('window.__sdfGame.bloodBlur');
  report.checks.sceneReset = {
    peak: resetPeak, stamps: resetDiag.last.stamps, texels: resetDiag.last.texels,
    layer: resetDiag.layer, seed: resetDiag.seed, error: resetDiag.error,
  };
  console.log('scene reset:', JSON.stringify(report.checks.sceneReset));
  await capture('check-reset__m44');
}

// ---------------------------------------------------------------------------
// COST leg
// ---------------------------------------------------------------------------
async function benchVariant(variant, frames, label) {
  await applyVariant(variant);
  await evaluate(`window.__sdfGame.step(4, 0)`);
  const expr = `(async () => {
    const g = window.__sdfGame;
    const times = []; const buildMs = [];
    let texels = 0, stamps = 0, maxStreakPx = 0;
    try { await g.passTimings(); } catch {}
    for (let i = 0; i < ${frames}; i++) {
      const t0 = performance.now();
      g.step(1, 0);
      await g.resolveGpu();
      times.push(performance.now() - t0);
      const bb = g.bloodBlur;
      buildMs.push(bb.last.buildMs ?? 0);
      texels = Math.max(texels, bb.last.texels); stamps = Math.max(stamps, bb.last.stamps);
      maxStreakPx = Math.max(maxStreakPx, bb.last.maxStreakPx);
    }
    let passTimings = null; try { passTimings = await g.passTimings(); } catch {}
    return { times, buildMs, texels, stamps, maxStreakPx, passTimings };
  })()`;
  const r = await evaluate(expr, 240000);
  const pct = (arr, p) => {
    const s = [...arr].sort((a, b) => a - b);
    return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(3);
  };
  const passMean = {};
  if (r.passTimings?.installed) {
    const sum = {};
    for (const s of (r.passTimings.samples ?? [])) {
      if (!s?.label) continue;
      sum[s.label] = (sum[s.label] ?? 0) + s.ms;
    }
    for (const [k, v] of Object.entries(sum)) passMean[k] = +(v / frames).toFixed(4);
  }
  const out = {
    label, variant: variant.id, frames,
    totalMsPerFrame: { p50: pct(r.times, 50), p95: pct(r.times, 95), mean: +(r.times.reduce((a, b) => a + b, 0) / r.times.length).toFixed(3) },
    buildMs: { p50: pct(r.buildMs, 50), p95: pct(r.buildMs, 95), max: +Math.max(...r.buildMs).toFixed(3) },
    texels: r.texels, stamps: r.stamps, maxStreakPx: +r.maxStreakPx.toFixed(1),
    passMeanMsPerFrame: passMean,
  };
  report.benches[label] = out;
  console.log(`  bench ${label}: p50=${out.totalMsPerFrame.p50} p95=${out.totalMsPerFrame.p95} ms  buildMs p50=${out.buildMs.p50} max=${out.buildMs.max}  texels=${r.texels}`);
  return out;
}

async function benchScenario(name, frames, reps = 3) {
  const variants = [
    { id: 'sharp', blur: false, ms: 0 },
    { id: 'm44', blur: true, ms: M44 },
    { id: 'm67', blur: true, ms: M67 },
  ];
  // INTERLEAVED reps: each rep measures sharp/m44/m67 back to back, so the
  // paired difference is robust to the slow drift of a busy machine. The report
  // gives the per-rep p50 and the MEDIAN paired delta.
  const perRep = [];
  let lastTexels = 0;
  for (let r = 0; r < reps; r++) {
    const row = {};
    for (const v of variants) {
      const out = await benchVariant(v, frames, `${name}-${v.id}-r${r}`);
      row[v.id] = out.totalMsPerFrame.p50;
      row[`${v.id}_mean`] = out.totalMsPerFrame.mean;
      if (v.id === 'm44') lastTexels = out.texels;
    }
    perRep.push(row);
    console.log(`  ${name} rep${r}: sharp=${row.sharp} m44=${row.m44} m67=${row.m67} ms`);
  }
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const d44 = perRep.map((r) => r.m44 - r.sharp);
  const d67 = perRep.map((r) => r.m67 - r.sharp);
  const dm44 = perRep.map((r) => r.m44_mean - r.sharp_mean);
  const dm67 = perRep.map((r) => r.m67_mean - r.sharp_mean);
  const summary = {
    reps, framesPerVariant: frames, perRep,
    sharpP50Median: +med(perRep.map((r) => r.sharp)).toFixed(3),
    m44P50Median: +med(perRep.map((r) => r.m44)).toFixed(3),
    m67P50Median: +med(perRep.map((r) => r.m67)).toFixed(3),
    deltaM44Median: +med(d44).toFixed(3),
    deltaM67Median: +med(d67).toFixed(3),
    deltaM44PerRep: d44.map((v) => +v.toFixed(3)),
    deltaM67PerRep: d67.map((v) => +v.toFixed(3)),
    meanDeltaM44Median: +med(dm44).toFixed(3),
    meanDeltaM67Median: +med(dm67).toFixed(3),
    meanDeltaM44PerRep: dm44.map((v) => +v.toFixed(3)),
    meanDeltaM67PerRep: dm67.map((v) => +v.toFixed(3)),
    texels: lastTexels,
  };
  report.benches[`${name}-summary`] = summary;
  console.log(`  ${name}: median delta m44=${summary.deltaM44Median}ms m67=${summary.deltaM67Median}ms; mean delta m44=${summary.meanDeltaM44Median}ms m67=${summary.meanDeltaM67Median}ms (texels=${lastTexels})`);
  return summary;
}

async function costLeg() {
  console.log('\n================ COST ================');
  report.checks.costLoadStart = loadavg().map((v) => +v.toFixed(2));
  await setMetrics(CONTENT.width, CONTENT.height);
  await bootGame();
  await applyShippedVhs();
  await applyHold(true);
  // PREWARM evidence: with the boot prewarm the resolve/targets must already
  // exist before the first blurred frame.
  const bootReady = await evaluate('window.__sdfGame.bloodBlur');
  report.checks.bootReady = { ready: bootReady.ready, warmed: bootReady.warmed, seed: bootReady.seed };

  // ORDINARY: one wound spray. Require a dense spray so the cost is measured at
  // a comparable blood load run to run.
  const wound = await stageWound(4);
  const peak = await advanceToSpray({ minTexels: 8000, maxFrames: 80 });
  report.checks.costOrdinaryStage = { aim: wound.aim, peak };
  await evaluate('window.__sdfGame.step(4, 0)');
  // FIRST-USE: the blur has never captured in this boot (targets not allocated,
  // pipelines only prewarmed lazily). Time the very first capture frame, then
  // the next four, so a compile/allocation stall is visible and separated from
  // the warm p50.
  await evaluate('window.__sdfGame.setBloodBlur(false)');
  await evaluate('window.__sdfGame.step(2, 0)');
  const firstUse = await evaluate(`(async () => {
    const g = window.__sdfGame;
    g.setBloodBlur(true); g.setBloodBlurExposure(${M44});
    const times = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now(); g.step(1, 0); await g.resolveGpu();
      times.push(performance.now() - t0);
    }
    const bb = g.bloodBlur;
    return { times, ready: bb.ready, warmed: bb.warmed, seed: bb.seed, stamps: bb.last.stamps };
  })()`, 60000);
  report.benches.firstUse = {
    firstFrameMs: +firstUse.times[0].toFixed(2),
    next4: firstUse.times.slice(1).map((t) => +t.toFixed(2)),
    ready: firstUse.ready, warmed: firstUse.warmed, seed: firstUse.seed, stamps: firstUse.stamps,
  };
  console.log('first-use:', JSON.stringify(report.benches.firstUse));
  await benchScenario('ordinary', 100, 4);

  // HEAVY: a real multi-body dynamite blast on the densest cluster, tracked to
  // its goo-droplet peak (the throw path can detonate away from the crowd).
  console.log('--- cost: heavy (dynamite + spray) ---');
  const crowd = await bestCrowdRoom();
  await evaluate(`window.__sdfGame.teleport(${crowd.room})`);
  await evaluate('window.__sdfGame.step(20)');
  await stageWound(crowd.room, { extraVolleys: 1 });
  const dyn = await detonateOnCrowd(crowd.room);
  let heavyPeak = { drops: 0, frame: -1, splats: 0 };
  for (let i = 0; i < 120; i++) {
    await evaluate('window.__sdfGame.step(1)');
    const bl = await evaluate('window.__sdfGame.bleed');
    if (bl.droplets > heavyPeak.drops) heavyPeak = { drops: bl.droplets, frame: i, splats: bl.splats };
  }
  report.checks.costHeavyStage = { crowd, dyn, peak: heavyPeak };
  console.log('heavy peak:', JSON.stringify(heavyPeak));
  await evaluate('window.__sdfGame.step(2, 0)');
  const heavyCounts = await evaluate('window.__sdfGame.bleed');
  report.checks.costHeavyCounts = heavyCounts;
  await benchScenario('heavy', 100, 4);
  report.checks.costLoadEnd = loadavg().map((v) => +v.toFixed(2));
}

// ---------------------------------------------------------------------------
// TIERS leg — the shipped reallocation paths. The default render cap is the
// FIXED `?res=800` rung, so a window resize intentionally does NOT move the
// capture target; the real size switches are the `?res=` rungs and the
// `?graphics=` upscale level (both boot decisions). Each tier boots fresh and
// runs a real spray with the blur live.
// ---------------------------------------------------------------------------
async function tiersLeg() {
  console.log('\n================ TIERS ================');
  await setMetrics(CONTENT.width, CONTENT.height);
  const tiers = [
    { id: 'res640', q: '?res=640' },
    { id: 'res960', q: '?res=960' },
    { id: 'graphics-high', q: '?graphics=high' },
    // CONTROL: the same high tier with the blur OFF. If it stalls too, the
    // stall belongs to the high upscaler's compile, not to the shutter layer.
    { id: 'graphics-high-noblur', q: '?graphics=high&bloodblur=0' },
  ];
  for (const t of tiers) {
    const info = { query: t.q };
    report.checks[`tier:${t.id}`] = info;
    try {
      await bootGame(t.q);
      await applyShippedVhs();
      await applyHold(true);
      const d0 = await evaluate('window.__sdfGame.bloodBlur');
      Object.assign(info, {
        renderCap: await evaluate('window.__sdfGame.renderCap').catch(() => null),
        graphics: await evaluate('window.__sdfGame.graphics()').catch(() => null),
        sdfScale: await evaluate('window.__sdfGame.sdfScale').catch(() => null),
        upscale: await evaluate('window.__sdfGame.upscaleInfo()').catch(() => null),
        layer: d0.layer, seed: d0.seed, error: d0.error,
      });
      try {
        await evaluate('window.__sdfGame.teleport(4)', 120000);
        await evaluate('window.__sdfGame.step(30)', 180000);
        await aimAtNearest();
        await evaluate('window.__sdfGame.step(10)', 120000);
        await fireConfirmed(1);
        await evaluate('window.__sdfGame.step(20)', 120000);
        await fireConfirmed(1, true);
        const peak = await advanceToSpray({ minTexels: 150, maxFrames: 50 });
        const d1 = await evaluate('window.__sdfGame.bloodBlur');
        info.peak = peak;
        info.layerAfter = d1.layer; info.seedAfter = d1.seed;
        info.errorAfter = d1.error; info.stamps = d1.last.stamps;
      } catch (e) {
        info.stageError = String(e?.message ?? e).slice(0, 200);
      }
      await capture(`tier-${t.id}`);
    } catch (e) {
      info.bootError = String(e?.message ?? e).slice(0, 200);
    }
    console.log('tier', t.id, JSON.stringify({ ...info, upscale: undefined }));
  }
}

// ---------------------------------------------------------------------------
try {
  if (ONLY.has('look')) await lookLeg();
  if (ONLY.has('checks')) await checksLeg();
  if (ONLY.has('clips')) await clipsLeg();
  if (ONLY.has('cost')) await costLeg();
  if (ONLY.has('tiers')) await tiersLeg();

  report.consoleErrors = errors.slice(-40);
  console.log('\nDONE');
  shutdown(0);
} catch (err) {
  console.error('TASK2 FAILED:', err?.message ?? err);
  report.failed = String(err?.stack ?? err?.message ?? err);
  report.consoleErrors = errors.slice(-40);
  shutdown(1);
}
