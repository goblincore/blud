// scripts/sdf-game-half-rate.mjs — C2 temporal-spike driver for sdf-game.html.
//
// No-deps CDP, same pattern as scripts/sdf-game.mjs. Subcommands:
//
//   parity <label>   Frozen settled capture with half-rate OFF, for the
//                    bit-parity gate: one before the code change, one after,
//                    pixel-diff must be zero. Protocol: adaptive off, HUD
//                    hidden, freeze(true), loop stopped, fixed camera, 30
//                    settle steps (post-aa smear converges), then shoot.
//   diff <a.png> <b.png>  Decode both PNGs (zlib, no deps), report pixel-diff
//                    percentages at several tolerances.
//   gate500          500 stepped frames with the toggle ON (both modes), a
//                    slug fired mid-run; FAIL on any console error.
//   reel             The capture reel: 4 moments x {full,half} x {smear
//                    default, smear 0}, half at reproject mode 1, plus
//                    hold-only (mode 0) for the strafe moment. Fresh page
//                    load per sequence so every run starts identical.
//   bench            Interleaved throughput legs off/on/off/on via the page's
//                    chunked+fenced __sdfGame.bench (never rAF wall clock).
//
// Usage: LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 node scripts/sdf-game-half-rate.mjs <mode> [args]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const MODE = process.argv[2] ?? '';
const ARG3 = process.argv[3];
const ARG4 = process.argv[4];
const ARG5 = process.argv[5];
const VITE = Number(process.env.LAB_VITE_PORT ?? 5277);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9277);
const OUT = process.env.GAME_OUT ?? 'docs/dev-notes/2026-08-31-temporal-c2-spike';
const W = Number(process.env.GAME_W ?? 800);
const H = Number(process.env.GAME_H ?? 600);
const URL_BASE = `http://localhost:${VITE}/sdf-game.html`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const log = (s) => console.log(s);

// ---------------------------------------------------------------------------
// Minimal PNG decode (8-bit RGBA, non-interlaced — what Chrome emits) and the
// pixel diff. Living in the driver keeps the parity gate self-contained.
// ---------------------------------------------------------------------------
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let off = 8;
  let w = 0, h = 0, depth = 0, color = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; color = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || (color !== 6 && color !== 2)) throw new Error(`unsupported png depth=${depth} color=${color}`);
  const ch = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  let pos = 0;
  const row = Buffer.alloc(stride);
  const prevRaw = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? row[x - ch] : 0;
      const b = prevRaw[x];
      const c = x >= ch ? prevRaw[x - ch] : 0;
      let v = raw[pos + x];
      switch (filter) {
        case 1: v = (v + a) & 255; break;
        case 2: v = (v + b) & 255; break;
        case 3: v = (v + ((a + b) >> 1)) & 255; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
          break;
        }
      }
      row[x] = v;
    }
    pos += stride;
    row.copy(prevRaw);
    for (let x = 0; x < w; x++) {
      const o = y * w * 4 + x * 4;
      out[o] = row[x * ch];
      out[o + 1] = row[x * ch + 1];
      out[o + 2] = row[x * ch + 2];
      out[o + 3] = 255;
    }
  }
  return { w, h, data: out };
}

export function diffPngs(aBuf, bBuf) {
  const a = decodePng(aBuf), b = decodePng(bBuf);
  if (a.w !== b.w || a.h !== b.h) fail(`size mismatch ${a.w}x${a.h} vs ${b.w}x${b.h}`);
  const n = a.w * a.h;
  let d0 = 0, d2 = 0, d8 = 0, max = 0;
  for (let i = 0; i < n * 4; i += 4) {
    let md = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c] - b.data[i + c]);
      if (d > md) md = d;
    }
    if (md > max) max = md;
    if (md > 0) d0++;
    if (md > 2) d2++;
    if (md > 8) d8++;
  }
  return {
    w: a.w, h: a.h,
    diffAny: d0, pctAny: (100 * d0 / n).toFixed(4) + '%',
    diff2: d2, pct2: (100 * d2 / n).toFixed(4) + '%',
    diff8: d8, pct8: (100 * d8 / n).toFixed(4) + '%',
    maxChannelDelta: max,
  };
}

// ---------------------------------------------------------------------------
// Subcommand: diff
// ---------------------------------------------------------------------------
if (MODE === 'diff') {
  if (!ARG3 || !ARG4) fail('diff needs two png paths');
  const a = readFileSync(ARG3), b = readFileSync(ARG4);
  log(JSON.stringify(diffPngs(a, b)));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Subcommand: phase — classify which frames of a reel sequence ran as holds,
// by diffing each frame against its full-rate twin (fresh cross-load ~<4 err,
// hold ~>8). Writes nothing; prints one line per sequence.
// ---------------------------------------------------------------------------
if (MODE === 'phase') {
  const seqDir = process.env.SEQ_DIR ?? 'docs/dev-notes/2026-08-31-temporal-c2-spike/seq';
  const names = (ARG3 ?? '').split(',').filter(Boolean);
  const rgba = (p) => decodePng(readFileSync(p));
  const errAt = (img, ref) => {
    let n = 0, sum = 0;
    for (let y = 0; y < img.h; y += 2) for (let x = 0; x < img.w; x += 2) {
      const i = (y * img.w + x) * 4, j = i;
      sum += Math.abs(img.data[i] - ref.data[j]) + Math.abs(img.data[i+1] - ref.data[j+1]) + Math.abs(img.data[i+2] - ref.data[j+2]);
      n++;
    }
    return sum / n;
  };
  for (const scene of ['strafe', 'walk', 'fire', 'sever']) {
    for (const rate of ['half', 'halfhold']) {
      if (names.length && !names.includes(`${scene}-${rate}`)) continue;
      for (const smear of ['smear0', 'smear25']) {
        const v = `${seqDir}/${scene}-${rate}-${smear}`;
        const f = `${seqDir}/${scene}-full-${smear}`;
        const marks = [];
        for (let i = 0; ; i++) {
          const vp = `${v}/f${String(i).padStart(2, '0')}.png`;
          const fp = `${f}/f${String(i).padStart(2, '0')}.png`;
          if (!existsSync(vp) || !existsSync(fp)) break;
          const e = errAt(rgba(vp), rgba(fp));
          marks.push(e < 4 ? '.' : 'H');
        }
        log(`${scene}-${rate}-${smear}: ${marks.join('')}`);
      }
    }
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Subcommand: shift-scan — numeric lag measurement. For frames where a hold
// ran, find the horizontal pixel shift of the variant image that best aligns
// it to the full-rate reference (minimising diff over ±40 px). mode0's shift
// = one frame of world slide (raw hold lag); mode1's shift ≈ 0 means the
// reprojection tracks the camera, mode1 ≈ 2x mode0 (opposite sign) means the
// reproject is inverted.
// ---------------------------------------------------------------------------
if (MODE === 'shift-scan') {
  // Two forms:
  //   shift-scan <probeDir> [N]           — probe layout: <probeDir>/{full,mode0,mode1}-fNN.png
  //   shift-scan <variantDir> <fullDir> <N> — reel layout: per-sequence dirs
  const probeForm = !ARG4 || /^[0-9]+$/.test(ARG4);
  const dirV = ARG3 ?? '/tmp/c2/probe';
  const dirF = probeForm ? dirV : ARG4;
  const N = probeForm ? Number(ARG4 ?? 8) : Number(ARG5 ?? 8);
  const variantOf = (v, f) => probeForm
    ? `${dirV}/${v}-f${String(f).padStart(2, '0')}.png`
    : `${dirV}/f${String(f).padStart(2, '0')}.png`;
  const refOf = (f) => probeForm
    ? `${dirF}/full-f${String(f).padStart(2, '0')}.png`
    : `${dirF}/f${String(f).padStart(2, '0')}.png`;
  const rgba = (p) => decodePng(readFileSync(p));
  const shiftDiff = (img, ref, dx) => {
    let n = 0, sum = 0;
    for (let y = 0; y < img.h; y += 2) {
      for (let x = 0; x < img.w; x += 2) {
        const sx = Math.min(img.w - 1, Math.max(0, x + dx));
        const i = (y * img.w + sx) * 4, j = (y * img.w + x) * 4;
        const d = Math.abs(img.data[i] - ref.data[j])
          + Math.abs(img.data[i + 1] - ref.data[j + 1])
          + Math.abs(img.data[i + 2] - ref.data[j + 2]);
        sum += d; n++;
      }
    }
    return sum / n;
  };
  for (let f = 0; f < N; f++) {
    const ref = rgba(refOf(f));
    const row = [`f${f}:`];
    const names = probeForm ? ['mode0', 'mode1'] : ['half', 'halfhold'];
    for (const v of names) {
      const img = rgba(variantOf(v, f));
      let best = Infinity, bestDx = 0;
      for (let dx = -40; dx <= 40; dx++) {
        const s = shiftDiff(img, ref, dx);
        if (s < best) { best = s; bestDx = dx; }
      }
      row.push(`${v} best dx=${bestDx} (err ${best.toFixed(2)})`);
    }
    log(row.join('  '));
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// CDP plumbing (house style)
// ---------------------------------------------------------------------------
const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' }); } catch {}
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({
      type: m.params.type,
      text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
    });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const withTimeout = (p, ms, what) => Promise.race([
  p, sleep(ms).then(() => { throw new Error(`timeout: ${what}`); }),
]);
const evaluate = async (expression, timeoutMs = 60000) => {
  const r = await withTimeout(
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
    timeoutMs, expression.slice(0, 60),
  );
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
let shotCount = 0;
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(name, buf);
  shotCount++;
  log(`  shot ${name} (${buf.length} bytes)`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const consoleErrors = () => consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');

/** Fresh page load + boot wait + the common capture protocol. */
async function boot() {
  await send('Page.navigate', { url: URL_BASE });
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const api = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
    if (api) {
      if (api !== 'webgpu') fail(`backend is ${api}, not webgpu`);
      return;
    }
  }
  console.error('console tail:', consoleEvents.slice(-8));
  fail('game page never booted (__sdfGame absent)');
}

/** Settle protocol shared by parity + reel: deterministic stepped world. */
async function commonSetup() {
  await evaluate('window.__sdfGame.setAdaptive(false)');
  await evaluate('var h = document.getElementById("hud"); if (h) h.style.display = "none";');
  await sleep(500);
}

// ---------------------------------------------------------------------------
// Subcommand: parity
// ---------------------------------------------------------------------------
if (MODE === 'parity') {
  const label = ARG3 ?? 'x';
  mkdirSync(OUT, { recursive: true });
  await boot();
  await commonSetup();
  await evaluate('window.__sdfGame.freeze(true)');
  await evaluate('window.__sdfGame.setLoopRunning(false)');
  await evaluate('window.__sdfGame.teleport(1)');
  await evaluate('window.__sdfGame.setPose(-7.4, -7.4, Math.PI * 0.75, 0)');
  await evaluate('window.__sdfGame.step(30, 1/60)');   // smear settles
  await shot(`${OUT}/parity-${label}.png`);
  const bad = consoleErrors();
  if (bad.length) { for (const e of bad.slice(0, 5)) console.error('  |', e.type, e.text.slice(0, 200)); }
  log(`parity ${label}: done, console errors: ${bad.length}`);
  ws.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Subcommand: reproj-probe — sign/orientation check with eyes. Smear 0, a
// full-rate marker sphere parked at the frozen zombie's torso, and a lateral
// sweep; full/mode0/mode1 captures of the same stepped states. In hold
// frames: mode 0 flesh lags the marker one frame; mode 1 should sit ON the
// marker; mode 1 with an inverted reproject overshoots the OTHER way.
// ---------------------------------------------------------------------------
if (MODE === 'reproj-probe') {
  const dir = process.env.CHECK_OUT ?? '/tmp/c2/probe';
  mkdirSync(dir, { recursive: true });
  await boot();
  await commonSetup();
  await evaluate('window.__sdfGame.setSmear(0)');
  await evaluate('window.__sdfGame.freeze(true)');
  await evaluate('window.__sdfGame.teleport(1)');
  await evaluate('window.__sdfGame.refreshHull()');
  const zs = await evaluate('window.__sdfGame.zombies()');
  const z = zs.find((q) => q.room === 1);
  const torso = await evaluate('window.__sdfGame.zombie(' + z.id + ').posed().clusters.find(c => c.limb === "torso").center');
  await evaluate(`window.__sdfGame.placeMarker(${torso[0]}, ${torso[1]}, ${torso[2]}, 0x00ff00)`);
  log(`  marker at (${torso[0].toFixed(2)}, ${torso[1].toFixed(2)}, ${torso[2].toFixed(2)})`);
  const px = z.pos[0], pz = z.pos[2] + 2.0;
  const yaw = Math.atan2(z.pos[0] - px, -(z.pos[2] - pz));
  const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
  const N = 8;
  const variants = [['full', false, -1], ['mode0', true, 0], ['mode1', true, 1]];
  for (const [name, hr, mode] of variants) {
    await evaluate(`window.__sdfGame.setHalfRate(${hr})`);
    if (mode >= 0) await evaluate(`window.__sdfGame.setHalfRateMode(${mode})`);
    await evaluate(`window.__sdfGame.setPose(${px}, ${pz}, ${yaw}, 0)`);
    await evaluate('window.__sdfGame.step(30, 1/60)');
    for (let f = 0; f < N; f++) {
      const t = (f - (N - 1) / 2) * 0.1;   // 0.1 m/frame = 6 m/s, unmissable
      await evaluate(`window.__sdfGame.setPose(${px + rightX * t}, ${pz + rightZ * t}, ${yaw}, 0)`);
      await evaluate('window.__sdfGame.step(1, 1/60)');
      await shot(`${dir}/${name}-f${String(f).padStart(2, '0')}.png`);
    }
    log(`reproj-probe: ${name} captured`);
  }
  await evaluate('window.__sdfGame.setHalfRate(false)');
  await evaluate('window.__sdfGame.placeMarker(null)');
  const bad = consoleErrors();
  if (bad.length) { for (const e of bad.slice(0, 5)) console.error('  |', e.type, e.text.slice(0, 200)); fail('reproj-probe: console errors'); }
  for (let f = 0; f < N; f++) {
    const fp = (n) => `${dir}/${n}-f${String(f).padStart(2, '0')}.png`;
    const d1 = diffPngs(readFileSync(fp('mode1')), readFileSync(fp('full')));
    const d0 = diffPngs(readFileSync(fp('mode0')), readFileSync(fp('full')));
    log(`f${f}: mode1-vs-full ${d1.pct2} (max ${d1.maxChannelDelta}) | mode0-vs-full ${d0.pct2} (max ${d0.maxChannelDelta})`);
  }
  ws.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Subcommand: reproj-check — POSITIVE evidence the hold path runs and
// reprojects with the right conventions. One frozen zombie, one scripted
// camera sweep, three captures over the SAME stepped states: full rate,
// half-rate mode 1 (reproject), half-rate mode 0 (raw hold). Then per-frame
// diffs: mode1-vs-full should be MODERATE (reprojection error only),
// mode0-vs-full LARGE at flesh (frozen flesh lagging the camera).
// ---------------------------------------------------------------------------
if (MODE === 'reproj-check') {
  const dir = process.env.CHECK_OUT ?? '/tmp/c2/reproj';
  mkdirSync(dir, { recursive: true });
  await boot();
  await commonSetup();
  await evaluate('window.__sdfGame.freeze(true)');
  await evaluate('window.__sdfGame.teleport(1)');
  await evaluate('window.__sdfGame.refreshHull()');
  const zs = await evaluate('window.__sdfGame.zombies()');
  const z = zs.find((q) => q.room === 1);
  const px = z.pos[0], pz = z.pos[2] + 2.0;
  const yaw = Math.atan2(z.pos[0] - px, -(z.pos[2] - pz));
  const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
  const N = 12;
  const variants = [['full', false, -1], ['half1', true, 1], ['half0', true, 0]];
  for (const [name, hr, mode] of variants) {
    await evaluate(`window.__sdfGame.setHalfRate(${hr})`);
    if (mode >= 0) await evaluate(`window.__sdfGame.setHalfRateMode(${mode})`);
    // Centre of the sweep, settled. The first render after setHalfRate is a
    // forced fresh, so the phase at capture time is deterministic per variant.
    await evaluate(`window.__sdfGame.setPose(${px}, ${pz}, ${yaw}, 0)`);
    await evaluate('window.__sdfGame.step(30, 1/60)');
    for (let f = 0; f < N; f++) {
      const t = (f - (N - 1) / 2) * 0.05;
      await evaluate(`window.__sdfGame.setPose(${px + rightX * t}, ${pz + rightZ * t}, ${yaw}, 0)`);
      await evaluate('window.__sdfGame.step(1, 1/60)');
      await shot(`${dir}/${name}-f${String(f).padStart(2, '0')}.png`);
    }
    log(`reproj-check: ${name} captured`);
  }
  await evaluate('window.__sdfGame.setHalfRate(false)');
  const bad = consoleErrors();
  if (bad.length) { for (const e of bad.slice(0, 5)) console.error('  |', e.type, e.text.slice(0, 200)); fail('reproj-check: console errors'); }
  for (let f = 0; f < N; f++) {
    const fp = (n) => `${dir}/${n}-f${String(f).padStart(2, '0')}.png`;
    const d1 = diffPngs(readFileSync(fp('half1')), readFileSync(fp('full')));
    const d0 = diffPngs(readFileSync(fp('half0')), readFileSync(fp('full')));
    log(`f${f}: half1-vs-full ${d1.pct2} (max ${d1.maxChannelDelta}) | half0-vs-full ${d0.pct2} (max ${d0.maxChannelDelta})`);
  }
  ws.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Subcommand: parity-cycle — the ZERO gate, within one page load.
// Settled OFF capture F0; toggle halfRate on, settle, back off, settle;
// capture F1. F0 vs F1 must be pixel-identical: the OFF path may not change
// because the toggle exists.
// ---------------------------------------------------------------------------
if (MODE === 'parity-cycle') {
  const label = ARG3 ?? 'x';
  mkdirSync(OUT, { recursive: true });
  await boot();
  await commonSetup();
  await evaluate('window.__sdfGame.freeze(true)');
  await evaluate('window.__sdfGame.setLoopRunning(false)');
  await evaluate('window.__sdfGame.teleport(1)');
  await evaluate('window.__sdfGame.setPose(-7.4, -7.4, Math.PI * 0.75, 0)');
  await evaluate('window.__sdfGame.step(30, 1/60)');   // smear settles
  await shot(`${OUT}/cycle-${label}-off0.png`);
  await evaluate('window.__sdfGame.setHalfRate(true)');
  await evaluate('window.__sdfGame.step(31, 1/60)');   // odd count: ends on a hold
  await evaluate('window.__sdfGame.setHalfRate(false)');
  await evaluate('window.__sdfGame.step(30, 1/60)');   // settle back
  await shot(`${OUT}/cycle-${label}-off1.png`);
  // And one ON capture for the record (hold + reproject exercised frozen).
  await evaluate('window.__sdfGame.setHalfRate(true)');
  await evaluate('window.__sdfGame.step(2, 1/60)');    // fresh then hold
  await shot(`${OUT}/cycle-${label}-on-hold.png`);
  await evaluate('window.__sdfGame.setHalfRate(false)');
  const d = diffPngs(readFileSync(`${OUT}/cycle-${label}-off0.png`), readFileSync(`${OUT}/cycle-${label}-off1.png`));
  log(`parity-cycle ${label}: ${JSON.stringify(d)}`);
  const bad = consoleErrors();
  if (bad.length) { for (const e of bad.slice(0, 5)) console.error('  |', e.type, e.text.slice(0, 200)); }
  if (d.diffAny > 0) fail(`parity-cycle: OFF path changed — ${d.diffAny} px differ (max delta ${d.maxChannelDelta})`);
  if (bad.length) fail(`${bad.length} console error(s)`);
  ws.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Subcommand: gate500
// ---------------------------------------------------------------------------
if (MODE === 'gate500') {
  mkdirSync(OUT, { recursive: true });
  await boot();
  await commonSetup();
  await evaluate('window.__sdfGame.freeze(false)');
  await evaluate('window.__sdfGame.setHalfRate(true)');
  await evaluate('window.__sdfGame.setHalfRateMode(1)');
  await evaluate('window.__sdfGame.teleport(4)');
  await evaluate('window.__sdfGame.step(250, 1/60)');
  await evaluate('window.__sdfGame.setHalfRateMode(0)');
  await evaluate('window.__sdfGame.aimSurface() && window.__sdfGame.fireSlug()');
  await evaluate('window.__sdfGame.step(249, 1/60)');
  const frames = await evaluate('window.__sdfGame.frames');
  const hr = await evaluate('({ on: window.__sdfGame.halfRate, mode: window.__sdfGame.halfRateMode })');
  const bad = consoleErrors();
  for (const e of bad.slice(0, 10)) console.error('  |', e.type, e.text.slice(0, 300));
  log(`gate500: frames=${frames} halfRate=${JSON.stringify(hr)} consoleErrors=${bad.length}`);
  await shot(`${OUT}/gate500-final.png`);
  if (bad.length) fail(`${bad.length} console error(s) over the 500-frame run`);
  ws.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Subcommand: bench — interleaved throughput legs, chunked+fenced.
// ---------------------------------------------------------------------------
if (MODE === 'bench') {
  mkdirSync(OUT, { recursive: true });
  await boot();
  await commonSetup();
  const legs = [];
  const pairs = Number(process.env.BENCH_PAIRS ?? 2);
  for (let i = 0; i < pairs * 2; i++) {
    const on = i % 2 === 1;
    await evaluate(`window.__sdfGame.setHalfRate(${on})`);
    const r = await evaluate('window.__sdfGame.bench({ room: 4 })', 180000);
    legs.push({
      halfRate: on,
      overall: r.overall,
      segments: r.segments.map((s) => ({ name: s.name, n: s.n, p50: s.p50, p95: s.p95, p99: s.p99, max: s.max })),
    });
    const o = r.overall;
    log(`leg halfRate=${on}: p50=${o.p50?.toFixed?.(2)} p95=${o.p95?.toFixed?.(2)} p99=${o.p99?.toFixed?.(2)} max=${o.max?.toFixed?.(2)} (n=${o.n})`);
    await sleep(1500);   // cool between legs (thermal drift is the enemy)
  }
  writeFileSync(`${OUT}/bench-legs.json`, JSON.stringify(legs, null, 2));
  log(`bench: wrote ${OUT}/bench-legs.json`);
  ws.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Subcommand: reel
// ---------------------------------------------------------------------------
if (MODE === 'reel') {
  const only = process.env.REEL_ONLY ?? '';   // e.g. REEL_ONLY=strafe-half-smear25
  const SEQ_DIR = `${OUT}/seq`;
  mkdirSync(SEQ_DIR, { recursive: true });

  /** angle wrap helper page-side is overkill: do it driver-side. */
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  const sequences = [];
  for (const smear of ['smear25', 'smear0']) {
    // strafe gets all three rate variants: the hold-only (mode 0) twin is
    // captured at the smear/double-image worst case, where it differs most
    // from the reproject.
    for (const rate of ['full', 'half', 'halfhold']) {
      sequences.push({ scene: 'strafe', rate, smear });
    }
    for (const rate of ['full', 'half']) {
      sequences.push({ scene: 'walk', rate, smear });
      sequences.push({ scene: 'fire', rate, smear });
      sequences.push({ scene: 'sever', rate, smear });
    }
  }

  for (const sq of sequences) {
    const name = `${sq.scene}-${sq.rate}-${sq.smear}`;
    if (only && name !== only) continue;
    const dir = `${SEQ_DIR}/${name}`;
    if (existsSync(`${dir}/f00.png`) && !process.env.REEL_FORCE) {
      log(`reel: ${name} already captured, skipping`);
      continue;
    }
    log(`reel: ${name}`);
    mkdirSync(dir, { recursive: true });
    await boot();
    await commonSetup();
    const smearVal = sq.smear === 'smear25' ? 0.25 : 0;
    await evaluate(`window.__sdfGame.setSmear(${smearVal})`);
    if (sq.rate === 'half' || sq.rate === 'halfhold') {
      await evaluate('window.__sdfGame.setHalfRate(true)');
      await evaluate(`window.__sdfGame.setHalfRateMode(${sq.rate === 'half' ? 1 : 0})`);
    } else {
      await evaluate('window.__sdfGame.setHalfRate(false)');
    }

    const frames = sq.scene === 'sever' ? 20 : sq.scene === 'fire' ? 18 : 16;

    if (sq.scene === 'strafe') {
      // FROZEN world, scripted lateral camera sweep past a zombie at ~2 m.
      await evaluate('window.__sdfGame.freeze(true)');
      await evaluate('window.__sdfGame.teleport(1)');
      await evaluate('window.__sdfGame.refreshHull()');
      const zs = await evaluate('window.__sdfGame.zombies()');
      const z = zs.find((q) => q.room === 1);
      if (!z) fail('no zombie in room 1');
      const zx = z.pos[0], zz = z.pos[2];
      // Stand 2 m south, face the zombie.
      const px = zx, pz = zz + 2.0;
      const yaw = Math.atan2(zx - px, -(zz - pz));
      const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
      for (let f = 0; f < frames; f++) {
        const t = (f - (frames - 1) / 2) * 0.055;   // ~3.3 m/s lateral
        await evaluate(`window.__sdfGame.setPose(${px + rightX * t}, ${pz + rightZ * t}, ${yaw}, 0)`);
        await evaluate('window.__sdfGame.step(1, 1/60)');
        await shot(`${dir}/f${String(f).padStart(2, '0')}.png`);
      }
    } else if (sq.scene === 'walk') {
      // LIVE wanderers, camera parked; wait until a zombie crosses the view,
      // then capture 16 consecutive frames (walk cycle under the toggle).
      await evaluate('window.__sdfGame.freeze(false)');
      await evaluate('window.__sdfGame.teleport(2)');
      await evaluate('window.__sdfGame.setPose(7.4, -7.4, -Math.PI * 0.75, 0)');
      await evaluate('window.__sdfGame.refreshHull()');
      const pose = await evaluate('window.__sdfGame.pose()');
      let found = null;
      const deadline = Date.now() + 90000;
      let lastZs = await evaluate('window.__sdfGame.zombies()');
      await evaluate('window.__sdfGame.setLoopRunning(true)');
      while (Date.now() < deadline) {
        await sleep(300);
        const zs = await evaluate('window.__sdfGame.zombies()');
        const p = pose.pos;
        for (const z of zs) {
          if (z.room !== 2) continue;
          const dx = z.pos[0] - p[0], dz = z.pos[2] - p[2];
          const dist = Math.hypot(dx, dz);
          if (dist < 2.2 || dist > 5.5) continue;
          const dYaw = wrap(Math.atan2(dx, -dz) - pose.yaw);
          if (Math.abs(dYaw) > 0.25) continue;
          // moving, and mostly ACROSS the view rather than at the camera?
          const lz = lastZs.find((q) => q.id === z.id);
          if (!lz) continue;
          const mx = z.pos[0] - lz.pos[0], mz = z.pos[2] - lz.pos[2];
          const spd = Math.hypot(mx, mz) / 0.3;
          if (spd < 0.15) continue;
          const toCam = { x: -dx / dist, z: -dz / dist };
          const across = Math.abs(mx / (Math.hypot(mx, mz) || 1) * toCam.x + mz / (Math.hypot(mx, mz) || 1) * toCam.z);
          if (across > 0.8) continue;
          found = { id: z.id, dist };
          break;
        }
        lastZs = zs;
        if (found) break;
      }
      await evaluate('window.__sdfGame.setLoopRunning(false)');
      if (!found) fail('walk: no zombie crossed the view within 90 s');
      log(`  walk: capturing zombie ${found.id} at ${found.dist.toFixed(1)} m`);
      for (let f = 0; f < frames; f++) {
        await evaluate('window.__sdfGame.step(1, 1/60)');
        await shot(`${dir}/f${String(f).padStart(2, '0')}.png`);
      }
    } else {
      // fire / sever: frozen zombie at ~3 m, confirmed surface aim, shoot,
      // capture the flight, impact and (sever) the chunks.
      await evaluate('window.__sdfGame.freeze(true)');
      await evaluate('window.__sdfGame.teleport(1)');
      const zs = await evaluate('window.__sdfGame.zombies()');
      const z = zs.find((q) => q.room === 1);
      if (!z) fail('no zombie in room 1');
      const px = z.pos[0], pz = z.pos[2] + 3.0;
      const yaw = Math.atan2(z.pos[0] - px, -(z.pos[2] - pz));
      await evaluate(`window.__sdfGame.setPose(${px}, ${pz}, ${yaw}, 0)`);
      await evaluate('window.__sdfGame.step(5, 1/60)');
      const aimed = await evaluate('window.__sdfGame.aimSurface()');
      if (!aimed) fail('aimSurface could not confirm a target');
      await evaluate('window.__sdfGame.step(2, 1/60)');
      if (sq.scene === 'sever') await evaluate('window.__sdfGame.fireSlug()');
      else await evaluate('window.__sdfGame.fire(1)');
      for (let f = 0; f < frames; f++) {
        await evaluate('window.__sdfGame.step(1, 1/60)');
        await shot(`${dir}/f${String(f).padStart(2, '0')}.png`);
      }
    }

    const bad = consoleErrors();
    log(`  ${name}: ${shotCount} shots total, console errors so far: ${bad.length}`);
    if (bad.length) {
      for (const e of bad.slice(0, 5)) console.error('  |', e.type, e.text.slice(0, 300));
      fail(`${name}: console errors during reel`);
    }
  }
  log(`reel: done, ${shotCount} frames`);
  ws.close();
  process.exit(0);
}

fail(`unknown mode: ${MODE} (use parity|diff|gate500|bench|reel)`);
