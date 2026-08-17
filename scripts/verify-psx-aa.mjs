// PSX AA (X1.25) A/B verification — base build (pre-change) vs current build.
//   Parity gate : base default  ==  current with post all-off (pixel diff,
//                 tolerance = the per-build flicker noise floor).
//   Active shots: fxaa on, smear converged, default, sharp upscale, and two
//                 moving-smear illustrations. Benches recorded to results.json.
// Two tabs share the one visible window; each is brought to front and rAF-
// probed before its screenshot (background tabs throttle rAF and capture
// STALE frames).
// Usage: node scripts/verify-psx-aa.mjs <curPort> <basePort> <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';

const CUR = Number(process.argv[2] ?? 5400);
const BASE = Number(process.argv[3] ?? 5401);
const OUT = process.argv[4] ?? '/tmp/psx-aa';
const CDP = 9223;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openTab(url) {
  const res = await fetch(`http://localhost:${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
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
  const front = async () => {
    // Re-attach brings THIS tab to the foreground of the shared window.
    await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
  };
  const rafAlive = async () => {
    const dt = await evaluate(`(async () => {
      const ts = [];
      for (let i = 0; i < 3; i++) ts.push(await new Promise(r => requestAnimationFrame(r)));
      return ts[2] - ts[0];
    })()`, true);
    return dt < 100;
  };
  const ensureLive = async () => {
    for (let i = 0; i < 10; i++) {
      await front();
      await sleep(300);
      if (await rafAlive()) return;
    }
    throw new Error('page not compositing (rAF throttled) — screenshots would be stale');
  };
  const frames = async (n) => {
    await ensureLive(); // a background tab's rAF is throttled — this hangs otherwise
    return evaluate(`(async () => {
      for (let i = 0; i < ${n}; i++) await new Promise(r => requestAnimationFrame(r));
      return true;
    })()`, true);
  };
  const shot = async (name) => {
    await ensureLive();
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
    console.log(`shot ${name}`);
  };
  return { send, evaluate, ensureLive, frames, shot, ws, id: tab.id };
}

const HIDE_OVERLAYS = `(() => {
  for (const id of ['panel', 'controls']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  return true;
})()`;

const base = await openTab(`http://localhost:${BASE}/sdf-lab-webgpu.html`);
const cur = await openTab(`http://localhost:${CUR}/sdf-lab-webgpu.html`);

// Wait for both labs to boot.
for (const [name, t] of [['base', base], ['cur', cur]]) {
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await t.evaluate(`!!(window.__sdfLab && window.__sdfLab.renderer)`)) break;
    if (i === 39) throw new Error(`${name}: __sdfLab never appeared`);
  }
  console.log(`${name} lab up`);
}

// Statue both scenes (motion master off) and hide the DOM overlays so the
// screenshots are canvas-only.
await base.evaluate(HIDE_OVERLAYS);
await cur.evaluate(HIDE_OVERLAYS);
await base.evaluate(`window.__sdfLab.setMotionEnabled(false); true`);
await cur.evaluate(`window.__sdfLab.setMotionEnabled(false); true`);
// Current build: post all off for the parity gate.
await cur.evaluate(`window.__sdfLab.post.setFxaa(false); window.__sdfLab.post.setSmear(0); window.__sdfLab.post.setSharpUpscale(false); true`);
await base.frames(30);
await cur.frames(30);

// Noise floors (eye-glow flicker is time-driven even in statue mode).
await base.shot('floor-base-1');
await base.shot('floor-base-2');
await cur.shot('floor-cur-1');
await cur.shot('floor-cur-2');

// THE PARITY GATE: base default vs current all-off.
await cur.shot('01-all-off');

// FXAA alone.
await cur.evaluate(`window.__sdfLab.post.setFxaa(true); true`);
await cur.frames(10);
await cur.shot('02-fxaa-on');
await cur.evaluate(`window.__sdfLab.post.setFxaa(false); true`);

// Smear alone, converged on the static scene.
await cur.evaluate(`window.__sdfLab.post.setSmear(0.25); true`);
await cur.frames(90);
await cur.shot('03-smear-converged');

// Owner default: FXAA + smear 0.25, converged.
await cur.evaluate(`window.__sdfLab.post.setFxaa(true); true`);
await cur.frames(60);
await cur.shot('04-default-fxaa-smear25');
await cur.evaluate(`window.__sdfLab.post.setFxaa(false); window.__sdfLab.post.setSmear(0); true`);

// Sharp upscale (canvas backing grows to the window; check the attrs).
await cur.evaluate(`window.__sdfLab.post.setSharpUpscale(true); true`);
await cur.frames(10);
await cur.shot('07-sharp-upscale');
const sharpCanvas = await cur.evaluate(`(() => {
  const c = document.querySelector('canvas');
  return { w: c.width, h: c.height, cssW: c.style.width, ir: c.style.imageRendering };
})()`);
await cur.evaluate(`window.__sdfLab.post.setSharpUpscale(false); true`);
await cur.frames(10);
const normalCanvas = await cur.evaluate(`(() => {
  const c = document.querySelector('canvas');
  return { w: c.width, h: c.height, ir: c.style.imageRendering };
})()`);

// Moving smear illustrations: body walking, two strengths.
await cur.evaluate(`window.__sdfLab.setMotionEnabled(true); window.__sdfLab.setWander(true); true`);
await cur.evaluate(`window.__sdfLab.post.setSmear(0.15); true`);
await sleep(4000);
await cur.shot('05-smear-0.15-moving');
await cur.evaluate(`window.__sdfLab.post.setSmear(0.35); true`);
await sleep(1500);
await cur.shot('06-smear-0.35-moving');
await cur.evaluate(`window.__sdfLab.post.setSmear(0); window.__sdfLab.setMotionEnabled(false); true`);
await cur.frames(30);

// Benches (current build): all-off, default, all-on.
await cur.ensureLive();
const benchAllOff = await cur.evaluate(`window.__sdfLab.benchGpu()`, true);
await cur.evaluate(`window.__sdfLab.post.setFxaa(true); window.__sdfLab.post.setSmear(0.25); true`);
const benchDefault = await cur.evaluate(`window.__sdfLab.benchGpu()`, true);
await cur.evaluate(`window.__sdfLab.post.setSharpUpscale(true); true`);
const benchAllOn = await cur.evaluate(`window.__sdfLab.benchGpu()`, true);
await cur.evaluate(`window.__sdfLab.post.setFxaa(false); window.__sdfLab.post.setSmear(0); window.__sdfLab.post.setSharpUpscale(false); true`);

// Late noise-floor shots — the parity shots above are minutes apart, so the
// floor must be measured on the same timescale (eye-glow flicker phase).
await base.shot('floor-base-3');
await cur.shot('floor-cur-3');

writeFileSync(`${OUT}/results.json`, JSON.stringify({
  backend: 'webgpu', sharpCanvas, normalCanvas, benchAllOff, benchDefault, benchAllOn,
}, null, 2));
console.log('done');
base.ws.close();
cur.ws.close();
