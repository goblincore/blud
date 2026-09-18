// BLOOD DENSITY / PACKING CAPTURE (2026-09-18 blood-density-spike).
//
// The curl spike showed that curl adds coherent MOTION but does not FUSE a
// spray: cohesion is a metaball-packing problem. This script shoots the same
// spray at fixed EVENT TIMES (launch, mid-flight, landing) for two looks:
//
//   baseline  the shipped game look: emission multipliers all 1, goo at
//             GAME_GOO_DEFAULTS (radius 0.14, threshold 0.65, blur 0)
//   dense     packing: tighter cone, more + larger droplets, wider goo blobs
//
// plus two sweeps (emission x curl, goo radius x threshold) and the
// baseline|dense wipe on the SAME frame. Output goes to
// docs/dev-notes/2026-09-18-blood-density/ as PNGs, sheet.png (baseline|dense
// launch/mid/landing), sheet-emission.png, sheet-goo.png and captures.json.
//
//   node scripts/blood-density-capture.mjs [outDir]
//   node scripts/blood-density-capture.mjs --spread 0.6 --count 2 --size 1.5 \
//        --gooRadius 0.28 --gooThreshold 0.45 --gooBlur 1.5
//   LAB_VITE_PORT=5237 LAB_CDP_PORT=9227 node scripts/blood-density-capture.mjs
//
// DETERMINISM. The page boots paused (rAF off) and rebuilds the Current sim
// from t=0 at a fixed 1/60 s on every seek, seeded from the page's own seed
// (12345). baseline and dense are two SIMS at the SAME seed/scenario/event
// time, differing only by the packing look, so they are captured in ONE page
// load with no wall clock in the sim. A baseline frame is re-shot after the
// dense run and must be identical — if the pack leaked into the baseline, or
// the goo uniforms were left changed, that gate fails.
//
// THE A/B IS ALSO A GATE. A dense run whose frames are byte-identical to the
// baseline means the switch never reached the sim or the goo layer (the silent
// failure this page's guards exist for), so the mid frame must differ. A
// GOO-ONLY run (emission untouched) must also differ, proving the fusion half
// alone reaches the render.
//
// SERVERS: the same lifecycle as scripts/blood-curl-capture.mjs — same env
// vars and reuse rule (only a server that serves OUR page is reused), same
// Chrome flags. Only what THIS script started is stopped.
//
// RENDERER GUARD: any `THREE.WebGPURenderer` pipeline/shader error on the
// console fails the run — a compile failure draws nothing and is never an
// acceptable capture (flame-capture's task-2 lesson).
//
// Exits 0 on success, 2 if it could not run.
import { mkdirSync, writeFileSync, openSync, rmSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { inflateSync, deflateSync } from 'node:zlib';

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(2); };

// --- the looks under test ----------------------------------------------------
// The shipped game look, expressed through the density API. Every field here
// is the default, so applying it is exactly "no change".
const BASE_LOOK = { spread: 1, count: 1, size: 1, gooRadius: 0.14, gooThreshold: 0.65, gooBlur: 0 };
// BEST is the sweep's chosen look: packed-3's emission (one connected sheet
// with a frayed droplet tail rather than a single solid tongue) against a
// MODERATE goo radius — wide enough to fuse, not so wide the tail disappears.
// Curl stays OFF for the plain density A/B; the sweep pairs it with a moderate
// strength (3.5, below the >5 that scattered).
const BEST_LOOK = { spread: 0.5, count: 2.5, size: 1.8, gooRadius: 0.22, gooThreshold: 0.5, gooBlur: 1 };
const CURL = { curlOn: false, strength: 3.5, scale: 2, drift: 0.8, softFade: 0 };
const CURL_ON = { ...CURL, curlOn: true };
const CURL_OFF = { ...CURL, curlOn: false };

const BEST_KEYS = [
  ['--spread', 'spread'], ['--count', 'count'], ['--size', 'size'],
  ['--gooRadius', 'gooRadius'], ['--gooThreshold', 'gooThreshold'], ['--gooBlur', 'gooBlur'],
];
const argv = [...process.argv];
for (const [flag, key] of BEST_KEYS) {
  const i = argv.indexOf(flag);
  if (i === -1) continue;
  const v = Number(argv[i + 1]);
  if (!Number.isFinite(v)) fail(`${flag} needs a number`);
  BEST_LOOK[key] = v;
  argv.splice(i, 2);
}
const OUT = argv[2] ?? 'docs/dev-notes/2026-09-18-blood-density';
const VITE = Number(process.env.LAB_VITE_PORT ?? 5237);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9227);
const LAB_TMP = process.env.LAB_TMP ?? '/tmp';
const LAB_CHROME = process.env.LAB_CHROME
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 800, H = 600;                    // the page's fixed output buffer
const PAGE_BASE = '/sdf-blood-compare.html';
// A sustained wound spurt (slug profile) so there IS an airborne phase to pack:
// launch is a dense pulse, mid is the stretching arc, landing is the floor
// cascade. A side camera keeps the +Z spray across the frame.
const SCENARIO = 'jet';
const CAM = { yaw: 1.18, pitch: 0.10, distance: 1.5 };
const TIMES = [
  { sec: 0.15, name: 'launch' },
  { sec: 0.50, name: 'mid' },
  { sec: 1.10, name: 'landing' },
];
// The opposed crossing streams are where "one connected volume vs N beads"
// reads hardest; a front camera runs them across the frame.
const CROSS_CAM = { yaw: 0.10, pitch: 0.04, distance: 1.45 };
const CROSS_SEC = 0.60;
const DENSITY_MIN_FRAC = 0.004;            // a dense frame that changed less never applied
const GOO_MIN_FRAC = 0.0005;               // goo-only is subtle; only catch "nothing"
const MIN_LUMA_STD = 5;                    // a flatter frame is a broken frame

setTimeout(() => { console.error('FAIL: watchdog (20 min)'); process.exit(2); }, 20 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Server lifecycle (blood-curl-capture's) --------------------------------

/** Anything ANSWERING counts as listening (curl-exit-7 rule), not just 200s. */
async function listening(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

const started = [];
let cleanupRan = false;

function killStarted() {
  for (const s of started) {
    try { process.kill(-s.pid, 'SIGTERM'); } catch { /* already gone */ }
    try { process.kill(s.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}
process.on('exit', killStarted);

async function stopStarted() {
  if (cleanupRan) return;
  cleanupRan = true;
  killStarted();
  for (const s of started) {
    const url = s.kind === 'vite'
      ? `http://localhost:${VITE}/`
      : `http://localhost:${CDP}/json/version`;
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
    console.log(`blood-density-capture: starting vite on ${VITE}`);
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
    if (!(await listening(`http://localhost:${VITE}${PAGE_BASE}`))) {
      fail(`vite never came up on ${VITE} (log: ${LAB_TMP}/lab-vite-${VITE}.log)`);
    }
  } else {
    if (!(await listening(`http://localhost:${VITE}${PAGE_BASE}`))) {
      fail(`port ${VITE} is busy but does not serve ${PAGE_BASE} — stop it or set LAB_VITE_PORT`);
    }
    console.log(`blood-density-capture: reusing vite on ${VITE}`);
  }

  if (!(await listening(`http://localhost:${CDP}/json/version`))) {
    console.log(`blood-density-capture: starting chrome (headless) on debug port ${CDP}`);
    const tmpDir = `${LAB_TMP}/tmp-${CDP}`;
    mkdirSync(tmpDir, { recursive: true });
    const profileDir = `${LAB_TMP}/chrome-blood-density-${CDP}`;
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
    console.log(`blood-density-capture: reusing chrome on debug port ${CDP}`);
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

await serversUp();

// --- CDP client --------------------------------------------------------------

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', closeTabUrl], { stdio: 'ignore' }); } catch { /* gone */ }
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });

let seq = 0;
const pending = new Map();
const consoleErrors = [];
const pageExceptions = [];
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

// --- PNG decode / encode / stats (blood-curl-capture's) ----------------------

function decodePng(png) {
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
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) return { unsupported: true };
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
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
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = out[i * bpp]; rgba[i * 4 + 1] = out[i * bpp + 1]; rgba[i * 4 + 2] = out[i * bpp + 2];
    rgba[i * 4 + 3] = bpp === 4 ? out[i * bpp + 3] : 255;
  }
  return { w, h, rgba };
}

function pngStats(png) {
  const d = decodePng(png);
  if (d.unsupported) return d;
  const { w, h, rgba } = d;
  let n = 0, s = 0, s2 = 0;
  const stepX = Math.max(1, Math.floor(w / 256)), stepY = Math.max(1, Math.floor(h / 256));
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      const i = (y * w + x) * 4;
      const l = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      n++; s += l; s2 += l * l;
    }
  }
  const mean = s / n;
  return { w, h, mean: +mean.toFixed(2), std: +Math.sqrt(s2 / n - mean * mean).toFixed(2) };
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 6 })), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Fraction of pixels whose luma moved > 2/255, and the mean absolute delta. */
function frameDiff(aBuf, bBuf) {
  const a = decodePng(aBuf), b = decodePng(bBuf);
  if (a.unsupported || b.unsupported) fail('frameDiff: undecodable frame');
  if (a.w !== b.w || a.h !== b.h) fail('frameDiff: size mismatch');
  let changed = 0, sum = 0, n = 0;
  const stepX = Math.max(1, Math.floor(a.w / 512)), stepY = Math.max(1, Math.floor(a.h / 512));
  for (let y = 0; y < a.h; y += stepY) {
    for (let x = 0; x < a.w; x += stepX) {
      const i = (y * a.w + x) * 4;
      const la = 0.299 * a.rgba[i] + 0.587 * a.rgba[i + 1] + 0.114 * a.rgba[i + 2];
      const lb = 0.299 * b.rgba[i] + 0.587 * b.rgba[i + 1] + 0.114 * b.rgba[i + 2];
      const d = Math.abs(la - lb);
      if (d > 2) changed++;
      sum += d; n++;
    }
  }
  return { changedFrac: changed / n, meanAbs: sum / n };
}

/** Side-by-side grid: `rows` is an array of rows of PNG buffers. */
function composeGrid(rows, outPath) {
  const dec = rows.map((row) => row.map(decodePng));
  const fw = dec[0][0].w, fh = dec[0][0].h;
  const cols = Math.max(...dec.map((r) => r.length));
  const GAP = 10;
  const SW = fw * cols + GAP * (cols + 1);
  const SH = fh * dec.length + GAP * (dec.length + 1);
  const canvas = Buffer.alloc(SW * SH * 4);
  for (let i = 0; i < SW * SH; i++) {
    canvas[i * 4] = 14; canvas[i * 4 + 1] = 16; canvas[i * 4 + 2] = 22; canvas[i * 4 + 3] = 255;
  }
  const blit = (d, dx, dy) => {
    for (let y = 0; y < d.h; y++) {
      const src = y * d.w * 4;
      const dst = ((dy + y) * SW + dx) * 4;
      d.rgba.copy(canvas, dst, src, src + d.w * 4);
    }
  };
  dec.forEach((row, r) => row.forEach((d, c) => {
    blit(d, GAP + c * (fw + GAP), GAP + r * (fh + GAP));
  }));
  writeFileSync(outPath, encodePng(canvas, SW, SH));
  return { w: SW, h: SH };
}

/** 2-column x R rows side-by-side sheet. */
function composeSheet(rows, outPath) {
  return composeGrid(rows, outPath);
}

// --- boot --------------------------------------------------------------------

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

let backend = 'unknown';

async function freshPage() {
  await send('Page.navigate', { url: `http://localhost:${VITE}${PAGE_BASE}` });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    try {
      ready = await evaluate('typeof window.__bloodCompare === "object"');
    } catch { /* still booting */ }
    if (ready) break;
  }
  if (!ready) fail('__bloodCompare never appeared');
  await evaluate('window.__bloodCompare.pause()');
  backend = await evaluate('window.__bloodCompare.state().backend');
  if (backend !== 'webgpu') fail(`backend is "${backend}" — not the WebGPU path`);
  // Hide the page chrome permanently: updateDiag() re-shows #paused on every
  // draw, so an inline display:none is not enough — this is a look capture,
  // not a UI capture.
  await evaluate(`(() => {
    const style = document.createElement('style');
    style.textContent = '#ui, #status, #paused, #errors { display: none !important; }';
    document.head.appendChild(style);
    return true;
  })()`);
}

const shots = [];

async function shoot(name, meta) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.result.data, 'base64');
  writeFileSync(`${OUT}/${name}`, buf);
  const stats = pngStats(buf);
  if (stats.unsupported) fail(`${name}: not a decodable 8-bit RGB(A) PNG`);
  if ((stats.std ?? 0) < MIN_LUMA_STD) {
    fail(`${name}: flat frame (luma std ${stats.std} < ${MIN_LUMA_STD}) — nothing rendered`);
  }
  shots.push({ ...meta, file: name, std: stats.std, buf });
  console.log(`${name}  (luma std=${stats.std})`);
}

/** Set the density look through the API and return the CLAMPED values. */
const DENSITY_KEYS = new Set(['spread', 'count', 'size', 'gooRadius', 'gooThreshold', 'gooBlur']);
async function applyDensity(partial) {
  const look = Object.fromEntries(Object.entries(partial).filter(([k]) => DENSITY_KEYS.has(k)));
  const applied = await evaluate(`window.__bloodCompare.setDensity(${JSON.stringify(look)})`);
  for (const [k, v] of Object.entries(look)) {
    if (v === undefined) continue;
    if (typeof applied[k] !== 'number' || Math.abs(applied[k] - v) > 1e-9) {
      fail(`setDensity ${k}=${v} applied ${applied[k]}`);
    }
  }
  return applied;
}

/** Set the flow (curl) look through the API and return the CLAMPED values. */
async function applyFlow(partial) {
  const applied = await evaluate(`window.__bloodCompare.setFlow(${JSON.stringify(partial)})`);
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) continue;
    if (typeof v === 'string') continue; // wipeAxis: exact echo checked below
    if (typeof v === 'boolean') { if (applied[k] !== v) fail(`setFlow ${k}=${v} applied ${applied[k]}`); }
    else if (Math.abs(applied[k] - v) > 1e-9) fail(`setFlow ${k}=${v} applied ${applied[k]}`);
  }
  if (partial.wipeAxis !== undefined && applied.wipeAxis !== partial.wipeAxis) {
    fail(`setFlow wipeAxis=${partial.wipeAxis} applied ${applied.wipeAxis}`);
  }
  return applied;
}

/** Seek the current shape to `sec` and shoot. */
async function shootCurrentAt(sec, name, meta) {
  await evaluate(`window.__bloodCompare.setSplashTime(${sec})`);
  await evaluate('window.__bloodCompare.present()');
  await shoot(name, { ...meta, sec, state: await evaluate('window.__bloodCompare.state()') });
}

/** Shoot the CURRENT frame without re-seeking (grid cells reuse one seek). */
async function shootNow(name, meta) {
  await evaluate('window.__bloodCompare.present()');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.result.data, 'base64');
  writeFileSync(`${OUT}/${name}`, buf);
  const stats = pngStats(buf);
  if (stats.unsupported || (stats.std ?? 0) < MIN_LUMA_STD) fail(`${name}: bad frame`);
  shots.push({ ...meta, file: name, std: stats.std, buf });
  console.log(`${name}  (luma std=${stats.std})`);
  return buf;
}

await freshPage();
await evaluate(`window.__bloodCompare.setShape('current')`);
await evaluate(`window.__bloodCompare.setScenario(${JSON.stringify(SCENARIO)})`);
await evaluate(`window.__bloodCompare.setCamera(${JSON.stringify(CAM)})`);
await evaluate('window.__bloodCompare.setSource(400, 300)');

// --- baseline: the shipped look ---------------------------------------------
await applyDensity(BASE_LOOK);
await applyFlow(CURL_OFF);
for (const spec of TIMES) await shootCurrentAt(spec.sec, `baseline-${spec.name}.png`, { variant: 'baseline', time: spec.name });
// A second baseline shot to pin determinism BEFORE the dense run.
await shootCurrentAt(TIMES[1].sec, 'baseline-mid-again.png', { variant: 'baseline', time: 'mid', repeat: true });

// --- dense: packing, curl off ------------------------------------------------
const denseLook = await applyDensity(BEST_LOOK);
for (const spec of TIMES) await shootCurrentAt(spec.sec, `dense-${spec.name}.png`, { variant: 'dense', time: spec.name });

// --- goo-only isolation: emission shipped, fusion widened --------------------
await applyDensity({ spread: 1, count: 1, size: 1, gooRadius: BEST_LOOK.gooRadius, gooThreshold: BEST_LOOK.gooThreshold, gooBlur: BEST_LOOK.gooBlur });
await shootCurrentAt(TIMES[1].sec, 'goo-only-mid.png', { variant: 'goo-only', time: 'mid' });

// --- dense + curl (moderate strength, below the scattering >5) ---------------
await applyDensity(BEST_LOOK);
await applyFlow(CURL_ON);
for (const spec of TIMES) await shootCurrentAt(spec.sec, `dense-curl-${spec.name}.png`, { variant: 'dense+curl', time: spec.name });

// --- determinism gate: baseline must still reproduce ------------------------
await applyFlow(CURL_OFF);
await applyDensity(BASE_LOOK);
await shootCurrentAt(TIMES[1].sec, 'baseline-mid-after.png', { variant: 'baseline', time: 'mid', repeat: true });

// --- SCENE A2: the opposed crossing streams ---------------------------------
await evaluate(`window.__bloodCompare.setScenario('crossing')`);
await evaluate(`window.__bloodCompare.setCamera(${JSON.stringify(CROSS_CAM)})`);
await applyFlow(CURL_OFF);
await applyDensity(BASE_LOOK);
await shootCurrentAt(CROSS_SEC, 'crossing-baseline.png', { variant: 'baseline', scenario: 'crossing' });
await applyDensity(BEST_LOOK);
await shootCurrentAt(CROSS_SEC, 'crossing-dense.png', { variant: 'dense', scenario: 'crossing' });
await applyFlow(CURL_ON);
await shootCurrentAt(CROSS_SEC, 'crossing-dense-curl.png', { variant: 'dense+curl', scenario: 'crossing' });
await applyFlow(CURL_OFF);
await applyDensity(BASE_LOOK);
await evaluate(`window.__bloodCompare.setScenario(${JSON.stringify(SCENARIO)})`);
await evaluate(`window.__bloodCompare.setCamera(${JSON.stringify(CAM)})`);

// --- WIPE: baseline | dense on the SAME frame --------------------------------
await applyDensity(BEST_LOOK);
await applyFlow({ ...CURL_OFF, wipeAxis: 'density' });
await evaluate('window.__bloodCompare.setWipe(true, "original", "smooth", 0.5)');
await shootCurrentAt(TIMES[1].sec, 'wipe-density-mid.png', { variant: 'wipe-density', time: 'mid' });
await evaluate('window.__bloodCompare.setWipe(false)');
await applyFlow({ ...CURL_OFF, wipeAxis: 'variant' });
await applyDensity(BASE_LOOK);

// --- SWEEP 1: emission pack x curl ------------------------------------------
// Rows tighten the emission and widen the goo together (goo held at one
// moderate setting); columns are curl off / curl on.
const EMISSION_SWEEP = [
  { id: 'packed-1', spread: 1.0, count: 1, size: 1.0, gooRadius: 0.22, gooThreshold: 0.5, gooBlur: 1 },
  { id: 'packed-2', spread: 0.7, count: 1.5, size: 1.3, gooRadius: 0.22, gooThreshold: 0.5, gooBlur: 1 },
  { id: 'packed-3', spread: 0.5, count: 2.5, size: 1.8, gooRadius: 0.22, gooThreshold: 0.5, gooBlur: 1 },
  { id: 'packed-4', spread: 0.35, count: 3.5, size: 2.4, gooRadius: 0.22, gooThreshold: 0.5, gooBlur: 1 },
];
const emissionRows = [];
await evaluate(`window.__bloodCompare.setScenario(${JSON.stringify(SCENARIO)})`);
for (const pack of EMISSION_SWEEP) {
  const row = [];
  for (const curl of [CURL_OFF, CURL_ON]) {
    await applyFlow(curl);
    await applyDensity(pack);
    await evaluate(`window.__bloodCompare.setSplashTime(${TIMES[1].sec})`);
    const file = `emission-${pack.id}-${curl.curlOn ? 'curl' : 'nocurl'}.png`;
    row.push(await shootNow(file, { variant: `emission-${pack.id}`, curl: curl.curlOn, pack, state: await evaluate('window.__bloodCompare.state()') }));
  }
  emissionRows.push(row);
}

// --- SWEEP 2: goo radius x threshold (best emission, curl off) ---------------
// The fusion half on its own: how readily the blobs merge.
const GOO_RADII = [0.14, 0.22, 0.32, 0.45];
const GOO_THRESHOLDS = [0.65, 0.45, 0.30];
const gooRows = [];
await applyFlow(CURL_OFF);
for (const r of GOO_RADII) {
  const row = [];
  for (const t of GOO_THRESHOLDS) {
    await applyDensity({ spread: BEST_LOOK.spread, count: BEST_LOOK.count, size: BEST_LOOK.size, gooRadius: r, gooThreshold: t, gooBlur: 1 });
    await evaluate(`window.__bloodCompare.setSplashTime(${TIMES[1].sec})`);
    const file = `goo-r${r}-t${t}.png`;
    row.push(await shootNow(file, { variant: 'goo-sweep', gooRadius: r, gooThreshold: t, state: await evaluate('window.__bloodCompare.state()') }));
  }
  gooRows.push(row);
}

// --- reset + gates -----------------------------------------------------------
await applyDensity(BASE_LOOK);
await applyFlow(CURL_OFF);

const byFile = new Map(shots.map((s) => [s.file, s]));
const midAgain = byFile.get('baseline-mid-again.png');
const midAfter = byFile.get('baseline-mid-after.png');
const determinism = frameDiff(midAgain.buf, midAfter.buf);
console.log(`determinism baseline mid repeat: changed=${(determinism.changedFrac * 100).toFixed(3)}% meanAbs=${determinism.meanAbs.toFixed(3)}`);
if (determinism.changedFrac > 0.0005) {
  fail(`baseline mid did not reproduce (${(determinism.changedFrac * 100).toFixed(3)}% changed) — the dense run leaked state`);
}

const timedDiffs = [];
for (const spec of TIMES) {
  const base = byFile.get(`baseline-${spec.name}.png`);
  const dense = byFile.get(`dense-${spec.name}.png`);
  const d = frameDiff(base.buf, dense.buf);
  timedDiffs.push({ time: spec.name, ...d });
  console.log(`diff ${spec.name} (density): changed=${(d.changedFrac * 100).toFixed(2)}% meanAbs=${d.meanAbs.toFixed(2)}`);
}
for (const d of timedDiffs) {
  if (d.time === 'mid' && d.changedFrac < DENSITY_MIN_FRAC) {
    fail(`"mid" changed only ${(d.changedFrac * 100).toFixed(2)}% of pixels — the packing did not apply`);
  }
}

const gooOnlyDiff = frameDiff(byFile.get('baseline-mid.png').buf, byFile.get('goo-only-mid.png').buf);
console.log(`diff goo-only mid (fusion only): changed=${(gooOnlyDiff.changedFrac * 100).toFixed(3)}% meanAbs=${gooOnlyDiff.meanAbs.toFixed(3)}`);
if (gooOnlyDiff.changedFrac < GOO_MIN_FRAC) {
  fail(`goo-only changed only ${(gooOnlyDiff.changedFrac * 100).toFixed(3)}% — the fusion half did not reach the render`);
}

// How much curl adds ON TOP of the dense packing (the curl spike's question).
const denseCurlDiffs = [];
for (const spec of TIMES) {
  const dense = byFile.get(`dense-${spec.name}.png`);
  const denseCurl = byFile.get(`dense-curl-${spec.name}.png`);
  const d = frameDiff(dense.buf, denseCurl.buf);
  denseCurlDiffs.push({ time: spec.name, ...d });
  console.log(`diff ${spec.name} (curl on DENSE): changed=${(d.changedFrac * 100).toFixed(2)}% meanAbs=${d.meanAbs.toFixed(2)}`);
}

const crossBase = byFile.get('crossing-baseline.png');
const crossDense = byFile.get('crossing-dense.png');
const crossCurl = byFile.get('crossing-dense-curl.png');
const crossingDiff = frameDiff(crossBase.buf, crossDense.buf);
const crossingCurlDiff = frameDiff(crossDense.buf, crossCurl.buf);
console.log(`diff crossing (density): changed=${(crossingDiff.changedFrac * 100).toFixed(2)}%   (curl on top): ${(crossingCurlDiff.changedFrac * 100).toFixed(2)}%`);

// --- sheets + json -----------------------------------------------------------
const sheet = composeSheet(TIMES.map((spec) => [
  byFile.get(`baseline-${spec.name}.png`).buf,
  byFile.get(`dense-${spec.name}.png`).buf,
  byFile.get(`dense-curl-${spec.name}.png`).buf,
]), `${OUT}/sheet.png`);
console.log(`sheet.png  (${sheet.w}x${sheet.h}: rows launch/mid/landing, columns baseline | dense | dense+curl)`);

const sheetEmission = composeGrid(emissionRows, `${OUT}/sheet-emission.png`);
console.log(`sheet-emission.png  (${sheetEmission.w}x${sheetEmission.h}: rows ${EMISSION_SWEEP.map((p) => p.id).join('/')}, columns curl off | on)`);

const sheetGoo = composeGrid(gooRows, `${OUT}/sheet-goo.png`);
console.log(`sheet-goo.png  (${sheetGoo.w}x${sheetGoo.h}: rows goo radius ${GOO_RADII.join('/')}, columns threshold ${GOO_THRESHOLDS.join('/')})`);

const sheetCross = composeSheet([[
  crossBase.buf, crossDense.buf, crossCurl.buf,
]], `${OUT}/sheet-crossing.png`);
console.log(`sheet-crossing.png  (${sheetCross.w}x${sheetCross.h}: baseline | dense | dense+curl, crossing mid)`);

// --- guards ------------------------------------------------------------------
const rendererErrors = consoleErrors.filter((t) => /THREE\.WebGPURenderer.*(pipeline|ShaderModule|fragment error|unresolved value)/i.test(t));
if (rendererErrors.length > 0) fail(`renderer pipeline error: ${rendererErrors[0].slice(0, 300)}`);
const realExceptions = pageExceptions.filter((t) => !/NotFoundError|setPointerCapture/.test(t));
if (realExceptions.length > 0) fail(`page threw: ${realExceptions[0]}`);

writeFileSync(`${OUT}/captures.json`, JSON.stringify({
  url: PAGE_BASE, backend, viewport: { width: W, height: H },
  scenario: SCENARIO, camera: CAM, times: TIMES,
  crossCamera: CROSS_CAM, crossSec: CROSS_SEC,
  baseLook: BASE_LOOK, denseLook, curl: CURL,
  determinism: { changedFrac: determinism.changedFrac, meanAbs: determinism.meanAbs },
  timedDiffs, gooOnlyDiff, denseCurlDiffs, crossingDiff, crossingCurlDiff,
  emissionSweep: { rows: EMISSION_SWEEP, cols: ['curl-off', 'curl-on'] },
  gooSweep: { radii: GOO_RADII, thresholds: GOO_THRESHOLDS, emission: BEST_LOOK },
  sheet, sheetEmission, sheetGoo, sheetCross,
  screenshots: shots.map(({ buf, ...rest }) => rest),
}, null, 2));

await stopStarted();
console.log(`\n${shots.length} captures + sheets + captures.json in ${OUT}`);
process.exit(0);
