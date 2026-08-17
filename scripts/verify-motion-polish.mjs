// CDP driver for the motion-polish browser verification (X1.22 playtest fixes).
// Node 22 native WebSocket against Chrome --remote-debugging-port. No deps.
//
// Usage: node scripts/verify-motion-polish.mjs <port> <outDir>
//   walks the body, captures head/face/body A/B shots + gait frames.
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5231);
const OUT = process.argv[3] ?? '/tmp/motion-polish';
const CDP = 9223;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function newTab() {
  const res = await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' });
  return res.json();
}
const tab = await newTab();
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

// Motion on, wander on — the lab's defaults for the walking shot.
const state0 = await evaluate(`(() => {
  const m = window.__sdfLab.motion;
  window.__sdfLab.setMotionEnabled(true);
  window.__sdfLab.setWander(true);
  return { phase: m.phase, enabled: m.enabled, wander: m.wander, shift: m.rootShift };
})()`);
console.log('motion:', JSON.stringify(state0));

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  const m = await evaluate(`window.__sdfLab.motion`);
  console.log(`shot ${name}: rootShift=[${m.rootShift.map(v => v.toFixed(2))}] heading=${m.heading.toFixed(2)} speed=${m.speed.toFixed(2)}`);
};

// --- (c) noise-riding A/B: body-centred frames at two distant world spots ---
// The camera target tracks the body, so the body occupies the same screen
// region in both shots; an anchored noise field keeps the skin pattern, a
// world-anchored one slides it.
await shot('walk-A');
const a0 = (await evaluate(`window.__sdfLab.motion.rootShift`));
let tries = 0;
while (tries++ < 240) {
  await sleep(500);
  const s = await evaluate(`window.__sdfLab.motion.rootShift`);
  const d = Math.hypot(s[0] - a0[0], s[2] - a0[2]);
  if (d > 0.9) break;
}
await shot('walk-B');

// --- (a)+(b) head socket / face prim rigidity: several gait frames -----
for (let i = 0; i < 4; i++) {
  await sleep(700);
  await shot(`gait-${i}`);
}

// Zoom the camera onto the head for the face-prim check (orbit params are
// page-internal; approximate with a close crop instead — capture two more
// full frames we can crop offline).
await shot('face-a');
await sleep(1200);
await shot('face-b');

console.log('done ->', OUT);
ws.close();
