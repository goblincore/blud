// BLOOD CURL + SOFT-FADE CAPTURE (2026-09-18 blood-curl-spike).
//
// Shoots the SAME spray at fixed EVENT TIMES — launch, mid-flight, landing —
// for two looks on the blood comparison page:
//
//   baseline  curl off, soft fade 0      the shipped look
//   flow      curl on + soft fade        the two techniques under test
//
// plus a splash-shape fade A/B (the impact-splash cards are where the fade has
// geometry to grade) and a determinism gate. Output goes to
// docs/dev-notes/2026-09-18-blood-curl-spike/ as individual PNGs, sheet.png
// (current shape) and sheet-fade.png (splash shape), and captures.json.
//
//   node scripts/blood-curl-capture.mjs [outDir]
//   node scripts/blood-curl-capture.mjs --strength 4 --scale 2 --drift 0.8 --fade 0.4
//   LAB_VITE_PORT=5236 LAB_CDP_PORT=9226 node scripts/blood-curl-capture.mjs
//
// DETERMINISM. The page boots paused (rAF off) and rebuilds the Current sim
// from t=0 at a fixed 1/60 s on every seek, seeded from the page's own seed
// (12345). baseline and flow are two SIMS at the SAME seed/scenario/event
// time, differing only by the curl setting, so they are captured in ONE page
// load with no wall clock in the sim. A baseline frame is re-shot after the
// flow run and must be identical — if the material swap or the extra sim
// leaked, that gate fails.
//
// THE A/B IS ALSO A GATE. A flow run whose frames are byte-identical to the
// baseline means the switch never reached the sim/shader (the silent failure
// the soft-fade guard exists for), so the mid-flight frame must differ.
//
// SERVERS: the same lifecycle as scripts/explosion-capture.mjs — same env vars
// and reuse rule (only a server that serves OUR page is reused), same Chrome
// flags. Only what THIS script started is stopped.
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

// --- the look under test -----------------------------------------------------
const BASE_LOOK = { curlOn: false, strength: 0, scale: 2, drift: 0, softFade: 0 };
const FLOW_LOOK = { curlOn: true, strength: 3.5, scale: 2, drift: 0.8, softFade: 0.35 };
// Fade ISOLATION: curl off, a fade distance big enough to grade mist that
// overlaps the body. The splash cards at the crown float clear of every
// surface, so the fade has no screen-space intersection to act on there.
const FADE_ONLY_LOOK = { curlOn: false, strength: 0, scale: 2, drift: 0, softFade: 0.6 };
const SPLASH_FADE_LOOK = { softFade: 0.6 };

const argv = [...process.argv];
for (const [flag, key] of [['--strength', 'strength'], ['--scale', 'scale'], ['--drift', 'drift'], ['--fade', 'softFade']]) {
  const i = argv.indexOf(flag);
  if (i === -1) continue;
  const v = Number(argv[i + 1]);
  if (!Number.isFinite(v)) fail(`${flag} needs a number`);
  FLOW_LOOK[key] = v;
  argv.splice(i, 2);
}
const OUT = argv[2] ?? 'docs/dev-notes/2026-09-18-blood-curl-spike';
const VITE = Number(process.env.LAB_VITE_PORT ?? 5236);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9226);
const LAB_TMP = process.env.LAB_TMP ?? '/tmp';
const LAB_CHROME = process.env.LAB_CHROME
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 800, H = 600;                    // the page's fixed output buffer
const PAGE_BASE = '/sdf-blood-compare.html';
// A sustained wound spurt (slug profile) so there IS an airborne phase to
// advect: launch is a dense pulse, mid is the stretching arc, landing is the
// floor cascade. A side camera keeps the +Z spray across the frame instead of
// coming straight at the lens.
const SCENARIO = 'jet';
const CAM = { yaw: 1.18, pitch: 0.10, distance: 1.5 };
const TIMES = [
  { sec: 0.15, name: 'launch' },
  { sec: 0.50, name: 'mid' },
  { sec: 1.10, name: 'landing' },
];
// Fade isolation uses the FRONT camera: the wound sits on the body proxy's
// front, so droplets/mist overlap the body in screen space and the depth fade
// has an edge to grade. The side camera above puts the body off to one side,
// where the fade has nothing behind the spray.
const FADE_CAM = { yaw: 0.10, pitch: 0.04, distance: 1.35 };
const FADE_TIMES = [
  { sec: 0.35, name: 'fade-mid' },
  { sec: 0.80, name: 'fade-late' },
];
const FLOW_STRENGTH_MIN_FRAC = 0.004;      // a flow frame that changed less than this never applied
const FADE_MIN_FRAC = 0.0004;              // the fade is subtle over mist; only catch "nothing"
const MIN_LUMA_STD = 5;                    // a flatter frame is a broken frame

setTimeout(() => { console.error('FAIL: watchdog (12 min)'); process.exit(2); }, 12 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Server lifecycle (explosion-capture's, node port) ----------------------

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
    console.log(`blood-curl-capture: starting vite on ${VITE}`);
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
    console.log(`blood-curl-capture: reusing vite on ${VITE}`);
  }

  if (!(await listening(`http://localhost:${CDP}/json/version`))) {
    console.log(`blood-curl-capture: starting chrome (headless) on debug port ${CDP}`);
    const tmpDir = `${LAB_TMP}/tmp-${CDP}`;
    mkdirSync(tmpDir, { recursive: true });
    const profileDir = `${LAB_TMP}/chrome-blood-curl-${CDP}`;
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
    console.log(`blood-curl-capture: reusing chrome on debug port ${CDP}`);
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

// --- PNG decode / encode / stats (explosion-capture's) ----------------------

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

/** Set the flow look through the API and return the CLAMPED values that landed. */
async function applyFlow(partial) {
  const applied = await evaluate(`window.__bloodCompare.setFlow(${JSON.stringify(partial)})`);
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) continue;
    if (typeof v === 'boolean') { if (applied[k] !== v) fail(`setFlow ${k}=${v} applied ${applied[k]}`); }
    else if (Math.abs(applied[k] - v) > 1e-9) fail(`setFlow ${k}=${v} applied ${applied[k]}`);
  }
  return applied;
}

/** Seek the current shape to `sec` and shoot. */
async function shootCurrentAt(sec, name, meta) {
  await evaluate(`window.__bloodCompare.setSplashTime(${sec})`);
  await evaluate('window.__bloodCompare.present()');
  await shoot(name, { ...meta, sec, state: await evaluate('window.__bloodCompare.state()') });
}

await freshPage();
await evaluate(`window.__bloodCompare.setShape('current')`);
await evaluate(`window.__bloodCompare.setScenario(${JSON.stringify(SCENARIO)})`);
await evaluate(`window.__bloodCompare.setCamera(${JSON.stringify(CAM)})`);
await evaluate('window.__bloodCompare.setSource(400, 300)');

// --- baseline: the shipped look ---------------------------------------------
const baselineLook = await applyFlow(BASE_LOOK);
for (const spec of TIMES) await shootCurrentAt(spec.sec, `baseline-${spec.name}.png`, { variant: 'baseline', time: spec.name });
// A second baseline shot to pin determinism BEFORE the flow run.
await shootCurrentAt(TIMES[1].sec, 'baseline-mid-again.png', { variant: 'baseline', time: 'mid', repeat: true });

// --- flow: curl advection + soft fade ---------------------------------------
const flowLook = await applyFlow(FLOW_LOOK);
for (const spec of TIMES) await shootCurrentAt(spec.sec, `flow-${spec.name}.png`, { variant: 'flow', time: spec.name });

// --- determinism gate: baseline must still reproduce ------------------------
await applyFlow(BASE_LOOK);
await shootCurrentAt(TIMES[1].sec, 'baseline-mid-after.png', { variant: 'baseline', time: 'mid', repeat: true });

// --- SCENE A2: denser fixtures ----------------------------------------------
// A gib-like PULSE (burst) and two OPPOSED streams (crossing) put many more
// droplets on screen, which is where "one connected volume" either reads or
// does not. Front camera: the burst sprays +z toward the lens and the crossing
// streams run ±x across the frame.
const SCENARIO_SHOTS = [
  { id: 'burst', sec: 0.45 },
  { id: 'crossing', sec: 0.60 },
];
await evaluate(`window.__bloodCompare.setCamera(${JSON.stringify(FADE_CAM)})`);
for (const spec of SCENARIO_SHOTS) {
  await evaluate(`window.__bloodCompare.setScenario(${JSON.stringify(spec.id)})`);
  await applyFlow(BASE_LOOK);
  await shootCurrentAt(spec.sec, `scen-${spec.id}-baseline.png`, { variant: 'baseline', scenario: spec.id, time: 'mid' });
  await applyFlow(FLOW_LOOK);
  await shootCurrentAt(spec.sec, `scen-${spec.id}-flow.png`, { variant: 'flow', scenario: spec.id, time: 'mid' });
}
await evaluate(`window.__bloodCompare.setScenario(${JSON.stringify(SCENARIO)})`);

// --- SWEEP: strength x scale on the crossing mid frame ----------------------
// The one place the curl visibly reorganises a spray, so the tuning read comes
// from here: rows are strength (m/s^2), columns are scale (metres per cell).
const SWEEP_STRENGTHS = [2, 4, 6];
const SWEEP_SCALES = [1, 2, 4];
const sweepRows = [];
await evaluate(`window.__bloodCompare.setScenario('crossing')`);
await evaluate(`window.__bloodCompare.setCamera(${JSON.stringify(FADE_CAM)})`);
for (const strength of SWEEP_STRENGTHS) {
  const row = [];
  for (const scale of SWEEP_SCALES) {
    await applyFlow({ curlOn: true, strength, scale, drift: 0.7, softFade: 0 });
    await evaluate(`window.__bloodCompare.setSplashTime(${SCENARIO_SHOTS[1].sec})`);
    await evaluate('window.__bloodCompare.present()');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(shot.result.data, 'base64');
    const stats = pngStats(buf);
    if (stats.unsupported || (stats.std ?? 0) < MIN_LUMA_STD) fail(`sweep s${strength}/k${scale}: bad frame`);
    const file = `sweep-s${strength}-k${scale}.png`;
    writeFileSync(`${OUT}/${file}`, buf);
    shots.push({ file, variant: 'sweep', scenario: 'crossing', strength, scale, std: stats.std, buf });
    row.push(buf);
  }
  sweepRows.push(row);
}
await evaluate(`window.__bloodCompare.setScenario(${JSON.stringify(SCENARIO)})`);

// --- SCENE B: the soft fade isolated (front camera, spray over the body) ----
await evaluate(`window.__bloodCompare.setCamera(${JSON.stringify(FADE_CAM)})`);
const fadeOffLook = await applyFlow(BASE_LOOK);
for (const spec of FADE_TIMES) {
  await shootCurrentAt(spec.sec, `${spec.name}-off.png`, { variant: 'fade-off', time: spec.name });
}
const fadeOnlyLook = await applyFlow(FADE_ONLY_LOOK);
for (const spec of FADE_TIMES) {
  await shootCurrentAt(spec.sec, `${spec.name}-on.png`, { variant: 'fade-on', time: spec.name });
}

// --- SCENE C: the splash cards (reported, not gated — the crown floats free) -
await evaluate(`window.__bloodCompare.setShape('splash')`);
await evaluate('window.__bloodCompare.setSplashFrozen(true)');
await applyFlow(BASE_LOOK);
await evaluate('window.__bloodCompare.resetSplash()');
await shoot('splash-baseline-crown.png', { variant: 'baseline', time: 'crown', state: await evaluate('window.__bloodCompare.state()') });
await applyFlow(SPLASH_FADE_LOOK);
await evaluate('window.__bloodCompare.resetSplash()');
await shoot('splash-fade-crown.png', { variant: 'fade', time: 'crown', state: await evaluate('window.__bloodCompare.state()') });

// --- A/B + determinism gates -------------------------------------------------
const byFile = new Map(shots.map((s) => [s.file, s]));
const midAgain = byFile.get('baseline-mid-again.png');
const midAfter = byFile.get('baseline-mid-after.png');
const determinism = frameDiff(midAgain.buf, midAfter.buf);
console.log(`determinism baseline mid repeat: changed=${(determinism.changedFrac * 100).toFixed(3)}% meanAbs=${determinism.meanAbs.toFixed(3)}`);
if (determinism.changedFrac > 0.0005) {
  fail(`baseline mid did not reproduce (${(determinism.changedFrac * 100).toFixed(3)}% changed) — the flow run leaked state`);
}

const diffs = [];
for (const spec of TIMES) {
  const base = byFile.get(`baseline-${spec.name}.png`);
  const flow = byFile.get(`flow-${spec.name}.png`);
  const d = frameDiff(base.buf, flow.buf);
  diffs.push({ time: spec.name, ...d });
  console.log(`diff ${spec.name}: changed=${(d.changedFrac * 100).toFixed(2)}% meanAbs=${d.meanAbs.toFixed(2)}`);
}
// A flow run that changes nothing means the switch never reached the sim.
for (const d of diffs) {
  if (d.time === 'mid' && d.changedFrac < FLOW_STRENGTH_MIN_FRAC) {
    fail(`"mid" changed only ${(d.changedFrac * 100).toFixed(2)}% of pixels — the curl did not apply`);
  }
}

const fadeDiffs = [];
for (const spec of FADE_TIMES) {
  const off = byFile.get(`${spec.name}-off.png`);
  const on = byFile.get(`${spec.name}-on.png`);
  const d = frameDiff(off.buf, on.buf);
  fadeDiffs.push({ time: spec.name, ...d });
  console.log(`diff ${spec.name} (fade-only): changed=${(d.changedFrac * 100).toFixed(3)}% meanAbs=${d.meanAbs.toFixed(3)}`);
}
// The fade must reach the shader. If NO fade-only frame moved, the switch is
// inert and the "soft fade doesn't matter" verdict would be an artifact.
if (fadeDiffs.every((d) => d.changedFrac < FADE_MIN_FRAC)) {
  fail(`soft fade changed nothing on any frame (max ${(Math.max(...fadeDiffs.map((d) => d.changedFrac)) * 100).toFixed(3)}%) — the fade did not apply`);
}
const splashDiff = frameDiff(byFile.get('splash-baseline-crown.png').buf, byFile.get('splash-fade-crown.png').buf);
console.log(`diff splash-crown (fade): changed=${(splashDiff.changedFrac * 100).toFixed(3)}% meanAbs=${splashDiff.meanAbs.toFixed(3)} (reported, not gated — the crown floats free)`);

// --- sheets + json -----------------------------------------------------------
const sheet = composeSheet(TIMES.map((spec) => [
  byFile.get(`baseline-${spec.name}.png`).buf,
  byFile.get(`flow-${spec.name}.png`).buf,
]), `${OUT}/sheet.png`);
console.log(`sheet.png  (${sheet.w}x${sheet.h}: rows launch/mid/landing, columns baseline|flow)`);
const sheetFade = composeSheet(FADE_TIMES.map((spec) => [
  byFile.get(`${spec.name}-off.png`).buf,
  byFile.get(`${spec.name}-on.png`).buf,
]), `${OUT}/sheet-fade.png`);
console.log(`sheet-fade.png  (${sheetFade.w}x${sheetFade.h}: rows fade-mid/fade-late, columns fade off|on)`);

const scenarioDiffs = [];
for (const spec of SCENARIO_SHOTS) {
  const base = byFile.get(`scen-${spec.id}-baseline.png`);
  const flow = byFile.get(`scen-${spec.id}-flow.png`);
  const d = frameDiff(base.buf, flow.buf);
  scenarioDiffs.push({ scenario: spec.id, sec: spec.sec, ...d });
  console.log(`diff scen-${spec.id} (curl): changed=${(d.changedFrac * 100).toFixed(2)}% meanAbs=${d.meanAbs.toFixed(2)}`);
}
const sheetScenarios = composeSheet(SCENARIO_SHOTS.map((spec) => [
  byFile.get(`scen-${spec.id}-baseline.png`).buf,
  byFile.get(`scen-${spec.id}-flow.png`).buf,
]), `${OUT}/sheet-scenarios.png`);
console.log(`sheet-scenarios.png  (${sheetScenarios.w}x${sheetScenarios.h}: rows burst/crossing, columns baseline|flow)`);

const sheetSweep = composeGrid(sweepRows, `${OUT}/sheet-sweep.png`);
console.log(`sheet-sweep.png  (${sheetSweep.w}x${sheetSweep.h}: rows strength ${SWEEP_STRENGTHS.join('/')}, columns scale ${SWEEP_SCALES.join('/')}, crossing mid)`);

// --- guards ------------------------------------------------------------------
const rendererErrors = consoleErrors.filter((t) => /THREE\.WebGPURenderer.*(pipeline|ShaderModule|fragment error|unresolved value)/i.test(t));
if (rendererErrors.length > 0) fail(`renderer pipeline error: ${rendererErrors[0].slice(0, 300)}`);
const realExceptions = pageExceptions.filter((t) => !/NotFoundError|setPointerCapture/.test(t));
if (realExceptions.length > 0) fail(`page threw: ${realExceptions[0]}`);

writeFileSync(`${OUT}/captures.json`, JSON.stringify({
  url: PAGE_BASE, backend, viewport: { width: W, height: H },
  scenario: SCENARIO, camera: CAM, times: TIMES,
  fadeCamera: FADE_CAM, fadeTimes: FADE_TIMES,
  baselineLook, flowLook, fadeOffLook, fadeOnlyLook, splashFadeLook: SPLASH_FADE_LOOK,
  determinism: { changedFrac: determinism.changedFrac, meanAbs: determinism.meanAbs },
  diffs, fadeDiffs, splashDiff, scenarioDiffs,
  sweep: { strengths: SWEEP_STRENGTHS, scales: SWEEP_SCALES, scenario: 'crossing', sec: SCENARIO_SHOTS[1].sec },
  sheet, sheetFade, sheetScenarios, sheetSweep,
  screenshots: shots.map(({ buf, ...rest }) => rest),
}, null, 2));

await stopStarted();
console.log(`\n${shots.length} captures + sheets + captures.json in ${OUT}`);
process.exit(0);
