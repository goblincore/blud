// docs/dev-notes/2026-09-07-per-ray-wound-list/parity.mjs — pixel-parity gate
// for the per-ray wound list (march.wgsl.ts counts2.w).
//
// The wound list is a value no-op BY CONSTRUCTION when it is correct: the
// preload folds the set of wounds whose REACH sphere the ray can enter, which
// is exactly the set the per-step reach cull would keep anyway. So ON vs OFF
// MUST render the identical frame. This script proves it the way closeup-
// woundcull-capture.mjs did for the union bound: carve wounds deterministically,
// freeze the scene, capture OFF/a OFF/b ON OFF/c, and diff with PIL.
//
// The gate is SHAPE-AWARE: a parity "win" is only meaningful if the mask looks
// like frame noise (scattered single pixels), not a crater-shaped blob — a
// dropped wound renders a hole. That is judged by a human LOOKING at the mask,
// not by a number. This script writes the PNGs and a parity.json; the Python
// PIL diff lives in diff.py, run by hand / by the notes step.
//
// Usage (servers already up — see scripts/lab-servers.sh):
//   LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 node docs/dev-notes/2026-09-07-per-ray-wound-list/parity.mjs
// Diff with  python3 docs/dev-notes/2026-09-07-per-ray-wound-list/diff.py
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5277);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9277);
const OUT = process.env.WOUNDLIST_PARITY_DIR ?? new URL('.', import.meta.url).pathname;
const W = Number(process.env.GAME_W ?? 1280);
const H = Number(process.env.GAME_H ?? 800);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (25 min)'); process.exit(3); }, 25 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

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
const evaluate = async (expression, timeoutMs = 300_000) => {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs,
  });
  if (r.result?.exceptionDetails) {
    fail(`page threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
  }
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const url = `http://localhost:${VITE}/sdf-game.html`;
console.log(`parity ${url}  (${W}x${H}) → ${OUT}`);

// --- boot -------------------------------------------------------------------
await send('Page.navigate', { url: 'about:blank' });
await sleep(200);
await send('Page.navigate', { url });
let backend = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
  if (backend) break;
}
if (!backend) { console.error('console tail:', consoleEvents.slice(-8)); fail('game page never booted'); }
if (backend !== 'webgpu') fail(`backend is ${backend}, not webgpu`);
// Settle: shader compile + boot-loop renders.
await sleep(3000);

// Ship-default baseline (the game page boots at these, pinned anyway so a
// stale captured page cannot contaminate the wound fold).
await evaluate(`(() => {
  __sdfGame.setWoundCull(true);
  __sdfGame.setWoundEarlyOut(true);
  __sdfGame.setWoundList(false);
  __sdfGame.setBleed(true);
  return 1;
})()`);

// --- carve wounds deterministically (firefight scenario) ---------------------
const bench = await evaluate(`__sdfGame.bench({ room: 3, mode: 'throughput', warmup: 20, walkFrames: 10, fireFrames: 90, gibFrames: 10, chunkFrames: 10 })`);
const woundCounts = (bench?.segments ?? []).map((s) => s?.census?.last?.wounds ?? 0);
const maxWounds = Math.max(0, ...woundCounts);
console.log(`bench census wounds: [${woundCounts.join(', ')}] (max ${maxWounds})`);
if (maxWounds < 8) fail(`only ${maxWounds} wounds carved — parity needs >= 8 (bench scenario under-shot)`);

// --- STATIC-IFY + pin clock so same-state captures compare exactly ---------
// freeze() pins pose/rig/wanderers. But blood droplets and the goo layer are
// SEPARATE sims that keep animating under freeze — the firefight leaves ~16
// wounds and a foreground spray of droplets/goo, and that animating foreground
// swamps a 1.5x parity gate (measured: the off-vs-off floor was 10.7% of
// pixels, all foreground weapon + droplets, not wound noise). setBleed(false)
// CLEARS droplets+splats; the goo passGate turns the additive quads off.
// pinClock pins performance.now, which the fire-flicker reads — without it
// same-state captures differ on ~19% of pixels (closeup-woundcull-capture).
// The carve is an SDF field change, so clearing particles does NOT touch the
// wounds the gate is about — the wound list only affects the body's march.
await evaluate(`(() => {
  __sdfGame.setBleed(false);
  __sdfGame.setGooPerf({ passGate: { density: false, blur: false, surface: false } });
  __sdfGame.freeze(true);
  __sdfGame.setLoopRunning(false);
  performance.now = () => 100000;
  return 1;
})()`);
// Re-render the cleared scene so the capture sees the static state.
await evaluate('__sdfGame.step(3, 1/60)');

async function capture(state, tag) {
  const wishOn = state === 'on';
  await evaluate(`__sdfGame.setWoundList(${wishOn})`);
  // readback proves the seam bound before we trust the frame
  const rb = await evaluate('__sdfGame.woundList');
  if (rb !== wishOn) fail(`woundList readback ${rb} != requested ${wishOn}`);
  // Step 3 frames at 1/60 so the uniform write lands in a presented frame.
  await evaluate('__sdfGame.step(3, 1/60)');
  await sleep(200);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (!s.result?.data) fail(`${tag}: screenshot returned no data`);
  const file = `${OUT}/${tag}.png`;
  writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  console.log(`  captured ${tag} -> ${file}`);
  return file;
}

await capture('off', 'off-a');
await capture('off', 'off-b');
await capture('on', 'on');
await capture('off', 'off-c');

writeFileSync(`${OUT}/parity.json`, JSON.stringify({
  url, backend, maxWounds, woundCounts,
  clockPinned: true, frozen: true,
  captures: { offA: `${OUT}/off-a.png`, offB: `${OUT}/off-b.png`, on: `${OUT}/on.png`, offC: `${OUT}/off-c.png` },
}, null, 2));
console.log(`manifest ${OUT}/parity.json`);
console.log('PARITY CAPTURES WRITTEN — now run: python3 docs/dev-notes/2026-09-07-per-ray-wound-list/diff.py');
process.exit(0);
