// CDP driver for the motion-polish task-5 browser verification:
//   watch TWO full wander legs — the face must lead travel through turns in
//   every quadrant (the 180°-head fix), knees hinge forward, arms reach
//   travel-side. Captures a shot series across headings + a metadata log.
// Node 22 native WebSocket against Chrome --remote-debugging-port. No deps.
//
// No synthetic pointer events (the pane replays them as phantom clicks —
// the lab shoots where the cursor last touched). Everything goes through
// __sdfLab APIs.
//
// Usage: node scripts/verify-motion-polish-5.mjs <vitePort> <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5317);
const OUT = process.argv[3] ?? '/tmp/motion-polish-5';
const CDP = 9223;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });

let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-lab-webgpu.html` });
await sleep(2500);

const gpu = await evaluate(`(async () => {
  const a = await navigator.gpu?.requestAdapter();
  return a ? 'webgpu-ok' : 'NO-ADAPTER';
})()`, true);
console.log('backend:', gpu);
if (gpu !== 'webgpu-ok') process.exit(1);

const motionPeek = () => evaluate(`(() => { const m = window.__sdfLab.motion;
  return { heading: +m.heading.toFixed(3), bodyYaw: +m.bodyYaw.toFixed(3),
    speed: +m.speed.toFixed(2), phase: m.phase,
    pos: m.pos.map(v => +v.toFixed(2)) }; })()`);

const log = [];
const shot = async (name, tag) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  const m = await motionPeek();
  log.push({ shot: name, tag, ...m });
  console.log(`shot ${name} (${tag}):`, JSON.stringify(m));
};

// The playtest config: motion + wander + reach arms + gaze follows travel.
// Three-quarter camera close enough to read the face and the knee hinge.
await evaluate(`(() => {
  const L = window.__sdfLab;
  L.setMotionEnabled(true); L.setWander(true); L.setArmStyle('reach');
  L.setGazeFollow(1); L.setCam(0.7, 0.28, 3.6);
  return 1; })()`);

// Two full wander legs ≈ arrivals at two targets + the turns between them.
// Sample for up to 100 s: a shot every ≥1.4 s while actually walking, plus
// a shot at every heading quadrant change (turns are where the face fix
// shows). Deterministic wander is not seeded here — this is the live read.
const quadrant = (h) => {
  const a = ((h % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return Math.round(a / (Math.PI / 2)) % 4; // 0:+z 1:+x 2:-z 3:-x
};
const QNAME = ['+z', '+x', '-z', '-x'];
let lastShot = 0;
let lastQuad = null;
let arrivals = 0;
let wasWalking = false;
const t0 = Date.now();
let n = 0;
while (Date.now() - t0 < 100_000 && (arrivals < 2 || n < 8)) {
  await sleep(150);
  const m = await motionPeek();
  const walking = m.speed > 0.45;
  if (wasWalking && !walking) { arrivals++; console.log(`arrival #${arrivals} at`, JSON.stringify(m.pos)); }
  wasWalking = walking;
  if (!walking) continue;
  const q = quadrant(m.bodyYaw);
  const turnedIntoNewQuadrant = lastQuad !== null && q !== lastQuad;
  if (lastQuad === null) lastQuad = q;
  const due = Date.now() - lastShot > 1400;
  if (turnedIntoNewQuadrant || due) {
    n++;
    await shot(`t5-walk-${String(n).padStart(2, '0')}-${QNAME[q]}`,
      turnedIntoNewQuadrant ? `turn ${QNAME[lastQuad]}→${QNAME[q]}` : 'walk');
    lastShot = Date.now();
    lastQuad = q;
  }
}
writeFileSync(`${OUT}/t5-log.json`, JSON.stringify(log, null, 2));
console.log(`done: ${n} shots, ${arrivals} arrivals, quadrants seen:`,
  [...new Set(log.map(l => QNAME[quadrant(l.bodyYaw)]))].join(' '));
process.exit(0);
