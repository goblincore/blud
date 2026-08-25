// Headless driver for sdf-bench.html — the perf chain's measurement
// surface. Same no-deps CDP pattern as scripts/blob-turntable.mjs (Node 22
// native WebSocket against Chrome --remote-debugging-port): open a tab,
// pin the viewport to the owner's window, navigate, poll window.__bench,
// print the JSON. NEVER quotes a run with hidden frames (X1.8: a hidden
// page measures ~0.065 ms of nothing).
//
// Usage: node scripts/sdf-bench.mjs <vitePort> <cdpPort> <scene> [scale] [seconds] [debug]
// Prefer scripts/sdf-bench.sh, which starts/stops the servers for you:
//   LAB_VITE_PORT=5271 LAB_CDP_PORT=9271 npm run bench:sdf -- A 0.7 15
//
// Viewport defaults to the owner's window (1536x1704 CSS at dsf 1 — the
// renderer caps its internal buffer at 960x540 itself, so the CSS size is
// what matters). Override with BENCH_W / BENCH_H.
//
// [debug] = steps|prims: instead of the timed run, screenshots ONE yaw-0
// heatmap frame to BENCH_OUT (default /tmp/sdf-bench/<scene>-<mode>.png),
// after the page has rendered at least 30 frames. The screenshot is the
// ONLY output of a debug run.
import { execFileSync } from 'node:child_process';

const VITE = Number(process.argv[2] ?? 5233);
const CDP = Number(process.argv[3] ?? 9223);
const SCENE = (process.argv[4] ?? 'A').toUpperCase();
const SCALE = Number(process.argv[5] ?? 0.7);
const SECONDS = Number(process.argv[6] ?? 15);
const DEBUG = (process.argv[7] ?? '').toLowerCase();
const W = Number(process.env.BENCH_W ?? 1536);
const H = Number(process.env.BENCH_H ?? 1704);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
if (DEBUG && DEBUG !== 'steps' && DEBUG !== 'prims') {
  fail(`debug mode must be steps|prims, got "${DEBUG}"`);
}

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
// ---------------------------------------------------------------------------
// TAB CLEANUP. `/json/new` above spawns a renderer process (~250 MB) that
// OUTLIVES this script unless it is closed again. Nothing here used to close
// it, so every invocation leaked one — and these scripts are run in loops. A
// 2026-08-25 session accumulated ~35 stale tabs across sweeps and benches,
// drove host load to 27, and silently corrupted every timing number taken in
// that window: the runs still "succeeded", they were just measuring a machine
// fighting itself. That is the dangerous failure mode — not a crash, a quiet
// bias.
//
// `process.on('exit')` fires on EVERY exit path (success, fail(), an uncaught
// throw), which is why the cleanup lives here rather than at the end of the
// happy path. Exit handlers must be synchronous, so this shells out to curl
// instead of using fetch — a dev-only script may be inelegant; it may not
// leak. Failure is ignored: if the browser is already gone there is nothing
// to close.
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try {
    execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' });
  } catch { /* browser already gone, or curl missing — nothing to clean */ }
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });

let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({
      type: m.params.type,
      text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
    });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({
      type: 'exception',
      text: JSON.stringify(m.params.exceptionDetails).slice(0, 500),
    });
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
// The stale-viewport trap (blob-turntable): fix the viewport BEFORE
// navigating, or the first renders size themselves to whatever the tab's
// viewport happened to be and you bench a letterbox.
await send('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: 1, mobile: false,
});

const qs = `scene=${encodeURIComponent(SCENE)}&scale=${SCALE}&seconds=${SECONDS}`
  + (DEBUG ? `&debug=${DEBUG}` : '')
  // BENCH_QS appends arbitrary page flags (e.g. BENCH_QS=tiles=1) so an A/B
  // of a page-level feature needs no code edit between legs.
  + (process.env.BENCH_QS ? `&${process.env.BENCH_QS}` : '');
const url = `http://localhost:${VITE}/sdf-bench.html?${qs}`;
console.log(`bench ${url}`);
await send('Page.navigate', { url });

// Boot can take 30 s cold (TSL node-graph build) — poll generously.
let benchApi = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  benchApi = await evaluate('typeof window.__sdfBench === "object" ? window.__sdfBench : null');
  if (benchApi) break;
}
if (!benchApi) {
  console.error('console tail:', consoleEvents.slice(-8));
  fail(`bench page never booted (__sdfBench absent) — is a stale server already on port ${VITE}?`);
}
if (benchApi.backend !== 'webgpu') {
  fail(`backend is ${benchApi.backend}, not webgpu — the numbers would be meaningless`);
}
console.log(`backend: ${benchApi.backend}`);

if (DEBUG) {
  // Heatmap capture: wait for the page to have rendered real frames, let
  // the present settle, screenshot the yaw-0 frame.
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    if (await evaluate('window.__sdfBench.ready')) break;
  }
  if (!(await evaluate('window.__sdfBench.ready'))) {
    fail('page never reached __sdfBench.ready (30 frames)');
  }
  await sleep(1500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.result.data, 'base64');
  const out = process.env.BENCH_OUT
    ?? `/tmp/sdf-bench/${SCENE}-${DEBUG}.png`;
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(out.slice(0, out.lastIndexOf('/')), { recursive: true });
  writeFileSync(out, buf);
  console.log(`heatmap: ${out} (${buf.length} bytes)`);
} else {
  // Timed run: poll __bench.done. Budget = boot + orbit + slack.
  let result = null;
  for (let i = 0; i < Math.ceil((SECONDS * 1000 + 120_000) / 500); i++) {
    await sleep(500);
    result = await evaluate('window.__bench ?? null');
    if (result?.done) break;
  }
  if (!result?.done) {
    console.error('console tail:', consoleEvents.slice(-8));
    fail('bench never completed (__bench.done never set)');
  }
  if (result.error) fail(`bench page reported an error: ${result.error}`);
  if (result.hiddenFrames > 0) {
    fail(`${result.hiddenFrames} hidden frame(s) — the run is INVALID (X1.8); re-run in the foreground`);
  }
  console.log(JSON.stringify(result));
}

const badConsole = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (badConsole.length > 0) {
  for (const e of badConsole.slice(0, 10)) console.error('  |', e.type, e.text.slice(0, 300));
  fail(`${badConsole.length} console error/exception event(s) during the run`);
}

ws.close();
process.exit(0);
