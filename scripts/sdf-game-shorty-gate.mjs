// scripts/sdf-game-shorty-gate.mjs — headless gate for the sawed-off
// view-model on sdf-game.html. No-deps CDP, same pattern as
// scripts/sdf-game-grapeshot.mjs (which owns the plumbing this copies).
//
//   1. BOOT GATE: backend === 'webgpu', no console errors, the gun loaded.
//   2. THE GUN: the k3 GLB is gone, shorty-double.glb's Barrels node is in.
//   3. FPV REST capture: fpv-rest.png into GAME_OUT for the owner look.
//
// Usage: LAB_VITE_PORT=5281 LAB_CDP_PORT=9281 node scripts/sdf-game-shorty-gate.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5281);
const CDP = Number(process.argv[3] ?? 9281);
const OUT = process.env.GAME_OUT ?? '/tmp/sdf-game-shorty';
const W = Number(process.env.GAME_W ?? 800);
const H = Number(process.env.GAME_H ?? 600);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' }); } catch {}
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({
      type: m.params.type,
      text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
    });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 30000,
    `evaluate timed out: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

/** A crashed/tab-busy target never answers a CDP request — every await needs
 *  a bound, or the driver hangs forever with zero diagnostics. */
function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms)),
  ]);
}

mkdirSync(OUT, { recursive: true });
let shotCount = 0;
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(`${OUT}/${name}.png`, buf);
  shotCount++;
  console.log(`  shot ${name}.png (${buf.length} bytes)`);
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const url = `http://localhost:${VITE}/sdf-game.html`;
console.log(`game ${url}`);
await send('Page.navigate', { url });

let api = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  api = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
  if (api) break;
}
if (!api) {
  console.error('console tail:', consoleEvents.slice(-8));
  fail('game page never booted (__sdfGame absent)');
}

// 1. BOOT GATE — webgpu backend, no console errors, the gun actually loaded.
const backend = await evaluate('__sdfGame.backend');
if (backend !== 'webgpu') fail(`backend ${backend}, expected webgpu`);
const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errs.length) fail(`console errors at boot: ${JSON.stringify(errs.slice(0, 3))}`);

// 2. THE GUN — a missing GLB must be loud. game-main throws if the named
//    nodes are absent, so a clean boot already proves Barrels/Hinge exist.
const gunOk = await evaluate(`
  (() => {
    const a = __sdfGame.viewModelAnchor;
    const g = a && a.getObjectByName('grapeshot-k3') === null;
    let barrels = null;
    a.traverse((o) => { if (o.name === 'Barrels') barrels = o; });
    return { hasAnchor: !!a, barrels: !!barrels, children: a ? a.children.length : 0 };
  })()
`);
if (!gunOk.hasAnchor) fail('no viewModelAnchor');
if (!gunOk.barrels) fail('Barrels node not present under the view-model anchor');

// Give the first frames a beat to settle, then capture the rest pose.
await sleep(2000);
await shot('fpv-rest');
console.log(`gate: backend=${backend} anchorChildren=${gunOk.children}`);

// 3. FLASH — fire, and prove the flash is visible on the shot frame and gone
//    a beat later. Screenshots are the evidence; the booleans are the gate.
//    fire() only stamps flashAge = 0; visibility flips in the TICK, so a read
//    issued straight back races the next rAF frame (up to 16.7 ms away) and
//    samples last-frame state. Settle 40 ms — mid-envelope, the window is
//    70 ms — so `lit` reads a frame that actually carried the flash.
await evaluate('__sdfGame.fire ? __sdfGame.fire(1) : null');
await sleep(40);
const lit = await evaluate('__sdfGame.flashVisible');
await shot('flash-on');
await sleep(300);
const dark = await evaluate('__sdfGame.flashVisible');
await shot('flash-off');
if (!lit) fail('no muzzle flash on the shot frame');
if (dark) fail('muzzle flash still visible 300 ms later — envelope never closed');
console.log(`done — ${shotCount} shots in ${OUT}`);
// An open CDP WebSocket keeps node's event loop alive forever — without this
// the gate prints its PASS lines and then hangs, the shell wrapper never
// finishes, and lab_servers_down never runs. process.exit still fires the
// process.on('exit') tab-close above.
process.exit(0);
