// EXPLOSION CAPTURE (2026-09-18): the explosion spike's curl + soft-fade A/B.
//
// Shoots the SAME ground burst at three fixed SIM times — early flash, mid
// fireball, smoke — for two looks:
//
//   baseline  curlStrength=0, softFade=0   the game's current look
//   curl      curlStrength, softFade on    the shared curl domain-warp + fade
//
// then composes a 2-column x 3-row side-by-side sheet. Output goes to
// docs/dev-notes/2026-09-18-explosion-curl/ (individual PNGs at full viewport
// resolution, plus sheet.png and captures.json).
//
//   node scripts/explosion-capture.mjs [outDir]
//   node scripts/explosion-capture.mjs --strength 0.85 --scale 2.6 --fade 0.35
//   node scripts/explosion-capture.mjs --clip [outDir]   staged box/floor cut
//   LAB_VITE_PORT=5255 LAB_CDP_PORT=9255 node scripts/explosion-capture.mjs
//
// DETERMINISM. The spike boots with `?paused=1&spawn=0`: its rAF loop is off,
// the sim clock starts at 0, and only `__explosionSpike.frame(dt)` advances it.
// The capture drives a fixed 1/60 s step sequence from a pinned spawn seed, so
// the baseline and curl runs reach the same SIM time even though they are two
// separate page loads (the wall clock never enters the sim). This is the
// flame-capture lesson: two page loads that each run their own rAF do NOT frame
// identically.
//
// THE A/B IS ALSO A GATE. A curl run whose frames are byte-identical to the
// baseline means the switch did not reach the shader (the exact silent failure
// the soft-fade guard exists for), so the fireball/smoke times must differ.
//
// SERVERS: the same lifecycle as scripts/lab-servers.sh / flame-capture.mjs —
// same ports (LAB_VITE_PORT / LAB_CDP_PORT), same reuse rule (only a server
// that serves OUR page is reused), same Chrome flags including the TMPDIR +
// crash-dumps redirect sandboxes need. Only what THIS script started is
// stopped, and only its own Chrome profile is removed.
//
// RENDERER GUARD: any `THREE.WebGPURenderer` pipeline/shader error on the
// console fails the run — a compile failure draws nothing and is never an
// acceptable capture (flame-capture's task-2 lesson).
//
// Exits 0 on success, 2 if it could not run (boot failure, page exception, no
// WebGPU backend, a flat frame, a curl run that changed nothing).
import { mkdirSync, writeFileSync, openSync, rmSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { inflateSync, deflateSync } from 'node:zlib';

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(2); };

// --- The look under test -----------------------------------------------------
// The curl look is READ BACK from the page's `?curl=1` boot (the page exports
// explosion-vfx-spike-main.ts's SPIKE_CURL_LOOK through stats()), so there is
// no second copy of the numbers to drift. `--strength/--scale/--fade` override
// individual fields for a sweep.
const CURL_OVERRIDE = {};
const BASE_LOOK = { curlStrength: 0, curlScale: 6, softFade: 0 };

const argv = [...process.argv];
for (const [flag, key] of [['--strength', 'curlStrength'], ['--scale', 'curlScale'], ['--fade', 'softFade']]) {
  const i = argv.indexOf(flag);
  if (i === -1) continue;
  const v = Number(argv[i + 1]);
  if (!Number.isFinite(v)) fail(`${flag} needs a number`);
  CURL_OVERRIDE[key] = v;
  argv.splice(i, 2);
}
// `--clip` stages the burst so it INTERSECTS the occluder box (and the floor),
// which is the case the soft fade exists for: the baseline cuts the quads on a
// straight edge, the fade turns the cut into a gradient. The default scene is
// the representative ground burst, whose fire grows UP from the floor and so
// barely intersects anything.
const CLIP = argv.includes('--clip');
if (CLIP) argv.splice(argv.indexOf('--clip'), 1);

const OUT = argv[2] ?? 'docs/dev-notes/2026-09-18-explosion-curl';
const VITE = Number(process.env.LAB_VITE_PORT ?? 5233);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9223);
const LAB_TMP = process.env.LAB_TMP ?? '/tmp';
const LAB_CHROME = process.env.LAB_CHROME
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1380, H = 820;
const STEP = 1 / 60;
// (sim seconds, name). Early = the ignition flash, mid = the fireball, late =
// the smoke cap; the burst's lifeSec is 1.5.
const TIMES = [
  { sec: 0.12, name: 'flash' },
  { sec: 0.55, name: 'fireball' },
  { sec: 1.15, name: 'smoke' },
];
// A ground burst at the origin, framed close enough to judge the plume and the
// floor intersection the soft fade exists for. Pinned seed: reproducible.
const SPAWN = CLIP
  ? { kind: 'air', at: [2.7, 1.3, -1.0], heightM: 1.8, seed: 2002 }
  : { kind: 'ground', at: [0, 0, 0], heightM: 2.0, seed: 1001 };
const CAM = CLIP
  ? [0.4, 1.7, 4.4, 2.7, 1.3, -1.4]   // px,py,pz, tx,ty,tz
  : [1.4, 2.1, 7.2, 0, 1.2, 0];
const MIN_LUMA_STD = 5;                    // a flatter frame is a broken frame
// A curl run that moved fewer than this fraction of pixels is not applying the
// curl/fade at all. Well under the real difference; only catches "nothing".
const MIN_CHANGED_FRAC = 0.005;
const PAGE_BASE = '/explosion-vfx-spike.html?spawn=0&paused=1';

setTimeout(() => { console.error('FAIL: watchdog (10 min)'); process.exit(2); }, 10 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

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

process.on('exit', killStarted);

async function stopStarted() {
  if (cleanupRan) return;
  cleanupRan = true;
  killStarted();
  for (const s of started) {
    const url = s.kind === 'vite'
      ? `http://localhost:${VITE}/`
      : `http://localhost:${CDP}/json/version`;
    // Being reaped is not the same as the port being free; poll until it answers
    // no more, THEN remove our own profile.
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
    console.log(`explosion-capture: starting vite on ${VITE}`);
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
    // Port busy: prove it is OUR dev server before reusing it (the 404 trap —
    // any vite answers `/`).
    if (!(await listening(`http://localhost:${VITE}${PAGE_BASE}`))) {
      fail(`port ${VITE} is busy but does not serve ${PAGE_BASE} — stop it or set LAB_VITE_PORT`);
    }
    console.log(`explosion-capture: reusing vite on ${VITE}`);
  }

  if (!(await listening(`http://localhost:${CDP}/json/version`))) {
    console.log(`explosion-capture: starting chrome (headless) on debug port ${CDP}`);
    const tmpDir = `${LAB_TMP}/tmp-${CDP}`;
    mkdirSync(tmpDir, { recursive: true });
    const profileDir = `${LAB_TMP}/chrome-explosion-${CDP}`;
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
    console.log(`explosion-capture: reusing chrome on debug port ${CDP}`);
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

// --- CDP client (flame-capture's prologue) ----------------------------------

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

// --- PNG decode / encode / stats (flame-capture's, trimmed) -----------------

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
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 6 })), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** How different two same-size frames are: fraction of pixels whose luma moved
 *  by more than 2/255, and the mean absolute luma delta. */
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

/** 2 columns (baseline | curl) x R rows (one per sim time). */
function composeSheet(rows, outPath) {
  const dec = rows.map(([l, r]) => [decodePng(l), decodePng(r)]);
  const fw = dec[0][0].w, fh = dec[0][0].h;
  const GAP = 10;
  const SW = fw * 2 + GAP * 3;
  const SH = fh * rows.length + GAP * (rows.length + 1);
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
  rows.forEach((_, r) => {
    const dy = GAP + r * (fh + GAP);
    blit(dec[r][0], GAP, dy);
    blit(dec[r][1], GAP * 2 + fw, dy);
  });
  writeFileSync(outPath, encodePng(canvas, SW, SH));
  return { w: SW, h: SH };
}

// --- The sweep --------------------------------------------------------------

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

let backend = 'unknown';

async function freshPage(url) {
  await send('Page.navigate', { url: `http://localhost:${VITE}${url}` });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    try {
      ready = await evaluate('typeof window.__explosionSpike === "object" && window.__explosionSpike.ready === true');
    } catch { /* page still booting */ }
    if (ready) break;
  }
  if (!ready) fail('__explosionSpike never became ready');
  // The driver owns the clock: the boot flag already paused, this is the guard.
  await evaluate('window.__explosionSpike.pause()');
  backend = await evaluate(`(() => {
    const m = document.body.textContent.match(/backend: (webgpu|webgl\\d*)/);
    return m ? m[1] : 'unknown';
  })()`);
  if (backend !== 'webgpu') fail(`backend is "${backend}" — not the WebGPU path`);
  // Hide the page overlays: this is a look capture, not a UI capture.
  await evaluate(`(() => {
    for (const sel of ['#controls', '#status', '#stats']) {
      const el = document.querySelector(sel);
      if (el) el.style.display = 'none';
    }
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

async function captureLook(variant) {
  await freshPage(`${PAGE_BASE}${variant === 'curl' ? '&curl=1' : ''}`);
  await evaluate(`window.__explosionSpike.setCamera(${CAM.join(',')})`);
  // The curl variant's values are whatever the page's ?curl=1 flag applied
  // (read from stats), with any CLI overrides layered on. The baseline is the
  // game's shipped zeros, pinned explicitly.
  let look;
  if (variant === 'curl') {
    const booted = await evaluate('window.__explosionSpike.stats()');
    look = {
      curlStrength: booted.curlStrength,
      curlScale: booted.curlScale,
      softFade: booted.softFade,
      ...CURL_OVERRIDE,
    };
  } else {
    look = BASE_LOOK;
  }
  // Pin the look explicitly through setTuning (the ?curl flag already did for
  // the curl run) and read back the CLAMPED tuning that landed.
  const applied = await evaluate(`window.__explosionSpike.setTuning(${JSON.stringify(look)})`);
  for (const [k, v] of Object.entries(look)) {
    if (Math.abs(applied[k] - v) > 1e-9) fail(`setTuning ${k}=${v} applied ${applied[k]}`);
  }
  const bursts = await evaluate(`window.__explosionSpike.spawn(${JSON.stringify(SPAWN)})`);
  if (!(bursts >= 1)) fail(`spawn produced ${JSON.stringify(bursts)} bursts`);

  let stepped = 0;
  for (const spec of TIMES) {
    const total = Math.round(spec.sec / STEP);
    while (stepped < total) {
      await evaluate(`window.__explosionSpike.frame(${STEP})`);
      stepped++;
    }
    await shoot(`${variant}-${spec.name}.png`, {
      variant, time: spec.name, sec: spec.sec, simSec: +(stepped * STEP).toFixed(4),
      look: applied, bootFlag: variant === 'curl',
    });
  }
  return applied;
}

const baselineLook = await captureLook('baseline');
const curlLook = await captureLook('curl');

// --- A/B gate + side-by-side sheet ------------------------------------------

const byFile = new Map(shots.map((s) => [s.file, s]));
const diffs = [];
for (const spec of TIMES) {
  const base = byFile.get(`baseline-${spec.name}.png`);
  const curl = byFile.get(`curl-${spec.name}.png`);
  const d = frameDiff(base.buf, curl.buf);
  diffs.push({ time: spec.name, ...d });
  console.log(`diff ${spec.name}: changed=${(d.changedFrac * 100).toFixed(2)}% meanAbs=${d.meanAbs.toFixed(2)}`);
}
// A curl run that changes nothing means the switch never reached the shader.
// The FLASH is small and easy to miss, so only the fireball and smoke are
// gated. A FADE-ONLY run (curlStrength 0) may legitimately leave the fireball
// untouched — the fire can sit entirely above the floor — so only the smoke,
// which is what reaches the floor and walls, is gated there.
function diffGate(look) {
  return look.curlStrength > 0 ? ['fireball', 'smoke'] : ['smoke'];
}
const mustChange = diffGate(curlLook);
for (const d of diffs) {
  if (mustChange.includes(d.time) && d.changedFrac < MIN_CHANGED_FRAC) {
    fail(`"${d.time}" frame changed only ${(d.changedFrac * 100).toFixed(2)}% of pixels — the curl/fade did not apply`);
  }
}

const rows = TIMES.map((spec) => [
  byFile.get(`baseline-${spec.name}.png`).buf,
  byFile.get(`curl-${spec.name}.png`).buf,
]);
const sheet = composeSheet(rows, `${OUT}/sheet.png`);
console.log(`sheet.png  (${sheet.w}x${sheet.h}: rows flash/fireball/smoke, columns baseline|curl)`);

// --- Guards -----------------------------------------------------------------

// A render pipeline that FAILS to compile draws nothing and logs through
// console.error. Refuse a run whose renderer reported one.
const rendererErrors = consoleErrors.filter((t) => /THREE\.WebGPURenderer.*(pipeline|ShaderModule|fragment error|unresolved value)/i.test(t));
if (rendererErrors.length > 0) fail(`renderer pipeline error: ${rendererErrors[0].slice(0, 300)}`);
const realExceptions = pageExceptions.filter((t) => !/NotFoundError|setPointerCapture/.test(t));
if (realExceptions.length > 0) fail(`page threw: ${realExceptions[0]}`);

writeFileSync(`${OUT}/captures.json`, JSON.stringify({
  url: PAGE_BASE, backend, viewport: { width: W, height: H }, step: STEP,
  scene: CLIP ? 'clip (airburst intersecting the occluder box)' : 'ground',
  times: TIMES, spawn: SPAWN, camera: CAM,
  baselineLook, curlLook: curlLook, diffs, sheet,
  shots: shots.map(({ buf, ...rest }) => rest),
}, null, 2));

await stopStarted();
console.log(`\n${shots.length} captures + sheet.png + captures.json in ${OUT}`);
process.exit(0);
