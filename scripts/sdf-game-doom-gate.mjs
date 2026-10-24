// scripts/sdf-game-doom-gate.mjs — headless gate for sector levels (spec 2026-10-24-doom-sector-levels-design.md).
//   1. FIXTURE boot: webgpu, ready, no errors, geometry 'sectors'.
//   2. FIXTURE walk: up the 0.5 m step, stopped by the 1.0 m ledge, down into the pit, stopped by the column.
//   3. E1M1 (skipped if public/assets/levels/doom-e1m1.level.json is absent): boot, the ROUTE, budget, shots.
// Usage: LAB_TMP=.lab-tmp bash scripts/sdf-game-doom-gate.sh   (DOOM_GATE_ONLY_FIXTURE=1 skips 3; SHOTS=1 writes shots)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
const OUT = '.lab-tmp/doom';

const VITE = Number(process.argv[2] ?? 5483);
const CDP = Number(process.argv[3] ?? 9483);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const pass = (msg) => console.log(`ok   ${msg}`);
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);

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
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 60000, expression.slice(0, 80));
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 720, deviceScaleFactor: 1, mobile: false });

async function boot(level) {
  consoleEvents = [];
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?level=${level}` });
  let ready = false;
  for (let i = 0; i < 360 && !ready; i++) {
    await sleep(500);
    ready = (await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null)) === 'ready';
    if (consoleEvents.some((e) => e.type === 'error' || e.type === 'exception')) break;
  }
  if (!ready) { console.error(consoleEvents.slice(-8)); fail(`${level} did not boot to ready`); }
  if ((await evaluate('__sdfGame.backend')) !== 'webgpu') fail('backend is not webgpu');
  const info = await evaluate('__sdfGame.level()');
  if (info.geometry !== 'sectors') fail(`${level}: geometry ${info.geometry}, expected sectors`);
  pass(`boot: ${level} ready on webgpu, ${info.rooms.length} zones`);
}

/** Walk from `from` toward `to` for `ms`; return the final pose. y is set to the floor there first. */
async function walk(from, to, ms) {
  const floor = (await evaluate(`__sdfGame.ground(${from[0]}, ${from[1]})`)).floor;
  await evaluate(`__sdfGame.setPose(${from[0]}, ${from[1]}, 0, 0, ${floor})`);
  await evaluate(`__sdfGame.walkTo(${to[0]}, ${to[1]})`);
  await sleep(ms);
  const pos = (await evaluate('__sdfGame.pose()')).pos;
  await evaluate('__sdfGame.walkCancel()');
  return pos;
}

/** A screenshot from a pose (x, z, yaw) standing on the floor there. */
async function shot(file, x, z, yaw) {
  mkdirSync(OUT, { recursive: true });
  const f = (await evaluate(`__sdfGame.ground(${x}, ${z})`)).floor;
  await evaluate(`__sdfGame.setPose(${x}, ${z}, ${yaw}, 0, ${f})`);
  await sleep(1200);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${file}`, Buffer.from(s.result.data, 'base64'));
}

// 1–2. THE FIXTURE (see the plan's diagram)
await boot('fixtures/sectors');
let p = await walk([2.5, -6], [2.5, -10], 3000);
if (!(Math.abs(p[1] - 0.5) < 0.02 && p[2] < -8.3)) fail(`step: ended at ${p.map((v) => v.toFixed(2))}, expected on B (y 0.5, z < -8.3)`);
pass('fixture: walked up the 0.5 m step');
p = await walk([2.5, -10], [2.5, -14], 3000);
if (!(p[2] > -12 && Math.abs(p[1] - 0.5) < 0.02)) fail(`ledge: ended at ${p.map((v) => v.toFixed(2))}, expected stopped on B`);
pass(`fixture: stopped ${(p[2] + 12).toFixed(2)} m short of the 1.0 m ledge`);
p = await walk([2.5, -6], [6.5, -6], 3000);
if (!(Math.abs(p[1] + 1) < 0.02 && p[0] > 4.3)) fail(`pit: ended at ${p.map((v) => v.toFixed(2))}, expected in D (y -1)`);
pass('fixture: dropped into the pit');
// The autopilot strafes round a blocker when stuck, so the end pose says nothing: measure the closest approach
// to the column's footprint (x -1..1, z -5..-3) while walking at it, as sdf-game-flat-gate does.
await evaluate('__sdfGame.setPose(0, -1.2, 0, 0, 0)');
await evaluate('__sdfGame.walkTo(0, -6)');
let nearest = Infinity;
for (let i = 0; i < 12; i++) {
  await sleep(250);
  const [px, , pz] = (await evaluate('__sdfGame.pose()')).pos;
  nearest = Math.min(nearest, Math.hypot(Math.max(-1 - px, 0, px - 1), Math.max(-5 - pz, 0, pz + 3)));
}
await evaluate('__sdfGame.walkCancel()');
if (nearest < 0.28) fail(`column: came ${nearest.toFixed(2)} m from it (the radius is 0.32)`);
if (nearest > 0.45) fail(`column: never reached it (closest ${nearest.toFixed(2)} m)`);
pass(`fixture: stopped ${nearest.toFixed(2)} m from the column`);
// After the walks: right after boot the start overlay still covers the frame.
if (process.env.SHOTS === '1') {
  await shot('fixture.png', 0, -1.5, 0);                                // the start pose, facing -z
  await shot('fixture-steps.png', 2.5, -2, 0);                         // beside the column, facing the step up to B and the ledge to C
  await shot('fixture-pit.png', 7, -1, Math.atan2(-7, 9));             // from the pit, facing back toward B (0, -10)
  pass(`shots: ${OUT}/fixture*.png`);
}

// 3. E1M1
if (process.env.DOOM_GATE_ONLY_FIXTURE === '1') process.exit(0);
if (!existsSync('public/assets/levels/doom-e1m1.level.json')) {
  console.log('skip E1M1: run scripts/levels/doom_map.py <doomu.wad> E1M1 first');
  process.exit(0);
}
await boot('doom-e1m1');
const start = await evaluate('__sdfGame.ground(0, 0)');
if (start.floor !== 0) fail(`E1M1 start floor ${start.floor}, expected 0`);
// ROUTE: [x, z] waypoints along the main path, read off .lab-tmp/doom/E1M1.svg (Step 3). Each leg
// must end within 0.6 m of its target, standing on the floor the ground reports there.
const ROUTE = JSON.parse(process.env.DOOM_ROUTE ?? '[]');
if (ROUTE.length < 4) fail('E1M1: ROUTE needs at least 4 waypoints (DOOM_ROUTE env, see the plan Task 7 Step 3)');
for (let i = 1; i < ROUTE.length; i++) {
  const q = await walk(ROUTE[i - 1], ROUTE[i], 6000);
  const gap = Math.hypot(q[0] - ROUTE[i][0], q[2] - ROUTE[i][1]);
  const floor = (await evaluate(`__sdfGame.ground(${q[0]}, ${q[2]})`)).floor;
  if (gap > 0.6) fail(`E1M1 leg ${i}: stopped ${gap.toFixed(2)} m short of ${ROUTE[i]}`);
  if (Math.abs(q[1] - floor) > 0.02) fail(`E1M1 leg ${i}: feet ${q[1].toFixed(2)} but floor ${floor}`);
  pass(`E1M1 leg ${i}: reached ${ROUTE[i]} on floor ${floor}`);
}

await evaluate('__sdfGame.setPose(0, 0, 0, 0, 0)');
await sleep(800);
const drawCalls = (await evaluate('__sdfGame.drawStats(true)')).drawCalls;
await evaluate('__sdfGame.timeDraws(15)');
const readings = [];
for (let i = 0; i < 3; i++) readings.push(await evaluate('__sdfGame.timeDraws(21)'));
const frameMs = readings.sort((a, b) => a - b)[1];
console.log(`budget: ${drawCalls} draw calls, ${frameMs.toFixed(2)} ms a frame at the start`);
if (frameMs > 33.3) fail(`frame ${frameMs.toFixed(2)} ms > 33.3 ms`);
pass('E1M1 budget: under 33.3 ms');

if (process.env.SHOTS === '1') {
  for (const [i, [x, z]] of [[0, 0], ...ROUTE].entries()) {
    for (const [k, yaw] of [0, Math.PI / 2, Math.PI, -Math.PI / 2].entries()) await shot(`e1m1-${i}-${k}.png`, x, z, yaw);
  }
  pass(`shots: ${OUT}/e1m1-*.png`);
}
process.exit(0);
