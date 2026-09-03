// scripts/hull-spike-drive.mjs — scripted CDP session on the hull spike page.
// usage: LAB_VITE_PORT=5340 LAB_CDP_PORT=9340 node scripts/hull-spike-drive.mjs <outDir> <step>...
//   step = js:<expression>  |  shot:<name>  |  sleep:<ms>
// Evaluates js with awaitPromise; prints each js result to stdout as a line.
// CDP boilerplate mirrors perf-r2-parity.mjs (the 400 ms capture settle is the
// headless race guard recorded there).
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const VITE = Number(process.env.LAB_VITE_PORT ?? 5340);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9340);
const [outDir, ...steps] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300)); };
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120_000 });
  if (r.result?.exceptionDetails) { console.log(`THREW: ${JSON.stringify(r.result.exceptionDetails).slice(0, 300)}`); return null; } return r.result?.result?.value; };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-hull-spike.html` });
for (let i = 0; i < 240; i++) { const ok = await evaluate(`(async () => { if (!window.__hullSpike?.resolveGpu) return false; try { await __hullSpike.resolveGpu(); return true; } catch { return false; } })()`); if (ok) break; await sleep(250); }
await sleep(1500);
for (const s of steps) {
  const [kind, ...rest] = s.split(':'); const arg = rest.join(':');
  if (kind === 'js') console.log(JSON.stringify(await evaluate(`(async () => { ${arg} })()`)));
  else if (kind === 'shot') { await sleep(400); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${outDir}/${arg}.png`, Buffer.from(r.result.data, 'base64')); console.log(`shot ${arg}`); }
  else if (kind === 'sleep') await sleep(Number(arg));
}
if (errors.length) console.log('page errors: ' + errors.join(' | '));
process.exit(0);
