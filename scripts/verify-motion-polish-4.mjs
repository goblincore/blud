// CDP driver for the motion-polish task-4 browser verification:
//   1. socketed shoulders through the reach cycle
//   2. gaze follows travel (default) vs pinned-gaze tuning (gazeFollow 0)
//   3. wounds ride the turning body (stamp mid-turn, turn on, compare)
// Node 22 native WebSocket against Chrome --remote-debugging-port. No deps.
//
// Wounds are stamped via __sdfLab.stampWounds (raycast against the POSED
// body through worldHitToWound — the exact defect-3 path) rather than
// synthetic pointer events, which the pane replays as phantom clicks.
//
// Usage: node scripts/verify-motion-polish-4.mjs <vitePort> <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5301);
const OUT = process.argv[3] ?? '/tmp/motion-polish-4';
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

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  const m = await evaluate(`(() => { const m = window.__sdfLab.motion; return {
    heading: +m.heading.toFixed(3), bodyYaw: +m.bodyYaw.toFixed(3),
    gazeFollow: m.gazeFollow, wounds: window.__sdfLab.wounds.length,
    armStyle: m.armStyle, speed: +m.speed.toFixed(2) }; })()`);
  console.log(`shot ${name}:`, JSON.stringify(m));
  return m;
};

// Deterministic-ish setup: motion + wander + reach arms (the playtest
// config), camera at a three-quarter front view, near enough to read the
// shoulder seam.
await evaluate(`(() => {
  const L = window.__sdfLab;
  L.setMotionEnabled(true); L.setWander(true); L.setArmStyle('reach');
  L.setGazeFollow(1); L.setCam(0.6, 0.25, 4.5);
  return 1; })()`);

const motionPeek = () => evaluate(`(() => { const m = window.__sdfLab.motion;
  let d = m.heading - m.bodyYaw;
  while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  return { heading: m.heading, bodyYaw: m.bodyYaw, d, speed: m.speed }; })()`);
// Wait for real walking (wander idles between targets).
const waitWalk = async (min = 0.6) => {
  for (let i = 0; i < 200; i++) {
    await sleep(150);
    if ((await motionPeek()).speed > min) return true;
  }
  return false;
};

// --- 1. socketed shoulders: four gait frames across the reach cycle ------
await waitWalk();
for (let i = 0; i < 4; i++) {
  await waitWalk();
  await sleep(550); // phase-shift between frames so the gait cycle shows
  await shot(`t4-reach-${i}`);
}

// --- 2. gaze leads into turns ---------------------------------------------
// Wander picks fresh targets on its own; poll until the body is mid-turn
// (heading ahead of the damped bodyYaw) and catch the head leading.
let turned = null;
for (let i = 0; i < 300 && !turned; i++) {
  await sleep(120);
  const m = await motionPeek();
  if (Math.abs(m.d) > 0.3 && Math.abs(m.d) < 1.6 && m.speed > 0.4) turned = m;
}
console.log('mid-turn state:', JSON.stringify(turned));
if (turned) await shot('t4-gaze-leads-turn');

// Pinned-gaze tuning: same walk, gazeFollow 0 — the creepy variant.
await evaluate(`window.__sdfLab.setGazeFollow(0)`);
for (let i = 0; i < 300; i++) {
  await sleep(120);
  const m = await motionPeek();
  if (Math.abs(m.d) > 0.3 && m.speed > 0.4) break;
}
await shot('t4-gaze-pinned');
await evaluate(`window.__sdfLab.setGazeFollow(1)`);

// --- 3. wounds ride the turning body --------------------------------------
// Respawn for a clean body, wait for a mid-turn, stamp two blast wounds on
// whatever side faces the ray, screenshot, let the body keep turning,
// screenshot again — the craters must ride the flesh, not stay viewer-fixed.
await evaluate(`window.__sdfLab.respawn()`);
await sleep(3000);
let pre = null;
for (let i = 0; i < 300 && !pre; i++) {
  await sleep(120);
  const m = await motionPeek();
  if (Math.abs(m.d) > 0.2 && Math.abs(m.d) < 1.4) pre = m;
}
console.log('stamp state:', JSON.stringify(pre));
await evaluate(`window.__sdfLab.stampWounds(2)`);
await sleep(150); // one upload tick, inside this visible window
const s1 = await shot('t4-wounds-stamped');
// Let the body rotate well past the stamp yaw.
let s2 = s1;
for (let i = 0; i < 100; i++) {
  await sleep(400);
  s2 = await evaluate(`(() => { const m = window.__sdfLab.motion;
    return { bodyYaw: m.bodyYaw }; })()`);
  let d = s2.bodyYaw - s1.bodyYaw;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  if (Math.abs(d) > 0.9) break;
}
await shot('t4-wounds-rotated');

console.log('done ->', OUT);
ws.close();
