// scripts/sdf-shutter-game-check.mjs
//
// GAME SMOKE for the selective shutter blur (game integration, 2026-09-17).
//
// The lab runner (scripts/sdf-shutter-blur-check.mjs) already proves the
// algorithm against its oracle; this one proves the SHIPPED GAME wiring:
//
//   1. default  — the active game boots with blood motion blur ON at the
//                 accepted 320°/20 fps = 44.44 ms, seed grid bound to the
//                 density dims, 24 taps, bias 0.020 m.
//   2. spray    — first wound spray: real droplets, real goo, and a non-zero
//                 seed stamp count read from __sdfGame.bloodBlur.
//   3. off/on   — under the shipped VHS stack; then a DETERMINISTIC A/B on the
//                 same frozen spray with vhs=off + the light clock frozen,
//                 where the only frame delta is the exposure resolve (VHS owns
//                 temporal blending, so a shipped-stack off/on diff is
//                 otherwise dominated by tape noise rather than the blur).
//   4. dynamite — a real charge, throw and detonation; capture the burst.
//   5. query    — ?bloodblur=0 boots disabled (reversible off flag).
//
// Own vite + headless Chrome on an UNUSED port pair, own profile under
// .lab-tmp, no unsafe flags. It refuses a port it did not start and stops only
// what it started. Screenshots + report land in the out dir.
//
// Usage: node scripts/sdf-shutter-game-check.mjs [vitePort] [cdpPort] [outDir]

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VITE = Number(process.argv[2] ?? 5484);
const CDP = Number(process.argv[3] ?? 9484);
const OUT = resolve(process.argv[4] ?? 'docs/dev-notes/2026-09-17-shutter-blur-game/evidence');
const LAB_TMP = resolve('.lab-tmp');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = {
  branch: (() => { try { return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })(),
  shots: {}, checks: {}, consoleErrors: [],
};

const children = [];
let finished = false;
function shutdown(code) {
  if (finished) return;
  finished = true;
  try { writeFileSync(`${OUT}/shutter-game-report.json`, JSON.stringify(report, null, 2)); } catch { /* best effort */ }
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch { /* gone */ } }
  }
  setTimeout(() => process.exit(code), 500);
}
process.on('exit', () => { for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } } });
// Hard watchdog: a stuck CDP call must not hang the dispatch forever.
setTimeout(() => { console.error('WATCHDOG: smoke exceeded 12 minutes'); shutdown(9); }, 12 * 60 * 1000);

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
  `--user-data-dir=${LAB_TMP}/chrome-game-${CDP}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-crash-reporter', `--crash-dumps-dir=${LAB_TMP}/crashpad-game-${CDP}`,
  '--window-size=980,640',
  'about:blank',
], { stdio: 'ignore', detached: true, env: { ...process.env, TMPDIR: `${LAB_TMP}/tmp-${CDP}` } });
children.push(chrome);
await waitFor(`http://localhost:${CDP}/json/version`, 'chrome debug port');

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = () => err(new Error('ws')); });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
/** Every CDP call is bounded: a lost response fails the smoke, it never hangs. */
const evaluate = async (expression, timeoutMs = 30000) => {
  const reply = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
    sleep(timeoutMs).then(() => ({ __timeout: true })),
  ]);
  if (reply.__timeout) throw new Error(`Runtime.evaluate timed out after ${timeoutMs}ms: ${expression.slice(0, 90)}`);
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 600));
  return reply.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 600, deviceScaleFactor: 1, mobile: false });

async function bootGame(query = '') {
  // Fixed boot seed unless the caller set one: the smoke's spray/throw legs need
  // a reproducible arena, and the demo seed is random otherwise.
  const q = new URLSearchParams(query.replace(/^\?/, ''));
  if (!q.has('seed')) q.set('seed', '20260917');
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${q.toString()}` });
  let ok = false;
  for (let i = 0; i < 240 && !ok; i++) {
    await sleep(500);
    ok = await evaluate('typeof window.__sdfGame === "object"').catch(() => false);
  }
  if (!ok) throw new Error(`__sdfGame never booted (${query || 'no query'})`);
  // Wait for the warm/loader gate to finish: deferred mode compiles more
  // pipelines, and a capture taken during "compiling pipelines" is not a frame.
  for (let i = 0; i < 180; i++) {
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
  await sleep(1500);
  await evaluate(`(() => {
    const g = window.__sdfGame;
    for (const fn of ['shutterPanel','gooPanel','vhsPanel','dynamitePanel','woundPanel']) {
      try { if (typeof g[fn] === 'function') g[fn](false); } catch {}
    }
    return true;
  })()`);
  await sleep(300);
}

async function capture(name) {
  const shot = await Promise.race([
    send('Page.captureScreenshot', { format: 'png' }),
    sleep(20000).then(() => ({ __timeout: true })),
  ]);
  if (shot.__timeout) throw new Error(`Page.captureScreenshot timed out for ${name}`);
  const buf = Buffer.from(shot.result.data, 'base64');
  writeFileSync(`${OUT}/${name}.png`, buf);
  const diag = await evaluate('window.__sdfGame.bloodBlur').catch(() => null);
  writeFileSync(`${OUT}/${name}.state.json`, JSON.stringify(diag, null, 2));
  report.shots[name] = diag ? { ...diag, sha256_16: execFileSync('shasum', ['-a', '256'], { input: buf, encoding: 'utf8' }).slice(0, 16) } : null;
  console.log(`  ${name}: enabled=${diag?.enabled} exposureMs=${diag?.exposureMs?.toFixed?.(3)} stamps=${diag?.last?.stamps} texels=${diag?.last?.texels} err=${diag?.error}`);
  return report.shots[name]?.sha256_16 ?? null;
}

/**
 * Aim at the nearest body's TORSO cluster and fire one buckshot round.
 * Mirrors the internal aimAtNearestSurface search: the torso cluster centre and
 * the shot predictor, own standoff, first candidate the predictor confirms.
 */
const AIM_JS = `(() => {
  const g = window.__sdfGame;
  const eye = g.cameraWorld();
  const p = g.playerPos();
  const cands = [];
  for (const a of g.actorList()) {
    const z = g.zombie(a.id);
    if (!z) continue;
    const clusters = z.posed().clusters || [];
    const torso = clusters.find(c => (c.limb === 'torso') && c.center)
      || clusters.find(c => c.center);
    if (!torso || !torso.center) continue;
    const c = torso.center;
    const d = Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]);
    if (d >= 0.7) cands.push({ id: a.id, c, d });
  }
  cands.sort((x, y) => x.d - y.d);
  for (const cand of cands) {
    const yaw = Math.atan2(cand.c[0] - eye[0], -(cand.c[2] - eye[2]));
    const pitch = Math.atan2(cand.c[1] - eye[1],
      Math.hypot(cand.c[0] - eye[0], cand.c[2] - eye[2]));
    g.setPose(p[0], p[2], yaw, pitch, 0);
    const hit = g.predictSlugHit();
    if (hit && hit.actorId >= 0) return { id: cand.id, dist: cand.d, yaw, pitch, hit: hit.actorId };
  }
  return null;
})()`;

async function aimAtNearest() {
  const aim = await evaluate(AIM_JS);
  return aim;
}

/** fire() returns false until the async gun GLB is ready and the cooldown has
 *  expired; a driver that ignores the return fires into the void. Poll it. */
async function fireConfirmed(barrels = 1, slug = false, tries = 60) {
  for (let t = 0; t < tries; t++) {
    const expr = slug ? 'window.__sdfGame.fireSlug()' : `window.__sdfGame.fire(${barrels})`;
    const ok = await evaluate(expr).catch(() => false);
    if (ok) return true;
    await sleep(400);
    await evaluate('window.__sdfGame.step(3, 0)').catch(() => {});
  }
  return false;
}

async function spraySetup(room = 4) {
  await evaluate(`window.__sdfGame.teleport(${room})`);
  await evaluate('window.__sdfGame.step(10)');
  const aim = await aimAtNearest();
  await evaluate('window.__sdfGame.step(10)');
  // A BUCKSHOT volley opens the wound (its droplets are goo-eligible), then a
  // SLUG severs the body: the gib burst is the fast-motion source that makes the
  // blur read. Both are confirmed, because fire() silently returns false until
  // the async gun GLB is ready and the cooldown has cleared.
  const fired = [];
  fired.push(await fireConfirmed(1));
  // GRAPESHOT.fireCooldownSec is 0.45 s (27 frames): stepping 20 left the slug
  // shot refused. Wait out the cooldown, re-aim, then slug the body.
  await evaluate('window.__sdfGame.step(30)');
  await aimAtNearest();
  fired.push(await fireConfirmed(1, true));
  return { ...(aim ?? {}), fired };
}

try {
  // =======================================================================
  // 1. DEFAULT BOOT (shipped graphics + VHS)
  // =======================================================================
  console.log('\n=== default boot (blur ON, shipped VHS) ===');
  await bootGame();
  const def = await evaluate('window.__sdfGame.bloodBlur');
  report.checks.default = {
    enabled: def.enabled, exposureMs: def.exposureMs, exposureSeconds: def.exposureSeconds,
    maxStreakPx: def.maxStreakPx, seedScale: def.seedScale, depthBiasM: def.depthBiasM,
    taps: def.taps, route: def.route, error: def.error,
  };
  console.log('default bloodBlur:', JSON.stringify(report.checks.default));
  if (!def.enabled) throw new Error('blood blur is not ON by default');
  if (Math.abs(def.exposureMs - 44.444444) > 0.01) throw new Error(`default exposure ${def.exposureMs} != 44.444`);
  if (def.taps !== 24) throw new Error(`taps ${def.taps} != 24`);
  if (Math.abs(def.depthBiasM - 0.02) > 1e-9) throw new Error(`bias ${def.depthBiasM} != 0.02`);

  await evaluate('window.__sdfGame.step(2)');
  await capture('game-00-idle-on');

  // =======================================================================
  // 2. WOUND SPRAY (shipped VHS). Combat is random in headless: a volley can
  //    graze and leave no goo-eligible blood. Retry across two rooms until a
  //    real spray (seed texels > 0) is on screen, then freeze IT for the A/B.
  // =======================================================================
  console.log('\n=== wound spray ===');
  let spray = null;
  for (let attempt = 0; attempt < 6 && !spray; attempt++) {
    const room = attempt % 2 === 0 ? 4 : 5;
    const info = await spraySetup(room);
    let maxStamps = 0, maxTexels = 0, peakFrame = -1, decline = 0;
    for (let i = 0; i < 30; i++) {
      await evaluate('window.__sdfGame.step(1)');
      const d = await evaluate('window.__sdfGame.bloodBlur');
      const tex = d.last.texels;
      maxStamps = Math.max(maxStamps, d.last.stamps);
      if (tex > maxTexels) { maxTexels = tex; peakFrame = i; decline = 0; }
      else if (maxTexels > 0) decline++;
      if (maxTexels === 0 && i === 10) await fireConfirmed(1, true); // fallback slug gib
      if (maxTexels > 0 && decline >= 3) break;
    }
    console.log(`  attempt ${attempt} (room ${room}): stamps=${maxStamps} texels=${maxTexels}`);
    if (maxTexels > 0) spray = { attempt, room, info, maxStamps, maxTexels, peakFrame };
  }
  if (!spray) throw new Error('no goo-eligible wound blood after 6 attempts');
  report.checks.spray = spray;
  console.log('spray:', JSON.stringify({ maxStamps: spray.maxStamps, maxTexels: spray.maxTexels, attempt: spray.attempt }));
  await capture(`game-10-spray-on-${String(Math.max(0, spray.peakFrame)).padStart(2, '0')}`);

  // Resize with blood on screen: the capture stage must rebuild its targets to
  // the new content/density dims without a black frame or a stale seed.
  console.log('\n=== resize ===');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 480, deviceScaleFactor: 1, mobile: false });
  await evaluate('window.__sdfGame.step(2, 0)');
  await capture('game-15-resize-720x480');
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 600, deviceScaleFactor: 1, mobile: false });
  await evaluate('window.__sdfGame.step(1, 0)');
  await capture('game-16-resize-back-f1');
  await evaluate('window.__sdfGame.step(2, 0)');
  await capture('game-17-resize-back-f3');
  await evaluate('window.__sdfGame.step(5, 0)');
  await capture('game-18-resize-back-f8');
  const resizeDiag = await evaluate('window.__sdfGame.bloodBlur');
  report.checks.resize = { layer: resizeDiag.layer, seed: resizeDiag.seed, error: resizeDiag.error };
  console.log('resize diag:', JSON.stringify(report.checks.resize));
  if (resizeDiag.error) throw new Error(`resize surfaced an error: ${resizeDiag.error}`);

  // Same resize cycle with the blur OFF: separates a shutter-layer rebuild
  // problem from the host's own resize path.
  await evaluate('window.__sdfGame.setBloodBlur(false)');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 480, deviceScaleFactor: 1, mobile: false });
  await evaluate('window.__sdfGame.step(2, 0)');
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 600, deviceScaleFactor: 1, mobile: false });
  await evaluate('window.__sdfGame.step(2, 0)');
  await capture('game-19-resize-back-off');
  await evaluate('window.__sdfGame.setBloodBlur(true)');

  // =======================================================================
  // 3. OFF/ON UNDER THE SHIPPED STACK (qualitative; VHS is temporal)
  // =======================================================================
  console.log('\n=== off / on (shipped VHS) ===');
  await evaluate('window.__sdfGame.setBloodBlur(false)');
  await evaluate('window.__sdfGame.step(1, 0)');
  await capture('game-20-spray-off');
  await evaluate('window.__sdfGame.setBloodBlur(true)');
  await evaluate('window.__sdfGame.step(1, 0)');
  await capture('game-21-spray-on-again');

  // =======================================================================
  // 3b. DETERMINISTIC A/B on the SAME frozen spray: VHS off (no temporal
  //     blend) + light clock frozen. The only frame delta is then the resolve.
  // =======================================================================
  console.log('\n=== deterministic A/B (vhs=off, light clock frozen) ===');
  await evaluate('window.__sdfGame.setVhs(null)');
  await evaluate('window.__sdfGame.setLightClockFrozen(true)');
  await evaluate('window.__sdfGame.step(1, 0)');
  await capture('game-40-ab-on');
  await evaluate('window.__sdfGame.setBloodBlur(false)');
  await evaluate('window.__sdfGame.step(1, 0)');
  await capture('game-41-ab-off');
  await evaluate('window.__sdfGame.setBloodBlur(true)');
  await evaluate('window.__sdfGame.step(1, 0)');
  await capture('game-42-ab-on-again');
  // Pass cost, blur ON vs OFF, over the SAME frozen scene (step with dt = 0
  // re-renders the identical instant, so the only difference is the shutter
  // passes). Raw pass sums double-count overlapping passes; the on-minus-off
  // delta of the labelled `shutter:*` passes is the number that matters.
  const NCOST = 60;
  const drain = async () => { await evaluate('window.__sdfGame.passTimings()'); };
  await drain();
  await evaluate(`window.__sdfGame.step(${NCOST}, 0)`);
  const timingOn = await evaluate('window.__sdfGame.passTimings()');
  await evaluate('window.__sdfGame.setBloodBlur(false)');
  await drain();
  await evaluate(`window.__sdfGame.step(${NCOST}, 0)`);
  const timingOff = await evaluate('window.__sdfGame.passTimings()');
  await evaluate('window.__sdfGame.setBloodBlur(true)');
  const meanByLabel = (t) => {
    const sum = {};
    for (const s of (t?.samples ?? [])) sum[s.label] = (sum[s.label] ?? 0) + s.ms;
    const out = {};
    for (const [k, v] of Object.entries(sum)) out[k] = +(v / NCOST).toFixed(4);
    return out;
  };
  report.checks.passCost = {
    installed: timingOn?.installed ?? false,
    frames: NCOST,
    onMsPerFrame: meanByLabel(timingOn),
    offMsPerFrame: meanByLabel(timingOff),
  };
  console.log('pass cost on:', JSON.stringify(report.checks.passCost.onMsPerFrame));
  console.log('pass cost off:', JSON.stringify(report.checks.passCost.offMsPerFrame));

  // WALL-CLOCK cost over the same frozen scene: per-frame CPU submit + GPU,
  // resolved by resolveGpu() after each batch. This is the number to trust;
  // the raw timestamp sums above double-count overlapping tile-GPU passes.
  const benchFrames = 90;
  const bench = async (label) => {
    const ms = await evaluate(`(async () => {
      const g = window.__sdfGame;
      const t0 = performance.now();
      for (let i = 0; i < ${benchFrames}; i++) g.step(1, 0);
      await g.resolveGpu();
      return performance.now() - t0;
    })()`, 120000);
    return { frames: benchFrames, totalMs: +ms.toFixed(1), msPerFrame: +(ms / benchFrames).toFixed(3) };
  };
  await evaluate('window.__sdfGame.setBloodBlur(true)');
  const wallOn = await bench('on');
  await evaluate('window.__sdfGame.setBloodBlur(false)');
  const wallOff = await bench('off');
  await evaluate('window.__sdfGame.setBloodBlur(true)');
  report.checks.wallCost = { on: wallOn, off: wallOff, deltaMsPerFrame: +(wallOn.msPerFrame - wallOff.msPerFrame).toFixed(3) };
  console.log('wall cost:', JSON.stringify(report.checks.wallCost));
  // Restore the shipped stack before the dynamite leg.
  await evaluate('window.__sdfGame.setVhs("blud")');
  await evaluate('window.__sdfGame.setLightClockFrozen(false)');

  // =======================================================================
  // 4. DYNAMITE BURST
  // =======================================================================
  console.log('\n=== dynamite ===');
  const before = await evaluate('window.__sdfGame.dynamite()');
  await evaluate("window.__sdfGame.selectSlot('dynamite')");
  // Let the slot actually swap UP before pressing: a press while the model is
  // still lowering is dropped, which is how a throw rig silently measures zero.
  await evaluate('window.__sdfGame.step(30)');
  const dynAim = await aimAtNearest();
  report.checks.dynamiteAim = dynAim;
  await evaluate('window.__sdfGame.dynamitePress()');
  await evaluate('window.__sdfGame.step(40)');
  const cooking = await evaluate('window.__sdfGame.dynamite()');
  await evaluate('window.__sdfGame.dynamiteRelease()');
  await evaluate('window.__sdfGame.step(2)');
  let detonations = 0, framesToDet = -1, maxDynStamps = 0, dynShot = null;
  for (let i = 0; i < 150; i++) {
    await evaluate('window.__sdfGame.step(1)');
    const d = await evaluate('window.__sdfGame.dynamite()');
    const bb = await evaluate('window.__sdfGame.bloodBlur');
    maxDynStamps = Math.max(maxDynStamps, bb.last.stamps);
    if (d.detonations > detonations) { detonations = d.detonations; framesToDet = i; break; }
  }
  for (let i = 0; i < 3; i++) await evaluate('window.__sdfGame.step(1)');
  await capture('game-30-dynamite-on');
  const after = await evaluate('window.__sdfGame.dynamite()');
  report.checks.dynamite = {
    before: { detonations: before.detonations, cookPhase: before.cookPhase },
    cooking: { cookPhase: cooking.cookPhase, charge: cooking.charge },
    detonations, framesToDet, maxStamps: maxDynStamps,
    after: { detonations: after.detonations, thrown: after.thrown },
  };
  console.log('dynamite:', JSON.stringify(report.checks.dynamite));

  // =======================================================================
  // 5. QUERY OFF
  // =======================================================================
  console.log('\n=== query off (?bloodblur=0) ===');
  await bootGame('?bloodblur=0');
  const qOff = await evaluate('window.__sdfGame.bloodBlur');
  report.checks.queryOff = { enabled: qOff.enabled };
  console.log('query off enabled =', qOff.enabled);
  if (qOff.enabled) throw new Error('?bloodblur=0 did not disable the blur');
  await evaluate('window.__sdfGame.step(2)');
  await capture('game-60-query-off');

  // =======================================================================
  // 6. DEFERRED ROUTE (opt-in ?renderer=deferred) — the blur nests in the
  //    same post-aa capture seam, so it must boot and run without errors.
  // =======================================================================
  console.log('\n=== deferred route (?renderer=deferred) ===');
  await bootGame('?renderer=deferred');
  await sleep(4000);
  const renderMode = await evaluate('window.__sdfGame.renderMode', 90000);
  const defBlur = await evaluate('window.__sdfGame.bloodBlur', 60000);
  console.log('renderMode =', renderMode, 'bloodBlur enabled =', defBlur.enabled, 'error =', defBlur.error);
  // A real spray in deferred mode, so the capture shows the blur path ran.
  const defAim = await spraySetup(4);
  let defStamps = 0;
  for (let i = 0; i < 16; i++) {
    await evaluate('window.__sdfGame.step(1)');
    const d = await evaluate('window.__sdfGame.bloodBlur');
    defStamps = Math.max(defStamps, d.last.stamps);
    if (d.last.stamps > 0 && i >= 2) break;
  }
  await capture('game-70-deferred-on');
  report.checks.deferred = { renderMode, enabled: defBlur.enabled, error: defBlur.error, aim: defAim, stamps: defStamps };
  console.log('deferred stamps:', defStamps);
  if (renderMode !== 'deferred') throw new Error(`deferred boot reported ${renderMode}`);

  console.log('\nDONE');
  shutdown(0);
} catch (err) {
  console.error('SMOKE FAILED:', err?.message ?? err);
  report.failed = String(err?.message ?? err);
  shutdown(1);
}
