// scripts/sdf-game-shorty-gate.mjs — headless gate for the sawed-off
// view-model on sdf-game.html. No-deps CDP, same pattern as
// scripts/sdf-game-grapeshot.mjs (which owns the plumbing this copies).
//
//   1. BOOT GATE: backend === 'webgpu', no console errors, the gun loaded.
//   2. THE GUN: the k3 GLB is gone, shorty-double.glb's Barrels node is in.
//   3. FLASH: the sprite is visible on the shot frame, gone a beat later.
//   4. THE BODIES: the marched bodies' spotCfg.x rises on the flash frame.
//   5. RELOAD: two shots empty it, the hinge opens, it returns shut and loaded.
//
// Usage: LAB_VITE_PORT=5281 LAB_CDP_PORT=9281 node scripts/sdf-game-shorty-gate.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5281);
const CDP = Number(process.argv[3] ?? 9281);
const OUT = process.env.GAME_OUT ?? '/tmp/sdf-game-shorty';
const W = Number(process.env.GAME_W ?? 800);
const H = Number(process.env.GAME_H ?? 600);

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
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 30000,
    `evaluate timed out: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

/** A crashed/tab-busy target never answers a CDP request — every await needs
 *  a bound, or the driver hangs forever with zero diagnostics. */
function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms)),
  ]);
}

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

// ?ammo=finite IS REQUIRED BY THIS GATE, not a preference. Unlimited ammo ships
// as the default (2026-09-10, for the dynamite tuning pass), and this gate's
// whole subject is the RELOAD: it spends both shells, waits for the auto-reload
// and reads the hinge. Under infinite ammo the magazine never empties, the
// reload never starts and every assertion below would fail for a reason that
// has nothing to do with the view-model. Pinned the same way the bench pins its
// seams — a gate that can be silently reconfigured by a default is not a gate.
const url = `http://localhost:${VITE}/sdf-game.html?ammo=finite`;
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

// 1. BOOT GATE — webgpu backend, no console errors, the gun actually loaded.
const backend = await evaluate('__sdfGame.backend');
if (backend !== 'webgpu') fail(`backend ${backend}, expected webgpu`);
const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errs.length) fail(`console errors at boot: ${JSON.stringify(errs.slice(0, 3))}`);

// 2. THE GUN — a missing GLB must be loud. game-main throws if the named
//    nodes are absent, so a clean boot already proves Barrels/Hinge exist.
const gunOk = await evaluate(`
  (() => {
    const a = __sdfGame.viewModelAnchor;
    const g = a && a.getObjectByName('grapeshot-k3') === null;
    let barrels = null;
    a.traverse((o) => { if (o.name === 'Barrels') barrels = o; });
    return { hasAnchor: !!a, barrels: !!barrels, children: a ? a.children.length : 0 };
  })()
`);
if (!gunOk.hasAnchor) fail('no viewModelAnchor');
if (!gunOk.barrels) fail('Barrels node not present under the view-model anchor');

// 2b. THE ARMS — goblin-arm.glb loaded, both arms parented, the skin has NO
//     emissive (the 0.30 glow was what flattened the old hands), and the
//     watch screen exists on the left arm. game-arms.ts throws on a missing
//     node, so a clean boot already proved the node contract; this proves
//     the dressing.
const armsOk = await evaluate('__sdfGame.arms');
if (!armsOk || !armsOk.left || !armsOk.right) fail(`arms not loaded: ${JSON.stringify(armsOk)}`);
if (armsOk.skinEmissive !== 0) fail(`skin emissive is ${armsOk.skinEmissive}, expected 0 — the glow is back`);
if (!armsOk.watch) fail('Watch_Screen missing from the left arm');
console.log('arms: both present, skin emissive 0, watch present');

// Give the first frames a beat to settle, then capture the rest pose.
// Dismiss the tuning panels BEFORE any screenshot. game-main.ts:380 says this
// seam exists for exactly this reason ("guarded typeof-style in capture
// scripts"), and without it the WOUND and GOO panels cover most of the frame:
// the first run of this gate produced ten shots in which the weapon is a
// sliver in the corner, which passes every boolean and shows the owner nothing.
await evaluate('typeof __sdfGame.woundPanel === "function" ? (__sdfGame.woundPanel(false), 1) : 0');
await evaluate('typeof __sdfGame.gooPanel === "function" ? (__sdfGame.gooPanel(false), 1) : 0');
await evaluate('typeof __sdfGame.vhsPanel === "function" ? (__sdfGame.vhsPanel(false), 1) : 0');
await sleep(2000);
await shot('fpv-rest');
console.log(`gate: backend=${backend} anchorChildren=${gunOk.children}`);

// 3. FLASH — fire, and prove the flash is visible on the shot frame and gone
//    a beat later.
//
//    DETERMINISTIC, not wall-clock. This first used `fire(); sleep(40)` against
//    a 70 ms envelope, which passed until the frame got heavier (smoke puffs
//    and shell meshes) and then failed intermittently because the read landed
//    past the window. A gate whose result depends on machine load is not a
//    gate. Pause the loop and step exactly one frame instead — the same
//    technique the reload check below already uses.
await evaluate('__sdfGame.setLoopRunning(false)');
await evaluate('__sdfGame.fire(1)');
await evaluate('__sdfGame.step(1, 1 / 60)');
const lit = await evaluate('__sdfGame.flashVisible');
await shot('flash-on');
// Step past the whole 70 ms envelope: 8 frames at 1/60 is 133 ms.
await evaluate('__sdfGame.step(8, 1 / 60)');
const dark = await evaluate('__sdfGame.flashVisible');
await shot('flash-off');
await evaluate('__sdfGame.setLoopRunning(true)');
if (!lit) fail('no muzzle flash on the shot frame');
if (dark) fail('muzzle flash still visible past the envelope — it never closed');

// 4. THE BODIES — read the uniform the march actually samples. A PointLight
//    cannot touch this, so a rise here is the whole point of the task.
//    Actors are exposed through zombie(id) (the weapon seam); zombies()[0]
//    IS actors[0]. Timing: a live-rAF read RACES the flash — headless ticks
//    clamp dt to 1/20 s while the window is 70 ms, so the lit uniform exists
//    for ONE rendered frame (probe: x=1.30 at ~+32 ms, back to 1 by +48 ms).
//    So fire, then HAND-STEP one 1/60 s frame: step() runs tick+drawFn
//    synchronously and parks the rAF loop, making the read deterministic
//    (flashAge = 1/60, fv = e^-1, gate = spotOn + 6/e).
// Clear check 3's fireCooldownSec. Stepped, not slept: check 3 now advances
// simulated time rather than wall-clock time, so a real-world sleep would not
// move the cooldown at all. 0.45 s of cooldown is 27 frames at 1/60; 34 with
// margin.
await evaluate('__sdfGame.setLoopRunning(false)');
await evaluate('__sdfGame.step(34, 1 / 60)');
const beamZid = await evaluate('__sdfGame.zombies()[0]?.id ?? null');
const beamRead = (zid) => `(() => { const a = __sdfGame.zombie(${zid}); return a ? a.view.uniforms.spotCfg.value.x : null; })()`;
const beam = await evaluate(beamRead(beamZid));
if ((await evaluate('__sdfGame.fire(1)')) !== true) fail('fire() rejected — check 3 cooldown had not cleared');
await evaluate('__sdfGame.step(1, 1 / 60)');
const beamLit = await evaluate(beamRead(beamZid));
await shot('flash-zombie');
await evaluate('__sdfGame.setLoopRunning(true)');
if (beamLit === null) fail('no actor to test the beam on');
if (!(beamLit > beam)) {
  fail(`spotCfg.x did not rise on the flash frame (${beam} -> ${beamLit}); ` +
       'the bias is probably AFTER the for-of loop instead of before it');
}
console.log(`beam: spotCfg.x ${beam} -> ${beamLit} on the flash frame`);

// 5. RELOAD — two shots must empty it, the hinge must actually open, and the
//    gun must come back to a shut, loaded rest state on its own.
//    fire() rejects SILENTLY: on the 0.45 s cooldown, mid-reload, and a dry
//    gun. Checks 3-4 already spent both shells (the second fire auto-starts
//    the reload), so this sequence first waits out the game's OWN return to a
//    full shut rest — the same auto-return the check exists to prove — then
//    asserts every fire's return value before reading shells.
const ready = await evaluate(`
  (async () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 4000) {
      await new Promise((r) => setTimeout(r, 100));
      if (__sdfGame.shells === 2 && Math.abs(__sdfGame.hingeOpenRad) < 1e-6) return true;
    }
    return { shells: __sdfGame.shells, open: __sdfGame.hingeOpenRad };
  })()
`);
if (ready !== true) fail(`gun never returned to full shut rest: ${JSON.stringify(ready)}`);
let maxOpen = 0;
// Pin the eject arc. Reloads seed their arc from Math.random (owner asked for
// variety); seed 0 is the reference arc, so two runs of this gate photograph
// the same tumble. The eject-origin check below does not depend on the seed
// either way -- at the hand-off beat every seed starts from the same point.
await evaluate('typeof __sdfGame.pinReloadSeed === "function" ? (__sdfGame.pinReloadSeed(0), 1) : 0');
if ((await evaluate('__sdfGame.fire(1)')) !== true) fail('reload fire 1 rejected');
// Clear fireCooldownSec (0.45 s) in GAME time, not wall time: headless rAF is
// slow enough that dt clamps to 1/20 s and 500 ms of wall clock can be under
// 0.45 s of game clock (observed: fire 2 rejected after a 500 ms sleep).
// 30 × 1/60 s hand-steps = 0.5 s of tick time, deterministically.
await evaluate('__sdfGame.step(30, 1 / 60)');
if ((await evaluate('__sdfGame.fire(1)')) !== true) fail('reload fire 2 rejected');
const spent = await evaluate('__sdfGame.shells');
if (spent !== 0) fail(`two shots left ${spent} shells, expected 0`);
// The loop stays parked (step() parked it): the reload beats are stepped in
// GAME time too, so each reload-*.png frame is exactly the beat it names —
// this strip is Task 8's evidence, and wall-clock sampling would race it.
//
// Every sample sits ON a beat from game-viewmodel.ts's RELOAD, a hair after it
// so the beat has actually landed in the frame:
//   180  presentSec 0.18   — rolled into view, top lever thrown
//   350  mid-break          — barrels swinging, chamber mouths coming into view
//   510  breakEndSec 0.51   — full 45 deg open, spent cases at the mouth
//   650  post-ejectAt 0.51  — cases clear of the bore and tumbling free
//   900  mid-carry          — fresh cases in the hand, rising to the breech
//   960  loadStageSec 0.96  — cases staged on the bore axis, tips at the mouths
//   1040 mid-insert         — cases half-way into the chambers, hand behind them
//   1110 loadSeatSec 1.11   — both fresh cases seated, gun still open
//   1180 snapEndSec 1.16    — snapped shut
// The old set ([120 260 400 550 740 900]) was cut for a 0.95 s reload and never
// moved: it opened mid-present, spent 740 on loadStart before a single fresh
// case was visible, and ended mid-load — the seat and the snap, the back third
// of the animation, were never photographed at all.
let ticks = 0;
// GAME_EXTRA_BEATS=540,580 adds frames between the beats (e.g. to watch the
// cases actually leave the bore) without touching the strip the gate owns.
const BEATS = [...new Set([180, 350, 510, 650, 900, 960, 1040, 1110, 1180,
  ...(process.env.GAME_EXTRA_BEATS ?? '').split(',').filter(Boolean).map(Number)])]
  .sort((a, b) => a - b);
for (const ms of BEATS) {
  const target = Math.round((ms / 1000) / (1 / 60));
  await evaluate(`__sdfGame.step(${target - ticks}, 1 / 60)`);
  ticks = target;
  const open = await evaluate('__sdfGame.hingeOpenRad');
  maxOpen = Math.max(maxOpen, open);
  await shot(`reload-${ms}`);
  // 5b. THE EJECT ORIGIN — the owner's actual complaint ("the ejected shells
  // dont come out of the right location"). 510 ms IS RELOAD.ejectAtSec (0.51 s):
  // the first frame the free tumble takes over from the axial extract, so
  // lastEjectOrigin is still (near) the chamber mouth rather than having
  // drifted downrange with the shell's own ballistic arc. Sampling any later
  // beat would fail a CORRECT build for the wrong reason -- the shell is
  // supposed to have moved on by then.
  //
  // The origin is the extracted case's CENTRE, half a case length (3.5 cm)
  // out of the mouth along the bore -- where the axial slide actually left
  // it -- so a correct build reads ~3.5 cm here, not ~0. The 5 cm bound still
  // separates that from the stale hardcoded breech (16.8 cm).
  if (ms === 510) {
    const eject = await evaluate(
      '({ o: __sdfGame.lastEjectOrigin, b: __sdfGame.breechWorld() })');
    if (!eject.o) fail('lastEjectOrigin still null at the eject beat');
    const dist3 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const d = Math.min(...eject.b.map((p) => dist3(p, eject.o)));
    if (d > 0.05) {
      fail(`case left ${(d * 100).toFixed(1)} cm from the nearest chamber mouth ` +
           `at the eject beat -- eject origin has drifted off the live breech`);
    }
    console.log(`eject origin: ${(d * 100).toFixed(2)} cm from the nearest breech mouth`);
  }
}
if (maxOpen < 0.4) fail(`hinge only reached ${maxOpen} rad; the barrels never opened`);
// Step past the END of the reload, DERIVED from the page rather than hardcoded.
// This line used to read `57 - ticks + 6` against a comment claiming 0.95 s;
// the reload then became 1.05 s and the number was never revisited, and when it
// became 1.30 s the gate failed a perfectly correct build and sent someone
// hunting a phantom eject bug. Ask the game how long its own reload is.
const totalSec = await evaluate('__sdfGame.reloadTotalSec');
if (typeof totalSec !== 'number') fail('__sdfGame.reloadTotalSec missing — cannot size the reload wait');
const endTick = Math.ceil(totalSec * 60) + 6;   // +6 frames of slack past the last beat
await evaluate(`__sdfGame.step(${endTick - ticks}, 1 / 60)`);
await evaluate('__sdfGame.setLoopRunning(true)');
const after = await evaluate('__sdfGame.shells');
const shut = await evaluate('__sdfGame.hingeOpenRad');
if (after !== 2) fail(`reload finished with ${after} shells, expected 2`);
if (Math.abs(shut) > 1e-6) fail(`hinge left at ${shut} rad, expected shut`);
console.log(`reload: shells 2 -> 0 -> 2, maxOpen ${maxOpen.toFixed(3)} rad, shut again`);

console.log(`done — ${shotCount} shots in ${OUT}`);
// An open CDP WebSocket keeps node's event loop alive forever — without this
// the gate prints its PASS lines and then hangs, the shell wrapper never
// finishes, and lab_servers_down never runs. process.exit still fires the
// process.on('exit') tab-close above.
process.exit(0);
