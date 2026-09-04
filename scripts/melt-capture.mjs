// MELT CAPTURE (2026-09-03): shoot the melt ramp at FIXED progress values
// through the lab renderer, measure the silhouette in every frame, and FAIL
// unless the end state is shorter, wider and lower than the start.
//
// This is gate B of the zombie-melt plan
// (docs/superpowers/plans/2026-09-03-zombie-melt.md, task 4). Gate A measures
// the same three ratios on the world-space AABB inside the test suite; this
// one measures them in PIXELS through the real renderer, because the previous
// attempt (c52b05b) shipped green tests and changed zero pixels. If the two
// gates disagree, that disagreement is itself the finding.
//
// A sibling of blob-turntable.mjs and a near-copy of its CDP prologue, which
// is deliberate: that file's comments record several hard-won facts (setCam
// is the only camera knob that survives the render loop; motion must be
// frozen or the pose drifts run to run; a flat PNG is worse than no PNG) and
// re-deriving them here would be how they get lost. Salvaged from the
// discarded c52b05b attempt — the capture harness was good; only its
// mechanism (a noise amplitude ramp) was wrong.
//
// DETERMINISM: progress is driven by __sdfLab.meltDirect(t), which HOLDS the
// value (the render loop's per-frame stepMelt is suspended), and the released
// bone chunks are advanced ONLY by __sdfLab.meltSettle(frames) at a fixed
// 1/60 (cosmetics are frozen, so the wall-clock rAF step is off) — see the
// MELT_RATE note at the sweep. What meltDirect does NOT pin is the verlet
// statue: with motion frozen it still settles to a slightly different arm
// pose each boot, which moves the t=0 bounds by ~±10 px and the ratios by a
// few hundredths run to run. The gate margins above absorb this; if a future
// run sits within a couple hundredths of a threshold, that is the noise,
// not the melt.
//
// SILHOUETTE: frames are decoded with the repo's own decodePng and bounded
// with the repo's subjectBounds. The KEYING is local and scene-specific, and
// here is why: maskFromRgba keys on distance from a flat backdrop colour,
// which is right for the reference plates it was built for and wrong for this
// scene — the lab floor carries a light halo around the subject (d≈90-100
// from the dark border backdrop, ~30k pixels, brighter than the threshold),
// and at the near-level gate camera that halo plus the grey reference cube
// forms a LARGER connected component than the zombie, so keepLargestComponent
// literally measures the cube. Verified 2026-09-03: at the salvage camera the
// t=0 "subject" bounds were the cube, not the body. What IS unique to the
// subject in this scene is redness — the zombie and its goo are the only
// pixels where R clearly exceeds max(G,B) (the floor is warm but only
// ~14 above neutral; shadowed flesh still clears 30). Thresholds of 20/30/40
// move the measured bounds by <4 px, which is what a stable keyer looks like.
// maskFromBody is equally NOT used: it auto-frames the raster to the body's
// own bounds, so a shrinking body keeps filling the frame and every ratio
// comes out ~1.0. This camera is FIXED, which is what makes the pixels
// comparable across progress values.
//
// Usage: npx tsx scripts/melt-capture.mjs <vitePort> <outDir> <cdpPort>
// Prefer scripts/melt-shot.sh, which starts and stops the server and browser.
// BLOB_PITCH / BLOB_DIST / BLOB_TARGET_Y override the camera framing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { decodePng } from '../src/lab/sdf-zombie/png-decode';
import { subjectBounds } from '../src/lab/sdf-zombie/silhouette';

const VITE = Number(process.argv[2] ?? 5233);
const OUT = process.argv[3] ?? '/tmp/melt-capture';
const CDP = Number(process.argv[4] ?? 9223);
// The melt is a zombie feature; the lab's default character is not assumed.
const CHARACTER = process.env.BLOB_CHARACTER ?? 'zombie';
// Fixed progress sweep — the spec's verification points. Never time-derived.
const PROGRESS = [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1.0];
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
// that window. That is the dangerous failure mode — not a crash, a quiet bias.
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

const url = `http://localhost:${VITE}/sdf-lab-webgpu.html?character=${encodeURIComponent(CHARACTER)}`;
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
  // Chunk physics too: the melt's released bone groups must move ONLY under
  // meltSettle's fixed-dt steps below, never under wall-clock rAF deltas —
  // that is what makes the photographed pile reproducible (melt task 6).
  window.__sdfLab.freezeCosmetics(true);
  window.__sdfLab.focusBody();
  return true;
})()`);
await sleep(4000);

const errors = await evaluate('JSON.stringify(window.__sdfLab.current.errors ?? [])');
if (errors && errors !== '[]') {
  fail(`lab reports validation errors: ${errors}`);
}

// meltDirect must EXIST and must hold — Task 3's wiring is the precondition.
if (!(await evaluate('typeof window.__sdfLab.meltDirect === "function"'))) {
  fail('__sdfLab.meltDirect missing — is the melt wired into the lab?');
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

// --- Silhouette metrics ----------------------------------------------------
// Redness keying — see the header for why maskFromRgba's backdrop distance
// cannot work in this scene. Per frame: bounding-box height/width in pixels,
// set-bit area, and the centroid expressed as ROWS ABOVE THE BOTTOM of the
// subject box (image rows grow downward, so y1 is the floor side — a puddle
// has its centroid close to zero above y1).
const RED_THRESHOLD = 30;
function silhouetteMetrics(buf) {
  const png = decodePng(buf);
  const { width: w, height: h, rgba } = png;
  const bits = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; i += 4, p++) {
    bits[p] = rgba[i] - Math.max(rgba[i + 1], rgba[i + 2]) > RED_THRESHOLD ? 1 : 0;
  }
  const b = subjectBounds({ w, h, bits });
  if (!b) return { empty: true };
  let area = 0, rowSum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bits[y * w + x]) { area++; rowSum += y; }
    }
  }
  return {
    width: b.x1 - b.x0 + 1,
    height: b.y1 - b.y0 + 1,
    area,
    centroid: +(b.y1 - rowSum / area).toFixed(1),
  };
}

// ——— THE SWEEP ————————————————————————————————————————————————————————————
// CAMERA: near floor level, on purpose. From the salvaged default (pitch
// 0.12, target 1.0) the camera looks DOWN at the puddle ~25-30 deg, and a
// flat disc's DEPTH then projects onto screen-Y: pixel "height" measured
// foreshortened width, not sag (0.59x when the geometry said 0.10x), and no
// melt tuning can fix that — the wider the puddle the taller it reads. A
// low, near-level camera is the framing where screen-Y tracks world-Y, which
// is the whole point of measuring a sink-and-spread gate in pixels. The plan's
// own example numbers (0.31x height at 1.72x width) are unreachable from a
// down-looking camera, so this is the intended framing, not gate-gaming: the
// frames still show everything, and are still read by eye below.
const YAW = Number(process.env.BLOB_YAW ?? 0.5); // gate default 0.5; override for close-ups
const PITCH = Number(process.env.BLOB_PITCH ?? 0.02);
const DIST = Number(process.env.BLOB_DIST ?? 3.6);
const TARGET_Y = Number(process.env.BLOB_TARGET_Y ?? 0.4);
const MIN_STD = 5;
const frames = [];

// DETERMINISTIC BONE SETTLE (melt task 6, step 0). meltDirect jumps melt
// PROGRESS instantly, but a released bone group is a rigid body that needs
// wall-clock time to FALL — and this sweep holds each progress value for two
// rAF ticks, so without an explicit settle every bone is photographed at the
// instant it was released, mid-air (Task 5's t=0.85 skull hovered above the
// puddle; its t=1.0 had no bones in it at all). meltSettle steps ONLY the
// melt's bone chunks, at a fixed 1/60, on top of the seeded spawn tumble —
// so the pile is reproducible frame for frame. The frame COUNT is the number
// the melt would actually have taken to reach t at MELT_TUNING.rate
// (0.625/s), handed over incrementally: a group released at t gets exactly
// the fall time a live melt would have given it by the time the sweep
// photographs a later t.
const MELT_RATE = 0.625; // melt.ts MELT_TUNING.rate — progress per second
// The melt freezes at t = 1 but the bones do not: the cage and skull release
// at t ≈ 0.8 with under half a second of ramp left, so the END frame needs a
// tail past 96 for the last groups to land — Gate A's bone-settle test
// asserts them AT REST, and this frame is what that looks like.
const SETTLE_TAIL = 90;
let settledFrames = 0;

await evaluate(`(() => { window.__sdfLab.setCam(${YAW}, ${PITCH}, ${DIST}, ${TARGET_Y}); return true; })()`);
await sleep(600);

for (const t of PROGRESS) {
  // meltDirect HOLDS the progress (lab-main.ts suspends stepMelt while held),
  // then two rAF ticks guarantee the melted prim rows have been uploaded and
  // marched before the screenshot.
  const held = await evaluate(`(() => {
    window.__sdfLab.meltDirect(${t});
    return new Promise((r) => requestAnimationFrame(() =>
      requestAnimationFrame(() => r(window.__sdfLab.meltState()))));
  })()`);
  if (!held || Math.abs(held.t - t) > 1e-6) {
    fail(`meltDirect(${t}) did not hold — lab reports meltState ${JSON.stringify(held)}`);
  }
  // Settle the released bone chunks to where a live melt would have them at
  // this progress (see the MELT_RATE note above). Incremental: chunks
  // released earlier in the sweep keep the fall time they already banked.
  const target = Math.round((t / MELT_RATE) * 60) + (t >= 1 ? SETTLE_TAIL : 0);
  if (target > settledFrames) {
    await evaluate(`(() => { window.__sdfLab.meltSettle(${target - settledFrames}); return true; })()`);
    settledFrames = target;
    // Let the settled chunk states reach the marched rows before shooting.
    await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.result.data, 'base64');
  const name = `melt-${String(Math.round(t * 100)).padStart(3, '0')}.png`;
  writeFileSync(`${OUT}/${name}`, buf);
  const stats = pngStats(buf);
  const m = silhouetteMetrics(buf);
  frames.push({ t, file: name, bytes: buf.length, std: stats.std ?? null, ...m });
  console.log(
    `t=${t.toFixed(2)}  ${name}  h=${m.height} w=${m.width} area=${m.area} ` +
    `centroid=${m.centroid}  (std=${stats.std ?? 'n/a'})`,
  );
}

const flat = frames.filter((f) => (f.std ?? 0) < MIN_STD);
if (flat.length) {
  console.error(`FLAT FRAMES (std < ${MIN_STD}): ${flat.map((f) => f.file).join(', ')}`);
  process.exit(1);
}
if (frames.some((f) => f.empty)) {
  console.error('EMPTY SILHOUETTE in: ' + frames.filter((f) => f.empty).map((f) => f.file).join(', '));
  process.exit(1);
}

writeFileSync(`${OUT}/metrics.json`, JSON.stringify({
  camera: { yaw: YAW, pitch: PITCH, dist: DIST, targetY: TARGET_Y },
  progress: PROGRESS,
  frames: Object.fromEntries(frames.map((f) => [f.t, f])),
}, null, 2));

// ——— THE GATE ——————————————————————————————————————————————————————————————
// The same three ratios as the in-suite gate A, measured through the
// renderer instead of the field. The width has a CEILING as well as a floor:
// the first melt captures passed every lower bound by turning the zombie
// into a flat disc several metres across, and a gate with no ceiling called
// that a success.
const first = frames[0], last = frames[frames.length - 1];
const ratioH = last.height / first.height;
const ratioW = last.width / first.width;
const ratioC = last.centroid / first.centroid;
const checks = [
  ['height', ratioH, '<= 0.40', ratioH <= 0.40],
  ['width', ratioW, '(1.50 - 3.00)', ratioW >= 1.50 && ratioW <= 3.00],
  ['centroid', ratioC, '<= 0.25', ratioC <= 0.25],
];
console.log('\nmelt gate (pixels):');
let failed = 0;
for (const [name, ratio, rule, ok] of checks) {
  console.log(`  ${name.padEnd(9)} ${ratio.toFixed(2)} x  ${rule}  ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) failed++;
}
console.log(`\nframes + metrics.json in ${OUT}`);
if (failed) process.exit(1);
process.exit(0);
