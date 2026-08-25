// scripts/sdf-game.mjs — headless gates for sdf-game.html (the grey-box ring).
//
// No-deps CDP, same pattern as scripts/sdf-bench.mjs. Drives __sdfGame:
//   1. WANDER GATE — unfreeze, hand-step ~360 frames in 60-frame chunks,
//      assert no zombie leaves its room or stands inside furniture.
//   2. RING WALK — autopilot walkTo() through tunnel midpoints and room
//      centres, 1->2->3->4->1, asserting the enclosure sequence and that
//      the path never reads 'void' (no wall clips, no diagonal shortcut).
//   3. CAPTURES — one PNG per room and per tunnel mouth, plus a probeWeight
//      0 / 0.5 A/B in room1. Screenshots land in /tmp/sdf-game/.
//   4. INDICATIVE frame ms per room — the loop runs live ~2.5 s per room.
//      NOT a benchmark: quoted beside uptime, never against the bench.
//
// Usage: LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 node scripts/sdf-game.mjs
// (or let it start its own: it expects servers already up — use
//  scripts/sdf-game.sh which wraps lab-servers.sh.)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5277);
const CDP = Number(process.argv[3] ?? 9277);
const OUT = process.env.GAME_OUT ?? '/tmp/sdf-game';
const W = Number(process.env.GAME_W ?? 1280);
const H = Number(process.env.GAME_H ?? 800);

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
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

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
if (api !== 'webgpu') fail(`backend is ${api}, not webgpu`);
console.log('backend: webgpu');

// Settle: let the boot loop render, then take over the clock.
await sleep(3000);
await evaluate('window.__sdfGame.setLoopRunning(false)');
const summary = { shots: [], wander: null, ring: null, frameMs: {}, uptimeAtEnd: 0 };

const ROOMS = await evaluate('window.__sdfGame.rooms');
const FURNITURE = await evaluate('window.__sdfGame.furniture');
const roomOf = (id) => ROOMS.find((r) => r.id === id);

// --- 1. WANDER GATE -------------------------------------------------------
console.log('gate: wander (360 frames, 6 chunks)');
await evaluate('window.__sdfGame.freeze(false)');
let wanderOk = true;
for (let chunk = 0; chunk < 6; chunk++) {
  await evaluate('window.__sdfGame.step(60, 1/60)');
  const zs = await evaluate('window.__sdfGame.zombies()');
  for (const z of zs) {
    const b = roomOf(z.room).bounds;
    if (z.pos[0] < b.minX || z.pos[0] > b.maxX || z.pos[2] < b.minZ || z.pos[2] > b.maxZ) {
      console.error(`  zombie ${z.id} escaped room ${z.room}: ${z.pos}`);
      wanderOk = false;
    }
    for (const f of FURNITURE) {
      if (f.room !== z.room) continue;
      if (z.pos[0] > f.minX - 0.2 && z.pos[0] < f.maxX + 0.2
        && z.pos[2] > f.minZ - 0.2 && z.pos[2] < f.maxZ + 0.2) {
        console.error(`  zombie ${z.id} inside furniture in room ${z.room}: ${z.pos}`);
        wanderOk = false;
      }
    }
  }
}
summary.wander = wanderOk ? 'ok (360 frames, 10 zombies in bounds, clear of furniture)' : 'FAILED';
await evaluate('window.__sdfGame.freeze(true)');
console.log(`  wander: ${summary.wander}`);

// --- 2. RING WALK ---------------------------------------------------------
console.log('gate: ring walk 1->2->3->4->1');
const waypoints = [
  [0, -4.8, 'tunnel-1-2'], [5.6, -3.6, 'room2'],
  [4.8, 0, 'tunnel-2-3'], [4.0, 4.0, 'room3'],
  [0, 4.8, 'tunnel-3-4'], [-5.2, 4.0, 'room4'],
  [-4.8, 0, 'tunnel-4-1'], [-4.0, -4.0, 'room1'],
];
// Start off the room1 centre — a zombie spawns exactly there, and the
// waypoint arrival radius (0.25) is smaller than its obstacle box.
await evaluate('window.__sdfGame.setPose(-4.0, -4.0, 0, 0)');
const visited = [];
let ringOk = true;
let voidSeen = false;
for (const [wx, wz, expectName] of waypoints) {
  await evaluate(`window.__sdfGame.walkTo(${wx}, ${wz})`);
  let arrived = false;
  for (let i = 0; i < 20; i++) {
    await evaluate('window.__sdfGame.step(30, 1/60)');
    const where = await evaluate('window.__sdfGame.room()');
    if (where === 'void') voidSeen = true;
    if (!(await evaluate('window.__sdfGame.walking'))) { arrived = true; break; }
    // A frozen wanderer parked ON the waypoint makes the 0.25 m arrival
    // radius unreachable (its obstacle box is bigger). For a ROOM waypoint,
    // being well inside the right enclosure is arrival enough.
    if (expectName.startsWith('room') && where === expectName) {
      const p = await evaluate('window.__sdfGame.pose()');
      if (Math.hypot(p.pos[0] - wx, p.pos[2] - wz) < 2.0) {
        await evaluate('window.__sdfGame.walkCancel()');
        arrived = true;
        break;
      }
    }
  }
  const here = await evaluate('window.__sdfGame.room()');
  visited.push(here);
  if (!arrived) { console.error(`  never reached (${wx},${wz}) — stuck at ${here}`); ringOk = false; }
  if (here !== expectName) { console.error(`  waypoint (${wx},${wz}): expected ${expectName}, in ${here}`); ringOk = false; }
}
if (voidSeen) { console.error('  walked through a void region (inside a wall!)'); ringOk = false; }
summary.ring = ringOk ? `ok: ${visited.join(' -> ')}` : `FAILED: ${visited.join(' -> ')}`;
console.log(`  ring: ${summary.ring}`);

// --- 3. CAPTURES ----------------------------------------------------------
// Viewpoint per room: back corner looking at the centre (shows the count).
console.log('captures: rooms, tunnels, probeWeight A/B');
const roomViews = {
  1: [-7.4, -7.4, Math.PI * 0.75], 2: [7.4, -7.4, -Math.PI * 0.75],
  3: [7.4, 7.4, -Math.PI * 0.25], 4: [-7.4, 7.4, Math.PI * 0.25],
};
for (const [id, [x, z, yaw]] of Object.entries(roomViews)) {
  await evaluate(`window.__sdfGame.setPose(${x}, ${z}, ${yaw}, 0)`);
  await evaluate('window.__sdfGame.step(20, 1/60)');
  await shot(`room${id}`);
}
// Tunnel mouths: stand in the corridor, look into the next room.
const tunnelViews = [
  ['tunnel-1-2', 0, -4.8, Math.PI / 2], ['tunnel-2-3', 4.8, 0, Math.PI],
  ['tunnel-3-4', 0, 4.8, -Math.PI / 2], ['tunnel-4-1', -4.8, 0, 0],
];
for (const [name, x, z, yaw] of tunnelViews) {
  await evaluate(`window.__sdfGame.setPose(${x}, ${z}, ${yaw}, 0)`);
  await evaluate('window.__sdfGame.step(20, 1/60)');
  await shot(name);
}
// probeWeight A/B in room1, zombie framed.
await evaluate('window.__sdfGame.setPose(-4.8, -7.2, Math.PI, 0)');
await evaluate('window.__sdfGame.setProbeWeight(0)');
await evaluate('window.__sdfGame.step(20, 1/60)');
await shot('ab-probe-0');
await evaluate('window.__sdfGame.setProbeWeight(0.5)');
await evaluate('window.__sdfGame.step(20, 1/60)');
await shot('ab-probe-0.5');

// --- 4. INDICATIVE frame ms per room --------------------------------------
// Live loop, ~2.5 s per room. Indicative only — never a bench number.
console.log('indicative frame ms per room (live loop, 2.5 s each)');
await evaluate('window.__sdfGame.freeze(false)');
for (const id of [1, 2, 3, 4]) {
  await evaluate(`window.__sdfGame.teleport(${id})`);
  await evaluate('window.__sdfGame.setLoopRunning(true)');
  await sleep(2500);
  await evaluate('window.__sdfGame.setLoopRunning(false)');
  const ms = await evaluate('window.__sdfGame.frameMs()');
  const up = await evaluate('window.__sdfGame.uptime()');
  summary.frameMs[`room${id}`] = { ms: Math.round(ms * 10) / 10, uptime: Math.round(up) };
  console.log(`  room${id}: ${summary.frameMs[`room${id}`].ms} ms (uptime ${summary.frameMs[`room${id}`].uptime}s)`);
}
summary.uptimeAtEnd = Math.round(await evaluate('window.__sdfGame.uptime()'));

const badConsole = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
summary.consoleErrors = badConsole.length;
if (badConsole.length > 0) {
  for (const e of badConsole.slice(0, 10)) console.error('  |', e.type, e.text.slice(0, 300));
}
summary.shotCount = shotCount;
console.log('SUMMARY ' + JSON.stringify(summary, null, 2));
if (!wanderOk || !ringOk) fail('gates failed — see above');
if (badConsole.length > 0) fail(`${badConsole.length} console error(s)`);
ws.close();
process.exit(0);
