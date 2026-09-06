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
//   MOTION      "off" (freeze recipe, default) or "on" (leave motion running
//               — used only for smoke-checking animation, never for diffs)
//   SETTLE_MS   default 2500
//   BENCH       if 1, run benchGpu() instead of shooting

const VITE = Number(process.argv[2] ?? 5291);
const CDP = Number(process.argv[3] ?? 9271);
const OUT = process.argv[4] ?? `/tmp/crowd-capture-${Date.now()}.png`;
const CROWD = Number(process.env.CROWD ?? 0);
const YAW = Number(process.env.YAW ?? 0.6);
const PITCH = Number(process.env.PITCH ?? 0.12);
const DIST = Number(process.env.DIST ?? 2.4);
const MOTION = process.env.MOTION ?? 'off';
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
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

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

const url = `http://localhost:${VITE}/sdf-lab-webgpu.html`;
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
  if (${MOTION !== 'on'}) { L.setMotionEnabled(false); L.setWander(false); }
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
// Suspend the loop: the statue-mode rig integrates real dt forever (a
// micro-jitter no settling removes), so only a paused loop gives bit-stable
// captures. The last presented frame stays on the canvas.
if (MOTION !== 'on') {
  await evaluate('window.__sdfLab.pauseLoop()');
  // Canonical reset + fixed-dt walk-in: makes the frozen frame a pure
  // function of (code, seed), so two page loads hash identically.
  await evaluate('window.__sdfLab.holdStill(120)');
}

if (WOUNDS > 0) {
  // Stamped BEFORE the capture and after the freeze, so the craters are part
  // of the frozen scene the three screenshots must agree on.
  await evaluate(`window.__sdfLab.stampWounds(${WOUNDS})`);
  await sleep(600);
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
    out: OUT, crowd: CROWD, motion: MOTION, wounds: WOUNDS,
    hashes: unique,
    stableWithinRun: unique.length === 1,
    consoleErrors: consoleErrors.slice(0, 6),
  }, null, 2));
}
