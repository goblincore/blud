// scripts/sdf-egg-check.mjs — headless check for the control room's egg pass
// (docs/superpowers/specs/2026-09-30-night-train-egg-ending-design.md §2), on Night Train. Its own script
// and port pair (5373/9373). No-deps CDP, the disco check's plumbing.
//
//   1. WIRING: the egg() seam exists, the proxy is in the control room (room 8) at the plinth, in the
//      late scene and drawn at the door, and the plan-1 placeholder is hidden.
//   2. DRAWS: with the pass off (setEgg({ off })) the egg region of the frame differs: not blank.
//   3. PULSE: held at 0 vs 1 the egg region differs; live it varies over 40 steps.
//   4. FIGURE: it resolves with the setting (near, resolve 0 -> 1) and fades with range (far < near),
//      yet stays hard to make out. EGG_FIGURE_WARN=1 turns this section's FAILs into WARNs (the look
//      is tuned in plan 2 task 5; the thresholds are never loosened to pass).
//   5. ALL ROUND: from behind the egg still draws (no sorting seam), not hollow.
//   6. AWAY: in the Boiler Room the proxy is hidden.
//   7. COST: door pose with the pass on vs off (the placeholder), interleaved, report-only (WARN > +1 ms).
//
// EGG_SHEET=<png> writes one labelled contact sheet (door, near r0, near r1, behind, pulse 0, pulse 1);
// EGG_SHOTS=<dir> keeps the frames there (default ${LAB_TMP ?? /tmp}/egg-shots). EGG_SKIP_COST=1 skips 7.
// EGG_QUERY appends to the page query. Usage: scripts/sdf-egg-check.sh, or node scripts/sdf-egg-check.mjs <vite> <cdp>.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';

const T0 = Date.now();
const VITE = Number(process.argv[2] ?? 5373);
const CDP = Number(process.argv[3] ?? 9373);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const pass = (msg) => console.log(`ok   ${msg}`);
function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
}

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const closeUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', closeUrl], { stdio: 'ignore' }); } catch {} });

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
let consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, ms = 30000) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), ms,
    `evaluate: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
async function boot(query) {
  consoleEvents = [];
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${query}&layers=${process.env.LIGHT_LAYERS ?? 'all'}` });
  for (let i = 0; i < 360; i++) {
    await sleep(500);
    const phase = await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null);
    if (phase === 'ready') return true;
    const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
    if (errs.length) return false;
  }
  return false;
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });


/** PNG decode (8-bit RGB/RGBA), copied from scripts/dungeon-shadowab.mjs. */
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

/** Mean rgb (0..1) over a box given in fractions of the frame (train gate's helper). */
function meanRgb(img, fx0, fy0, fx1, fy1) {
  const { w, h, ch, data } = img;
  const x0 = Math.floor(fx0 * w), x1 = Math.floor(fx1 * w), y0 = Math.floor(fy0 * h), y1 = Math.floor(fy1 * h);
  const acc = [0, 0, 0]; let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * ch; acc[0] += data[i]; acc[1] += data[i + 1]; acc[2] += data[i + 2]; n++; }
  return acc.map((v) => v / n / 255);
}
/** Mean luma (0..255) over a box of frame fractions [x0, y0, x1, y1]. */
const luma = (img, b) => { const [r, g, bl] = meanRgb(img, ...b); return 255 * (0.2126 * r + 0.7152 * g + 0.0722 * bl); };

const SHOTS = process.env.EGG_SHOTS;
const SHEET = process.env.EGG_SHEET;
const shotDir = SHOTS ?? join(process.env.LAB_TMP ?? '/tmp', 'egg-shots');
mkdirSync(shotDir, { recursive: true });
const shots = {};
/** Screenshot, write the PNG, return the decoded image (the assertions read pixels). */
const shootImg = async (name, label) => {
  await evaluate('__sdfGame.timeDraws(2)');
  const png = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
  const file = join(shotDir, `${name}.png`);
  writeFileSync(file, png);
  shots[name] = { file, label: label ?? name };
  return decodePng(png);
};
const stepN = (n, dt) => evaluate(`__sdfGame.step(${n}${dt === undefined ? '' : `, ${dt}`})`, 300000);
const egg = () => evaluate('__sdfGame.egg()');
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };

// Poses: x, z, yaw, pitch. The egg is at x 0, z -136.7; the completion box is z -135.1..-138.3 (never enter it:
// a level.end ends the run), the plinth fills z -135.5..-137.9.
const FAR = '0, -131.4, 0, 0';      // the door, 5.3 m
const MID = '0, -133.4, 0, 0';      // 3.3 m
const NEAR = '0, -134.9, 0, 0';     // 1.8 m, at the edge of the completion box
const BEHIND = `0, -139.0, ${Math.PI}, 0`;   // between the egg and the CRT wall, looking back south at it
const q = 'level=night-train&frozen&nospawn&god' + (process.env.EGG_QUERY ?? '');
if (!(await boot(q))) { console.error(consoleEvents.slice(-8)); fail(`night-train did not boot (${q})`); }
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
for (const c of ['setFlashlight(false)', 'setDemoHold(true)', 'holdWindowLight(0, -1)', 'setLightClockFrozen(true)', 'setLightTime(0)']) await evaluate(`__sdfGame.${c}`);
const at = async (pose) => { await evaluate(`__sdfGame.setPose(${pose})`); await sleep(1500); await evaluate(`__sdfGame.setPose(${pose})`); await stepN(6); };

// 1. WIRING.
await at(FAR);
let E = await egg();
if (!E) fail('no egg() seam / no placeholder egg on night-train');
if (E.room !== 8) fail(`egg in room ${E.room}, not the control room`);
if (!E.inLateScene) fail('the egg proxy is not in the late scene');
if (!E.visible) fail(`the egg proxy is hidden at the door: ${JSON.stringify(E)}`);
if (E.placeholderVisible) fail('the placeholder egg is still drawn');
if (Math.abs(E.centre[0]) > 0.05 || Math.abs(E.centre[2] + 136.7) > 0.05 || Math.abs(E.centre[1] - 1.6) > 0.1) fail(`egg centre ${E.centre} is not (0, 1.6, -136.7)`);
pass(`wiring: egg at ${E.centre}, proxy ${E.material} in the late scene, placeholder hidden`);
const imgOn = await shootImg('1-door', 'door (far, 5.3 m)');

// 2. IT DRAWS: with the pass off (the placeholder back) the egg region differs; the pass is not blank.
// The egg region of the frame at the door pose.
const EGG_BOX = [0.34, 0.22, 0.66, 0.76];   // the outer egg's silhouette at the door pose (x 275-525 px, y 132-455 of 800 x 600)
await evaluate('__sdfGame.setEgg({ off: true })'); await stepN(2);
const imgOff = await shootImg('2-placeholder', 'placeholder (pass off)');
await evaluate('__sdfGame.setEgg({ off: false })'); await stepN(2);
const lOn = luma(imgOn, EGG_BOX), lOff = luma(imgOff, EGG_BOX);
if (Math.abs(lOn - lOff) < 3) fail(`the egg pass looks the same as the placeholder (luma ${lOn.toFixed(1)} vs ${lOff.toFixed(1)})`);
pass(`draws: egg region luma ${lOn.toFixed(1)} (pass) vs ${lOff.toFixed(1)} (placeholder)`);

// 3. PULSE: held at 0 and at 1 the egg region differs; live it varies over 2 s of steps.
await evaluate('__sdfGame.setEgg({ pulse: 0 })'); await stepN(2);
const lP0 = luma(await shootImg('3-pulse0', 'pulse held 0 (door)'), EGG_BOX);
await evaluate('__sdfGame.setEgg({ pulse: 1 })'); await stepN(2);
const lP1 = luma(await shootImg('3-pulse1', 'pulse held 1 (door)'), EGG_BOX);
if (!(lP1 > lP0 * 1.08)) fail(`pulse 1 is not brighter than pulse 0 (${lP1.toFixed(1)} vs ${lP0.toFixed(1)})`);
await evaluate('__sdfGame.setEgg({ pulse: null })');
const seen = new Set();
for (let i = 0; i < 40; i++) { await stepN(3, 1 / 30); seen.add((await egg()).pulse.toFixed(2)); }
if (seen.size < 4) fail(`the live pulse barely moves (${[...seen]})`);
pass(`pulse: held 0 -> ${lP0.toFixed(1)}, held 1 -> ${lP1.toFixed(1)} (+${((lP1 / lP0 - 1) * 100).toFixed(0)}%); live pulse took ${seen.size} distinct values`);

// 4. THE FIGURE RESOLVES with distance and with the setting. Contrast = how much darker the figure's
// patch is than the bare milk beside it at the same height. The boxes are per pose (the egg is 3x bigger
// near) and dodge the inner egg's bright spots (the spot directions are fixed, so the frames are repeatable).
// Frames are 800 x 600; the figure stands at the inner egg's centre (y ~1.4 m, eye height 1.6 m).
const FIG_BOXES = {
  // far (5.3 m): the inner egg is x 328-475, y 215-420 px; the figure's left half, below the head spot.
  far: { fig: [0.51, 0.50, 0.55, 0.58], sides: [[0.425, 0.47, 0.452, 0.57], [0.56, 0.47, 0.585, 0.57]] },
  // near (1.8 m): the inner egg fills x 180-620; the big spot sits on the right of the figure (x 410-560, y 290-440),
  // so the figure patch is its left half (x 296-400, y 312-432) and the milk is the strip to its left.
  near: { fig: [0.50, 0.45, 0.62, 0.70], sides: [[0.27, 0.70, 0.34, 0.82], [0.27, 0.27, 0.34, 0.42], [0.71, 0.50, 0.75, 0.62]] },
};
const contrast = (img, set) => {
  const side = set.sides.reduce((a, b) => a + luma(img, b), 0) / set.sides.length;
  return (side - luma(img, set.fig)) / Math.max(side, 1e-3);
};
await evaluate('__sdfGame.setEgg({ resolve: 0 })');
await at(NEAR); const cN0 = contrast(await shootImg('4-near-resolve0', 'near, resolve 0'), FIG_BOXES.near);
await evaluate('__sdfGame.setEgg({ resolve: 1 })'); await stepN(2);
const cN1 = contrast(await shootImg('4-near-resolve1', 'near, resolve 1'), FIG_BOXES.near);
await at(FAR); const cF1 = contrast(await shootImg('4-far-resolve1', 'far, resolve 1'), FIG_BOXES.far);
E = await egg();
console.log(`     figure contrast: near r0 ${cN0.toFixed(3)}, near r1 ${cN1.toFixed(3)}, far r1 ${cF1.toFixed(3)}`);
const figProblems = [];
if (!(cN1 > cN0 * 1.15)) figProblems.push(`the setting does not sharpen the figure near (${cN1.toFixed(3)} vs ${cN0.toFixed(3)})`);
if (!(cF1 < cN1)) figProblems.push(`the figure is as clear at range as near (${cF1.toFixed(3)} vs ${cN1.toFixed(3)})`);
if (!(cN1 < 0.6)) figProblems.push(`the figure is too clear even soft (${cN1.toFixed(3)}); it should be hard to make out`);
if (figProblems.length) {
  if (process.env.EGG_FIGURE_WARN) for (const p of figProblems) console.log(`WARN figure: ${p}`);
  else fail(`figure (section 4): ${figProblems.join('; ')}. EGG_FIGURE_WARN=1 downgrades these to warnings; the fix is the look (EGG/FIGURE tables in egg-look.ts), not the thresholds`);
} else pass(`figure: contrast near ${cN0.toFixed(2)} (resolve 0) -> ${cN1.toFixed(2)} (resolve 1), far ${cF1.toFixed(2)}`);
await evaluate(`__sdfGame.setEgg({ resolve: ${0.5} })`);

// 5. ALL ROUND: the egg draws from behind too (no sorting seam), and is not hollow.
await at(BEHIND);
E = await egg();
if (!E.visible) fail('the egg proxy is hidden behind the egg');
const lBehind = luma(await shootImg('5-behind', 'behind the egg, looking south'), EGG_BOX);
if (!(lBehind > 4)) fail(`from behind the egg region is black (${lBehind.toFixed(1)})`);
pass(`behind: egg region luma ${lBehind.toFixed(1)}`);

// 6. AWAY: in the Boiler Room the proxy is hidden.
await evaluate('__sdfGame.setPose(0, -105.0, 0, 0)'); await stepN(4);
E = await egg();
if (E.visible) fail('the egg proxy is drawn from the Boiler Room');
pass('away: hidden in the Boiler Room');

// 7. COST (report only): the door pose with the pass on vs off, interleaved.
if (!process.env.EGG_SKIP_COST) {
  await at(FAR);
  const on = [], off = [];
  for (let k = 0; k < 5; k++) {
    await evaluate('__sdfGame.setEgg({ off: true })'); await stepN(1, 0); off.push(await evaluate('__sdfGame.timeDraws(9)'));
    await evaluate('__sdfGame.setEgg({ off: false })'); await stepN(1, 0); on.push(await evaluate('__sdfGame.timeDraws(9)'));
  }
  const d = median(on) - median(off);
  console.log(`cost: egg pass on ${median(on).toFixed(2)} ms vs placeholder ${median(off).toFixed(2)} ms (${d >= 0 ? '+' : ''}${d.toFixed(2)} ms, load ${loadavg()[0].toFixed(1)})`);
  if (d > 1.0) console.log('WARN: the egg pass costs more than +1.0 ms');
}

const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errs.length) fail(`console errors: ${JSON.stringify(errs.slice(0, 4))}`);

if (SHEET) {
  const order = ['1-door', '4-near-resolve0', '4-near-resolve1', '5-behind', '3-pulse0', '3-pulse1'].filter((n) => shots[n]);
  mkdirSync(dirname(SHEET), { recursive: true });
  const py = `
import sys
from PIL import Image, ImageDraw
files = sys.argv[2::2]; labels = sys.argv[3::2]
ims = [Image.open(f).convert('RGB') for f in files]
w, h = ims[0].size; bar = 28
cols = 3; rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, (h + bar) * rows), (16, 16, 16))
d = ImageDraw.Draw(sheet)
for i, (im, lab) in enumerate(zip(ims, labels)):
    x, y = (i % cols) * w, (i // cols) * (h + bar)
    sheet.paste(im, (x, y + bar))
    d.text((x + 8, y + 8), lab, fill=(235, 235, 235))
sheet.save(sys.argv[1])
`;
  execFileSync('python3', ['-c', py, SHEET, ...order.flatMap((n) => [shots[n].file, shots[n].label])], { stdio: 'inherit' });
  console.log(`sheet: ${SHEET}`);
}
console.log(`frames: ${shotDir}`);
console.log(`PASS sdf-egg-check (wall ${((Date.now() - T0) / 1000).toFixed(0)} s)`);
process.exit(0);
