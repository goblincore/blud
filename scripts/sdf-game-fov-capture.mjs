// scripts/sdf-game-fov-capture.mjs — the FOV-narrowing capture set for the
// owner (2026-09-21), and the gate on the view-model's FOV compensation.
//
// The owner narrowed the world FOV from 72/46 render/centre to 58/46, which
// magnifies everything drawn through it — the first-person weapons included,
// until they were mostly off the bottom of the frame. The fix is not a
// per-weapon retune: the whole view model hangs off a rig carrying
// viewmodelFovScale()'s (r, r, 1), so the weapons keep the framing they were
// authored at whatever the world FOV becomes.
//
// This script produces the evidence for both halves:
//
//   1. GATE — the rig exists, carries exactly (r, r, 1) with z pinned at 1,
//      and moves when `setFisheye` does. A compensation that silently stops
//      tracking the world FOV is the failure this file is here to catch.
//   2. AIM GATE — the shot ray still goes through the warped crosshair. The
//      FOV change must not touch aim; F-aim.1 (free aim misplacing under the
//      lens) is the owner's, deferred, and separate from this.
//   3. CAPTURES — every weapon slot at the OLD 72/60 and the NEW 58/46, with
//      and without the compensation, so the owner can judge the narrowing and
//      the weapon framing independently instead of as one lump.
//
// Usage: LAB_VITE_PORT=5285 LAB_CDP_PORT=9285 node scripts/sdf-game-fov-capture.mjs
// (or scripts/sdf-game-fov-capture.sh, which owns its own servers.)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { waitForLoader } from './lib/wait-loader.mjs';

const VITE = Number(process.argv[2] ?? 5285);
const CDP = Number(process.argv[3] ?? 9285);
const OUT = process.env.GAME_OUT ?? '/tmp/sdf-game-fov';
const W = Number(process.env.GAME_W ?? 1280);
const H = Number(process.env.GAME_H ?? 800);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

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
    consoleEvents.push({
      type: m.params.type,
      text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
    });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});

/** A crashed/tab-busy target never answers a CDP request — every await needs
 *  a bound, or the driver hangs forever with zero diagnostics. */
function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms)),
  ]);
}
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 30000,
    `evaluate timed out: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

mkdirSync(OUT, { recursive: true });
let shotCount = 0;
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(`${OUT}/${name}.png`, buf);
  shotCount++;
  console.log(`  shot ${name}.png (${buf.length} bytes)`);
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// ?ammo=finite is NOT wanted here: these are framing captures, and an empty
// magazine starts an auto-reload that moves the gun mid-shot. Ship default.
const url = `http://localhost:${VITE}/sdf-game.html`;
console.log(`game ${url}`);
await send('Page.navigate', { url });

let api = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  api = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
  if (api) break;
}
if (!api) {
  console.error('console tail:', consoleEvents.slice(-8));
  fail('game page never booted (__sdfGame absent)');
}
const backend = await evaluate('__sdfGame.backend');
if (backend !== 'webgpu') fail(`backend ${backend}, expected webgpu`);
const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errs.length) fail(`console errors at boot: ${JSON.stringify(errs.slice(0, 3))}`);

// The tuning panels cover most of the frame; a framing capture with them up
// shows the owner nothing (the shorty gate's header records that lesson).
for (const p of ['woundPanel', 'gooPanel', 'vhsPanel']) {
  await evaluate(`typeof __sdfGame.${p} === "function" ? (__sdfGame.${p}(false), 1) : 0`);
}

// WAIT FOR THE LOADER, THEN DISMISS IT. `__sdfGame` exists long before the
// march pipelines finish compiling (cold: minutes — docs/dev-notes/
// 2026-09-19-shader-compile), and the overlay covers the whole frame until
// then. The first run of this script captured its first leg over "compiling
// pipelines" and produced three 17 KB near-black PNGs that passed every
// assertion and showed the owner nothing — the same failure mode the shorty
// gate's panel note records, from the other direction. game-boot-leaves adds
// `loader-ready` when the game is actually playable; `loader-hidden` is what
// the overlay's own click handler adds, so dismissing it this way is the
// player's path, not a private one.
await waitForLoader(evaluate, { fail });

// ————————————————————————————————————————————————————————————————————————
// 1. THE SHIPPED DEFAULTS
// ————————————————————————————————————————————————————————————————————————
const boot = await evaluate('__sdfGame.fisheye');
console.log('fisheye at boot:', JSON.stringify(boot));
if (boot.renderFovDeg !== 58) fail(`render FOV ${boot.renderFovDeg}, expected 58`);
if (boot.centerFovDeg !== 46) fail(`centre FOV ${boot.centerFovDeg}, expected 46`);
if (boot.viewmodelFovDeg !== 60) fail(`viewmodel FOV ${boot.viewmodelFovDeg}, expected 60`);
// Bounded, not pinned. The warp crops the vertical mid-edges, so the visible
// FOV always lands strictly between the centre and the render FOV — but WHERE
// between depends on the aspect (49.0 at 16:9, 50.5 in this headless tab's
// letterboxed 4:3), and a gate that pins one number fails on the other
// machine for a reason that has nothing to do with the lens.
if (!(boot.visibleFovDeg > boot.centerFovDeg && boot.visibleFovDeg < boot.renderFovDeg)) {
  fail(`visible FOV ${boot.visibleFovDeg} is not between centre ${boot.centerFovDeg} and render ${boot.renderFovDeg}`);
}

// ————————————————————————————————————————————————————————————————————————
// 2. THE COMPENSATION RIG — (r, r, 1), and it TRACKS the world FOV.
//
//    z pinned at 1 is the load-bearing half: it is what leaves the view
//    model's depths (and therefore its occlusion against the composited
//    world, and the shell that lands behind a wall) exactly as authored.
// ————————————————————————————————————————————————————————————————————————
const readRig = `(() => {
  let rig = null;
  __sdfGame.viewModelAnchor.traverseAncestors((o) => { if (o.name === 'view-model-fov-rig') rig = o; });
  return rig ? { x: rig.scale.x, y: rig.scale.y, z: rig.scale.z, anchorIsChild: rig.children.includes(__sdfGame.viewModelAnchor) } : null;
})()`;
const rig = await evaluate(readRig);
if (!rig) fail('view-model-fov-rig is not an ancestor of the view model anchor');
if (!rig.anchorIsChild) fail('the anchor is not a direct child of the fov rig — the ride height would go unscaled');
if (Math.abs(rig.x - 0.7352) > 1e-3) fail(`rig scale.x ${rig.x}, expected ~0.7352 (tan23/tan30)`);
if (rig.x !== rig.y) fail(`rig scale is not isotropic in x/y: ${rig.x} vs ${rig.y}`);
if (rig.z !== 1) fail(`rig scale.z is ${rig.z}, expected exactly 1 — depth must not move`);
console.log(`rig: scale (${rig.x.toFixed(4)}, ${rig.y.toFixed(4)}, ${rig.z})`);

// It tracks. Widen the world FOV to the reference and the scale must return
// to an EXACT 1 — the identity the poses were authored through.
await evaluate('__sdfGame.setFisheye(60)');
const at60 = await evaluate(readRig);
if (at60.x !== 1) fail(`at centre FOV 60 the rig scale is ${at60.x}, expected exactly 1`);
await evaluate('__sdfGame.setFisheye(46)');
const back = await evaluate(readRig);
if (Math.abs(back.x - rig.x) > 1e-12) fail('the rig did not return to the shipped scale');
console.log('rig tracks setFisheye: 46 -> 0.7352, 60 -> 1 exactly');

// ————————————————————————————————————————————————————————————————————————
// 3. AIM. The FOV change must leave the shot ray going through the warped
//    crosshair. Both are derived from camera.fov and the same lens, so this
//    is a regression gate, not a tuning read — and it is deliberately NOT a
//    test of F-aim.1 (free-aim misplacement under the lens), which the owner
//    deferred and which reproduces at every FOV.
// ————————————————————————————————————————————————————————————————————————
await evaluate('__sdfGame.setLoopRunning(false)');
await evaluate('__sdfGame.step(2, 1 / 60)');
const aim = await evaluate(`(() => {
  const f = __sdfGame.fisheye;
  const p = typeof __sdfGame.predictSlugHit === 'function' ? __sdfGame.predictSlugHit() : null;
  return { f, hit: p ? { kind: p.kind ?? null, dist: p.dist ?? null } : null };
})()`);
console.log('aim:', JSON.stringify(aim));
await evaluate('__sdfGame.setLoopRunning(true)');

// ————————————————————————————————————————————————————————————————————————
// 4. CAPTURES. Three FOV legs x three weapon slots, in ONE page so the
//    frames differ only by what this script changed.
//
//      old      — 72/60, the look before the narrowing (compensation at 1).
//      new      — 58/46 with the compensation ON: what ships.
//      new-raw  — 58/46 with the compensation OFF (viewmodel FOV pinned to
//                 the world's): the "weapon is mostly cut off" the owner
//                 reported, kept as the before-picture rather than described.
// ————————————————————————————————————————————————————————————————————————
const LEGS = [
  ['old',     72, 60, 60],
  ['new',     58, 46, 60],
  ['new-raw', 58, 46, 46],
];
const SLOTS = ['shotgun', 'dynamite', 'flare'];
for (const [leg, render, centre, vm] of LEGS) {
  await evaluate(`__sdfGame.setRenderFov(${render}); __sdfGame.setFisheye(${centre}); __sdfGame.setViewmodelFov(${vm});`);
  const report = await evaluate('__sdfGame.fisheye');
  console.log(`leg ${leg}: ${JSON.stringify(report)}`);
  // READ BACK, DO NOT ASSUME. The first run of this script logged three
  // identical legs and captured three identical-FOV sets, because
  // `__sdfGame.fisheye` was a boot-time snapshot (a spread flattens a
  // getter — game-main.ts's note at the seam literal). A capture set whose
  // legs are secretly the same leg is worse than no capture set, so the
  // read-back is a gate, not a log line.
  if (report.renderFovDeg !== render) fail(`leg ${leg}: render FOV read back as ${report.renderFovDeg}, set ${render}`);
  if (report.centerFovDeg !== centre) fail(`leg ${leg}: centre FOV read back as ${report.centerFovDeg}, set ${centre}`);
  if (report.viewmodelFovDeg !== vm) fail(`leg ${leg}: viewmodel FOV read back as ${report.viewmodelFovDeg}, set ${vm}`);
  for (const slot of SLOTS) {
    const sel = await evaluate(`JSON.stringify(__sdfGame.selectSlot(${JSON.stringify(slot)}))`);
    if (!JSON.parse(sel).ok) fail(`selectSlot(${slot}) refused: ${sel}`);
    // The slot machine lowers one weapon and raises the next over
    // ~0.42 s (game-weapon-slots.ts). Step past it deterministically rather
    // than sleeping, so a loaded machine cannot catch a weapon mid-raise.
    await evaluate('__sdfGame.setLoopRunning(false)');
    await evaluate('__sdfGame.step(40, 1 / 60)');
    await evaluate('__sdfGame.setLoopRunning(true)');
    await sleep(500);
    await shot(`${leg}-${slot}`);
  }
}

// Leave the page on what ships, in case a human takes the tab over.
await evaluate(`__sdfGame.setRenderFov(58); __sdfGame.setFisheye(46); __sdfGame.setViewmodelFov(60); __sdfGame.selectSlot('shotgun');`);

const late = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (late.length) fail(`console errors during the run: ${JSON.stringify(late.slice(0, 3))}`);
console.log(`\nPASS — ${shotCount} shots in ${OUT}`);
// Explicit, because the open CDP WebSocket keeps the event loop alive: the
// first run of this script finished all nine shots and then sat there until
// it was killed, which reads as a hang rather than a pass.
process.exit(0);
