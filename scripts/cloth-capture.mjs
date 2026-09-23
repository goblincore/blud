// LIVE CLOTH CAPTURE — frames of a .blob character WANDERING in the WebGPU lab,
// for judging cloth that only moves when the body does (the cultist's hem
// pendulum, 2026-09-23). blob-turntable.mjs freezes motion or marches in place
// (holdPose has no travel, so a pendulum that lags TRAVEL never swings there).
//
//   node scripts/cloth-capture.mjs <vitePort> <outDir> <frames> <cdpPort>
//   env: BLOB_CHARACTER (required), CLOTH_EVERY_MS (default 120),
//        CLOTH_YAW (camera yaw, rad, default 1.57 = side-on), BLOB_DIST,
//        BLOB_PITCH, BLOB_TARGET_Y, BLOB_PROBE (evaluated once after boot),
//        CLOTH_PRIM (index of a prim whose posed axis is logged per frame),
//        CLOTH_WANDER=0 (stand still), CLOTH_WIND="x,y,z" (m/s, __sdfLab.setWind).
//
// Writes frame-NN.png plus axis.json: per frame, the logged prim's a->b axis
// tilt from vertical (deg) — the number that says the skirt swung. Frames are
// wall-clock, so two runs differ; this is for LOOKING, not a golden image.
//
// Start the servers first (scripts/lab-servers.sh), or run it through
// scripts/cloth-capture.sh which does.
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const VITE = Number(process.argv[2] ?? 5233);
const OUT = process.argv[3] ?? '/tmp/cloth';
const FRAMES = Number(process.argv[4] ?? 40);
const CDP = Number(process.argv[5] ?? 9223);
const CHARACTER = process.env.BLOB_CHARACTER ?? '';
const EVERY = Number(process.env.CLOTH_EVERY_MS ?? 120);
const YAW = Number(process.env.CLOTH_YAW ?? 1.57);
const DIST = Number(process.env.BLOB_DIST ?? 2.6);
const PITCH = Number(process.env.BLOB_PITCH ?? 0.12);
const TARGET_Y = Number(process.env.BLOB_TARGET_Y ?? 1.0);
const PRIM = process.env.CLOTH_PRIM === undefined ? -1 : Number(process.env.CLOTH_PRIM);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch { /* gone */ }
});
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-lab-webgpu.html?character=${encodeURIComponent(CHARACTER)}` });
let booted = false;
for (let i = 0; i < 160 && !booted; i++) {
  await sleep(500);
  booted = await evaluate('typeof window.__sdfLab === "object" && !!window.__sdfLab.camera');
}
if (!booted) { console.error('FAIL: lab never booted'); process.exit(1); }
await sleep(1500);
if (process.env.BLOB_PROBE) console.log('probe:', JSON.stringify(await evaluate(process.env.BLOB_PROBE)));
await evaluate(`(() => {
  for (const s of ['#panel', '#controls']) { const e = document.querySelector(s); if (e) e.style.display = 'none'; }
  const t = document.querySelector('#panel-toggle'); if (t) t.style.display = 'none';
  window.__sdfLab.setMotionEnabled(true);
  window.__sdfLab.setWander(${process.env.CLOTH_WANDER !== '0'});
  ${process.env.CLOTH_WIND ? `window.__sdfLab.setWind(${process.env.CLOTH_WIND});` : ''}
  return true; })()`);
await sleep(1000);

const axis = [];
for (let i = 0; i < FRAMES; i++) {
  await evaluate(`(() => { window.__sdfLab.setCam(${YAW}, ${PITCH}, ${DIST}, ${TARGET_Y}); return true; })()`);
  await sleep(EVERY);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/frame-${String(i).padStart(2, '0')}.png`, Buffer.from(shot.result.data, 'base64'));
  if (PRIM >= 0) {
    axis.push(await evaluate(`(() => {
      const p = window.__sdfLab.heroPosed()?.prims?.[${PRIM}]; if (!p) return null;
      const d = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
      const l = Math.hypot(...d);
      return { tiltDeg: Math.acos(-d[1] / l) * 180 / Math.PI, a: p.a, b: p.b };
    })()`));
  }
}
if (PRIM >= 0) {
  writeFileSync(`${OUT}/axis.json`, JSON.stringify(axis, null, 1));
  const t = axis.filter(Boolean).map((x) => x.tiltDeg);
  console.log(`prim ${PRIM} tilt from vertical: min ${Math.min(...t).toFixed(1)} max ${Math.max(...t).toFixed(1)} deg`);
}
console.log(`${FRAMES} frames in ${OUT}`);
process.exit(0);
