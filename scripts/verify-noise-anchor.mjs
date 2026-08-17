// Noise-anchor wiring A/B, v2 — pose/camera frozen, ONLY the anchor moves.
//   S_live  : body walking far from origin (anchor = live rootShift)
//   statue1 : motion disabled the same second (body frozen; anchor forced 0)
//   statue2 : another statue frame (noise floor: identical anchor)
// If the plumbing is live, diff(S_live, statue1) >> diff(statue1, statue2).
// Usage: node scripts/verify-noise-anchor.mjs <port> <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5231);
const OUT = process.argv[3] ?? '/tmp/motion-polish';
const CDP = 9223;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const res = await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' });
const tab = await res.json();
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
await send('Page.bringToFront');
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-lab-webgpu.html` });
await sleep(2500);

// Liveness gate: the canvas only renders while the page composites. An
// occluded window freezes rAF and the screenshot is a STALE frame (the
// DOM HUD keeps updating, which masquerades as change). Bring the tab to
// the front and prove rAF is ticking INSIDE this one tool call, per the
// <300ms-burst rule, before trusting any canvas pixels.
const rafAlive = async () => {
  const dt = await evaluate(`(async () => {
    const ts = [];
    for (let i = 0; i < 3; i++) ts.push(await new Promise(r => requestAnimationFrame(r)));
    return ts[2] - ts[0];
  })()`, true);
  return dt < 100;
};
for (let i = 0; i < 10; i++) {
  await send('Page.bringToFront');
  await sleep(300);
  if (await rafAlive()) break;
  console.log('rAF throttled — bringing tab to front again');
}
if (!(await rafAlive())) throw new Error('page not compositing (rAF throttled) — screenshots would be stale');
console.log('rAF live');

const motion = () => evaluate(`window.__sdfLab.motion`);
const shot = async (name) => {
  if (!(await rafAlive())) throw new Error(`rAF throttled before ${name} — stale frame risk`);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  const m = await motion();
  console.log(`shot ${name}: shift=[${m.rootShift.map(v => v.toFixed(2))}] blend=${m.blend.toFixed(2)} enabled=${m.enabled}`);
};

await evaluate(`window.__sdfLab.setMotionEnabled(true); window.__sdfLab.setWander(true); 'on'`);
// walk until well away from the origin
for (let t = 0; t < 60000; t += 250) {
  await sleep(250);
  const m = await motion();
  if (Math.hypot(m.rootShift[0], m.rootShift[2]) > 1.2 && m.blend > 0.5) break;
}
await shot('S_live');
await evaluate(`window.__sdfLab.setMotionEnabled(false); 'statue'`);
await sleep(700); // pose settles against the frozen targets; anchor now (0,0)
await shot('statue1');
await sleep(400);
await shot('statue2');
console.log('done');
ws.close();
