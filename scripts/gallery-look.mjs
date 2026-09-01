// scripts/gallery-look.mjs — quick look driver: one pose, one shot.
// Usage: node scripts/gallery-look.mjs [vitePort] [cdpPort] [outName]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5297);
const CDP = Number(process.argv[3] ?? 9297);
const OUT = process.env.LOOK_OUT ?? '/tmp/gallery-look';
const NAME = process.argv[4] ?? 'look';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
};
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

mkdirSync(OUT, { recursive: true });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });
for (let i = 0; i < 240; i++) {
  await sleep(500);
  if (await evaluate('typeof window.__sdfGame === "object"')) break;
}
if (!(await evaluate('typeof window.__sdfGame === "object"'))) { console.error('never booted', errors.slice(-5)); process.exit(1); }
console.log('resolution:', JSON.stringify(await evaluate('window.__sdfGame.resolution')));
console.log('sdf target:', JSON.stringify(await evaluate('window.__sdfGame.sdfTarget')));

// The pose comes from LOOK_POSE ("x,z,yaw,pitch" in radians) and defaults to
// the room3 zombies the gallery work framed on. Overridable because different
// looks want different shots: a corridor for falloff, a wall close-up for
// specular, a figure in the beam for shadows. The default is unchanged, so
// every existing caller keeps the frame it was reading.
const POSE = (process.env.LOOK_POSE ?? '4.8,4.8,3.141592653589793,0')
  .split(',').map(Number);
if (POSE.length !== 4 || POSE.some(Number.isNaN)) {
  console.error(`bad LOOK_POSE ${process.env.LOOK_POSE} — want "x,z,yaw,pitch"`);
  process.exit(2);
}
const SETTLE = Number(process.env.LOOK_STEPS ?? 20);
// The goo tuning panel ships VISIBLE on this page (it is a debug page and the
// panel is the point). A screenshot wants the ROOM, not the UI over it, so the
// capture dismisses it — guarded, because older builds have no such seam.
await evaluate('typeof window.__sdfGame.gooPanel === "function" && window.__sdfGame.gooPanel(false)');
await evaluate('window.__sdfGame.freeze(true)');
await evaluate('window.__sdfGame.setLoopRunning(false)');
await evaluate(`window.__sdfGame.setPose(${POSE[0]}, ${POSE[1]}, ${POSE[2]}, ${POSE[3]})`);
await evaluate(`window.__sdfGame.step(${SETTLE}, 1/60)`);

// FORCE A SHADOW-MAP UPDATE BEFORE CAPTURING, or this path lies.
//
// With the loop stopped and frames hand-stepped, three r185's WebGPU
// ShadowNode does not re-render the shadow map, so the capture composites
// WITHOUT shadows while the live game shows them plainly. Measured: a frozen
// capture sat inside the run-to-run noise floor of a deliberately
// shadow-disabled frame (5160 changed px against a 4550 floor) and 2x outside
// it from the shadow-enabled one — i.e. the shot was silently shadow-less.
// Touching the shadow's live uniform marks it dirty; one more step then
// renders it. Guarded so pages without the seam still capture.
await evaluate(`(() => {
  const s = window.__dungeon && window.__dungeon.spot;
  if (!s || !s.shadow) return false;
  s.shadow.intensity = 1;   // a real write; this is what arms the shadow node
  return true;
})()`);
await evaluate('window.__sdfGame.step(3, 1/60)');

// SETTLE BEFORE GRABBING. Page.captureScreenshot can return before the
// just-submitted GPU work reaches the compositor, so a shot taken immediately
// after step() shows the PREVIOUS frame — which is how a shadow-less frame
// survived three separate "fixes" here. Diagnosed 2026-09-01 by diffing the
// grabbed frame against a known shadow-on/shadow-off pair.
await sleep(Number(process.env.LOOK_SETTLE_MS ?? 450));
const s = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${OUT}/${NAME}.png`, Buffer.from(s.result.data, 'base64'));
console.log(`shot ${OUT}/${NAME}.png`);
if (errors.length) console.log('console errors:', errors.length, errors.slice(-3));
ws.close();
process.exit(0);
