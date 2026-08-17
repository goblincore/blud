// CDP driver for the per-prim orientation browser verification
// (motion-polish task 3 — the detached-visor fix). Same no-deps pattern as
// verify-motion-polish.mjs: Node 22 native WebSocket against Chrome
// --remote-debugging-port=9223.
//
// Usage: node scripts/verify-orient.mjs <vitePort> <outDir> [benchOnlyBefore]
//
// What it proves on a LIVE page:
//   1. rest + turned-head screenshots (brow must hug the skull at the
//      clamped angle — no visor/spike),
//   2. a phantom click ON THE TURNED HEAD lands a wound where clicked
//      (CPU-raycast vs GPU-field parity in anger),
//   3. benchGpu before/after numbers (the quat branch should be ~free).
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5233);
const OUT = process.argv[3] ?? '/tmp/orient';
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

// The bench is invalid on a hidden page (no swapchain → ~0 ms readings), so
// the tab must be the ACTIVE one for the whole run.
await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-lab-webgpu.html` });

// Wait for the lab to boot.
let booted = false;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  booted = await evaluate(`!!window.__sdfLab`);
  if (booted) break;
}
if (!booted) throw new Error('lab never booted');
await sleep(1500);
console.log('backend:', await evaluate(`window.__sdfLab.backend`));
console.log('visible:', await evaluate(`!document.hidden`));

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  const q = await evaluate(`Array.from(window.__sdfLab.uniforms.headQuat.value)`);
  console.log(`shot ${name}: headQuat=[${q.map(v => (+v).toFixed(3))}]`);
};

// --- 1. rest head, motion off ---------------------------------------------
await evaluate(`window.__sdfLab.setMotionEnabled(false); window.__sdfLab.setWander(false); window.__sdfLab.respawn();`);
await evaluate(`window.__sdfLab.focusHead()`);
await sleep(800);
await shot('orient-rest');

if (process.env.BENCH_STATUE) {
  // Statue bench: motion OFF, so the field is all-identity quats — this
  // isolates the pure shader overhead of the orient machinery from the
  // feature's actual cost (a turned head cluster paying the quat fetch).
  await evaluate(`window.__sdfLab.focusBody()`);
  await sleep(500);
  await evaluate(`window.__sdfLab.runBench('${process.env.BENCH_LABEL ?? 'statue'}')`);
  let b = null;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    b = await evaluate(`window.__benchResult ?? null`);
    if (b) break;
  }
  console.log('bench:', JSON.stringify(b));
  ws.close();
  process.exit(0);
}

// --- 2. turned head: motion+wander, wait for a real heading change ---------
await evaluate(`window.__sdfLab.setMotionEnabled(true); window.__sdfLab.setWander(true);`);
const q0 = await evaluate(`Array.from(window.__sdfLab.uniforms.headQuat.value)`);
let turned = false;
for (let i = 0; i < 120; i++) {
  await sleep(500);
  const q = await evaluate(`Array.from(window.__sdfLab.uniforms.headQuat.value)`);
  if (Math.abs(1 - q[3]) > 0.02) { turned = true; break; } // >~23° off rest
}
console.log('head turned:', turned);
await sleep(300);
await evaluate(`window.__sdfLab.focusHead()`);
await sleep(400);
await shot('orient-turned');
await sleep(900);
await shot('orient-turned-2');

// --- 3. phantom click on the TURNED head: CPU raycast must hit the drawn ---
//     surface (parity in anger). Project the posed skull centre to screen
//     and click it; a wound must appear.
const clickPt = await evaluate(`(() => {
  const lab = window.__sdfLab;
  const hc = lab.uniforms.headCentre.value;
  const V3 = lab.body.position.constructor;
  const v = new V3(hc.x, hc.y, hc.z).project(lab.camera);
  const canvas = lab.renderer.domElement;
  const r = canvas.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height,
           wounds: lab.wounds.length, quatW: lab.uniforms.headQuat.value.w };
})()`);
console.log('click target:', JSON.stringify(clickPt));
if (Math.abs(1 - clickPt.quatW) > 0.005) {
  const before = clickPt.wounds;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: clickPt.x, y: clickPt.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickPt.x, y: clickPt.y, button: 'left', clickCount: 1 });
  await sleep(700);
  const after = await evaluate(`window.__sdfLab.wounds.length`);
  console.log(`PARITY CLICK: wounds ${before} -> ${after}`, after > before ? 'HIT (parity holds)' : 'MISS (PARITY BUG)');
  await shot('orient-clicked-head');
} else {
  console.log('PARITY CLICK: skipped — head not turned at click time');
}

// --- 4. bench ---------------------------------------------------------------
await evaluate(`window.__sdfLab.setWander(false); window.__sdfLab.respawn(); window.__sdfLab.focusBody();`);
await sleep(500);
await evaluate(`window.__sdfLab.runBench('${process.env.BENCH_LABEL ?? 'orient'}')`);
let bench = null;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  bench = await evaluate(`window.__benchResult ?? null`);
  if (bench) break;
}
console.log('bench:', JSON.stringify(bench));

console.log('done ->', OUT);
ws.close();
