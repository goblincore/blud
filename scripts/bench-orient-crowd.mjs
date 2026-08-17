// 10-body cone+occluder bench for the per-prim orientation change — the
// realistic operating point (same config as the shell-displace gate).
// Usage: BENCH_LABEL=x node scripts/bench-orient-crowd.mjs <vitePort>
const VITE = Number(process.argv[2] ?? 5233);
const CDP = 9223;
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
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-lab-webgpu.html` });
for (let i = 0; i < 40; i++) {
  await sleep(500);
  if (await evaluate(`!!window.__sdfLab`)) break;
}
await sleep(1500);

await evaluate(`(() => {
  const lab = window.__sdfLab;
  lab.setCrowdCount(9);
  lab.setConeEnabled(true);
  lab.setOccluder(true);
  lab.setWander(true);
  lab.focusBody();
})()`);
await sleep(1200);
await evaluate(`window.__sdfLab.runBench('${process.env.BENCH_LABEL ?? 'crowd'}')`);
let bench = null;
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  bench = await evaluate(`window.__benchResult ?? null`);
  if (bench) break;
}
console.log('bench:', JSON.stringify(bench));
ws.close();
