// Crowd-alive capture + bench harness (dispatch 2026-08-25-crowd-alive).
//
// Two jobs:
//
//   1. PIXEL IDENTITY GATE for the step-1 refactor: boot the lab, apply the
//      deterministic freeze recipe (the relax-sweep one), shoot, and report a
//      SHA-256 of the raw framebuffer bytes plus the PNG on disk. Two runs at
//      the same settings must produce the same hash — and the pre/post
//      refactor runs must match each other, or the refactor changed pixels.
//
//   2. COST SPLIT: per-frame wall time from __sdfLab.benchGpu() (cpu+gpu,
//      queue kept full) at a given body count with motion off/on.
//
// Usage:
//   node scripts/crowd-capture.mjs <vitePort> <cdpPort> <outPng>
// Env:
//   CROWD       crowd size (default 0 = body zero only)
//   YAW/PITCH/DIST  camera (defaults 0.6 / 0.12 / 2.4)
//   MOTION      "off"  full freeze recipe (default): motion and wander off,
//                      so the body holds its authored rest pose;
//               "walk" motion AND wander LEFT ON, then the same pauseLoop +
//                      holdStill(120) canonical reset and fixed-dt walk-in.
//                      Deterministic for the same reason "off" is — holdStill
//                      reseeds from MOTION_SEED and steps a FIXED dt, so the
//                      real-rAF timing history that made settled captures
//                      unrepeatable never enters. This is the ONLY mode that
//                      renders a body mid-gait, and therefore the only one
//                      that can see a motion-vs-rig defect (see CHARACTER);
//               "on"   leave the live loop running — smoke-check only, NEVER
//                      diff two of these.
//   CHARACTER   lab ?character= value (default: the lab's own default, zombie).
//               THE GATE WAS BLIND TO EVERY CHARACTER BUT THE ZOMBIE until
//               this existed (2026-09-06): a goblin regression visible on
//               screen passed all eight views and all four game gates,
//               because every one of them rendered the zombie.
//   SETTLE_MS   default 2500
//   BENCH       if 1, run benchGpu() instead of shooting
//
// EXITS ON ITS OWN. It did not until 2026-09-06 -- see the note above the
// ws.close() at the bottom -- so callers wrapping this in `timeout` and
// treating rc=124 as the success path are reading a fixed bug; a clean run
// now exits 0 and a 124 means it really did hang.

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const VITE = Number(process.argv[2] ?? 5291);
const CDP = Number(process.argv[3] ?? 9271);
const OUT = process.argv[4] ?? `/tmp/crowd-capture-${Date.now()}.png`;
const CROWD = Number(process.env.CROWD ?? 0);
const YAW = Number(process.env.YAW ?? 0.6);
const PITCH = Number(process.env.PITCH ?? 0.12);
const DIST = Number(process.env.DIST ?? 2.4);
const MOTION = process.env.MOTION ?? 'off';
if (!['off', 'walk', 'on'].includes(MOTION)) fail(`MOTION must be off|walk|on, got "${MOTION}"`);
// Freeze the rig only in "off". "walk" wants the gait to actually run during
// holdStill's fixed-dt walk-in; "on" wants everything live.
const FREEZE_MOTION = MOTION === 'off';
// Pause + canonical reset for anything that is going to be diffed.
const CANONICALISE = MOTION !== 'on';
const CHARACTER = process.env.CHARACTER ?? '';
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 2500);
const BENCH = process.env.BENCH === '1';
// WOUNDS: stamp N blast craters on the torso before capturing. Default 0 =
// today's behaviour, byte-for-byte.
//
// WHY IT WAS ADDED (2026-09-06). This script's header says it "shoots", and
// the loop below is commented "three shots" — but those are three
// Page.captureScreenshot calls. NOTHING here ever fired a weapon or stamped a
// wound, so every pixel-identity verdict this script has ever given was blind
// to the entire wound path: carve spheres, rim splay, depth-slab caps, ageing.
// A refactor moving wound code could pass this gate byte-identically while
// changing every crater on screen, which is exactly what nearly happened when
// the lab converged onto the shared carve upload.
const WOUNDS = Number(process.env.WOUNDS ?? 0);

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- CDP plumbing (same no-deps pattern as relax-sweep.mjs) ----------
const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
// TAB CLEANUP — see relax-sweep.mjs. Leaked tabs biased a whole session once.
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' }); }
  catch { /* browser already gone */ }
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled'
    && ['error', 'warning'].includes(m.params.type)) {
    consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};
await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 960, deviceScaleFactor: 1, mobile: false });

// Hashing the PNG BYTES node-side: Chrome's encoder is deterministic, so
// identical framebuffers produce identical bytes — no need to haul megabytes
// of base64 through Runtime.evaluate (whose promise GCs at that size).
const hashPng = (b64) => createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');

const url = `http://localhost:${VITE}/sdf-lab-webgpu.html`
  + (CHARACTER ? `?character=${encodeURIComponent(CHARACTER)}` : '');
console.log(`capture ${url}  crowd ${CROWD}, motion ${MOTION}, bench ${BENCH}`);
await send('Page.navigate', { url });

let lab = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  lab = await evaluate('typeof window.__sdfLab === "object"');
  if (lab) break;
}
if (!lab) { console.error('console tail:', consoleErrors.slice(-8)); fail('__sdfLab never booted'); }
const backend = await evaluate('window.__sdfLab.backend');
if (backend !== 'webgpu') fail(`backend is ${backend}, not webgpu`);

// Deterministic freeze recipe — the same one relax-sweep validated (floor
// max lost-tile 0.0278). With MOTION=on we skip only the motion freeze so an
// animated crowd can be eyeballed; NEVER diff two MOTION=on shots.
await evaluate(`(() => {
  const L = window.__sdfLab;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH' })); // hide debug panel
  if (${FREEZE_MOTION}) { L.setMotionEnabled(false); L.setWander(false); }
  L.setAdaptive(false);
  L.setSdfScale(1.0);
  L.post.setSmear(0);
  L.post.setFxaa(false);
  L.uniforms.faceCfg3.value.x = 0; // glow flicker off
  L.gooLayer.setThreshold(10);
  for (const o of L.scene.children) if (o.isInstancedMesh) o.visible = false;
  L.freezeCosmetics();
  return true;
})()`);
await evaluate(`window.__sdfLab.setCrowdCount(${CROWD})`);
await sleep(Number(process.env.CROWD_SETTLE_MS ?? 400));
await evaluate(`window.__sdfLab.setCam(${YAW}, ${PITCH}, ${DIST})`);
await sleep(SETTLE_MS);

// STAMP BEFORE pauseLoop(), NOT AFTER. This block first sat below the pause,
// which is the one window where a state change cannot reach the framebuffer:
// pauseLoop's whole contract is "the last presented frame stays on the canvas,
// nothing advances between the freeze and the shot". The wounds went into the
// ring, the uniform count read 6, and the screenshot was still the pre-stamp
// frame — every wounded view came out byte-identical to its unwounded twin,
// which looks exactly like "the change was a no-op" and is not.
if (WOUNDS > 0) {
  await evaluate(`window.__sdfLab.stampWounds(${WOUNDS})`);
  await sleep(600);   // let the live loop present the craters
}
// Suspend the loop: the statue-mode rig integrates real dt forever (a
// micro-jitter no settling removes), so only a paused loop gives bit-stable
// captures. The last presented frame stays on the canvas.
if (CANONICALISE) {
  await evaluate('window.__sdfLab.pauseLoop()');
  // Canonical reset + fixed-dt walk-in: makes the frozen frame a pure
  // function of (code, seed), so two page loads hash identically.
  await evaluate('window.__sdfLab.holdStill(120)');
}

if (BENCH) {
  const r = await evaluate(`window.__sdfLab.benchGpu({ chunks: 8, chunkFrames: 20 })`, true);
  console.log('BENCH ' + JSON.stringify(r));
} else {
  // Three shots; every hash must agree within the run (frozen scene), and the
  // reported hash is what the pre/post-refactor comparison uses.
  const hashes = [];
  let lastB64 = null;
  for (let i = 0; i < 3; i++) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    lastB64 = shot.result?.data;
    if (!lastB64) throw new Error('captureScreenshot returned no data');
    hashes.push(hashPng(lastB64));
    await sleep(120);
  }
  const unique = [...new Set(hashes)];
  writeFileSync(OUT, Buffer.from(lastB64, 'base64'));
  console.log(JSON.stringify({
    out: OUT, character: CHARACTER || 'zombie', crowd: CROWD,
    motion: MOTION, wounds: WOUNDS,
    hashes: unique,
    stableWithinRun: unique.length === 1,
    consoleErrors: consoleErrors.slice(0, 6),
  }, null, 2));
}

// CLOSE THE SOCKET, OR THIS PROCESS NEVER EXITS (fixed 2026-09-06).
//
// An open CDP WebSocket is a live libuv handle, so node kept the event loop
// alive forever with all the work done and the PNG already on disk. Every
// caller had to wrap the run in `timeout`, and every capture then burned its
// ENTIRE budget waiting on a finished process. The cost was badly
// underestimated in the comments this replaces, which guessed "60-90 s of
// real work plus the hang": MEASURED after the fix, an unwrapped capture
// returns in SEVEN SECONDS, so a 240 s budget was spending 97% of a
// twelve-shot gate waiting on nothing. It also cost two debugging attempts
// the first time someone hit it, because a plain loop over this script simply
// hangs on iteration one.
//
// The unref'd timer is belt and braces, not the mechanism: closing the socket
// normally drains the loop and node exits on its own, flushing stdout the
// ordinary way (which `process.exit()` here would risk truncating, since a
// piped stdout write can still be in flight). If some other handle is left
// holding the loop the timer fires and takes the exit anyway -- and because
// it is unref'd it never delays an otherwise-clean exit.
ws.close();
setTimeout(() => process.exit(0), 2000).unref();
