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
// BLOB_POSE=walk|run|hip (and BLOB_POSE_FRAMES, default 90) shoot a held
// motion pose instead of the rest pose — see the pose block below.
import { mkdirSync, writeFileSync } from 'node:fs';
import { decodePng } from './lib/demo-presented.mjs';
import { writePng } from './lib/png-write.mjs';
import { inflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const VITE = Number(process.argv[2] ?? 5233);
// BLOB_OUT lets one run write beside another, which is what an A/B needs: a
// wounded capture is only meaningful measured against a clean one.
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

// Pose. Default: freeze the rig into its authored rest pose so the same
// document produces the same silhouette on every run, independent of
// wall-clock timing. BLOB_POSE=walk|run|hip steps the motion deterministically
// on a treadmill instead (lab-main's holdPose: fixed 1/60 steps, wander off,
// then motion frozen) so a capture shows a mid-stride or a carry from every
// yaw, and the same document still yields the same frames.
const POSE = process.env.BLOB_POSE ?? 'rest';
const POSE_FRAMES = Number(process.env.BLOB_POSE_FRAMES ?? 90);
const poseResult = await evaluate(`(() => {
  // Dynamic resolution would change the SDF pixel count between frames and
  // runs; frames are judged by eye, so pin it.
  if (window.__sdfLab.setAdaptive) window.__sdfLab.setAdaptive(false);
  window.__sdfLab.focusBody();
  if (${JSON.stringify(POSE)} === 'rest' || !window.__sdfLab.holdPose) {
    window.__sdfLab.setMotionEnabled(false);
    window.__sdfLab.setWander(false);
    return 'rest';
  }
  return JSON.stringify(window.__sdfLab.holdPose(${JSON.stringify(POSE)}, ${POSE_FRAMES}));
})()`);
console.log('pose:', poseResult);
await sleep(4000);
// A held WALK/RUN pose steps the treadmill from the origin, and the body's
// torso is no longer where the pre-pose focusBody() aimed: the ogre's stomp
// left it ~1 m off the orbit centre, so every yaw framed a different crop of
// it. Re-aim once the posed rig has rendered (lastPosed updates per frame).
if (POSE !== 'rest') {
  await evaluate('window.__sdfLab.focusBody()');
  await sleep(500);
}

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

// Fixed pitch/distance matching __sdfLab.focusBody()'s own framing — only
// yaw varies frame to frame, orbiting the already-centred camTarget.
// DIST is overridable because the default frames the ~1.8 m zombie: a 1.30 m
// goblin shot at 2.4 m is a small figure in a large empty room, which is
// exactly the wrong image for judging whether two limbs read as separate.
const PITCH = Number(process.env.BLOB_PITCH ?? 0.12);
const DIST = Number(process.env.BLOB_DIST ?? 2.4);
// BLOB_TARGET_Y orbits at a given height (e.g. the head's, for a face close-up).
const TARGET_Y = process.env.BLOB_TARGET_Y === undefined ? 'undefined' : Number(process.env.BLOB_TARGET_Y);
const MIN_STD = 5; // "a rendered scene, not a flat surface" (verify-clip-smoke.mjs precedent)
const frameStats = [];

// WIND SWEEP (shell cloth sway). BLOB_WIND=x,y,z holds the camera STILL at
// yaw 0 and steps the wind offset instead, so consecutive frames differ only
// by where the fold lattice has drifted. That is the only way to see sway in
// a still: the turntable orbits the camera, and a breeze is not a camera move.
// Each frame advances by the vector, so frame i sits at i * BLOB_WIND metres.
const WIND = (process.env.BLOB_WIND ?? '').split(',').map(Number).filter(n => Number.isFinite(n));
const WIND_SWEEP = WIND.length === 3 && WIND.some(n => n !== 0);
/**
 * The body's silhouette, from the difference between the normal frame and the
 * same frame with the body hidden. White where the body is, transparent where the
 * background is, with a small tolerance so capture noise does not speckle it.
 *
 * Returns null when the two captures are the same size (they always are) but the
 * difference is empty, which would mean the hide did nothing — a silent failure
 * that would otherwise produce an all-background mask and a sheet of nothing.
 */
function maskFrom(withBody, without) {
  const a = decodePng(withBody);
  const b = decodePng(without);
  if (a.w !== b.w || a.h !== b.h) throw new Error('mask: frame sizes differ');
  const out = new Uint8Array(a.w * a.h * 4);
  let hits = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    const d = Math.abs(a.data[i * a.ch] - b.data[i * b.ch])
      + Math.abs(a.data[i * a.ch + 1] - b.data[i * b.ch + 1])
      + Math.abs(a.data[i * a.ch + 2] - b.data[i * b.ch + 2]);
    const on = d > 12 ? 255 : 0;
    if (on) hits++;
    out[i * 4] = 255; out[i * 4 + 1] = 255; out[i * 4 + 2] = 255; out[i * 4 + 3] = on;
  }
  console.log(`  mask: ${hits} body px (${(100 * hits / (a.w * a.h)).toFixed(1)}% of frame)`);
  return hits > 0 ? writePng(a.w, a.h, out) : null;
}

// BODY-FRAME SWEEP. BLOB_ANCHOR=<degrees> holds the camera AND the body
// still and turns only the anchor, frame by frame. If the folds are anchored
// to the body they rotate on the cloth with it; if they are world-anchored
// the frames are identical. That is the only still-image way to tell the two
// apart, because a turntable orbits the camera and a statue never yaws.
const ANCHOR_DEG = Number(process.env.BLOB_ANCHOR ?? 0);
const ANCHOR_SWEEP = Number.isFinite(ANCHOR_DEG) && ANCHOR_DEG !== 0;

// PRE-WOUNDING, for gore baked into the sprites. The owner: "it would be cool to
// like precapture like blood and wounds like you could make the zombie wounded and
// then capture sprites from it that way would be cheap way to get some gore
// effects baked in". Cheap is right: the wound stack already exists and the lab
// already responds to real clicks (see sdf-lab-stagger-seq.mjs, which shift-clicks
// the hero to blast it), so this dispatches REAL shots at the body before the
// sweep and every yaw afterwards carries the same craters.
//
// Wounds are applied ONCE, before the sweep, deliberately: eight views of the SAME
// wounded body are coherent, where a different wound set per angle would make one
// "piece" a different piece in every frame.
//
// ⚠ NOT WORKING YET, and the measurement says so rather than the code: with the aim
// point verified from the mask (the body's bbox centre is 690,424 and the clicks
// land inside it) and the loop confirmed running, six shots move the body's pixel
// count at yaw 0 from 38183 (clean) to 38340 — +0.4%, i.e. no craters appeared.
// Two traps were found on the way and are fixed here: the aim must come from the
// MASK (a guessed screen point misses a body whose bbox is 186x392 in a 1380x820
// frame), and pausing the loop before/after the shots freezes the render so every
// later setCam captures a byte-identical stale frame (measured: frames 00 and 01
// both 54925 bytes, body-hidden difference 0 px). What is still unknown is whether
// this camera mode accepts click-shoot at all — lab-main says the click-shoot
// pipeline "stays god-only" — so the next step is to find the input path that
// actually wounds (the seam `woundRing.stampBundle` is reachable through
// `gorePort.stampWounds`, which would be a direct seam rather than a synthetic
// click).
const WOUNDS = Number(process.env.BLOB_WOUNDS ?? 0);
if (WOUNDS > 0) {
  console.log(`wounding the body with ${WOUNDS} wound(s) before the sweep`);
  // THE LOOP MUST BE RUNNING. First attempt measured NO effect (body pixels
  // 20977 vs 20863 clean) with the aim point verified correct — the mask puts the
  // body's centre at 690,424 and the clicks landed inside that box. The working
  // example, sdf-lab-stagger-seq.mjs, calls `pauseLoop(false)` before its click;
  // this rig freezes the loop for a reproducible pose, and a frozen lab never
  // processes the pending shot.
  // A DIRECT SEAM, not a synthetic click: `__sdfLab.wound(n, seed, type)` is
  // deterministic, aim-free, and returns how many craters landed — which is what
  // lets a rig ASSERT the wounding happened instead of inferring it from pixels.
  // The click path measured 0.4% and could never have worked here (lab-main: the
  // click-shoot pipeline "stays god-only", and this rig freezes the rig).
  const seed = Number(process.env.BLOB_WOUND_SEED ?? 7);
  const type = process.env.BLOB_WOUND_TYPE ?? 'pellet';
  // BLOB_WOUND_CALIBRE=small: pistol/SMG bullet holes on cloth (clothifyWound).
  const calibre = process.env.BLOB_WOUND_CALIBRE ?? 'heavy';
  const stamped = await evaluate(`__sdfLab.wound(${WOUNDS}, ${seed}, '${type}', '${calibre}')`);
  console.log(`  ${stamped} of ${WOUNDS} wound(s) landed; body now carries `
    + `${await evaluate('__sdfLab.woundCount()')}`);
  const woundedPx = await evaluate(`(() => {
    const w = window.__sdfLab.heroPosed ? 1 : 0; return w;
  })()`);
  void woundedPx;
  // Let the flesh settle and the blood sim spread, then freeze again for the
  // sweep so the pose is reproducible.
  await sleep(1200);
  // ...and DO NOT re-pause. MEASURED: pauseLoop(true) here freezes the render, so
  // every subsequent setCam captures the SAME stale frame (frames 00 and 01 came
  // back byte-identical, 54925 bytes, and the body-hidden difference found 0 px).
  // The sweep needs the loop running.
}

for (let i = 0; i < FRAMES; i++) {
  const yaw = (WIND_SWEEP || ANCHOR_SWEEP) ? 0 : (i / FRAMES) * Math.PI * 2;
  await evaluate(`(() => { window.__sdfLab.setCam(${yaw}, ${PITCH}, ${DIST}, ${TARGET_Y}); return true; })()`);
  if (WIND_SWEEP) {
    await evaluate(`(() => { window.__sdfLab.setWindOffset(${WIND[0] * i}, ${WIND[1] * i}, ${WIND[2] * i}); return true; })()`);
  }
  if (ANCHOR_SWEEP) {
    const rad = (ANCHOR_DEG * Math.PI / 180) * i;
    await evaluate(`(() => { window.__sdfLab.setBodyAnchor(0, ${rad}, 0); return true; })()`);
  }
  await sleep(500); // let the marcher settle before grabbing the frame
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.result.data, 'base64');
  const file = `${OUT}/frame-${String(i).padStart(2, '0')}.png`;
  writeFileSync(file, buf);
  // BLOB_MASK=1 also writes a BODY MASK for this angle, by capturing the same
  // frame with the body hidden and diffing. That is exact where keying the
  // background is not: the lab's background is a fogged, DITHERED gradient (see
  // gib-sheet.mjs's header for the three key attempts that failed on it), whereas
  // hiding `__sdfLab.body` changes only the body's own pixels — the lab has a
  // directional light with NO shadow map, so the body casts nothing to catch in
  // the difference. 2 captures per angle, no renderer change.
  if (process.env.BLOB_MASK === '1') {
    await evaluate(`(() => { window.__sdfLab.body.visible = false; return true; })()`);
    await sleep(250);
    const bare = await send('Page.captureScreenshot', { format: 'png' });
    const bareBuf = Buffer.from(bare.result.data, 'base64');
    writeFileSync(`${OUT}/bare-${String(i).padStart(2, '0')}.png`, bareBuf);
    const mask = maskFrom(buf, bareBuf);
    if (mask) writeFileSync(`${OUT}/mask-${String(i).padStart(2, '0')}.png`, mask);
    await evaluate(`(() => { window.__sdfLab.body.visible = true; return true; })()`);
    await sleep(250);
  }
  const stats = pngStats(buf);
  frameStats.push({ i, yaw, file, bytes: buf.length, stats });
  console.log(
    `wrote ${file}  yaw=${((yaw * 180) / Math.PI).toFixed(0)}deg  bytes=${buf.length}  std=${stats.std ?? 'n/a'}`,
  );
}

const blankFrames = frameStats.filter((f) => (f.stats.std ?? 0) < MIN_STD);
if (blankFrames.length > 0) {
  fail(
    `${blankFrames.length}/${FRAMES} frame(s) look blank (luma std < ${MIN_STD}): ` +
      blankFrames.map((f) => `frame-${String(f.i).padStart(2, '0')} std=${f.stats.std}`).join(', '),
  );
}

const badConsole = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (badConsole.length > 0) {
  console.error('console errors during run:');
  for (const e of badConsole.slice(0, 20)) console.error('  |', e.type, e.text.slice(0, 300));
  fail(`${badConsole.length} console error/exception event(s) during the run`);
}

// A small dependency-free index so N PNGs are reviewable at a glance without
// an image-compositing library: an HTML page that lays the frames out in a
// grid via plain <img> tags referencing the files already on disk. This is
// not the contact sheet the plan waved off (no pixel compositing, nothing
// added to package.json) — it is just a directory listing with eyes.
const html = `<!doctype html>
<meta charset="utf-8">
<title>turntable — ${new Date().toISOString()}</title>
<style>
  body { background: #111; color: #ccc; font: 13px monospace; margin: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  figure { margin: 0; background: #1a1a1a; border: 1px solid #333; padding: 4px; }
  img { width: 100%; display: block; image-rendering: pixelated; }
  figcaption { padding: 4px 2px 0; }
</style>
<h1>blob-turntable — ${FRAMES} frames</h1>
<p>backend=${backend} pitch=${PITCH} dist=${DIST}</p>
<div class="grid">
${frameStats
  .map(
    (f) => `  <figure>
    <img src="frame-${String(f.i).padStart(2, '0')}.png" alt="frame ${f.i}">
    <figcaption>yaw ${((f.yaw * 180) / Math.PI).toFixed(0)}&deg; · std ${f.stats.std}</figcaption>
  </figure>`,
  )
  .join('\n')}
</div>
`;
writeFileSync(`${OUT}/index.html`, html);

console.log(`\n${FRAMES} frames in ${OUT} (open ${OUT}/index.html to review at a glance)`);
ws.close();
process.exit(0);
