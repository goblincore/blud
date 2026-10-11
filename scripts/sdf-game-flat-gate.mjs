// scripts/sdf-game-flat-gate.mjs — headless gate for the Flat (docs/superpowers/specs/2026-10-11-flat-room-design.md).
//   1. BOOT: webgpu, warm gate ready, no console errors, level 'flat'.
//   2. LAYOUT: one room 'flat'; the start is inside it.
//   3. COLLISION: walking at the kotatsu stops short of it.
//   4. BUDGET: draw calls and frame time in the room (spec section 8: 40 art draws, 33 ms).
//   5. SHOTS (SHOTS=1): four screenshots from the look-dev's cameras into .lab-tmp/flat/.
// Usage: LAB_TMP=.lab-tmp bash scripts/sdf-game-flat-gate.sh
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5560);
const CDP = Number(process.argv[3] ?? 9560);
const OUT = '.lab-tmp/flat';
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

// 1. BOOT
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?level=flat&frozen` });
let ready = false;
for (let i = 0; i < 360 && !ready; i++) {
  await sleep(500);
  ready = (await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null)) === 'ready';
  if (consoleEvents.some((e) => e.type === 'error' || e.type === 'exception')) break;
}
if (!ready) { console.error(consoleEvents.slice(-8)); fail('the flat did not boot to ready'); }
if ((await evaluate('__sdfGame.backend')) !== 'webgpu') fail('backend is not webgpu');
const level = await evaluate('__sdfGame.level()');
if (level.id !== 'flat') fail(`level ${level.id}, expected flat`);
pass('boot: webgpu, warm gate ready, no errors, flat active');

// 2. LAYOUT
if (JSON.stringify(level.rooms) !== JSON.stringify(['flat'])) fail(`rooms ${JSON.stringify(level.rooms)}`);
if ((await evaluate('__sdfGame.room()')) !== 'flat') fail('start room is not flat');
pass('layout: one room, the player starts in it');

// 3. COLLISION: walk at each blocker and measure the closest approach to its footprint (game x, z = Blender x, -y). The autopilot
// strafes around a blocker when stuck (over the low futon), so the final position says nothing; the closest approach does.
await evaluate('__sdfGame.freeze(true)');
const BLOCKERS = {                                           // [from x, z], [to x, z], the footprint {x0, x1, z0, z1} of flat_layout.COLLISION
  kotatsu: { from: [0.12, -0.6], to: [0.12, -2.4], box: { x0: -0.29, x1: 0.53, z0: -2.77, z1: -1.95 } },
  shelf: { from: [0.5, -2.2], to: [1.25, -2.2], box: { x0: 1.08, x1: 1.35, z0: -2.95, z1: -1.55 } },
  tub: { from: [1.75, 1.1], to: [2.8, 1.1], box: { x0: 2.29, x1: 3.03, z0: 0.305, z1: 1.845 } },
  toilet: { from: [1.85, 1.3], to: [1.85, 0.2], box: { x0: 1.64, x1: 2.06, z0: 0.0, z1: 0.72 } },
  sink: { from: [1.85, 0.9], to: [1.85, 1.9], box: { x0: 1.60, x1: 2.12, z0: 1.68, z1: 2.0 } },
  fridge: { from: [-0.9, -2.4], to: [-1.04, -3.3], box: { x0: -1.29, x1: -0.79, z0: -3.56, z1: -3.04 } },
};
for (const [name, { from, to, box }] of Object.entries(BLOCKERS)) {
  await evaluate(`__sdfGame.setPose(${from[0]}, ${from[1]}, 0, 0)`);
  await evaluate(`__sdfGame.walkTo(${to[0]}, ${to[1]})`);
  let nearest = Infinity;
  for (let i = 0; i < 16; i++) {
    await sleep(250);
    const [px, , pz] = (await evaluate('__sdfGame.pose()')).pos;
    nearest = Math.min(nearest, Math.hypot(Math.max(box.x0 - px, 0, px - box.x1), Math.max(box.z0 - pz, 0, pz - box.z1)));
  }
  await evaluate('__sdfGame.walkCancel()');
  if (nearest < 0.25) fail(`walked into the ${name}: came ${nearest.toFixed(2)} m from its footprint (the capsule radius is 0.3)`);
  if (nearest > 0.45) fail(`never reached the ${name}: closest ${nearest.toFixed(2)} m (did the walk run?)`);
  pass(`collision: stopped ${nearest.toFixed(2)} m short of the ${name} (the capsule radius is 0.3)`);
}

// 3b. REACH: the doorways are passable. Game space (x, z): the hall is z 0 to 2, the room z -3.6 to 0, the bathroom x 1.35 to 3.1.
const REACH = {
  'hall to room (through the arch)': { from: [0.12, 1.7], to: [0.12, -1.5] },
  'hall to bathroom (through the doorway)': { from: [0.5, 1.1], to: [2.1, 1.1] },
};
for (const [name, { from, to }] of Object.entries(REACH)) {
  await evaluate(`__sdfGame.setPose(${from[0]}, ${from[1]}, 0, 0)`);
  await evaluate(`__sdfGame.walkTo(${to[0]}, ${to[1]})`);
  await sleep(4500);
  const [px, , pz] = (await evaluate('__sdfGame.pose()')).pos;
  await evaluate('__sdfGame.walkCancel()');
  const gap = Math.hypot(px - to[0], pz - to[1]);
  if (gap > 0.45) fail(`${name}: stopped ${gap.toFixed(2)} m short of the target (a doorway is blocked?)`);
  pass(`reach: ${name} (${gap.toFixed(2)} m from the target)`);
}

// 4. BUDGET
await evaluate('__sdfGame.setPose(0.12, -0.6, 0, 0)');
await sleep(800);
const drawCalls = (await evaluate('__sdfGame.drawStats(true)')).drawCalls;
const frameMs = await evaluate('__sdfGame.timeDraws(9)');
console.log(`budget: ${drawCalls} draw calls, ${frameMs.toFixed(2)} ms a frame`);
if (frameMs > 33.3) fail(`frame ${frameMs.toFixed(2)} ms > 33.3 ms`);
pass('budget: the frame holds under 33.3 ms');

// 5. SHOTS: the look-dev's cameras (room.py 1397-1402), from the engine's 1.75 m eye. yaw 0 faces north (-z in game space).
if (process.env.SHOTS === '1') {
  mkdirSync(OUT, { recursive: true });
  // Review shots show the room alone: no DOM overlays (panels, HUD) and no flashlight, so the level's own lights read.
  await evaluate(`(() => {
    // hide every element that is not the canvas or one of its ancestors
    let n = document.querySelector('canvas');
    while (n && n !== document.body) { for (const sib of n.parentElement.children) if (sib !== n) sib.style.display = 'none'; n = n.parentElement; }
    __sdfGame.setFlashlight(false);
    return 1;
  })()`);
  const YAW_SIGN = Number(process.env.YAW_SIGN ?? -1);          // flip to -1 if the shots face the wrong way (see Task 5 Step 4)
  const CAMS = { wide: [[-1.12, 0.17], [0.4, 2.8, 0.45]], shoulder: [[-0.32, 0.92], [0.16, 2.48, 0.62]], imac: [[0.8, 1.5], [0.08, 2.55, 0.62]], skull: [[-0.62, 2.12], [0.14, 2.58, 0.64]],
    vault: [[0.12, 0.55], [0.12, 1.8, 2.5]], face: [[0.12, 1.55], [0.12, 2.3, 0.72]], window: [[1.15, 2.2], [0.12, 3.6, 1.1]], door: [[0.12, 1.15], [0.12, 0.0, 1.35]],
    hall: [[0.12, -1.75], [0.12, 1.5, 1.5]], hallwest: [[0.7, -0.6], [-1.35, -1.2, 1.0]], hallsconce: [[-0.5, -1.2], [1.35, -0.7, 1.5]], bath: [[1.65, -1.1], [2.8, -1.1, 0.9]], tub: [[1.7, -0.9], [2.66, -1.4, 0.6]], mirror: [[1.75, -0.8], [1.86, -2.0, 1.5]], toilet: [[2.05, -1.3], [1.85, -0.3, 0.6]], door2: [[0.12, -0.3], [0.12, -2.0, 1.3]], bathdoor: [[0.3, -1.1], [2.2, -1.1, 1.1]], boiler: [[0.3, 1.2], [1.2, 3.3, 1.4]] };      // vault and boiler: the Giger layer (added in Task 9)
  for (const [name, [[bx, by], [tx, ty, tz]]] of Object.entries(CAMS)) {
    const dx = tx - bx, dy = ty - by;                           // Blender space: +y is north
    const yaw = YAW_SIGN * Math.atan2(-dx, dy);                  // 0 when the target is straight north
    const pitch = Math.atan2(tz - 1.75, Math.hypot(dx, dy));
    await evaluate(`__sdfGame.setPose(${bx}, ${-by}, ${yaw}, ${pitch})`);
    await sleep(1200);
    const png = (await send('Page.captureScreenshot', { format: 'png' })).result.data;
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(png, 'base64'));
    console.log(`shot ${OUT}/${name}.png`);
  }
}
if (consoleEvents.some((e) => e.type === 'error' || e.type === 'exception')) { console.error(consoleEvents.slice(-8)); fail('console errors'); }
console.log('PASS sdf-game-flat-gate');
process.exit(0);
