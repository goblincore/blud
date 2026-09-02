// scripts/perf-r2-parity.mjs — frozen in-page A/B/A/B capture + pixel diff for
// the SDF perf round-2 plan (docs/superpowers/plans/2026-09-01-sdf-render-perf-round2.md).
// Every later task's parity gate runs through here. Driven by
// scripts/perf-r2-parity.sh, which owns the vite + Chrome lifecycle.
//
//   scripts/perf-r2-parity.sh capture <outDir> --room <3|4> --on "<js>" --off "<js>" [--occupancy]
//   scripts/perf-r2-parity.sh diff <pngA> <pngB>
//
// SHAPE (the 2026-08-31 shell-march gate, generalised): boot the page NORMALLY,
// drive it only through __sdfGame after resolveGpu(), teleport to a room, let
// the wanderers run ~2 s, freeze, settle 2500 ms (the post-AA smear; 7.9% of
// pixels still differ across a freeze until it settles), then capture A/B/A/B
// by TOGGLING THE SEAM IN-PAGE — never by comparing across page loads, never by
// holding rAF or hand-stepping the boot (that attempt cost thirty minutes and
// produced nothing; do not revive it). Screenshots are CDP
// Page.captureScreenshot; in-page canvas readback (drawImage/getImageData) is
// forbidden — off a WebGPU canvas it returns black (frozen-capture-verdict.md).
//
// Pair order: an off-vs-off state pair FIRST as the noise floor, then
// off → on → off → on (b-1, a-1, b-2, a-2). a-1 vs a-2 and b-1 vs b-2 prove
// the toggle is state-clean (no history); a vs b is the parity verdict.
// With --occupancy, __sdfGame.occupancy() runs after each state's screenshot
// (counters, not timers — valid while another chain holds status: running).
// Screenshots come BEFORE occupancy in each state: occupancy() internally
// re-steps one frame with a debug config (game-main.ts), and the next state's
// 2500 ms settle gives that perturbation ~150 frames to decay — Task 0 proved
// two occupancy reads 1 s apart on a frozen scene are bit-identical.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5299);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9299);

const argv = process.argv.slice(2);
const mode = argv[0];
const usage = () => {
  console.error(
    'usage: scripts/perf-r2-parity.sh capture <outDir> --room <3|4> --on "<js>" --off "<js>" [--occupancy]\n' +
    '       scripts/perf-r2-parity.sh diff <pngA> <pngB>',
  );
  process.exit(2);
};
if (mode !== 'capture' && mode !== 'diff') usage();

// --- minimal PNG decode (truecolor/grayscale, 8-bit, non-interlaced) --------
function decodePng(buf) {
  let off = 8; let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported png: depth ${bitDepth} color ${colorType}`);
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride); p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= ch && prev ? prev[x - ch] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
  }
  return { w, h, ch, data: out };
}

function diffPngs(a, b) {
  if (a.w !== b.w || a.h !== b.h) throw new Error('size mismatch');
  let changed = 0, bigChanged = 0, sum = 0, maxD = 0;
  // coarse map: 32px cells, count big-diff pixels per cell
  const cells = new Map();
  for (let i = 0; i < a.w * a.h; i++) {
    const ia = i * a.ch, ib = i * b.ch;
    const d = Math.abs(a.data[ia] - b.data[ib]) + Math.abs(a.data[ia + 1] - b.data[ib + 1]) + Math.abs(a.data[ia + 2] - b.data[ib + 2]);
    if (d > 30) {
      changed++;
      if (d > 150) bigChanged++;
      const cx = Math.floor((i % a.w) / 32), cy = Math.floor(Math.floor(i / a.w) / 32);
      cells.set(`${cx},${cy}`, (cells.get(`${cx},${cy}`) ?? 0) + 1);
    }
    sum += d; if (d > maxD) maxD = d;
  }
  const hot = [...cells.entries()].filter(([, n]) => n > 200).map(([c]) => c);
  return { changed, bigChanged, meanD: +(sum / (a.w * a.h)).toFixed(2), maxD, hotCells: hot };
}

// Where the changed pixels ARE — one char per 32px cell. diffPngs' hotCells
// (cells > 200 changed px) answers "how bad"; this answers "where", which is
// what the halo checks need (a halo hugs silhouettes; scattered noise does not).
// '.' none · 1-9 px · '+' 10-99 · 'X' 100-999 · '#' 1000+
function cellGrid(a, b) {
  const cw = 32;
  const cols = Math.ceil(a.w / cw), rows = Math.ceil(a.h / cw);
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < a.w * a.h; i++) {
    const ia = i * a.ch, ib = i * b.ch;
    const d = Math.abs(a.data[ia] - b.data[ib]) + Math.abs(a.data[ia + 1] - b.data[ib + 1]) + Math.abs(a.data[ia + 2] - b.data[ib + 2]);
    if (d > 30) grid[Math.floor(Math.floor(i / a.w) / cw)][Math.floor((i % a.w) / cw)]++;
  }
  const chr = (n) => (n === 0 ? '.' : n < 10 ? String(n) : n < 100 ? '+' : n < 1000 ? 'X' : '#');
  return grid.map((row) => row.join('')).join('\n');
}

const frac = (changed, w, h) => `${((changed / (w * h)) * 100).toFixed(4)}%`;
function reportDiff(label, fileA, fileB, { grid = false } = {}) {
  const a = decodePng(readFileSync(fileA));
  const b = decodePng(readFileSync(fileB));
  const d = diffPngs(a, b);
  console.log(`diff ${label}: ${JSON.stringify({ ...d, changedFrac: frac(d.changed, a.w, a.h) })}`);
  if (grid && d.changed > 0) console.log(`cell map ${label} (32px cells, ${a.w}x${a.h}):\n${cellGrid(a, b)}`);
  return d;
}

// --- CDP plumbing (the Task-0 driver, which produced bit-identical frozen
// reads; the error tap is dungeon-shadowab's) -------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const closeUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', closeUrl], { stdio: 'ignore' }); } catch {}
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400));
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, timeoutMs = 120_000) => {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs,
  });
  if (r.result?.exceptionDetails) {
    fail(`page threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
  }
  return r.result?.result?.value;
};

// Screenshot grab. The sleep is the headless capture race guard: without it
// captureScreenshot can pair the LAST PRESENTED frame with the just-submitted
// GPU work and read byte-identical PNGs across a real change (seen 2026-09-01
// on the shadow A/B). Settles are generous everywhere; parity runs are short.
const SHOT_SETTLE_MS = 400;
async function shot(outDir, name) {
  await sleep(SHOT_SETTLE_MS);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${outDir}/${name}.png`;
  writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  console.error(`shot ${name}`);
  return file;
}

if (mode === 'diff') {
  const [, fileA, fileB] = argv;
  if (!fileA || !fileB) usage();
  reportDiff(`${fileA} vs ${fileB}`, fileA, fileB, { grid: true });
  process.exit(0);
}

// --- capture mode -----------------------------------------------------------
const outDir = argv[1];
if (!outDir) usage();
let room, onJs, offJs, wantOccupancy = false;
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--room') room = Number(argv[++i]);
  else if (argv[i] === '--on') onJs = argv[++i];
  else if (argv[i] === '--off') offJs = argv[++i];
  else if (argv[i] === '--occupancy') wantOccupancy = true;
}
if (room !== 3 && room !== 4) fail('--room must be 3 or 4');
if (!onJs || !offJs) fail('--on and --off are required');
mkdirSync(outDir, { recursive: true });

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
});

await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });

// Wait for the seam and a resolved GPU backend.
const ready = await evaluate(`(async () => {
  for (let i = 0; i < 600; i++) {
    if (window.__sdfGame?.resolveGpu) {
      try { await __sdfGame.resolveGpu(); return 'ready'; } catch {}
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return 'never became ready';
})()`, 180_000);
if (ready !== 'ready') fail(`page boot: ${ready}`);
await sleep(5000); // boot settle, same as the bench's bootPage

// Pin the measurement state: bench-style. Adaptive OFF (machine is loaded),
// scale pinned to 1.0 so the march target is the ship 800x600.
const state = await evaluate(`(() => {
  __sdfGame.setAdaptive(false);
  __sdfGame.setSdfScale(1.0);
  __sdfGame.setFxaa(true);
  __sdfGame.setSmear(0.25);
  __sdfGame.setCone(false);
  __sdfGame.setOccluder(false);
  return {
    shell: __sdfGame.shell, occluder: __sdfGame.occluder, cone: __sdfGame.cone,
    fxaa: __sdfGame.fxaa, relax: __sdfGame.relax,
    sdfScale: __sdfGame.sdfScale, adaptive: __sdfGame.adaptive.enabled,
    halfRate: __sdfGame.halfRate, sdfTarget: __sdfGame.sdfTarget,
    backend: __sdfGame.backend,
  };
})()`);
console.error(`state: ${JSON.stringify(state)}`);

// Freeze the room, settle the smear, THEN touch nothing but the seam.
await evaluate(`(() => {
  __sdfGame.freeze(false);
  __sdfGame.teleport(${room});
})()`);
await sleep(2000); // ~120 frames of natural wander, as in the walk segment
await evaluate(`__sdfGame.freeze(true)`);
await sleep(2500); // post-AA smear settle on the frozen scene

// 1) noise floor: the SAME state captured twice.
const state1 = await shot(outDir, 'state-1');
const state2 = await shot(outDir, 'state-2');
const noiseFloor = reportDiff(`noise floor (state-1 vs state-2)`, state1, state2);

// 2) the A/B/A/B: off → on → off → on. Two independent pairs per state prove
// the toggle is state-clean before the a-vs-b verdict means anything.
const occ = { off: [], on: [] };
const toggle = async (js, label, file) => {
  await evaluate(js);
  await sleep(2500); // settle the smear on the new state
  const file_ = await shot(outDir, file);
  if (wantOccupancy) {
    const o = await evaluate(`__sdfGame.occupancy()`);
    (label === 'on' ? occ.on : occ.off).push(o);
    console.error(`occupancy[${label}]: hits ${o.hits} rasterised ${o.rasterised} ` +
      `meanSteps hit ${o.meanStepsHit.toFixed(1)} miss ${o.meanStepsMiss.toFixed(1)} ` +
      `bodies ${o.bodiesOnScreen} target ${o.targetW}x${o.targetH}`);
  }
  return file_;
};
const b1 = await toggle(offJs, 'off', 'b-1');
const a1 = await toggle(onJs, 'on', 'a-1');
const b2 = await toggle(offJs, 'off', 'b-2');
const a2 = await toggle(onJs, 'on', 'a-2');

const pairs = {
  'a-1 vs b-1': reportDiff('a-1 vs b-1', a1, b1, { grid: true }),
  'a-2 vs b-2': reportDiff('a-2 vs b-2', a2, b2, { grid: true }),
  'a-1 vs a-2': reportDiff('a-1 vs a-2', a1, a2),
  'b-1 vs b-2': reportDiff('b-1 vs b-2', b1, b2),
};

await evaluate(`__sdfGame.freeze(false)`); // leave the page as we found it

const summary = { state, room, onJs, offJs, outDir, noiseFloor, pairs };
if (wantOccupancy) {
  summary.occupancy = occ;
  console.log(`occupancy off: ${JSON.stringify(occ.off.map((o) => ({
    hits: o.hits, rasterised: o.rasterised, misses: o.misses,
    meanStepsHit: +o.meanStepsHit.toFixed(2), meanStepsMiss: +o.meanStepsMiss.toFixed(2),
    missStepShare: +o.missStepShare.toFixed(3), bodies: o.bodiesOnScreen,
  })))}`);
  console.log(`occupancy on:  ${JSON.stringify(occ.on.map((o) => ({
    hits: o.hits, rasterised: o.rasterised, misses: o.misses,
    meanStepsHit: +o.meanStepsHit.toFixed(2), meanStepsMiss: +o.meanStepsMiss.toFixed(2),
    missStepShare: +o.missStepShare.toFixed(3), bodies: o.bodiesOnScreen,
  })))}`);
}
writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
console.error(`summary: ${outDir}/summary.json`);
if (errors.length) console.error(`console errors: ${errors.length}`, errors.slice(-3));
ws.close();
process.exit(0);
