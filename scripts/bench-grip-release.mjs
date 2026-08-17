// CDP benchmark for X1.27 task F (F4 step 5): alternate X1.26 static baked
// and the clip on a VISIBLE page with identical settings, 240 benchGpu
// samples each (benchGpu drives hand-stepped frames with GPU resolves — the
// project's required timing evidence, never wall-clock rAF). Sequence per
// the plan: static 1, clip 1, clip 2, static 2. Samples with hiddenSteps > 0
// are rejected outright.
//
// Usage: node scripts/bench-grip-release.mjs <vitePort> <cdpPort>
const VITE = Number(process.argv[2] ?? 5291);
const CDP = Number(process.argv[3] ?? 9224);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const res = await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' });
const tab = await res.json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
process.on('exit', () => { try { ws.close(); } catch { /* gone */ } });

let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push(`${m.params.type}: ${m.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push(`exception: ${JSON.stringify(m.params.exceptionDetails).slice(0, 300)}`);
  }
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
await send('Emulation.setDeviceMetricsOverride', {
  width: 1380, height: 820, deviceScaleFactor: 1, mobile: false,
});
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-lab-webgpu.html` });

for (let i = 0; i < 160; i++) {
  await sleep(500);
  if (await evaluate('typeof window.__sdfLab === "object" && !!window.__sdfLab.fpv')) break;
}
for (let i = 0; i < 120; i++) {
  const st = await evaluate('window.__sdfLab.fpv');
  if (st.staticLoad === 'ready' && st.clipLoad === 'ready') break;
  await sleep(500);
}

// Identical settings for every leg (task C's band): FPV, 1 body, hands on,
// SDF scale 0.7, no crowd, no throws mid-run (playback 'play' parks held).
await evaluate(`(() => {
  window.__sdfLab.enterFpv();
  window.__sdfLab.setFpvAim({ yaw: 0, pitch: -0.03, pos: [0, 0, 4] });
  window.__sdfLab.setHandWarp(false);
  window.__sdfLab.setSdfScale(0.7);
  window.__sdfLab.setGripPlayback('play');
  return true;
})()`);

const LEGS = [
  ['static 1', 'baked'],
  ['clip 1', 'clip'],
  ['clip 2', 'clip'],
  ['static 2', 'baked'],
];
const results = [];
for (const [label, field] of LEGS) {
  await evaluate(`window.__sdfLab.setHandField('${field}'), true`);
  await sleep(1500); // field rebind + a presented close settles
  const st = await evaluate('window.__sdfLab.fpv');
  if (st.handField !== field) throw new Error(`${label}: field did not switch (${st.handField})`);
  const r = await evaluate('window.__sdfLab.benchGpu()', true);
  results.push({ label, field, ...r });
  console.log(`${label}: median ${r.median} ms · p05 ${r.p05} · p95 ${r.p95} · hiddenSteps ${r.hiddenSteps} · n=${r.n} · bodies ${r.bodies} · sdfScale ${r.sdfScale}`);
  await sleep(400);
}

const bad = results.filter(r => r.hiddenSteps > 0);
const statics = results.filter(r => r.field === 'baked').map(r => r.median);
const clips = results.filter(r => r.field === 'clip').map(r => r.median);
const delta = (clips.reduce((a, b) => a + b, 0) / clips.length)
  - (statics.reduce((a, b) => a + b, 0) / statics.length);
console.log(`clip − static median delta: ${delta.toFixed(2)} ms (investigate gate: +0.75 ms)`);
console.log(`hidden-frame samples: ${bad.length} (must be 0)`);

const badConsole = consoleEvents.filter(e =>
  /GPUValidationError|GPUInternalError|compil|shader|error/i.test(e));
console.log('console events (filtered):', badConsole.length);

const pass = bad.length === 0 && badConsole.length === 0 && delta < 0.75;
console.log(pass ? 'BENCH PASS' : 'BENCH REVIEW NEEDED');
process.exit(0); // exit 0 either way — the numbers are the evidence
