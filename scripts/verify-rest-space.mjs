// CDP driver for the rest-space noise anchor browser verification
// (motion-polish task 6 — noise baked into the model, no swimming on limbs).
// Same no-deps pattern as verify-orient.mjs: Node 22 native WebSocket against
// Chrome --remote-debugging-port=9223.
//
// Usage: node scripts/verify-rest-space.mjs <vitePort> <outDir> [bench1|bench10|verify]
//
// What it proves on a LIVE page:
//   1. gait-cycle screenshots while walking (texture must be GLUED to the
//      arms/torso/head — successive shots at different gait phases),
//   2. a severed arm chunk keeps a sane texture while tumbling,
//   3. benchGpu numbers at 1 body and 10 bodies (the perf gate).
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5261);
const OUT = process.argv[3] ?? '/tmp/rest-space';
const MODE = process.argv[4] ?? 'verify';
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
  console.log(`shot ${name}`);
};

const bench = async (label) => {
  await evaluate(`window.__benchResult = null; window.__sdfLab.runBench('${label}')`);
  let b = null;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    b = await evaluate(`window.__benchResult ?? null`);
    if (b) break;
  }
  console.log(`bench ${label}:`, JSON.stringify(b));
  return b;
};

if (MODE === 'bench1') {
  await evaluate(`window.__sdfLab.setMotionEnabled(true); window.__sdfLab.setWander(false); window.__sdfLab.respawn(); window.__sdfLab.focusBody();`);
  await sleep(800);
  await bench(process.env.BENCH_LABEL ?? 'rest-1body');
  ws.close();
  process.exit(0);
}

if (MODE === 'bench10') {
  await evaluate(`(() => {
    const lab = window.__sdfLab;
    lab.setCrowdCount(9);
    lab.setConeEnabled(true);
    lab.setOccluder(true);
    lab.setWander(true);
    lab.focusBody();
  })()`);
  await sleep(1200);
  await bench(process.env.BENCH_LABEL ?? 'rest-10body');
  ws.close();
  process.exit(0);
}

// --- full verify -----------------------------------------------------------
// 1. gait cycle while walking: four shots ~0.4 s apart catch the arms at
//    different swing phases; the flesh texture must be glued, not sliding.
await evaluate(`window.__sdfLab.setMotionEnabled(true); window.__sdfLab.setWander(true); window.__sdfLab.respawn();`);
await evaluate(`window.__sdfLab.focusBody()`);
await sleep(1500);
for (let i = 0; i < 4; i++) {
  await shot(`gait-${i}`);
  await sleep(400);
}

// 2. sever an arm (key 4 = armR) and shoot the tumbling chunk.
await evaluate(`window.__sdfLab.setWander(false);`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '4', text: '4' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '4', text: '4' });
await sleep(500);
await shot('sever-arm-chunk-0');
await sleep(700);
await shot('sever-arm-chunk-1');

// 3. benches, same configs as the gate.
await evaluate(`window.__sdfLab.setWander(false); window.__sdfLab.respawn(); window.__sdfLab.focusBody();`);
await sleep(500);
await bench('rest-1body-after');
await evaluate(`(() => {
  const lab = window.__sdfLab;
  lab.setCrowdCount(9);
  lab.setConeEnabled(true);
  lab.setOccluder(true);
  lab.setWander(true);
  lab.focusBody();
})()`);
await sleep(1200);
await bench('rest-10body-after');

console.log('done ->', OUT);
ws.close();
