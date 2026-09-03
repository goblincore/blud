// MELT CAPTURE (experiment, 2026-09-03): hold the camera still and step the
// melt, so the effect can be judged frame by frame instead of by prose.
//
// A sibling of blob-turntable.mjs and a near-copy of its CDP prologue, which
// is deliberate: that file's comments record several hard-won facts (setCam
// is the only camera knob that survives the render loop; motion must be
// frozen or the pose drifts run to run; a flat PNG is worse than no PNG) and
// re-deriving them here would be how they get lost.
//
// Usage: node scripts/melt-capture.mjs <vitePort> <outDir> <frames> <cdpPort>
//   MELT_PEAK=0.03 MELT_FREQ=3.0 MELT_COLLAPSE=1
//
// Original header follows.
//
// Deterministic N-angle capture of the lab body, for judging a .blob
// character by eye. Same no-deps CDP pattern as scripts/verify-orient.mjs /
// scripts/verify-clip-smoke.mjs: Node 22 native WebSocket against Chrome
// --remote-debugging-port=9223.
//
// The plan this script was drafted from set `camera.position` directly on
// the assumption that would stick. It does not: the lab's render loop
// recomputes `camera.position` from `camYaw`/`camPitch`/`camDist` every
// frame (see lab-main.ts, the `if (autoSpin) camYaw += dt * 0.35 ... else
// { camera.position.set(...) }` block), so a raw position.set() gets
// stomped on the very next rAF tick and the capture would just show
// whatever the orbit/auto-spin state already was. `__sdfLab.setCam(yaw,
// pitch, dist)` is the actual deterministic knob — it writes the same
// state variables the loop reads, and it also flips `autoSpin` off so nothing
// drifts between frames.
//
// The plan also never touched motion/wander. Both default ON, and the
// jiggle/walk phase is driven by wall-clock elapsed time since boot, which
// is NOT the same run to run (network + WebGPU pipeline-compile jitter).
// That would silently break the "same document -> same images" requirement:
// two runs at the identical camera angle could show the body at a different
// point in its stride. This script freezes the rig into its authored rest
// pose (`setMotionEnabled(false)`, `setWander(false)`) before shooting, then
// gives the (still wall-clock-driven, per lab-main.ts's "statue mode ...
// verbatim" comment) verlet settle several seconds of real time before the
// first capture — measured to cut cross-run pixel drift roughly 15x (from
// ~5.7% of pixels differing to ~0.3-0.4%, see below).
//
// KNOWN LIMIT: frames are reproducible in content (same pose, same std/mean
// luma to 2 decimal places, <0.4% of pixels differ) but NOT byte-identical
// across runs. Root-caused by hand: even with motion/wander frozen and
// post-fx (`setPostEnabled(false)`) disabled entirely, two runs of the same
// single frame still differed by ~0.3% of pixels (mostly high-contrast,
// silhouette-edge pixels — consistent with the verlet rig settling to a
// hair different equilibrium depending on the exact sequence of real frame
// deltas it integrated over before motion was frozen). There is no exposed
// knob to pin simulation time or single-step the renderer, and lab-main.ts
// is out of scope for this task, so this is the ceiling reachable from
// outside the lab. Treat frames as reproducible for review purposes, not as
// a byte-diffable golden-image gate.
//
// Usage: node scripts/blob-turntable.mjs <vitePort> <outDir> [frames] [cdpPort]
// Prefer scripts/blob-shot.sh, which starts and stops the server and browser for you.
//
// Which character gets shot comes from the BLOB_CHARACTER env var, which is
// passed straight through as the lab's `?character=` query parameter (see the
// CHARACTERS registry in lab-main.ts). Unset means the lab's own default. It
// is an env var rather than a positional argument so the four positions above
// — which the authoring skill documents verbatim — keep their meaning.
// BLOB_DIST, BLOB_PITCH and BLOB_TARGET_Y override the camera framing the same way.
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const VITE = Number(process.argv[2] ?? 5233);
const OUT = process.argv[3] ?? '/tmp/turntable';
const FRAMES = Number(process.argv[4] ?? 8);
const CDP = Number(process.argv[5] ?? 9223);
const CHARACTER = process.env.BLOB_CHARACTER ?? '';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

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
await new Promise((ok, err) => {
  ws.onopen = ok;
  ws.onerror = err;
});

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

// The stale-viewport trap: after a reload the render target can be sized to
// whatever the tab's viewport happened to be, which produces a blank canvas
// that looks exactly like a broken build. Fix the viewport BEFORE navigating
// rather than diagnosing a blank capture after the fact.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1380,
  height: 820,
  deviceScaleFactor: 1,
  mobile: false,
});

const url = `http://localhost:${VITE}/sdf-lab-webgpu.html`
  + (CHARACTER ? `?character=${encodeURIComponent(CHARACTER)}` : '');
console.log(`shooting ${url}`);
await send('Page.navigate', { url });

// WebGPU pipeline compilation is slow on first load — poll generously rather
// than sleeping a fixed guess.
let booted = false;
for (let i = 0; i < 160; i++) {
  await sleep(500);
  booted = await evaluate('typeof window.__sdfLab === "object" && !!window.__sdfLab.camera');
  if (booted) break;
}
if (!booted) {
  console.error('console tail:', consoleEvents.slice(-8));
  fail(`lab never booted (__sdfLab.camera absent) — is a stale server already on port ${VITE}?`);
}
// Confirm this is really the server we asked for and not some other
// worktree's dev server already squatting the port.
const backend = await evaluate('window.__sdfLab.backend');
console.log('backend:', backend);
await sleep(1500); // let the first frames settle after boot
// BLOB_PROBE=<js expression> prints its JSON value after boot — for checking
// that a .blob value actually landed in a uniform, without opening the lab.
if (process.env.BLOB_PROBE) {
  console.log('probe:', JSON.stringify(await evaluate(process.env.BLOB_PROBE)));
}

// Hide the debug panel so it does not occlude the body.
await evaluate(`(() => {
  const panel = document.querySelector('#panel');
  const toggle = document.querySelector('#panel-toggle');
  const controls = document.querySelector('#controls');
  if (panel) panel.hidden = true;
  if (toggle) toggle.style.display = 'none';
  if (controls) controls.style.display = 'none';
  return true;
})()`);

// Freeze the rig into its authored rest pose so the same document produces
// the same silhouette on every run, independent of wall-clock timing.
await evaluate(`(() => {
  window.__sdfLab.setMotionEnabled(false);
  window.__sdfLab.setWander(false);
  // Dynamic resolution would change the SDF pixel count between frames and
  // runs; frames are judged by eye, so pin it.
  if (window.__sdfLab.setAdaptive) window.__sdfLab.setAdaptive(false);
  window.__sdfLab.focusBody();
  return true;
})()`);
await sleep(4000);

const errors = await evaluate('JSON.stringify(window.__sdfLab.current.errors ?? [])');
if (errors && errors !== '[]') {
  fail(`lab reports validation errors: ${errors}`);
}

// --- No-deps PNG luma-variance check --------------------------------------
// A blank/flat capture (stale viewport, unrendered canvas, GPU device lost)
// is worse than no capture at all because it LOOKS like a normal file on
// disk. Decode each PNG for real and refuse to call it a pass if the frame
// is uniform. Adapted from the same decoder scripts/verify-clip-smoke.mjs
// uses (Node's built-in zlib, no image library).
function pngStats(png) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!png.subarray(0, 8).equals(sig)) return { unsupported: 'not a PNG' };
  let off = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    return { w, h, unsupported: `depth${bitDepth}/color${colorType}` };
  }
  const chans = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * chans;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= chans ? cur[i - chans] : 0;
      const bb = prev[i];
      const c = i >= chans ? prev[i - chans] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + bb) & 0xff;
      else if (filter === 3) v = (v + ((a + bb) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c)) & 0xff;
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

// ——— MELT CAPTURE ————————————————————————————————————————————————————————
// One camera angle, N frames, the melt stepped between them. The amplitude
// is driven DIRECTLY rather than through the ramp so each frame is a known
// value: a wall-clock ramp would make the series depend on how fast this
// machine renders, which is exactly the reproducibility trap the turntable's
// header warns about.
const PITCH = Number(process.env.BLOB_PITCH ?? 0.12);
const DIST = Number(process.env.BLOB_DIST ?? 2.4);
const PEAK = Number(process.env.MELT_PEAK ?? 0.030);
const FREQ = Number(process.env.MELT_FREQ ?? 3.0);
const COLLAPSE = process.env.MELT_COLLAPSE === '1';
const MIN_STD = 5;
const frameStats = [];

await evaluate(`(() => { window.__sdfLab.setCam(0.5, ${PITCH}, ${DIST}, 1.0); return true; })()`);
if (COLLAPSE) {
  // The collapse needs the motion pipeline the turntable prologue just froze.
  await evaluate(`(() => { window.__sdfLab.setMotionEnabled(true); return true; })()`);
  await sleep(1500);
}
await sleep(600);

for (let i = 0; i < FRAMES; i++) {
  const amp = (i / Math.max(1, FRAMES - 1)) * PEAK;
  await evaluate(`(() => {
    window.__sdfLab.setMeltTuning({ peak: ${PEAK}, freq: ${FREQ}, collapse: ${COLLAPSE} });
    window.__sdfLab.meltDirect(${amp});
    return true;
  })()`);
  await sleep(450);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.result.data, 'base64');
  const file = `${OUT}/melt-${String(i).padStart(2, '0')}.png`;
  writeFileSync(file, buf);
  const stats = pngStats(buf);
  frameStats.push({ i, amp, file, bytes: buf.length, stats });
  console.log(`wrote ${file}  amp=${amp.toFixed(4)}  bytes=${buf.length}  std=${stats.std ?? 'n/a'}`);
}

const flat = frameStats.filter((f) => (f.stats?.std ?? 0) < MIN_STD);
if (flat.length) {
  console.error(`FLAT FRAMES (std < ${MIN_STD}): ${flat.map((f) => f.file).join(', ')}`);
  process.exit(1);
}
console.log(`\n${FRAMES} melt frames in ${OUT}`);
process.exit(0);
