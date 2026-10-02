const [, , VITE, CDP] = process.argv;
const tab = await (await fetch(`http://localhost:${CDP}/json/new?http://localhost:${VITE}/docs/dev-notes/2026-10-01-earlyz-probe/earlyz-probe.html`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
for (let i = 0; i < 240; i++) {
  const r = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__earlyz ?? null)', returnByValue: true });
  const v = r.result?.result?.value;
  if (v && v !== 'null') { console.log(JSON.stringify(JSON.parse(v), null, 1)); break; }
  await new Promise((ok) => setTimeout(ok, 500));
}
await fetch(`http://localhost:${CDP}/json/close/${tab.id}`);
process.exit(0);
