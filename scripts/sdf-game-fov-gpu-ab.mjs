// scripts/sdf-game-fov-gpu-ab.mjs — what narrowing the FOV costs on the GPU.
//
// The march is FILL-BOUND: its cost tracks covered pixels (see
// docs/dev-notes/2026-09-21-multiscale-march/WOUND-COST.md). Narrowing the
// world FOV from 72/60 to 58/46 magnifies a body at a fixed distance by
// ~1.72x in pixel area against the RENDER FOV, ~1.81x against the visible
// one — so close-up `sdf:march` should cost about that much more. This
// measures it instead of leaving it as arithmetic.
//
// METHOD, and why it is not negotiable (docs/dev-notes/2026-09-20-telemetry-v3):
//
//   * ONE PAGE. GPU ms is not comparable across sessions — different boots
//     land on different clocks.
//   * setFrameCap(0). Under a cap the GPU DOWNCLOCKS and the same work reads
//     11.7 ms or 18.9 ms depending on how much slack the cap leaves. A capped
//     A/B measures the cap, not the change.
//   * ALTERNATING LEGS (old, new, old, new, ...). Thermal drift and
//     background compiles are monotonic over a run; alternating turns them
//     into noise on both arms instead of a bias on the second one.
//
// Usage: LAB_VITE_PORT=5289 LAB_CDP_PORT=9289 node scripts/sdf-game-fov-gpu-ab.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5289);
const CDP = Number(process.argv[3] ?? 9289);
const OUT = process.env.GAME_OUT ?? '/tmp/sdf-game-fov';
const W = Number(process.env.GAME_W ?? 1280);
const H = Number(process.env.GAME_H ?? 800);
/**
 * Pixel multiplier. The FIRST run of this script came back vsync-bound: frame
 * p50 pinned at 16.6 ms with 3.7 ms of GPU idle on BOTH arms, so `busyMs`
 * compared two GPUs that were each finishing early and waiting for the
 * compositor — exactly the elastic-clock trap the method note above is
 * about, arriving through the presenter rather than through setFrameCap.
 * Headless Chrome here has no vsync-off switch (scripts/lab-servers.sh owns
 * the flags and is shared).
 *
 * RAISING THIS DOES NOT HELP, and that is itself the finding: at scale 2
 * (2560x1600 device pixels) every number above came back unchanged to within
 * noise, because the march renders into a CAPPED target whose size does not
 * follow the device pixel ratio. Narrowing the FOV does not add marched
 * pixels at all — it changes what those pixels SEE (median coverage 0.155 ->
 * 0.27, a measured 1.75x, which is the pixel-area arithmetic confirmed), and
 * the extra cost is per-covered-pixel march depth, not extra pixels. Left as
 * a knob because it is the obvious thing to try next and now has an answer.
 */
const SCALE = Number(process.env.FOV_SCALE ?? 1);
/** Seconds of recording per leg. */
const LEG_SEC = Number(process.env.FOV_LEG_SEC ?? 6);
/** How many times each arm is visited. */
const ROUNDS = Number(process.env.FOV_ROUNDS ?? 3);

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
    consoleEvents.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
}
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 60000,
    `evaluate timed out: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

mkdirSync(OUT, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
console.log(`viewport ${W}x${H} at scale ${SCALE} (${W * SCALE}x${H * SCALE} device pixels)`);
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });

let api = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  api = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
  if (api) break;
}
if (!api) fail('game page never booted');
if (api !== 'webgpu') fail(`backend ${api}, expected webgpu`);

let ready = false;
for (let i = 0; i < 600; i++) {
  ready = await evaluate(`!!document.getElementById('loader')?.classList.contains('loader-ready')`);
  if (ready) break;
  await sleep(1000);
}
if (!ready) fail('loader never reached loader-ready');
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
if ((await evaluate('typeof __sdfGame.telemetry === "object" && __sdfGame.telemetry !== null')) !== true) {
  fail('__sdfGame.telemetry is null — this build has no recorder, so there is nothing to measure');
}

// UNCAPPED. Everything below is meaningless without this line.
await evaluate('__sdfGame.setFrameCap(0)');
// Let the clock settle before the first leg, so leg 1 is not measured on a
// GPU still ramping up from the capped boot.
await sleep(4000);

const ARMS = {
  old: { render: 72, centre: 60 },
  new: { render: 58, centre: 46 },
};
const legs = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const name of ['old', 'new']) {
    const { render, centre } = ARMS[name];
    // The view model is compensated in BOTH arms (setViewmodelFov 60), so the
    // only difference between them is how much world each pixel sees — which
    // is the thing being measured. Leaving the weapon to grow with the FOV
    // would put its own extra pixels on the new arm's bill.
    await evaluate(`__sdfGame.setRenderFov(${render}); __sdfGame.setFisheye(${centre}); __sdfGame.setViewmodelFov(60);`);
    const report = await evaluate('__sdfGame.fisheye');
    if (report.renderFovDeg !== render || report.centerFovDeg !== centre) {
      fail(`leg ${name}: FOV read back as ${report.renderFovDeg}/${report.centerFovDeg}, set ${render}/${centre}`);
    }
    // A beat for the resized march target and the new lens to stop being new.
    await sleep(1200);
    await evaluate('__sdfGame.telemetry.start()');
    await sleep(LEG_SEC * 1000);
    await evaluate('__sdfGame.telemetry.stop()');
    const cap = await evaluate(`(() => {
      const c = __sdfGame.telemetry.lastCapture();
      if (!c) return null;
      const s = c.summary ?? {};
      const cov = c.frames.map((f) => f.state && f.state.coverageFrac).filter((v) => typeof v === 'number');
      cov.sort((a, b) => a - b);
      return {
        gpu: s.gpu ?? null, p50Ms: s.p50Ms ?? null, visibleFrames: s.visibleFrames ?? null,
        coverageMedian: cov.length ? cov[Math.floor(cov.length / 2)] : null,
      };
    })()`);
    if (!cap) fail(`leg ${name}: no capture came back`);
    if (!cap.gpu) fail(`leg ${name}: the capture carries no GPU timings — timestamp queries unavailable`);
    legs.push({ round, arm: name, render, centre, ...cap });
    console.log(`round ${round} ${name.padEnd(3)} (${render}/${centre}): gpu busy p50 ${cap.gpu.busyP50Ms.toFixed(2)} ms  p95 ${cap.gpu.busyP95Ms.toFixed(2)}  idle p50 ${cap.gpu.idleP50Ms.toFixed(2)}  frame p50 ${Number(cap.p50Ms).toFixed(2)} ms  coverage ${cap.coverageMedian}`);
  }
}

const med = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const arm = (name) => legs.filter((l) => l.arm === name);
const busy = (name) => med(arm(name).map((l) => l.gpu.busyP50Ms));
const oldBusy = busy('old'), newBusy = busy('new');
console.log(`\nGPU busy p50, median over ${ROUNDS} visits per arm:`);
console.log(`  72/60  ${oldBusy.toFixed(2)} ms`);
console.log(`  58/46  ${newBusy.toFixed(2)} ms`);
console.log(`  ratio  ${(newBusy / oldBusy).toFixed(2)}x`);
console.log(`  (arithmetic from the FOV alone predicts 1.72x on the render FOV, 1.81x on the visible one —`);
console.log(`   and only for the SDF march, which is one pass of the frame, so the whole-frame ratio is lower.)`);
// IDLE is the honesty check: if it is not ~0 the GPU had slack, the cap or a
// CPU stall was the limit, and the busy numbers are not comparing GPU work.
const idleOld = med(arm('old').map((l) => l.gpu.idleP50Ms));
const idleNew = med(arm('new').map((l) => l.gpu.idleP50Ms));
console.log(`  idle p50: ${idleOld.toFixed(2)} ms old, ${idleNew.toFixed(2)} ms new` +
  (Math.max(idleOld, idleNew) > 2 ? '  <-- NOT GPU-BOUND: treat the ratio as a lower bound' : '  (both GPU-bound)'));

writeFileSync(`${OUT}/gpu-ab.json`, JSON.stringify({ legs, oldBusy, newBusy, ratio: newBusy / oldBusy, idleOld, idleNew }, null, 2));
console.log(`\nwrote ${OUT}/gpu-ab.json`);
process.exit(0);
