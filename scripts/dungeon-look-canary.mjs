// scripts/dungeon-look-canary.mjs — DOES THE FROZEN CAPTURE PATH STILL SEE
// CHARACTERS?
//
// scripts/dungeon-look.sh, scripts/dungeon-bench.sh and every dispatch agent
// that "verified a look change" do it through one path: freeze(true) +
// setLoopRunning(false) + setPose + step(n). If that path ever stopped
// re-running the SDF march — a hold frame that never clears, a draw callback
// that stops being called — the shot would still LOOK like a dungeon and every
// character-only regression would be invisible to it. That failure is silent
// by construction, so it needs a canary rather than a code reading.
//
// The test is a change that MUST move character pixels and can move nothing
// else: the flesh albedo (baseColor) on every actor. Three shots at one pose —
// same state twice (the floor), recoloured (the signal), restored (back to the
// floor) — and the verdict is the ratio.
//
// WHY NOT the in-page canvas: reading the WebGPU canvas with drawImage +
// getImageData is NOT a usable oracle here. Measured 2026-09-01 on this page:
// it returns an all-black image (whole-frame mean rgb 0,0,0) at moments when
// Page.captureScreenshot returns the correct frame, and real content at other
// moments, with the loop running or stopped. An A/B built on it reports "no
// change" for changes that are plainly there. Diff the PNG.
//
// Usage: node scripts/dungeon-look-canary.mjs [vitePort] [cdpPort]
//        scripts/dungeon-look-canary.sh          # boots its own servers
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5297);
const CDP = Number(process.argv[3] ?? 9297);
const OUT = process.env.LOOK_OUT ?? '/tmp/dungeon-canary';
// room1 spawn, the pose with the most bodies in frame — the canary wants
// character pixels, so it uses the fullest shot rather than the prettiest.
const POSE = (process.env.LOOK_POSE ?? '-7.4,-7.4,2.3561945,0').split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- minimal PNG decode (8-bit truecolor, non-interlaced), as dungeon-shadowab
function decodePng(buf) {
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
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
function changedPx(a, b) {
  if (a.w !== b.w || a.h !== b.h) throw new Error('size mismatch');
  let changed = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    const ia = i * a.ch, ib = i * b.ch;
    const d = Math.abs(a.data[ia] - b.data[ib])
            + Math.abs(a.data[ia + 1] - b.data[ib + 1])
            + Math.abs(a.data[ia + 2] - b.data[ib + 2]);
    if (d > 30) changed++;
  }
  return changed;
}

// --- CDP driver -------------------------------------------------------------
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
};
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
// Same settle as gallery-look.mjs, and for the same reason: captureScreenshot
// can return before the submitted GPU work reaches the compositor.
const SETTLE = Number(process.env.LOOK_SETTLE_MS ?? 450);
const shot = async (name) => {
  await sleep(SETTLE);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(`${OUT}/${name}.png`, buf);
  return decodePng(buf);
};

mkdirSync(OUT, { recursive: true });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });
for (let i = 0; i < 240; i++) {
  await sleep(500);
  if (await ev('typeof window.__sdfGame === "object"')) break;
}
if (!(await ev('typeof window.__sdfGame === "object"'))) { console.error('never booted', errors.slice(-5)); process.exit(1); }

// EXACTLY the capture path under test — gallery-look.mjs, line for line.
await ev('typeof window.__sdfGame.gooPanel === "function" && window.__sdfGame.gooPanel(false)');
await ev('window.__sdfGame.freeze(true)');
await ev('window.__sdfGame.setLoopRunning(false)');
await ev(`window.__sdfGame.setPose(${POSE[0]}, ${POSE[1]}, ${POSE[2]}, ${POSE[3]})`);
await ev(`window.__sdfGame.step(${Number(process.env.LOOK_STEPS ?? 20)}, 1/60)`);
await ev(`(() => { const s = window.__dungeon && window.__dungeon.spot;
  if (!s || !s.shadow) return false; s.shadow.intensity = 1; return true; })()`);
await ev('window.__sdfGame.step(3, 1/60)');

const bodies = await ev('window.__sdfGame.bodiesOnScreen()');
console.log(`pose ${POSE.join(',')} · bodiesOnScreen ${bodies} · halfRate ${await ev('window.__sdfGame.halfRate')}`);
if (!bodies) { console.error('FAIL: no bodies in frame — the canary has nothing to watch'); process.exit(1); }

// FLOOR: the same state, captured twice, nothing touched. Everything below is
// measured against this, because cross-capture noise here is not zero (the HUD
// repaints, and the fire flicker rides performance.now() rather than the step).
const a = await shot('canary-a');
const b = await shot('canary-b');
const floor = changedPx(a, b);

// SIGNAL: flesh albedo on every actor, green. Characters only — no light, no
// mesh, no camera moves. Originals saved so the restore is exact.
const n = await ev(`(() => {
  window.__canaryBase = [];
  for (const z of window.__sdfGame.zombies()) {
    const u = window.__sdfGame.zombie(z.id).view.uniforms;
    window.__canaryBase.push([z.id, u.baseColor.value.getHex()]);
    u.baseColor.value.setHex(0x00ff00);
  }
  return window.__canaryBase.length;
})()`);
await ev('window.__sdfGame.step(3, 1/60)');
const green = await shot('canary-green');
const signal = changedPx(b, green);

await ev(`(() => { for (const [id, hex] of window.__canaryBase)
  window.__sdfGame.zombie(id).view.uniforms.baseColor.value.setHex(hex); })()`);
await ev('window.__sdfGame.step(3, 1/60)');
const back = await shot('canary-restored');
const residual = changedPx(b, back);

console.log(`actors recoloured: ${n}`);
console.log(`floor    (same state, twice)      : ${floor} px changed`);
console.log(`signal   (flesh albedo -> green)  : ${signal} px changed`);
console.log(`residual (albedo restored)        : ${residual} px changed`);
console.log(`shots in ${OUT}/`);

// The bar: the character-only change has to dominate the floor, and undoing it
// has to come back to the floor. A frozen path that re-composited a held march
// would score signal ~= floor; one that leaked state would score residual >>
// floor.
const SIGNAL_MIN = Math.max(20 * floor, 1500);
const RESIDUAL_MAX = Math.max(5 * floor, 400);
let ok = true;
if (signal < SIGNAL_MIN) {
  console.error(`FAIL: a flesh-albedo change moved ${signal} px, under the ${SIGNAL_MIN} px bar.`);
  console.error('       The frozen capture is NOT tracking character changes — look');
  console.error('       verification through dungeon-look/dungeon-bench is unsound.');
  ok = false;
}
if (residual > RESIDUAL_MAX) {
  console.error(`FAIL: restoring the albedo left ${residual} px changed (bar ${RESIDUAL_MAX}).`);
  console.error('       The frozen capture is not returning to the same state.');
  ok = false;
}
if (errors.length) console.log('console errors:', errors.length, errors.slice(-3));
console.log(ok ? 'PASS: the frozen capture path tracks character-only changes.' : 'CANARY FAILED');
ws.close();
process.exit(ok ? 0 : 1);
