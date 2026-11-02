// scripts/sdf-game-doom-emitlight.mjs — the emitter LIGHT tuning shots (hand-off item 2g, part B1).
// Boots ?level=doom-e1m1&god=1&frozen once (enemies stand at their spawns, so the alcove shots show bodies),
// stands at each pose and, for each gain variant, sets the live seams and writes
// .lab-tmp/doom/emitlight/<variant>/<pose>.png. Variants scale BOTH the baked emitter bounce
// (__sdfGame.sectorLight({ emitBounceGain })) and the converter's emitter lights ({ emitLightGain }):
// off (B1 off: 0 / 0), half (½), default, double (2×). A pose suffixed "-off" has the flashlight off.
// Prints the boot's [sector-bounce] bake line and the draw calls at the computer pose.
// Compose with: python3 scripts/sdf-game-doom-emitlight-sheet.py
// Usage: LAB_TMP=.lab-tmp bash scripts/sdf-game-doom-emitlight.sh   (POSES=computer,... VARIANTS=off,default)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { at32, doomScale } from './lib/doom-scale.mjs';

const VITE = Number(process.argv[2] ?? 5547);
const CDP = Number(process.argv[3] ?? 9547);
const OUT = '.lab-tmp/doom/emitlight';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

/** [name, x, z, yaw, pitch, flashlight]: yaw 0 faces -z, π/2 faces +x; x, z are metres at 32 units/m
 *  (scripts/lib/doom-scale.mjs), scaled to the level's world scale below. */
export const POSES = [
  ['computer', 21, -28, 0.45, 0.2, true],          // the computer room (zone 2) from its north-west: screen banks, viewscreen boxes
  ['computer-off', 21, -28, 0.45, 0.2, false],
  ['screens', 32, -40.5, 0, 0.05, true],          // the south screen-bank wall and a soldier in front of it (s105)
  ['screens-off', 32, -40.5, 0, 0.05, false],
  ['alcove', 33, -38.25, Math.PI / 2, 0.02, true],  // the east alcove (sector 60, fluorescent ceiling) and its two flayers
  ['alcove-off', 33, -38.25, Math.PI / 2, 0.02, false],
  ['ledge', 20, -40, Math.PI * 0.85, -0.1, true],  // sector 21's ledge: its fluorescent strips and screen banks
  ['ledge-off', 20, -40, Math.PI * 0.85, -0.1, false],
  ['corridor', 10.5, -35, Math.PI / 2, 0.2, true],   // the zone 7 corridor's fluorescent ceiling (sector 25)
  ['corridor-off', 10.5, -35, Math.PI / 2, 0.2, false],
  ['exitsign', 61, 27, Math.PI, 0.25, true],         // the exit passage: the sign box and its red
  ['exitsign-off', 61, 27, Math.PI, 0.25, false],
];

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); let consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') consoleEvents.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  if (m.method === 'Runtime.exceptionThrown') consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 720, deviceScaleFactor: 1, mobile: false });

const t0 = Date.now();
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?level=doom-e1m1&god=1&frozen${process.env.QUERY_EXTRA ?? ''}` });
let ready = false;
for (let i = 0; i < 480 && !ready; i++) {
  await sleep(500);
  ready = (await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null)) === 'ready';
  if (consoleEvents.some((e) => e.type === 'error' || e.type === 'exception')) break;
}
if (!ready) { console.error(consoleEvents.slice(-8)); fail('did not boot to ready'); }
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const e of consoleEvents) if (e.text.includes('[sector-bounce]')) console.log(e.text);
await evaluate('__sdfGame.setPose(0, 0, 0, 0, 0)');
await evaluate('__sdfGame.walkTo(0, -4)'); await sleep(2500); await evaluate('__sdfGame.walkCancel()');
const base = await evaluate('__sdfGame.sectorLight()');
console.log(`defaults: emitBounceGain ${base.emitBounceGain}, emitLightGain ${base.emitLightGain}`);
const D = base.emitBounceGain;
const VARIANTS = { off: [0, 0], half: [D / 2, 0.5], default: [D, 1], double: [2 * D, 2] };
const vlist = (process.env.VARIANTS ?? 'off,half,default,double').split(',');
const only = process.env.POSES ? new Set(process.env.POSES.split(',')) : null;
for (const v of vlist) mkdirSync(`${OUT}/${v}`, { recursive: true });
const K = doomScale();
for (const [name, x32, z32, yaw, pitch, torch] of POSES) {
  if (only && !only.has(name)) continue;
  const [x, z] = at32(K, x32, z32);
  await evaluate(`__sdfGame.setFlashlight(${torch})`);
  const f = (await evaluate(`__sdfGame.ground(${x}, ${z})`)).floor;
  await evaluate(`__sdfGame.setPose(${x}, ${z}, ${yaw}, ${pitch}, ${f})`);
  await sleep(1200);
  if (name === 'computer') {
    const calls = [];
    for (let k = 0; k < 5; k++) {
      await evaluate('__sdfGame.drawStats(true)');
      await evaluate('__sdfGame.timeDraws(1)');
      calls.push((await evaluate('__sdfGame.drawStats(true)')).drawCalls);
    }
    console.log(`draw calls at the computer pose ${calls.join(', ')}`);
  }
  for (const v of vlist) {
    const [eb, el] = VARIANTS[v];
    await evaluate(`__sdfGame.sectorLight({ emitBounceGain: ${eb}, emitLightGain: ${el} })`);
    await evaluate(`__sdfGame.setPose(${x}, ${z}, ${yaw}, ${pitch}, ${f})`);
    await sleep(700);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/${v}/${name}.png`, Buffer.from(s.result.data, 'base64'));
  }
  await evaluate(`__sdfGame.sectorLight({ emitBounceGain: ${D}, emitLightGain: 1 })`);
}
const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errs.length) fail(`console errors ${JSON.stringify(errs.slice(0, 4))}`);
console.log(`shots in ${OUT}/<variant>/`);
process.exit(0);
