// Wound soft shadow bench gate (dispatch 2026-08-24-wound-soft-shadow).
//
// Interleaved shadow OFF/ON legs on a VISIBLE page with identical settings,
// benchGpu samples each (the project's required timing evidence — never
// wall-clock rAF). Two scenes per the task brief:
//
//   far    — full-body view at the default framing, no wounds
//   close  — stampWounds(5) torso close-up, camera dist 1.0 at chest height
//
// Gate: far within noise; close delta under ~1 ms.
//
// Usage: node scripts/bench-wound-shadow.mjs <vitePort> <cdpPort>
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
  if (await evaluate('typeof window.__sdfLab === "object" && !!window.__sdfLab.benchGpu')) break;
}

// Scene setup lives in-page so both scenes share one boot.
const SCENES = {
  far: `(() => {
    window.__sdfLab.setWoundShadow(true);
    window.__sdfLab.setCam(0.6, 0.12, 2.4, undefined);
    return true;
  })()`,
  close: `(() => {
    window.__sdfLab.setCam(0.6, 0.12, 1.0, 1.05);
    window.__sdfLab.stampWounds(5);
    return true;
  })()`,
};

const results = [];
for (const [scene, setup] of Object.entries(SCENES)) {
  await evaluate(setup);
  await sleep(1500); // pose settle + shader warm at this framing
  // Interleaved off/on/off/on cancels thermal drift (X1.10 method).
  for (const shadow of [false, true, false, true]) {
    await evaluate(`window.__sdfLab.setWoundShadow(${shadow}), true`);
    await sleep(400);
    const r = await evaluate('window.__sdfLab.benchGpu()', true);
    results.push({ scene, shadow, ...r });
    console.log(
      `${scene} shadow=${shadow ? 'ON ' : 'OFF'}: median ${r.median} ms · p05 ${r.p05} · p95 ${r.p95}` +
      ` · hiddenSteps ${r.hiddenSteps} · n=${r.n} · sdfScale ${r.sdfScale}`,
    );
    await sleep(300);
  }
}

const med = (rows) => rows.reduce((a, b) => a + b.median, 0) / rows.length;
for (const scene of Object.keys(SCENES)) {
  const off = results.filter(r => r.scene === scene && !r.shadow);
  const on = results.filter(r => r.scene === scene && r.shadow);
  const bad = [...off, ...on].filter(r => r.hiddenSteps > 0);
  console.log(
    `${scene}: OFF ${med(off).toFixed(2)} ms vs ON ${med(on).toFixed(2)} ms` +
    ` -> delta ${(med(on) - med(off)).toFixed(2)} ms · hidden-frame samples ${bad.length} (must be 0)`,
  );
}

const badConsole = consoleEvents.filter(e =>
  /GPUValidationError|GPUInternalError|compil|shader|error/i.test(e));
console.log('console events (filtered):', badConsole.length);
if (badConsole.length > 0) console.log(badConsole.slice(0, 10));
process.exit(0); // the WebSocket pins the event loop; the numbers are the evidence
