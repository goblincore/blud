// scripts/sdf-game-wake-gate.mjs — headless gate for level 0, The Wake.
// No-deps CDP, same plumbing as scripts/sdf-game-shorty-gate.mjs.
//
//   1. BOOT: webgpu, warm gate ready, no console errors, level 'the-wake'.
//   2. LAYOUT: eight rooms, start in 'gates', the parlour window exists.
//   3. GATE: the crypt slab blocks the player until opened, then lets them through.
//   4. CAPABILITY: the two-floors fixture is refused with a clear message.
//
// Usage: LAB_VITE_PORT=5291 LAB_CDP_PORT=9291 node scripts/sdf-game-wake-gate.mjs
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5291);
const CDP = Number(process.argv[3] ?? 9291);
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
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 30000,
    `evaluate: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
async function boot(query) {
  consoleEvents = [];
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${query}` });
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

// 1. BOOT
if (!(await boot('level=the-wake&frozen'))) { console.error(consoleEvents.slice(-8)); fail('the-wake did not boot to ready'); }
if ((await evaluate('__sdfGame.backend')) !== 'webgpu') fail('backend is not webgpu');
const level = await evaluate('__sdfGame.level()');
if (level.id !== 'the-wake') fail(`level ${level.id}, expected the-wake`);
pass('boot: webgpu, warm gate ready, no errors, the-wake active');

// 2. LAYOUT
if (JSON.stringify(level.rooms) !== JSON.stringify(['gates', 'lane', 'graveyard', 'crypt', 'ossuary', 'vestibule', 'parlour', 'secret'])) {
  fail(`rooms ${JSON.stringify(level.rooms)}`);
}
if ((await evaluate('__sdfGame.room()')) !== 'gates') fail('start room is not gates');
if (!level.windows.includes('parlour-window')) fail('parlour window missing');
pass('layout: eight rooms, start in gates, parlour window present');

// 2b. OUTDOORS (Outdoor v1): the sky draws above the graveyard; the moon's shadow
// renders while outdoors and idles in the crypt.
await evaluate('__sdfGame.freeze(true)');
await evaluate('__sdfGame.setPose(-11.5, -27.5, 0.67, 0.25)');
await sleep(1200);
const skyShot = decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
// Mean colour of rows 30 px .. +15 % (below the tuning-panel bar), 0..1.
const skyTop = (() => {
  const { w, h, ch, data } = skyShot; const y0 = 30, y1 = y0 + Math.floor(h * 0.15);
  const acc = [0, 0, 0]; let n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * ch; acc[0] += data[i]; acc[1] += data[i + 1]; acc[2] += data[i + 2]; n++; }
  return acc.map(v => v / n / 255);
})();
const skyInfo = await evaluate('__sdfGame.sky()');
if (!skyInfo) fail('__sdfGame.sky() is null on an outdoor level');
const fogC = skyInfo.preset.fog.color;
const skyDiff = Math.max(...skyTop.map((v, i) => Math.abs(v - fogC[i])));
if (!(skyDiff > 0.03)) fail(`top of frame matches the fog colour (diff ${skyDiff.toFixed(3)}): no sky drawn`);
if (!skyInfo.moonShadowLive) fail('moon shadow idle while standing in the graveyard');
await evaluate('__sdfGame.setPose(10, -70, 0, 0)');
await sleep(600);
if ((await evaluate('__sdfGame.sky()')).moonShadowLive) fail('moon shadow still rendering in the crypt');
pass(`outdoors: sky draws (top-of-frame vs fog diff ${skyDiff.toFixed(3)}), moon shadow live outdoors, idle in the crypt`);

// 3. GATE — stand south of the slab, walk north, check z did not cross it.
// The crypt slab (layout.md §2): gate z -59…-58.6 inside the crypt stairs
// (z -62…-58). Walk from the graveyard's north lane toward the crypt.
const SLAB_SOUTH = -58.6, SLAB_NORTH = -59, WALK_TO_Z = -61.5;
async function walkNorthFrom(x, z, ms) {
  await evaluate(`__sdfGame.setPose(${x}, ${z}, 0, 0)`);
  await evaluate(`__sdfGame.walkTo(${x}, ${WALK_TO_Z})`);
  await sleep(ms);
  await evaluate('__sdfGame.walkCancel()');
  return evaluate('__sdfGame.pose().pos[2]');
}
await evaluate('__sdfGame.freeze(true)');
const blockedZ = await walkNorthFrom(10.6, -55, 2500);
if (blockedZ < SLAB_SOUTH) fail(`walked through the closed crypt slab (z ${blockedZ})`);
if (!(await evaluate('__sdfGame.openGate("crypt-slab")'))) fail('openGate returned false');
const openZ = await walkNorthFrom(10.6, -55, 3500);
if (openZ > SLAB_NORTH - 0.5) fail(`gate open but the player stopped at z ${openZ}`);
pass(`gate: blocked at z ${blockedZ.toFixed(2)}, through to z ${openZ.toFixed(2)} once open`);

// 4. CAPABILITY — a level needing multi-floor is refused by name.
await boot('level=fixtures/two-floors');
const refused = consoleEvents.some((e) => /needs engine support for: multi-floor/.test(e.text))
  || /multi-floor/.test(await evaluate('document.getElementById("errors")?.textContent ?? ""'));
if (!refused) fail('two-floors fixture was not refused with a multi-floor message');
pass('capability: multi-floor level refused by name');

console.log('PASS sdf-game-wake-gate');
process.exit(0);
