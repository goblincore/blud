// FLAME CAPTURE (2026-09-17): the flame lab's fixed pose set, shot at two
// burn stages, so surface-fire techniques can be judged side by side and this
// plan's surface look becomes the baseline the three tongue plans compare
// against (docs/superpowers/plans/2026-09-17-flame-lab-foundation.md, task 14).
//
//   6 poses x 2 stages = 12 PNGs + contact.png -> docs/dev-notes/2026-09-17-flame-lab/
//   close-fresh.png   burn=1 char=0   (single body fills most of the frame)
//   stand-fresh.png   burn=1 char=0   (engulfed, unburnt skin)
//   stand-charred.png burn=1 char=0.6 (engulfed, mostly charred)
//   contact.png       close-fresh + stand-fresh + stand-charred in a row,
//                     then the three Blood reference tiles (3321/3323/3325)
//                     scaled to the stand frames' body height, so the judge
//                     is one image rather than a folder.
//// POSES are driven through the PAGE'S OWN INPUT, not a console backdoor:
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
import { mkdirSync, writeFileSync, openSync, rmSync, readFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { inflateSync, deflateSync } from 'node:zlib';

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
const SETTLE_POSE = { close: 30, stand: 30, walk: 30, run: 30, collapsed: 90, distant: 15 };
const SETTLE_STAGE = 10;    // post-aa smear history flushed to <2e-6
const ZOOM_TICKS = 25;      // wheel ticks out: 3.2 + 25*0.2 -> clamped at 8
const CLOSE_TICKS = 9;      // wheel ticks in: 3.2 - 9*0.2 -> 1.4, one body cups the frame
const MIN_LUMA_STD = 5;     // a flatter frame is a broken frame (melt's gate)

const POSES = ['close', 'stand', 'walk', 'run', 'collapsed', 'distant'];
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
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
};
// A real drag along the canvas: the orbit camera reads pointermove while a
// button is held (camYaw -= dx * 0.008). Every event carries pointerType
// 'mouse' — without it a press that follows another click at the same point
// lands in Chrome's double-click window and the drag never reaches the page
// (probed 2026-09-17 — the probe diff across a fixed drag was 16.6 luma with
// pointerType, and the framing did not move without it). Origin is OFFSET
// from the spin-stop click for the same reason.
const dragBy = async (x, y, dx, dy) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'mouse' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x + (dx * i) / steps), y: Math.round(y + (dy * i) / steps), buttons: 1, pointerType: 'mouse' });
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
};
const wheelAt = async (x, y, deltaY) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
};
const frames = async (n) => {
  await evaluate(`new Promise((r) => { let n = 0; const t = () => (++n >= ${n} ? r(n) : requestAnimationFrame(t)); requestAnimationFrame(t); })`);
};

// A flat capture (stale viewport, GPU device lost) LOOKS like a normal file
// on disk — decode and refuse (melt's pngStats, luma over a sparse grid).
// The decoder covers what this script reads: 8-bit RGB(A) screenshots and the
// 8-bit palette Blood reference tiles (PLTE + tRNS), non-interlaced.
function decodePng(png) {
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  let plte = null, trns = null;
  while (off < png.length) {
    const len = png.readUInt32BE(off); const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    if (type === 'PLTE') plte = Buffer.from(data);
    if (type === 'tRNS') trns = Buffer.from(data);
    if (type === 'IEND') break;
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8 || ![2, 3, 6].includes(colorType)) return { unsupported: true };
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 3 ? 1 : colorType === 6 ? 4 : 3;
  const unfilter = (stride) => {
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
    return out;
  };
  if (colorType === 3) {
    const idx = unfilter(w);
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const p = idx[i];
      rgba[i * 4] = plte[p * 3]; rgba[i * 4 + 1] = plte[p * 3 + 1]; rgba[i * 4 + 2] = plte[p * 3 + 2];
      rgba[i * 4 + 3] = trns && p < trns.length ? trns[p] : 255;
    }
    return { w, h, rgba };
  }
  const chans = colorType === 6 ? 4 : 3;
  const out = unfilter(w * chans);
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = out[i * chans]; rgba[i * 4 + 1] = out[i * chans + 1]; rgba[i * 4 + 2] = out[i * chans + 2];
    rgba[i * 4 + 3] = chans === 4 ? out[i * chans + 3] : 255;
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

// --- contact sheet ----------------------------------------------------------

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

/** Nearest-neighbour scale — the tiles are UPscaled ~2.7x, where NN's crunch
 *  is the honest look (the page's own #reference strip draws them pixelated
 *  too, image-rendering: pixelated). */
function scaleNearest(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, (y * sh / dh) | 0);
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, (x * sw / dw) | 0);
      const s = (sy * sw + sx) * 4, d = (y * dw + x) * 4;
      dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; dst[d + 3] = src[s + 3];
    }
  }
  return dst;
}

// The tiles go in at the STAND frames' body height: the soldier spans head to
// heel roughly 265..660 px in the 1380x820 stand frames (measured on the fix
// pass captures), so ~400 px is "same body height" for the row's two stand
// bodies. The close frame's body is much larger; one sheet cannot match both.
const CONTACT_BODY_PX = 400;
const CONTACT_GAP = 12;
const CONTACT_BG = [16, 12, 14, 255];

function composeContact(frames, tiles, outPath) {
  const fdec = frames.map((f) => {
    const d = decodePng(f.buf);
    if (d.unsupported) fail(`${f.name}: not a decodable 8-bit RGB(A) PNG for the contact sheet`);
    return d;
  });
  const H = fdec[0].h;
  const tileDec = tiles.map((t) => {
    const d = decodePng(t.buf);
    if (d.unsupported) fail(`${t.file}: not a decodable 8-bit palette PNG`);
    const dw = Math.max(1, Math.round(d.w * CONTACT_BODY_PX / d.h));
    return { name: t.file, w: dw, h: CONTACT_BODY_PX, rgba: scaleNearest(d.rgba, d.w, d.h, dw, CONTACT_BODY_PX) };
  });
  const W = fdec.reduce((a, f) => a + f.w, 0) + tileDec.reduce((a, t) => a + t.w, 0) + CONTACT_GAP * (fdec.length + tileDec.length - 1);
  const canvas = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { canvas[i * 4] = CONTACT_BG[0]; canvas[i * 4 + 1] = CONTACT_BG[1]; canvas[i * 4 + 2] = CONTACT_BG[2]; canvas[i * 4 + 3] = 255; }
  const blit = (src, sw, sh, dx, dypix) => {
    for (let y = 0; y < sh; y++) {
      if (dypix + y < 0 || dypix + y >= H) continue;
      for (let x = 0; x < sw; x++) {
        const s = (y * sw + x) * 4, d = ((dypix + y) * W + dx + x) * 4;
        const a = src[s + 3] / 255;
        canvas[d] = src[s] * a + canvas[d] * (1 - a);
        canvas[d + 1] = src[s + 1] * a + canvas[d + 1] * (1 - a);
        canvas[d + 2] = src[s + 2] * a + canvas[d + 2] * (1 - a);
      }
    }
  };
  let x = 0;
  for (const f of fdec) { blit(f.rgba, f.w, f.h, x, 0); x += f.w + CONTACT_GAP; }
  for (const t of tileDec) { blit(t.rgba, t.w, t.h, x, (H - t.h) >> 1); x += t.w + CONTACT_GAP; }
  writeFileSync(outPath, encodePng(canvas, W, H));
  return { w: W, h: H, entries: [...fdec.map((f) => `${f.w}x${f.h}`), ...tileDec.map((t) => `${t.w}x${t.h}`)] };
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

  // Drive the pose through the page's own keys. The drag origin is 60 px
  // left of centre — the spin-stop click already fired there, and a press at
  // the same point inside Chrome's double-click window swallows the drag.
  // Drag right ~88 px runs yaw 0.35 down to ~-0.35, putting the ZOMBIE (the
  // burning SDF body) nearest the camera; then wheel in 9 ticks:
  // 3.2 - 9*0.2 -> 1.4, so one body cups most of the frame.
  if (pose === 'close') {
    await dragBy(Math.floor(W / 2) - 60, Math.floor(H / 2), 88, 0);
    for (let i = 0; i < CLOSE_TICKS; i++) await wheelAt(Math.floor(W / 2), Math.floor(H / 2), -120);
  }
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
    shots.push({ pose, stage: stage.name, char: stage.char, file: name, std: stats.std, buf });
    console.log(`${name}  (char=${stage.char}, luma std=${stats.std})`);
  }
}

// --- Contact sheet (fix pass task 4): the judge is one image -----------------
// close-fresh, stand-fresh and stand-charred in a row, then the three Blood
// reference tiles at body height. Shot buffers come straight from THIS run,
// so the sheet can never describe a stale folder.
const byName = (n) => {
  const s = shots.find((x) => x.file === n);
  if (!s) fail(`contact sheet: ${n} was not captured this run`);
  return { name: n, buf: s.buf };
};
const CONTACT_FRAMES = ['close-fresh.png', 'stand-fresh.png', 'stand-charred.png'].map(byName);
const CONTACT_TILES = ['3321.png', '3323.png', '3325.png'].map((f) => {
  const p = `public/assets/blood-tiles/${f}`;
  return { file: f, buf: readFileSync(p) }; // tracked reference tiles — dev-safe to read
});
const contact = composeContact(CONTACT_FRAMES, CONTACT_TILES, `${OUT}/contact.png`);
console.log(`contact.png  (${contact.w}x${contact.h}: ${contact.entries.join(' | ')})`);

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
  poses: POSES, stages: STAGES, contact: {
    file: 'contact.png', frames: CONTACT_FRAMES.map((f) => f.name),
    tiles: CONTACT_TILES.map((t) => t.file), bodyPx: CONTACT_BODY_PX,
  },
  shots: shots.map(({ buf, ...rest }) => rest),
}, null, 2));

await stopStarted();
console.log(`\n${shots.length} captures + contact.png + captures.json in ${OUT}`);
process.exit(0);
