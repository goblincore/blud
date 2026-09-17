// FLAME CAPTURE (2026-09-17): the flame lab's fixed pose set, shot at two
// burn stages, so surface-fire techniques can be judged side by side and this
// plan's surface look becomes the baseline the three tongue plans compare
// against (docs/superpowers/plans/2026-09-17-flame-lab-foundation.md, task 14).
//
//   5 poses x 2 stages = 10 PNGs -> docs/dev-notes/2026-09-17-flame-lab/
//   stand-fresh.png   burn=1 char=0   (engulfed, unburnt skin)
//   stand-charred.png burn=1 char=0.6 (engulfed, mostly charred)
//
// POSES are driven through the PAGE'S OWN INPUT, not a console backdoor:
// CDP key events for ',' (walk) / '.' (run) / 'k' (collapse), real mouse
// press to stop the orbit spin, real wheel events for the distant framing.
// The page's keydown handlers are the contract a player uses; if they move,
// this script should break with them.
//
// HOLDING A STAGE: __flameLab.capture(burn, char) forceBurns both bodies, but
// the render loop's stepBurn keeps integrating afterwards — while alight,
// char grows at charRate (0.22/s), so a screenshot taken 2 s after the pin
// shows char 0.44, not 0. The same trap melt-capture documented for
// meltDirect (stepMelt kept advancing under it). So each pin is followed by
// __flameLab.setTuning({ charRate: 0 }) — charRate is TS-side only (the
// shader never sees it), so the VISUAL mapping of the pinned char value is
// untouched and only the creep stops. burn stays pinned at 1 on its own
// (clamp), and burnSec growing is fine — that is the noise phase, and live
// fire is supposed to move.
//
// SERVERS: same lifecycle as scripts/lab-servers.sh (which goo/melt source
// from their shell wrappers) — re-implemented here because the npm script is
// plain `node scripts/flame-capture.mjs`, with no wrapper to source it from.
// Same ports (LAB_VITE_PORT / LAB_CDP_PORT), same reuse rule (a listening
// server is left alone; a reused Chrome must prove it has WebGPU), same
// Chrome flags including the TMPDIR + crash-dumps redirect that sandboxes
// need (see lab-servers.sh's two-paths note). Only what WE started is
// stopped, and only our own Chrome profile is removed.
//
// Usage:
//   node scripts/flame-capture.mjs [outDir]
//   LAB_VITE_PORT=5244 LAB_CDP_PORT=9244 node scripts/flame-capture.mjs
// Exits 0 on success, 2 if it could not run (boot failure, page exception,
// no WebGPU backend, a flat capture).
import { mkdirSync, writeFileSync, openSync, rmSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const OUT = process.argv[2] ?? 'docs/dev-notes/2026-09-17-flame-lab';
const VITE = Number(process.env.LAB_VITE_PORT ?? 5233);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9223);
const LAB_TMP = process.env.LAB_TMP ?? '/tmp';
const LAB_CHROME = process.env.LAB_CHROME
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1380, H = 820;                       // melt-capture's viewport
const PAGE_PATH = '/sdf-flame-lab.html?seed=1';
// Fixed frame counts, not wall-clock sleeps — the rAF clock is what the
// render loop and the post chain's temporal smear live on.
const SETTLE_BOOT = 90;     // first-use pipeline compiles after boot
// Per-pose hold AFTER the key, in frames. Walk/run shoot MID-STRIDE: the
// wander boxes are ±0.35 m, so at 60+ frames (1 s) a walker has already
// arrived at its target and the gait reads idle. Collapse needs the full
// fall (the 60-frame first pass caught it complete; 90 is margin).
const SETTLE_POSE = { stand: 30, walk: 30, run: 30, collapsed: 90, distant: 15 };
const SETTLE_STAGE = 10;    // post-aa smear history flushed to <2e-6
const ZOOM_TICKS = 25;      // wheel ticks out: 3.2 + 25*0.2 -> clamped at 8
const MIN_LUMA_STD = 5;     // a flatter frame is a broken frame (melt's gate)

const POSES = ['stand', 'walk', 'run', 'collapsed', 'distant'];
// name -> the char value `__flameLab.capture(1, char)` pins. burn is 1 in
// every stage — the stages differ in how charred the body is UNDER the fire.
const STAGES = [
  { name: 'fresh', char: 0 },
  { name: 'charred', char: 0.6 },
];

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(2); };
setTimeout(() => { console.error('FAIL: watchdog (10 min)'); process.exit(2); }, 10 * 60_000).unref();
mkdirSync(OUT, { recursive: true });
mkdirSync(LAB_TMP, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Server lifecycle (lab-servers.sh, node port) ---------------------------

/** Anything ANSWERING counts as listening (curl-exit-7 rule), not just 200s. */
async function listening(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

const started = []; // { pid, kind, profileDir? } — only OUR processes.
let cleanupRan = false;

function killStarted() {
  for (const s of started) {
    try { process.kill(-s.pid, 'SIGTERM'); } catch { /* already gone */ }
    try { process.kill(s.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}

// 'exit' handlers must be synchronous: kill the groups, leave the profile
// (removing it before the port is confirmed closed is the one thing
// lab-servers.sh's cleanup explicitly refuses to do).
process.on('exit', killStarted);

async function stopStarted() {
  if (cleanupRan) return;
  cleanupRan = true;
  killStarted();
  for (const s of started) {
    const url = s.kind === 'vite'
      ? `http://localhost:${VITE}/`
      : `http://localhost:${CDP}/json/version`;
    // Being reaped is not the same as the port being free (lab-servers.sh's
    // note); poll until it answers no more, THEN remove our own profile.
    for (let i = 0; i < 25; i++) {
      if (!(await listening(url))) break;
      await sleep(200);
    }
    if (s.profileDir) {
      try { rmSync(s.profileDir, { recursive: true, force: true }); } catch { /* next run's problem */ }
    }
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { killStarted(); process.exit(2); });
}

async function serversUp() {
  if (!(await listening(`http://localhost:${VITE}/`))) {
    console.log(`flame-capture: starting vite on ${VITE}`);
    const log = openSync(`${LAB_TMP}/lab-vite-${VITE}.log`, 'a');
    const child = spawn('npx', ['vite', '--port', String(VITE), '--strictPort'], {
      detached: true, stdio: ['ignore', log, log],
    });
    child.unref();
    started.push({ pid: child.pid, kind: 'vite' });
    for (let i = 0; i < 40; i++) {
      if (await listening(`http://localhost:${VITE}/`)) break;
      await sleep(500);
    }
    if (!(await listening(`http://localhost:${VITE}${PAGE_PATH}`))) {
      fail(`vite never came up on ${VITE} (log: ${LAB_TMP}/lab-vite-${VITE}.log)`);
    }
  } else {
    // Port busy: prove it is OUR dev server before reusing it (the 404 trap
    // lab-servers.sh documents — any vite answers `/`).
    if (!(await listening(`http://localhost:${VITE}${PAGE_PATH}`))) {
      fail(`port ${VITE} is busy but does not serve ${PAGE_PATH} — stop it or set LAB_VITE_PORT`);
    }
    console.log(`flame-capture: reusing vite on ${VITE}`);
  }

  if (!(await listening(`http://localhost:${CDP}/json/version`))) {
    console.log(`flame-capture: starting chrome (headless) on debug port ${CDP}`);
    // TMPDIR + crash-dumps redirect: Chrome writes its ProcessSingleton socket
    // under TMPDIR and Crashpad under the GLOBAL profile regardless of
    // --user-data-dir; both defeat a workspace-write sandbox (lab-servers.sh).
    const tmpDir = `${LAB_TMP}/tmp-${CDP}`;
    mkdirSync(tmpDir, { recursive: true });
    const profileDir = `${LAB_TMP}/chrome-flame-${CDP}`;
    const log = openSync(`${LAB_TMP}/lab-chrome-${CDP}.log`, 'a');
    const child = spawn(LAB_CHROME, [
      '--headless=new',
      `--remote-debugging-port=${CDP}`,
      '--enable-unsafe-webgpu',
      `--user-data-dir=${profileDir}`,
      '--no-first-run', '--no-default-browser-check',
      '--disable-crash-reporter',
      `--crash-dumps-dir=${LAB_TMP}/crashpad-${CDP}`,
      `--window-size=${W},${H}`,
      'about:blank',
    ], {
      detached: true, stdio: ['ignore', log, log],
      env: { ...process.env, TMPDIR: tmpDir },
    });
    child.unref();
    started.push({ pid: child.pid, kind: 'chrome', profileDir });
    for (let i = 0; i < 40; i++) {
      if (await listening(`http://localhost:${CDP}/json/version`)) break;
      await sleep(500);
    }
    if (!(await listening(`http://localhost:${CDP}/json/version`))) {
      fail(`chrome never came up on ${CDP} (log: ${LAB_TMP}/lab-chrome-${CDP}.log)`);
    }
  } else {
    console.log(`flame-capture: reusing chrome on debug port ${CDP}`);
    // A reused Chrome must prove it has WebGPU (the black-canvas trap —
    // lab-servers.sh probes for the same reason).
    const probe = await fetch(`http://localhost:${CDP}/json/new?${encodeURIComponent(`http://localhost:${VITE}/`)}`, { method: 'PUT' })
      .then((r) => r.json()).catch(() => null);
    if (!probe) fail(`could not open a probe tab on reused chrome ${CDP}`);
    const verdict = await new Promise((resolve) => {
      const ws = new WebSocket(probe.webSocketDebuggerUrl);
      const done = (v) => { try { ws.close(); } catch { /* */ } resolve(v); };
      ws.onopen = () => {
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
          expression: `(async () => { if (!navigator.gpu) return 'no navigator.gpu'; return (await navigator.gpu.requestAdapter()) ? 'ok' : 'no adapter'; })()`,
          awaitPromise: true, returnByValue: true,
        } }));
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === 1) done(m.result?.result?.value ?? 'probe returned nothing');
      };
      ws.onerror = () => done('probe websocket error');
      setTimeout(() => done('probe timed out'), 15000);
    });
    await fetch(`http://localhost:${CDP}/json/close/${probe.id}`).catch(() => {});
    if (verdict !== 'ok') fail(`reused chrome on ${CDP} has no working WebGPU: ${verdict}`);
  }
}

// Servers BEFORE the CDP prologue: melt-capture's prologue could assume its
// shell wrapper had already started them; this script owns the lifecycle.
await serversUp();

// --- CDP client (melt-capture's prologue) -----------------------------------

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' }); } catch { /* gone */ }
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });

let seq = 0;
const pending = new Map();
const consoleErrors = [];   // console.error texts (the shutter's onError lands here)
const pageExceptions = [];  // uncaught page exceptions
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    pageExceptions.push((m.params.exceptionDetails?.exception?.description
      ?? m.params.exceptionDetails?.text ?? 'page exception').slice(0, 300));
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

// Page's own input, through real browser events (not synthetic DOM events —
// those have no active pointerId and the page's setPointerCapture would throw).
const keyTap = async (key, code, vk, text) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};
const mouseClick = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const wheelAt = async (x, y, deltaY) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
};
const frames = async (n) => {
  await evaluate(`new Promise((r) => { let n = 0; const t = () => (++n >= ${n} ? r(n) : requestAnimationFrame(t)); requestAnimationFrame(t); })`);
};

// A flat capture (stale viewport, GPU device lost) LOOKS like a normal file
// on disk — decode and refuse (melt's pngStats, luma over a sparse grid).
function pngStats(png) {
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off); const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    if (type === 'IEND') break;
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) return { unsupported: true };
  const chans = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * chans;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= chans ? cur[i - chans] : 0;
      const b = prev[i];
      const c = i >= chans ? prev[i - chans] : 0;
      let v = line[i];
      if (f === 1) v = (v + a) & 0xff;
      else if (f === 2) v = (v + b) & 0xff;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[i] = v;
    }
    prev = cur;
  }
  let n = 0, s = 0, s2 = 0;
  const stepX = Math.max(1, Math.floor(w / 256)), stepY = Math.max(1, Math.floor(h / 256));
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      const i = y * stride + x * chans;
      const l = 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2];
      n++; s += l; s2 += l * l;
    }
  }
  const mean = s / n;
  return { w, h, mean: +mean.toFixed(2), std: +Math.sqrt(s2 / n - mean * mean).toFixed(2) };
}

// --- The sweep ---------------------------------------------------------------

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// FRESH PAGE PER POSE: the page has no "stop wandering" key (',' and '.' only
// set wanderOn), and char is MONOTONIC within a page — a new load resets both,
// so every pose starts from the same clean idle state.
async function freshPage() {
  await send('Page.navigate', { url: `http://localhost:${VITE}${PAGE_PATH}` });
  let booted = false;
  for (let i = 0; i < 160; i++) {
    await sleep(500);
    try {
      booted = await evaluate('typeof window.__flameLab === "object" && window.__flameLab !== null');
    } catch { /* page still booting */ }
    if (booted) break;
  }
  if (!booted) fail('__flameLab never appeared — the flame lab never booted');
  await frames(SETTLE_BOOT);
  // The backend line lives in the status box ("backend: webgpu", green) — the
  // single most important fact about these captures (lab-main's own note).
  backend = await evaluate(`(() => {
    // Anchor on the known backends: textContent runs the status box's divs
    // together ("backend: webgpubodies: 2"), so a bare \\w+ over-matches.
    const m = document.body.textContent.match(/backend: (webgpu|webgl\\d*)/);
    return m ? m[1] : 'unknown';
  })()`);
  // Stop the orbit spin so every pose frames from the same yaw (0.35), then
  // hide the panels: 'h' is the page's own hide-everything key (debug panel,
  // flame panel, toggle). #controls is help text; the Blood reference strip
  // (#reference) STAYS — side-by-side with those tiles is the point.
  await mouseClick(Math.floor(W / 2), Math.floor(H / 2));
  await keyTap('h', 'KeyH', 72, 'h');
  await evaluate(`(() => {
    // #controls is help text and #panel-toggle is the reveal button — neither
    // belongs in a look capture (melt hides the same pair). The Blood
    // reference strip (#reference) STAYS: side-by-side with those tiles is
    // the point of a fixed pose set.
    for (const sel of ['#controls', '#panel-toggle']) {
      const el = document.querySelector(sel);
      if (el) el.style.display = 'none';
    }
    return true;
  })()`);
  await frames(5);
}

let backend = 'unknown';
const shots = [];

for (const pose of POSES) {
  await freshPage();
  if (backend !== 'webgpu') {
    console.error(`flame-capture: backend is "${backend}" — not the WebGPU path; refusing to call these flame-lab captures`);
    await stopStarted();
    process.exit(2);
  }

  // Drive the pose through the page's own keys.
  if (pose === 'walk') await keyTap(',', 'Comma', 188, ',');
  if (pose === 'run') await keyTap('.', 'Period', 190, '.');
  if (pose === 'collapsed') await keyTap('k', 'KeyK', 75, 'k');
  if (pose === 'distant') {
    for (let i = 0; i < ZOOM_TICKS; i++) await wheelAt(Math.floor(W / 2), Math.floor(H / 2), 120);
  }
  await frames(SETTLE_POSE[pose]);

  for (const stage of STAGES) {
    // Pin the stage, then stop the char creep (see HOLDING A STAGE above).
    await evaluate(`(() => {
      window.__flameLab.capture(1, ${stage.char});
      window.__flameLab.setTuning({ charRate: 0 });
      return window.__flameLab.burns();
    })()`);
    await frames(SETTLE_STAGE);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(shot.result.data, 'base64');
    const name = `${pose}-${stage.name}.png`;
    writeFileSync(`${OUT}/${name}`, buf);
    const stats = pngStats(buf);
    if (stats.unsupported) fail(`${name}: not a decodable 8-bit RGB(A) PNG`);
    if ((stats.std ?? 0) < MIN_LUMA_STD) fail(`${name}: flat frame (luma std ${stats.std} < ${MIN_LUMA_STD}) — nothing rendered`);
    shots.push({ pose, stage: stage.name, char: stage.char, file: name, std: stats.std });
    console.log(`${name}  (char=${stage.char}, luma std=${stats.std})`);
  }
}

// The shutter's own error callback must have stayed silent (task 13's check,
// enforced for every capture run — a blurred capture is not what shipped).
const shutterErrors = consoleErrors.filter((t) => t.includes('[shutter-game]'));
if (shutterErrors.length > 0) fail(`shutter errored mid-run: ${shutterErrors[0]}`);
// Exceptions in page listeners surface here, not through evaluate. The orbit
// stop-click can report a benign setPointerCapture NotFoundError under CDP's
// synthetic pointer — ignore exactly that, fail on anything else.
const realExceptions = pageExceptions.filter((t) => !/NotFoundError|setPointerCapture/.test(t));
if (realExceptions.length > 0) fail(`page threw: ${realExceptions[0]}`);

writeFileSync(`${OUT}/captures.json`, JSON.stringify({
  url: PAGE_PATH, backend, viewport: { width: W, height: H },
  poses: POSES, stages: STAGES, shots,
}, null, 2));

await stopStarted();
console.log(`\n${shots.length} captures + captures.json in ${OUT}`);
process.exit(0);
