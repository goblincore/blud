// scripts/zap-trace.mjs
//
// ZAP TRACE (tesla arc plan 2026-11-17-tesla-1-zap-state.md, Tasks 4 and 5). Proves the zap's glow on the
// flesh, and the skeleton showing in it, with NUMBERS, in the real game:
//
//   * a zombie the arc is put on (`__sdfGame.zapActor()`) reads phase 'zapped' at once, later 'statue',
//     and ends with glow 0 and char 1 (`__sdfGame.zaps()`, sampled every 0.25 s of sim time for 4 s);
//   * the centre 30% crop of the frame is brighter while it is zapped than before the zap, and darker
//     than before by the end (a charred corpse);
//   * the skeleton is in the glow (Task 5): on the first zapped sample and on the first jolt, the same frame
//     is drawn again with the bone meshes hidden (`meshSkeletonShow`, under `setRenderLock`), and the mean
//     absolute difference over the body's box is the skeleton's share of the picture. A third draw with the
//     bones shown again is the noise floor. `boneZap(id)` reads the glow the bone instances carry;
//   * the glow is one body's (the review of Task 4): with TWO zombies in the arena room and the arc on the
//     first-spawned one (its view is the crowd type's source, whose uniforms the crowd material copies every
//     frame), the other body's chest does not turn bluer while the zapped one's does. Bones hidden, so the
//     chest box is flesh. `ZAP_TRACE_BLEED_ONLY=1` runs this scenario alone;
//   * the zap compiles NO pipeline: `__sdfGame.pipelineLog().totalPipelines` is the same before and after;
//   * SLOT 9 (Task 6): the real weapon path. Slot 9 selected through `selectSlot('tesla')`, the aim put on the
//     body's torso (`aimSurface`), fire held through `fireTesla(true)`: the body reads 'zapped' within 0.2 s and
//     `tesla().target` is its id; on release it reads 'recovering' and ends with no glow and no char. Then, fire
//     still held, the aim turned well outside the stick angle drops it, and so does starting a switch to
//     another slot. A frame of the held zap shows the placeholder prop in hand. `ZAP_TRACE_TESLA_ONLY=1` runs
//     this scenario alone.
//
// The harness is scripts/burn-behaviour-trace.mjs's: own vite + headless Chrome on an unused port pair,
// the real page (/sdf-game.html?level=arena&spawn=zombie), the real renderer, the
// `window.__warmGate.phase === 'ready'` gate, a flat-frame luma gate and a renderer-pipeline-error
// guard. It saves a frame per sample and a contact sheet (PNGs under docs/dev-notes are gitignored).
//
// Usage: node scripts/zap-trace.mjs [vitePort] [cdpPort] [outDir]

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5541);
const CDP = Number(process.argv[3] ?? 9541);
const OUT = resolve(process.argv[4] ?? 'docs/dev-notes/2026-11-17-tesla-zap');
const LAB_TMP = resolve('.lab-tmp');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN_LUMA_STD = 5;
const DT = 1 / 60;
/** Sim frames per sample: 15 frames at 1/60 s is the 0.25 s the trace samples at. */
const SAMPLE_FRAMES = 15;
const SAMPLES = 16;

const report = {
  branch: (() => { try { return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })(),
  checks: {}, consoleErrors: [],
};
const consoleErrors = [];

const children = [];
let finished = false;
function shutdown(code) {
  if (finished) return;
  finished = true;
  try { writeFileSync(`${OUT}/zap-trace.json`, JSON.stringify(report, null, 2)); } catch { /* best effort */ }
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch { /* gone */ } }
  }
  setTimeout(() => process.exit(code), 500);
}
process.on('exit', () => { for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } } });
setTimeout(() => { console.error('WATCHDOG: trace exceeded 14 minutes'); shutdown(9); }, 14 * 60 * 1000);
const fail = (msg) => { throw new Error(msg); };

// ---------------------------------------------------------------------------
// PNG decode + luma stats (flare-ingame-capture.mjs's flat-frame gate).
// ---------------------------------------------------------------------------
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

/** The centre 30% of the frame (30% of each side): the plan's crop. At 2.8 m it is mostly the room behind the body. */
const CENTRE = [0.35, 0.65, 0.35, 0.65];
/** A box on the body's chest, below the crosshair and above the first-person gun: flesh and nothing else. */
const CHEST = [0.47, 0.53, 0.55, 0.66];

/** Mean luminance (0..255) and mean RGB of a box of the frame given as fractions [x0, x1, y0, y1], every pixel. */
function cropLuma(png, box = CENTRE) {
  const { w, h, rgba } = decodePng(png);
  const x0 = Math.round(w * box[0]), x1 = Math.round(w * box[1]), y0 = Math.round(h * box[2]), y1 = Math.round(h * box[3]);
  let n = 0, s = 0, r = 0, g = 0, b = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2];
      s += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      n++;
    }
  }
  return { mean: +(s / n).toFixed(2), rgb: [+(r / n).toFixed(1), +(g / n).toFixed(1), +(b / n).toFixed(1)] };
}

/** How near the close look at the x-ray stands to the body (m). */
const CLOSE_M = 1.1;
/** The body in the star, 2.6 to 3 m off: head to feet, hands included. */
const BODY = [0.36, 0.64, 0.10, 0.90];
/** Where slot 9's placeholder prop sits in the frame (lower right of centre): reported, to compare with slot 2 live. */
const PROP = [0.55, 0.75, 0.62, 0.92];
/** Mean absolute difference (0..255, over R, G and B) of two frames in a box, and the share of its pixels that
 *  moved by more than 24 in any channel. */
function boxDiff(pngA, pngB, box = BODY) {
  const a = decodePng(pngA), b = decodePng(pngB);
  const x0 = Math.round(a.w * box[0]), x1 = Math.round(a.w * box[1]), y0 = Math.round(a.h * box[2]), y1 = Math.round(a.h * box[3]);
  let n = 0, s = 0, moved = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.w + x) * 4;
      const d = [0, 1, 2].map((k) => Math.abs(a.rgba[i + k] - b.rgba[i + k]));
      s += (d[0] + d[1] + d[2]) / 3; n++;
      if (Math.max(...d) > 24) moved++;
    }
  }
  return { meanAbs: +(s / n).toFixed(2), movedShare: +(moved / n).toFixed(4) };
}

/** The un-zapped neighbour, with the camera turned to it: its head, chest and arms, wherever it has walked to. */
const NEIGHBOUR = [0.42, 0.78, 0.38, 0.66];
/** The luminance (0..255) that `q` of a box's pixels are under: 0.9 is the body's lit flesh (the body is about a fifth of the box), whatever share of the
 *  box is the dark room or the gun and wherever in the box the body stands. */
function boxPercentile(png, box, q) {
  const { w, h, rgba } = decodePng(png);
  const x0 = Math.round(w * box[0]), x1 = Math.round(w * box[1]), y0 = Math.round(h * box[2]), y1 = Math.round(h * box[3]);
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * w + x) * 4;
    hist[Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2])]++; n++;
  }
  let acc = 0;
  for (let l = 0; l < 256; l++) { acc += hist[l]; if (acc >= q * n) return l; }
  return 255;
}

/** The head, with the camera level on the body from 2.6 m: the skull and, on a split head, its turned halves. */
const HEAD = [0.44, 0.56, 0.43, 0.53];
/**
 * THE X-RAY SKULL'S FOOTPRINT in the glow: the pixels of the head box that are at least 60 of 255 darker with the
 * bones shown than with them hidden (dark bone over bright flesh), as an area, and as a width: the columns with
 * three or more such pixels. A closed skull is one oval; a split one is the rest and two halves swung apart about
 * the hinge, clipped along the fracture, so it is wider and has bright flesh showing between its pieces.
 */
function skullFootprint(pngShown, pngHidden, box = HEAD) {
  const a = decodePng(pngShown), b = decodePng(pngHidden);
  const x0 = Math.round(a.w * box[0]), x1 = Math.round(a.w * box[1]), y0 = Math.round(a.h * box[2]), y1 = Math.round(a.h * box[3]);
  const luma = (d, i) => 0.299 * d.rgba[i] + 0.587 * d.rgba[i + 1] + 0.114 * d.rgba[i + 2];
  let area = 0, width = 0, first = -1, last = -1;
  for (let x = x0; x < x1; x++) {
    let col = 0;
    for (let y = y0; y < y1; y++) { const i = (y * a.w + x) * 4; if (luma(b, i) - luma(a, i) > 60) col++; }
    area += col;
    if (col >= 3) { width++; if (first < 0) first = x; last = x; }
  }
  // Gaps: columns between the first and the last skull column that hold no skull (bright flesh between the pieces).
  return { area, width, span: first < 0 ? 0 : last - first + 1, gaps: first < 0 ? 0 : last - first + 1 - width };
}

async function waitFor(url, what, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up */ }
    await sleep(500);
  }
  throw new Error(`${what} never came up at ${url}`);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(`${LAB_TMP}/tmp-${CDP}`, { recursive: true });

for (const [port, what] of [[VITE, 'vite'], [CDP, 'chrome']]) {
  try {
    const r = await fetch(`http://localhost:${port}/`);
    if (r.status >= 0) { console.error(`port ${port} (${what}) is already answering — choose another`); process.exit(2); }
  } catch { /* connection refused = free */ }
}

console.log(`starting vite on ${VITE}`);
const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(VITE), '--strictPort'], {
  stdio: 'ignore', detached: true,
});
children.push(vite);
await waitFor(`http://localhost:${VITE}/`, 'vite');

console.log(`starting headless chrome on ${CDP}`);
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${LAB_TMP}/chrome-zaptrace-${CDP}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-crash-reporter', `--crash-dumps-dir=${LAB_TMP}/crashpad-zaptrace-${CDP}`,
  '--window-size=960,600',
  'about:blank',
], { stdio: 'ignore', detached: true, env: { ...process.env, TMPDIR: `${LAB_TMP}/tmp-${CDP}` } });
children.push(chrome);
await waitFor(`http://localhost:${CDP}/json/version`, 'chrome debug port');

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = () => err(new Error('ws')); });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    consoleErrors.push(text); report.consoleErrors.push(text.slice(0, 300));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const text = JSON.stringify(m.params.exceptionDetails).slice(0, 300);
    consoleErrors.push(text); report.consoleErrors.push(text);
  }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, timeoutMs = 30000) => {
  const reply = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
    sleep(timeoutMs).then(() => ({ __timeout: true })),
  ]);
  if (reply.__timeout) throw new Error(`Runtime.evaluate timed out after ${timeoutMs}ms: ${expression.slice(0, 90)}`);
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 600));
  return reply.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 600, deviceScaleFactor: 1, mobile: false });

/** Boot the game and wait for the REAL warm outcome (phase === 'ready'). */
async function bootGame(query = '') {
  const q = new URLSearchParams(query.replace(/^\?/, ''));
  if (!q.has('seed')) q.set('seed', '20261117');
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${q.toString()}` });
  let ok = false;
  for (let i = 0; i < 240 && !ok; i++) {
    await sleep(500);
    ok = await evaluate('typeof window.__sdfGame === "object"').catch(() => false);
  }
  if (!ok) throw new Error(`__sdfGame never booted (${query || 'no query'})`);
  let gate = null;
  for (let i = 0; i < 180 && !gate; i++) {
    gate = await evaluate('window.__warmGate ?? null').catch(() => null);
    if (!gate) await sleep(500);
  }
  if (!gate) {
    const loader = await evaluate(`document.getElementById('loader')?.textContent?.trim() ?? ''`).catch(() => '?');
    throw new Error(`warm gate never settled after 90 s (${query || 'no query'}); loader says: ${loader.slice(0, 120)}`);
  }
  if (gate.phase !== 'ready') {
    throw new Error(`boot did not reach READY (${query || 'no query'}): warm gate phase '${gate.phase}'`
      + (gate.phase === 'device-lost' ? ' — often GPU contention from another WebGPU page or capture running at the same time' : ''));
  }
  await sleep(1500);
  await evaluate(`(() => {
    const g = window.__sdfGame;
    for (const fn of ['shutterPanel','gooPanel','vhsPanel','dynamitePanel','woundPanel']) {
      try { if (typeof g[fn] === 'function') g[fn](false); } catch {}
    }
    return true;
  })()`);
  await sleep(2500);
}

async function capture(name, note = '') {
  const shot = await Promise.race([
    send('Page.captureScreenshot', { format: 'png' }),
    sleep(20000).then(() => ({ __timeout: true })),
  ]);
  if (shot.__timeout) fail(`Page.captureScreenshot timed out for ${name}`);
  const buf = Buffer.from(shot.result.data, 'base64');
  const stats = pngStats(buf);
  const crop = cropLuma(buf);
  const chest = cropLuma(buf, CHEST);
  if (stats.unsupported) fail(`${name}: not a decodable 8-bit RGB(A) PNG`);
  if ((stats.std ?? 0) < MIN_LUMA_STD) fail(`${name}: flat frame (luma std ${stats.std} < ${MIN_LUMA_STD}) — nothing rendered`);
  writeFileSync(`${OUT}/zap-${name}.png`, buf);
  console.log(`  ${name}: luma std=${stats.std} mean=${stats.mean} centre=${crop.mean} chest=${chest.mean} chestRgb=${chest.rgb.join(',')}`);
  return { name, note, png: buf, b64: shot.result.data, lumaStd: stats.std, lumaMean: stats.mean, centreLuma: crop.mean, centreRgb: crop.rgb, chestLuma: chest.mean, chestRgb: chest.rgb };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

const step = (frames) => evaluate(`window.__sdfGame.step(${frames}, ${DT})`, 180000);

/** Turn the player (who does not move) to face actor `id`'s chest, so the body sits in the centre crop. */
async function frameOn(id) {
  return evaluate(`(() => {
    const g = window.__sdfGame;
    const p = g.playerPos();
    const a = g.actorTrace().find(x => x.id === ${id});
    if (!a) return null;
    const dx = a.pos[0] - p[0], dz = a.pos[2] - p[2];
    g.setPose(p[0], p[2], Math.atan2(dx, -dz), 0);
    return +Math.hypot(dx, dz).toFixed(2);
  })()`);
}

/**
 * THE SKELETON'S SHARE of the frame on screen: the same sim instant drawn three times under the render lock,
 * bones shown, bones and eyes hidden, bones shown again. Shown against hidden is the skeleton; shown against
 * shown again is what two draws of one instant differ by anyway. The sim does not advance.
 */
async function xrayPair(tag, id) {
  const boneZap = await evaluate(`window.__sdfGame.boneZap(${id})`);
  const drawn = await evaluate(`(() => { const s = window.__sdfGame.skeletonMesh?.(); return s ? { segments: s.segments, hidden: s.hidden } : null; })()`).catch(() => null);
  await evaluate('window.__sdfGame.setRenderLock(true)');
  await step(2);
  const shown = await capture(`xray-${tag}-shown`, `${tag}: bones shown`);
  await evaluate('window.__sdfGame.meshSkeletonShow({ bones: false, eyes: false })');
  await step(2);
  const hidden = await capture(`xray-${tag}-hidden`, `${tag}: bones hidden`);
  await evaluate('window.__sdfGame.meshSkeletonShow({ bones: true, eyes: true })');
  await step(2);
  const again = await capture(`xray-${tag}-shown-again`, `${tag}: bones shown again`);
  await evaluate('window.__sdfGame.setRenderLock(false)');
  const out = {
    boneZap: boneZap ? { instances: boneZap.length, min: Math.min(...boneZap), max: Math.max(...boneZap) } : null,
    drawn,
    skeleton: boxDiff(shown.png, hidden.png), noise: boxDiff(shown.png, again.png),
    bodyLumaShown: cropLuma(shown.png, BODY).mean, bodyLumaHidden: cropLuma(hidden.png, BODY).mean,
    skull: skullFootprint(shown.png, hidden.png),
  };
  console.log(`  xray ${tag}: ${JSON.stringify(out)}`);
  return { ...out, hiddenChest: { luma: hidden.chestLuma, rgb: hidden.chestRgb }, shots: [shown, hidden] };
}

/**
 * A SPLIT HEAD UNDER THE ARC (Task 5). `closedSkull`: the closed head's x-ray footprint from the main series, when
 * it ran.
 */
async function splitScenario(closedSkull) {
  // The split skull's batches are the ones at the vertex-buffer limit (8: mesh-renderer.ts splitRows), and no
  // closed head draws them. A fresh boot, the head forced open, then the zap: the split copies must carry the
  // glow and the renderer must log no pipeline error.
  await bootGame('?level=arena&spawn=zombie');
  await evaluate('window.__sdfGame.setBloodBlur(false)');
  await step(30);
  const id2 = (await evaluate('window.__sdfGame.actorTrace().map(a => a.id)'))[0];
  await frameOn(id2);
  const forced = await evaluate(`window.__sdfGame.forceSplit(${id2}, "middle", 0, 0, 1)`);
  await step(5);
  const zapped2 = await evaluate(`window.__sdfGame.zapActor(${id2})`);
  await step(SAMPLE_FRAMES);
  const splitShot = await capture('xray-split-head', 'split head, zapped');
  // The same instant with the bones shown and hidden: the x-ray skull's footprint.
  const splitPair = await xrayPair('split', id2);
  const split = await evaluate(`(() => {
    const g = window.__sdfGame, d = g.skullDrawn(${id2}), z = g.boneZap(${id2}), q = g.zaps().find(x => x.id === ${id2});
    return { copies: d ? d.copies.map(c => ({ material: c.material, piece: c.piece, eye: c.eye })) : null,
      instances: z ? z.length : 0, zapMin: z && z.length ? Math.min(...z) : null, zapMax: z && z.length ? Math.max(...z) : null,
      phase: q ? q.phase : 'none', invert: q ? q.invert : null };
  })()`);
  // The same body from CLOSE_M away: is the skeleton still in register with the flesh, and does a bone pulled
  // toward the eye come through the first-person gun? (The sim runs: the render lock holds the camera too.)
  await evaluate(`(() => {
    const g = window.__sdfGame, p = g.playerPos(), a = g.actorTrace().find(x => x.id === ${id2});
    const dx = a.pos[0] - p[0], dz = a.pos[2] - p[2], d = Math.hypot(dx, dz);
    g.setPose(a.pos[0] - dx / d * ${CLOSE_M}, a.pos[2] - dz / d * ${CLOSE_M}, Math.atan2(dx, -dz), 0);
  })()`);
  await step(3);
  const closeShot = await capture('xray-close', `zapped, from ${CLOSE_M} m`);
  split.closeDistance = await evaluate(`(() => { const g = window.__sdfGame, p = g.playerPos(), a = g.actorTrace().find(x => x.id === ${id2});
    return +Math.hypot(a.pos[0] - p[0], a.pos[2] - p[2]).toFixed(2); })()`);
  split.closeZap = await evaluate(`window.__sdfGame.zaps().find(x => x.id === ${id2}) ?? null`);
  split.skull = splitPair.skull;
  split.closedSkull = closedSkull;
  report.checks.splitHead = { forced, zapped: zapped2, ...split };
  console.log('split head under the arc:', JSON.stringify(report.checks.splitHead));
  if (!forced || zapped2 !== 1) fail(`the split check did not set up: forceSplit ${forced}, zapActor ${zapped2}`);
  if (!split.copies || split.copies.length < 2) fail(`the forced split drew ${split.copies?.length ?? 0} skull copies`);
  if (!(Math.abs(split.zapMin) > 0 && Math.abs(split.zapMax) > 0)) fail(`the split body's bones carry iZap ${split.zapMin}..${split.zapMax}`);
  // THE SPLIT SHOWS IN THE X-RAY (second review pass). The split materials clip each copy to its piece at the
  // bone's TRUE place; clipped at the pulled place both halves were discarded whole and the unclipped rest drew a
  // closed skull. A split skull's footprint is wider than a closed one's and has flesh showing between its pieces.
  if (!(split.skull.width >= SPLIT_SKULL_MIN_WIDTH)) fail(`the zapped split head draws a closed skull: its x-ray footprint is ${split.skull.width} columns wide (${JSON.stringify(split.skull)}), under ${SPLIT_SKULL_MIN_WIDTH}`);
  if (closedSkull && !(split.skull.width > closedSkull.width * 1.15)) fail(`the zapped split skull (${split.skull.width} columns) is no wider than the closed one (${closedSkull.width})`);
  return { splitShot, closeShot, splitPair };
}

const blue = (rgb) => +(rgb[2] - rgb[0]).toFixed(1);
const BLEED_ONLY = process.env.ZAP_TRACE_BLEED_ONLY === '1';
const SPLIT_ONLY = process.env.ZAP_TRACE_SPLIT_ONLY === '1';
/** The most the un-zapped body's chest may darken while its neighbour chars (a share of its luminance). */
const CHAR_FALL_MAX = 0.12;
/** The least width (columns of the 960 px frame) of a zapped split skull's footprint; a closed skull is narrower. */
const SPLIT_SKULL_MIN_WIDTH = 57;
const TESLA_ONLY = process.env.ZAP_TRACE_TESLA_ONLY === '1';
/** Where the slot-9 scenario stands the player from the body (m). */
const TESLA_STANDOFF_M = 2.6;
/** Sim frames per slot-9 sample: 6 frames at 1/60 s is 0.1 s. */
const TESLA_FRAMES = 6;

/**
 * SLOT 9, HELD (Task 6): the weapon's own path, from the slot select to the release. A fresh boot. Returns the
 * frames it took (the held zap, with the prop in hand, first).
 */
async function teslaScenario() {
  await bootGame('?level=arena&spawn=zombie');
  await evaluate('window.__sdfGame.setBloodBlur(false)');
  await step(30);
  const id = (await evaluate('window.__sdfGame.actorTrace().map(a => a.id)'))[0];
  const distance = await frameOn(id);
  const zapOf = async () => (await evaluate('window.__sdfGame.zaps()')).find((x) => x.id === id) ?? null;
  const state = async (t) => {
    const z = await zapOf(), h = await evaluate('window.__sdfGame.tesla()');
    return { t: +t.toFixed(2), phase: z?.phase ?? 'none', glow: z ? +z.glow.toFixed(3) : 0, char: z ? +z.char.toFixed(3) : 0, held: h.held, target: h.target };
  };
  /** Put the crosshair on the body's torso: the reticle home, the view turned onto the torso cluster. The player is
   *  first stood TESLA_STANDOFF_M from the body where it is NOW (a recovered zombie walks up to the player, and aimSurface
   *  refuses a body nearer than its 1.5 m standoff). */
  const aimOn = async () => {
    const ok = await evaluate(`(() => {
      const g = window.__sdfGame, p = g.playerPos(), a = g.actorTrace().find(x => x.id === ${id});
      const dx = a.pos[0] - p[0], dz = a.pos[2] - p[2], d = Math.hypot(dx, dz) || 1;
      g.setPose(a.pos[0] - dx / d * ${TESLA_STANDOFF_M}, a.pos[2] - dz / d * ${TESLA_STANDOFF_M}, Math.atan2(dx, -dz), 0);
      g.setAimPoint(0, 0);
      return g.aimSurface('torso', ${id});
    })()`);
    if (!ok) fail('aimSurface did not find the body');
    return ok;
  };
  /** Turn the view `rad` to the side of the body, level: far outside the stick angle. */
  const aimAway = (rad) => evaluate(`(() => {
    const g = window.__sdfGame, p = g.playerPos(), a = g.actorTrace().find(x => x.id === ${id});
    g.setPose(p[0], p[2], Math.atan2(a.pos[0] - p[0], -(a.pos[2] - p[2])) + ${rad}, 0);
    return true;
  })()`);
  const slotState = () => evaluate('(() => { const d = window.__sdfGame.dynamite(); return { live: d.live, target: d.target, phase: d.phase, ready: d.ready }; })()');
  const untilReady = async (slot) => {
    for (let i = 0; i < 60; i++) {
      const s = await slotState();
      if (s.ready && s.live === slot) return i * 2;
      await step(2);
    }
    fail(`slot ${slot} never came up: ${JSON.stringify(await slotState())}`);
  };

  const pipelinesBefore = await evaluate('window.__sdfGame.pipelineLog().totalPipelines');
  const selected = await evaluate(`window.__sdfGame.selectSlot('tesla')`);
  const raiseFrames = await untilReady('tesla');
  const aimed = await aimOn();
  await step(2);
  const idle = await state(0);
  const idleShot = await capture('tesla-00-idle', 'slot 9, fire not held');

  // ---- HOLD 0.6 s, then RELEASE and 1.2 s more ---------------------------------
  await evaluate('window.__sdfGame.fireTesla(true)');
  const hold = [], shots = [];
  for (let i = 1; i <= 6; i++) {
    await step(TESLA_FRAMES);
    hold.push(await state(i * TESLA_FRAMES * DT));
    if (i === 3) shots.push(await capture('tesla-01-held', 'slot 9 held: zapped, prop in hand'));
  }
  await evaluate('window.__sdfGame.fireTesla(false)');
  const release = [];
  for (let i = 1; i <= 12; i++) {
    await step(TESLA_FRAMES);
    release.push(await state(i * TESLA_FRAMES * DT));
    if (i === 1) shots.push(await capture('tesla-02-released', 'slot 9 released: recovering'));
  }

  // ---- (a) STILL HELD, THE AIM TURNED AWAY ------------------------------------
  await aimOn();
  await evaluate('window.__sdfGame.fireTesla(true)');
  await step(TESLA_FRAMES * 2);
  const awayBefore = await state(0);
  await aimAway(0.6);   // 34 degrees
  await step(2);
  const awayAfter = await state(2 * DT);
  shots.push(await capture('tesla-03-aim-away', 'held, aim 34 deg off: dropped'));
  await step(TESLA_FRAMES);
  const awayLater = await state((2 + TESLA_FRAMES) * DT);

  // ---- (b) STILL HELD, BACK ON THE BODY, THEN A SLOT SWITCH -------------------
  await aimOn();
  await step(TESLA_FRAMES * 2);
  const switchBefore = await state(0);
  const switched = await evaluate(`window.__sdfGame.selectSlot('shotgun')`);
  await step(2);
  const switchAfter = await state(2 * DT);
  const switchSlot = await slotState();
  await untilReady('shotgun');
  await step(TESLA_FRAMES);
  const switchLater = await state(0);
  shots.push(await capture('tesla-04-switched', 'held, switched to slot 2: dropped'));
  // Back to slot 9 with fire never released: the arc comes back on by itself.
  await evaluate(`window.__sdfGame.selectSlot('tesla')`);
  await untilReady('tesla');
  await step(TESLA_FRAMES);
  const backOn = await state(0);
  await evaluate('window.__sdfGame.fireTesla(false)');
  await step(2);
  const end = await state(0);
  const pipelinesAfter = await evaluate('window.__sdfGame.pipelineLog().totalPipelines');

  const out = { id, distance, selected, raiseFrames, aimed, idle, hold, release,
    aimAway: { before: awayBefore, after: awayAfter, later: awayLater },
    slotSwitch: { before: switchBefore, switched, slot: switchSlot, after: switchAfter, later: switchLater, backOn, end },
    pipelines: { before: pipelinesBefore, after: pipelinesAfter },
    propBox: { idle: cropLuma(idleShot.png, PROP), held: cropLuma(shots[0].png, PROP), switched: cropLuma(shots[3].png, PROP) } };
  report.checks.tesla = out;
  const line = (xs) => xs.map((s) => `${s.t.toFixed(2)}:${s.phase}${s.target === id ? '*' : ''}`).join(' ');
  console.log('slot 9:', JSON.stringify({ selected, raiseFrames, aimed, distance, idle }));
  console.log('  hold    (* = the arc is on it):', line(hold));
  console.log('  release:', line(release), '| last', JSON.stringify(release[release.length - 1]));
  console.log('  aim away:', JSON.stringify(out.aimAway));
  console.log('  slot switch:', JSON.stringify(out.slotSwitch));
  console.log('  pipelines:', JSON.stringify(out.pipelines), 'prop box:', JSON.stringify(out.propBox));

  if (!selected?.ok) fail(`selectSlot('tesla') refused: ${JSON.stringify(selected)}`);
  if (idle.phase !== 'none' || idle.target !== -1) fail(`slot 9 zapped the body with fire not held: ${JSON.stringify(idle)}`);
  const early = hold.filter((s) => s.t <= 0.2 + 1e-6);
  if (!early.some((s) => s.phase === 'zapped' && s.target === id)) fail(`no sample within 0.2 s of fire is zapped with the arc on the body: ${JSON.stringify(early)}`);
  if (!hold.every((s) => s.phase === 'zapped' && s.target === id)) fail(`the arc did not stay on the body through the hold: ${line(hold)}`);
  if (release[0].phase !== 'recovering' || release[0].target !== -1) fail(`the first sample after release is ${JSON.stringify(release[0])}, not recovering with no target`);
  const last = release[release.length - 1];
  if (!(last.phase === 'none' && last.glow === 0 && last.char === 0)) fail(`1.2 s after release the body still carries the zap: ${JSON.stringify(last)}`);
  if (awayBefore.phase !== 'zapped' || awayBefore.target !== id) fail(`(a) the second hold did not zap the body: ${JSON.stringify(awayBefore)}`);
  if (awayAfter.phase !== 'recovering' || awayAfter.target !== -1 || !awayAfter.held) fail(`(a) with fire held and the aim 34 degrees off, the body is ${JSON.stringify(awayAfter)}, not recovering`);
  if (awayLater.phase === 'zapped' || awayLater.target !== -1) fail(`(a) the arc came back with the aim still away: ${JSON.stringify(awayLater)}`);
  if (switchBefore.phase !== 'zapped' || switchBefore.target !== id || !switchBefore.held) fail(`(b) aiming back at the body with fire still held did not zap it: ${JSON.stringify(switchBefore)}`);
  if (!switched?.ok) fail(`(b) selectSlot('shotgun') refused: ${JSON.stringify(switched)}`);
  if (switchAfter.phase !== 'recovering' || switchAfter.target !== -1 || !switchAfter.held) fail(`(b) with fire held and the slot switching (${JSON.stringify(switchSlot)}), the body is ${JSON.stringify(switchAfter)}, not recovering`);
  if (switchLater.phase === 'zapped' || switchLater.target !== -1) fail(`(b) the arc is on the body with slot 2 live: ${JSON.stringify(switchLater)}`);
  if (backOn.phase !== 'zapped' || backOn.target !== id) fail(`(b) back on slot 9 with fire still held, the body is ${JSON.stringify(backOn)}`);
  if (end.target !== -1 || end.held) fail(`the scenario ended with the arc on: ${JSON.stringify(end)}`);
  if (pipelinesAfter !== pipelinesBefore) fail(`slot 9 compiled pipelines: ${pipelinesBefore} -> ${pipelinesAfter}`);
  return [...shots, idleShot];
}

try {
  if (SPLIT_ONLY) { await splitScenario(null); console.log('\nDONE (split scenario only)'); shutdown(0); await sleep(5000); }
  if (TESLA_ONLY) {
    await teslaScenario();
    const errs = consoleErrors.filter((t) => /THREE\.WebGPURenderer.*(pipeline|ShaderModule|fragment error|unresolved value)/i.test(t));
    if (errs.length > 0) fail(`renderer pipeline error: ${errs[0].slice(0, 300)}`);
    console.log('\nDONE (slot 9 scenario only)'); shutdown(0); await sleep(5000);
  }
  // ---- TWO BODIES, ONE ARC (the crowd type's shared uniforms) -----------------
  await bootGame('?level=arena&spawn=zombie');
  report.checks.warmGate = 'ready';
  await evaluate('window.__sdfGame.setBloodBlur(false)');
  await step(30);
  const idA = (await evaluate('window.__sdfGame.actorTrace().map(a => a.id)'))[0];
  await frameOn(idA);
  // The bodies must be drawn by the CROWD material (one per type, its uniforms copied from the source view): until
  // its program is compiled in the background the game draws each body through its own view, which cannot bleed.
  let crowdJob = null;
  for (let i = 0; i < 480; i++) {
    crowdJob = await evaluate('window.__sdfGame.warmBackground().crowd ?? null');
    if (crowdJob === 'ready' || crowdJob?.state === 'ready' || crowdJob === 'failed' || crowdJob?.state === 'failed') break;
    await step(1); await sleep(500);
  }
  console.log('crowd program:', JSON.stringify(crowdJob));
  // A second zombie beside the first, the same distance from the player, 1.4 m to its side.
  const spawned = await evaluate(`(() => {
    const g = window.__sdfGame, p = g.playerPos(), a = g.actorTrace().find(x => x.id === ${idA});
    const dx = a.pos[0] - p[0], dz = a.pos[2] - p[2], d = Math.hypot(dx, dz);
    return g.spawnDebugCharacter('zombie', [a.pos[0] - dz / d * 1.4, a.pos[1], a.pos[2] + dx / d * 1.4]);
  })()`);
  const idB = spawned.id;
  await evaluate('window.__sdfGame.meshSkeletonShow({ bones: false, eyes: false })');
  await step(20);
  const crowd = await evaluate(`(() => {
    const g = window.__sdfGame, dump = g.crowdSlotDump();
    return { on: g.crowdInfo().on, program: g.warmBackground().crowd, bodies: g.actorTrace().length,
      rows: Object.entries(dump).flatMap(([type, rows]) => rows.map(r => ({ type, actor: r.actor, slot: r.slot, isSource: r.isSource, room: r.room }))) };
  })()`);
  /** Aim at `id` and take the frame: its chest is the CHEST box. */
  const look = async (id, name, note) => { await frameOn(id); await step(2); return capture(name, note); };
  const bBefore = await look(idB, 'bleed-b-before', 'two bodies: the other, before');
  const aBefore = await look(idA, 'bleed-a-before', 'two bodies: the first, before');
  const zappedA = await evaluate(`window.__sdfGame.zapActor(${idA})`);
  await step(SAMPLE_FRAMES - 4);
  const bZapped = await look(idB, 'bleed-b-zapped', 'two bodies: the other, arc on the first');
  const zapAtB = await evaluate(`window.__sdfGame.zaps()`);
  const aZapped = await look(idA, 'bleed-a-zapped', 'two bodies: the first, zapped');
  const zapAtA = await evaluate(`window.__sdfGame.zaps()`);
  // THE CHAR (second review pass): hold the arc on the first body until it has cooked (char 0.8, or the statue).
  // The zap's char must be that body's alone too: the other's chest must not darken as the first one chars.
  let cooked = null;
  for (let i = 0; i < 60; i++) {
    cooked = (await evaluate(`window.__sdfGame.zaps()`)).find((x) => x.id === idA) ?? null;
    if (cooked && (cooked.char >= 0.8 || cooked.phase === 'statue')) break;
    await step(4);
  }
  const bCooked = await look(idB, 'bleed-b-cooked', 'two bodies: the other, the first charred');
  const aCooked = await look(idA, 'bleed-a-cooked', 'two bodies: the first, charred');
  const cookedAt = (await evaluate(`window.__sdfGame.zaps()`)).find((x) => x.id === idA) ?? null;
  await evaluate('window.__sdfGame.meshSkeletonShow({ bones: true, eyes: true })');
  const bleed = {
    crowd, spawned, zapped: zappedA, zapsAtOther: zapAtB, zapsAtFirst: zapAtA,
    first: { beforeRgb: aBefore.chestRgb, zappedRgb: aZapped.chestRgb, blueMinusRedBefore: blue(aBefore.chestRgb), blueMinusRedZapped: blue(aZapped.chestRgb),
      shift: +(blue(aZapped.chestRgb) - blue(aBefore.chestRgb)).toFixed(1) },
    other: { beforeRgb: bBefore.chestRgb, zappedRgb: bZapped.chestRgb, blueMinusRedBefore: blue(bBefore.chestRgb), blueMinusRedZapped: blue(bZapped.chestRgb),
      shift: +(blue(bZapped.chestRgb) - blue(bBefore.chestRgb)).toFixed(1), lumaBefore: bBefore.chestLuma, lumaZapped: bZapped.chestLuma },
    char: {
      first: cookedAt ? { phase: cookedAt.phase, char: +cookedAt.char.toFixed(3) } : null,
      firstLuma: { before: aBefore.chestLuma, cooked: aCooked.chestLuma, rgb: aCooked.chestRgb },
      // The other body walks toward the player all the while, so its chest box drifts off its chest (reported, not
      // gated). Its flesh is read as the 90th-percentile luminance of a wide box round it instead.
      otherChestLuma: { before: bBefore.chestLuma, arcOn: bZapped.chestLuma, cooked: bCooked.chestLuma, rgb: bCooked.chestRgb },
      otherFlesh: { before: boxPercentile(bBefore.png, NEIGHBOUR, 0.9), arcOn: boxPercentile(bZapped.png, NEIGHBOUR, 0.9), cooked: boxPercentile(bCooked.png, NEIGHBOUR, 0.9) },
      // The other body's flesh against itself before any char: its fall, as a share.
      otherFall: +(1 - boxPercentile(bCooked.png, NEIGHBOUR, 0.9) / Math.min(boxPercentile(bBefore.png, NEIGHBOUR, 0.9), boxPercentile(bZapped.png, NEIGHBOUR, 0.9))).toFixed(3),
    },
  };
  report.checks.bleed = bleed;
  console.log('two bodies, one arc:', JSON.stringify(bleed));
  const bleedShots = [bBefore, aBefore, bZapped, aZapped, bCooked, aCooked];
  const srcRow = crowd.rows.find((r) => r.actor === idA), otherRow = crowd.rows.find((r) => r.actor === idB);
  if (!(crowd.program === 'ready' || crowd.program?.state === 'ready')) fail(`the crowd program is not ready (${JSON.stringify(crowd.program)}): the bodies are drawn one view each, which proves nothing about the crowd`);
  if (!crowd.on || !srcRow?.isSource || !otherRow || otherRow.isSource || otherRow.type !== srcRow.type) fail(`the two-body scenario is not arranged: crowd ${JSON.stringify(crowd)}`);
  if (zappedA !== 1 || zapAtB.length !== 1 || zapAtB[0].id !== idA || zapAtB[0].invert || zapAtA[0]?.invert) fail(`the two-body zap is not the first body's alone, un-inverted: ${JSON.stringify([zapAtB, zapAtA])}`);
  if (!(bleed.first.shift > 20)) fail(`the zapped body did not turn bluer: blue - red moved ${bleed.first.shift}`);
  if (!(Math.abs(bleed.other.shift) < 8)) fail(`THE GLOW BLEEDS: the un-zapped body's chest moved ${bleed.other.shift} in blue - red (${bleed.other.blueMinusRedBefore} -> ${bleed.other.blueMinusRedZapped}) with the arc on the other body`);
  if (!bleed.char.first || !(bleed.char.first.char >= 0.8)) fail(`the first body did not cook: ${JSON.stringify(bleed.char.first)}`);
  if (!(bleed.char.otherFall < CHAR_FALL_MAX)) fail(`THE CHAR BLEEDS: the un-zapped body's flesh fell ${(bleed.char.otherFall * 100).toFixed(1)}% (${JSON.stringify(bleed.char.otherFlesh)}) as the other body charred`);
  if (BLEED_ONLY) { console.log('\nDONE (bleed scenario only)'); shutdown(0); await sleep(5000); }

  await bootGame('?level=arena&spawn=zombie');

  await evaluate('window.__sdfGame.setBloodBlur(false)');
  await step(30);
  const actors = await evaluate('window.__sdfGame.actorTrace().map(a => ({ id: a.id, kind: a.kind, pos: a.pos }))');
  report.checks.actors = actors;
  console.log('actors:', JSON.stringify(actors));
  if (actors.length !== 1) fail(`the arena should hold one body, found ${actors.length}`);
  const id = actors[0].id;

  // ---- BEFORE ------------------------------------------------------------
  report.checks.distance = await frameOn(id);
  console.log('distance to the body (m):', report.checks.distance);
  await step(2);
  const zapsBefore = await evaluate('window.__sdfGame.zaps()');
  if (zapsBefore.length !== 0) fail(`a body reads as zapped before the zap: ${JSON.stringify(zapsBefore)}`);
  const beforeShot = await capture('00-before');
  const boneZapBefore = await evaluate(`window.__sdfGame.boneZap(${id})`);
  const pipelinesBefore = await evaluate('window.__sdfGame.pipelineLog().totalPipelines');

  // ---- THE ARC -----------------------------------------------------------
  const started = await evaluate('window.__sdfGame.zapActor()');
  console.log('zapActor():', started);
  if (started !== 1) fail(`zapActor() started ${started} zaps, expected 1`);

  // ---- 4 s UNDER IT, a sample and a frame every 0.25 s ---------------------
  const samples = [];
  const shots = [];
  const xray = {};
  let statueBones = null;
  for (let i = 0; i < SAMPLES; i++) {
    await step(SAMPLE_FRAMES);
    const t = +((i + 1) * SAMPLE_FRAMES * DT).toFixed(2);
    const z = (await evaluate('window.__sdfGame.zaps()')).find((x) => x.id === id) ?? null;
    const lane = await evaluate(`(() => {
      const a = window.__sdfGame.actorTrace().find(x => x.id === ${id});
      return a ? { pos: a.pos.map(v => +v.toFixed(2)), speed: +a.speed.toFixed(2) } : null;
    })()`);
    const shot = await capture(`${String(i + 1).padStart(2, '0')}-t${t.toFixed(2)}`, z ? z.phase : 'none');
    samples.push({ t, phase: z?.phase ?? 'none', glow: z ? +z.glow.toFixed(3) : 0, invert: !!z?.invert, char: z ? +z.char.toFixed(3) : 0,
      centreLuma: shot.centreLuma, chestLuma: shot.chestLuma, chestRgb: shot.chestRgb, ...lane });
    shots.push(shot);
    console.log(`  t=${t.toFixed(2)} ${JSON.stringify(samples[samples.length - 1])}`);
    // The skeleton's share, once in the glow and once on a jolt (the sim does not advance while it is taken).
    const which = z?.phase === 'zapped' ? (z.invert ? 'jolt' : 'glow') : null;
    if (which && !xray[which]) xray[which] = { t, ...(await xrayPair(which, id)) };
    // The statue (glow 0) is out of the exposure set: its bones are not drawn behind its flesh, and none carries a glow.
    if (z?.phase === 'statue' && !statueBones) statueBones = { t, zap: await evaluate(`window.__sdfGame.boneZap(${id})`) };
  }
  const pipelinesAfter = await evaluate('window.__sdfGame.pipelineLog().totalPipelines');
  const boneZapAfter = await evaluate(`window.__sdfGame.boneZap(${id})`);

  // ---- AFTER: look down at where the body stood (not part of the series) ----
  await evaluate(`(() => { const g = window.__sdfGame; const p = g.playerPos(); const a = g.actorTrace().find(x => x.id === ${id});
    if (a) g.setPose(p[0], p[2], Math.atan2(a.pos[0] - p[0], -(a.pos[2] - p[2])), -0.45); })()`);
  await step(2);
  const afterShot = await capture('17-after-looking-down', 'after, looking down');

  // ---- NUMBERS -----------------------------------------------------------
  // The glow proper: zapped samples whose bones are not inverted (on a jolt the flesh goes DARK by design, and
  // the bright skeleton that then carries the frame is Task 5's).
  const lit = samples.filter((s) => s.phase === 'zapped' && !s.invert);
  const jolts = samples.filter((s) => s.phase === 'zapped' && s.invert);
  const statues = samples.filter((s) => s.phase === 'statue');
  const last = samples[samples.length - 1];
  report.samples = samples;
  report.checks.pipelines = { before: pipelinesBefore, after: pipelinesAfter };
  report.checks.luma = {
    centre: {
      before: beforeShot.centreLuma,
      series: samples.map((s) => s.centreLuma),
      zappedMean: +mean(lit.map((s) => s.centreLuma)).toFixed(2),
      zappedOverBefore: +(mean(lit.map((s) => s.centreLuma)) / Math.max(1e-6, beforeShot.centreLuma)).toFixed(2),
      last: last.centreLuma,
    },
    chest: {
      before: beforeShot.chestLuma, beforeRgb: beforeShot.chestRgb, beforeBlueMinusRed: blue(beforeShot.chestRgb),
      series: samples.map((s) => s.chestLuma),
      zappedMean: +mean(lit.map((s) => s.chestLuma)).toFixed(2),
      zappedMin: Math.min(...lit.map((s) => s.chestLuma)),
      zappedOverBefore: +(mean(lit.map((s) => s.chestLuma)) / Math.max(1e-6, beforeShot.chestLuma)).toFixed(2),
      zappedBlueMinusRed: +mean(lit.map((s) => blue(s.chestRgb))).toFixed(1),
      joltMean: jolts.length ? +mean(jolts.map((s) => s.chestLuma)).toFixed(2) : null,
      statueMean: statues.length ? +mean(statues.map((s) => s.chestLuma)).toFixed(2) : null,
      last: last.chestLuma,
    },
  };
  console.log('phases:', samples.map((s) => `${s.t.toFixed(2)}:${s.phase}${s.invert ? '(inverted)' : ''}`).join(' '));
  console.log('glow:', samples.map((s) => s.glow).join(' '));
  console.log('char:', samples.map((s) => s.char).join(' '));
  console.log('centre luma before:', beforeShot.centreLuma, 'series:', samples.map((s) => s.centreLuma).join(' '));
  console.log('chest luma before:', beforeShot.chestLuma, 'series:', samples.map((s) => s.chestLuma).join(' '));
  console.log('luma:', JSON.stringify(report.checks.luma));
  console.log('pipelines:', JSON.stringify(report.checks.pipelines));
  const strip = (x) => (x ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'shots')) : null);
  report.checks.xray = { glow: strip(xray.glow), jolt: strip(xray.jolt), boneZapBefore, boneZapAfter };
  console.log('xray:', JSON.stringify(report.checks.xray));

  if (samples[0].phase !== 'zapped') fail(`the first sample's phase is '${samples[0].phase}', not 'zapped'`);
  if (!statues.length) fail('no sample reads phase statue');
  if (last.glow !== 0 || last.char !== 1) fail(`the last sample has glow ${last.glow} char ${last.char}, expected 0 and 1`);
  if (pipelinesAfter !== pipelinesBefore) fail(`the zap compiled pipelines: ${pipelinesBefore} -> ${pipelinesAfter}`);
  if (!lit.length) fail('no zapped sample without a jolt: nothing to measure the glow on');
  // The glowing FLESH is brighter and bluer than the lit flesh it replaces; and the statue is darker than the body
  // before the zap. Since Task 5 the ribcage stands in front of the chest (dark in the glow), so the flesh is read
  // on the frame drawn with the bones hidden; the chest series above, bones and all, is reported and not gated.
  // (The plan's 1.5x on the centre crop is REPORTED above, not gated: the arena's zombie stands in the flashlight
  // at a chest luminance near 200 of 255, so no glow can reach 1.5x it, and the centre crop is mostly the room.)
  const c = report.checks.luma.chest;
  const flesh = xray.glow?.hiddenChest;
  report.checks.luma.fleshChest = flesh ?? null;
  if (!flesh) fail('no zapped sample without a jolt: the flesh glow was not measured');
  if (!(flesh.luma > c.before)) fail(`the zapped flesh's chest (${flesh.luma}, bones hidden) is not brighter than before the zap (${c.before})`);
  if (!(blue(flesh.rgb) > c.beforeBlueMinusRed + 20)) fail(`the zapped flesh is not bluer: blue - red ${blue(flesh.rgb)} against ${c.beforeBlueMinusRed} before`);
  // THE SKELETON (Task 5). The bones carry the glow while the body is zapped and nothing before or after; hiding
  // them changes the body's box by at least 8 of 255 in the glow (the plan's number), and well over the noise.
  if (!xray.glow) fail('no zapped sample without a jolt: the skeleton was not measured');
  if (!xray.jolt) fail('no sample landed on a jolt: the inverted skeleton was not measured');
  for (const [name, x] of Object.entries(xray)) {
    if (!x.boneZap || x.boneZap.instances < 10) fail(`${name}: ${x.boneZap?.instances ?? 0} bone instances drawn for the zapped body, expected its whole skeleton`);
    if (name === 'glow' ? !(x.boneZap.min > 0) : !(x.boneZap.max < 0)) fail(`${name}: the bone instances carry iZap ${x.boneZap.min}..${x.boneZap.max}`);
    if (!(x.skeleton.meanAbs >= 8)) fail(`${name}: hiding the bones changes the body box by ${x.skeleton.meanAbs} of 255, under 8: the skeleton is not in front of the flesh`);
    if (!(x.skeleton.meanAbs > 2 * x.noise.meanAbs)) fail(`${name}: the skeleton's share (${x.skeleton.meanAbs}) is not clear of the noise (${x.noise.meanAbs})`);
  }
  // Dark bones in the glow (hiding them brightens the box), bright bones on a jolt (hiding them darkens it).
  if (!(xray.glow.bodyLumaShown < xray.glow.bodyLumaHidden)) fail(`in the glow the bones do not darken the body box: ${xray.glow.bodyLumaShown} shown, ${xray.glow.bodyLumaHidden} hidden`);
  if (!(xray.jolt.bodyLumaShown > xray.jolt.bodyLumaHidden)) fail(`on a jolt the bones do not brighten the body box: ${xray.jolt.bodyLumaShown} shown, ${xray.jolt.bodyLumaHidden} hidden`);
  report.checks.xray.statueBones = statueBones;
  console.log('statue bones:', JSON.stringify(statueBones));
  if (!statueBones) fail('no statue sample: its bones were not read');
  if (statueBones.zap.length > 4 || statueBones.zap.some((v) => v !== 0)) fail(`the statue still draws its skeleton, or carries a glow: iZap ${JSON.stringify(statueBones.zap)}`);
  if ((boneZapBefore ?? []).some((v) => v !== 0)) fail(`a bone instance carries a zap before the zap: ${JSON.stringify(boneZapBefore)}`);
  if ((boneZapAfter ?? []).some((v) => v !== 0)) fail(`a bone instance still carries a zap at the end: ${JSON.stringify(boneZapAfter)}`);
  if (!(c.statueMean < c.before)) fail(`the statue's chest (${c.statueMean}) is not darker than before the zap (${c.before})`);

  const { splitShot, closeShot, splitPair } = await splitScenario(xray.glow?.skull ?? null);
  xray.split = splitPair;

  // ---- SLOT 9, HELD (Task 6) --------------------------------------------------
  const teslaShots = await teslaScenario();

  // ---- CONTACT SHEET: before, then every second sample ---------------------
  const tiles = [...bleedShots.map((s) => ({ label: s.note.replace('two bodies: ', '2: '), b64: s.b64 })), { label: 'before', b64: beforeShot.b64 },
    ...shots.filter((_, i) => i % 2 === 1 || i === 0).map((s) => ({ label: `${s.name.slice(3)} ${s.note}`, b64: s.b64 })),
    { label: afterShot.note, b64: afterShot.b64 },
    ...['glow', 'jolt', 'split'].flatMap((k) => (xray[k]?.shots ?? []).map((s) => ({ label: s.note, b64: s.b64 }))),
    { label: splitShot.note, b64: splitShot.b64 }, { label: closeShot.note, b64: closeShot.b64 },
    ...teslaShots.map((s) => ({ label: s.note, b64: s.b64 }))];
  await evaluate('window.__sheet = []');
  for (const t of tiles) await evaluate(`window.__sheet.push(${JSON.stringify(t)})`);
  const dataUrl = await evaluate(`(async () => {
    const tiles = window.__sheet;
    const imgs = await Promise.all(tiles.map(t => new Promise((ok, err) => {
      const im = new Image(); im.onload = () => ok(im); im.onerror = () => err(new Error('decode'));
      im.src = 'data:image/png;base64,' + t.b64;
    })));
    const k = 0.5, cw = imgs[0].naturalWidth * k, ch = imgs[0].naturalHeight * k, lh = 22;
    const cols = 5, rows = Math.ceil(imgs.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * cw; cv.height = rows * (ch + lh);
    const g = cv.getContext('2d');
    g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, cv.width, cv.height);
    tiles.forEach((t, i) => {
      const x = (i % cols) * cw, y = Math.floor(i / cols) * (ch + lh);
      g.drawImage(imgs[i], x, y + lh, cw, ch);
      g.fillStyle = '#e8e8e8'; g.font = 'bold 14px monospace'; g.textBaseline = 'top';
      g.fillText(t.label, x + 6, y + 4);
      g.strokeStyle = '#444'; g.strokeRect(x + 0.5, y + 0.5, cw - 1, ch + lh - 1);
    });
    return cv.toDataURL('image/png');
  })()`, 30000);
  if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
    writeFileSync(`${OUT}/zap-contact-sheet.png`, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
    console.log(`contact sheet: ${OUT}/zap-contact-sheet.png`);
  } else {
    console.log('WARNING: contact sheet composition returned nothing');
  }

  // ---- GUARDS ------------------------------------------------------------
  const rendererErrors = consoleErrors.filter((t) => /THREE\.WebGPURenderer.*(pipeline|ShaderModule|fragment error|unresolved value)/i.test(t));
  if (rendererErrors.length > 0) fail(`renderer pipeline error: ${rendererErrors[0].slice(0, 300)}`);

  writeFileSync(`${OUT}/zap-trace.json`, JSON.stringify(report, null, 2));
  console.log('\nDONE');
  shutdown(0);
} catch (err) {
  console.error('TRACE FAILED:', err?.message ?? err);
  report.failed = String(err?.message ?? err);
  try { writeFileSync(`${OUT}/zap-trace.json`, JSON.stringify(report, null, 2)); } catch { /* best effort */ }
  shutdown(1);
}
