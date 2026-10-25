// Boot sdf-game.html in the lab Chrome and report how the background pipeline compiles end (gib, crowd), how long
// they took, and every console error/warning (WGSL compile messages included).
//   (inside lab-servers) node docs/dev-notes/2026-10-24-gpu-bake-parity/warm-probe.mjs <vitePort> <cdpPort> [maxSeconds] [holdSeconds]
// holdSeconds keeps the page open after that, so compiles the 180 s warm budget gave up on can still finish and land
// in Chrome's pipeline cache (closing the tab abandons them, and every later boot is cold again).
const [vite, cdp, maxS = '900', holdS = '0'] = process.argv.slice(2);
const tab = await (await fetch(`http://localhost:${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, e) => { ws.onopen = r; ws.onerror = e; });
let seq = 0; const pending = new Map(); const logs = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning'))
    logs.push(`${m.params.type}: ${m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 1500)}`);
  if (m.method === 'Runtime.exceptionThrown') logs.push(`exception: ${m.params.exceptionDetails.exception?.description?.slice(0, 1500)}`);
};
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable'); await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${vite}/sdf-game.html` });
const t0 = Date.now(); let s = null;
while ((Date.now() - t0) / 1000 < Number(maxS)) {
  await new Promise(r => setTimeout(r, 2000));
  s = await ev('window.__sdfGame?.warmBackground?.() ?? null');
  if (s && s.gib !== 'pending' && s.gib !== 'compiling' && s.crowd !== 'pending' && s.crowd !== 'compiling') break;
}
console.log(JSON.stringify({ warm: s, seconds: (Date.now() - t0) / 1000 }));
await new Promise(r => setTimeout(r, Number(holdS) * 1000));
for (const l of logs.filter(l => !/decode audio/.test(l))) console.log(l);
await fetch(`http://localhost:${cdp}/json/close/${tab.id}`);
process.exit(0);
