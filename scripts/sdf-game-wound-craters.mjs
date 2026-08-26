// scripts/sdf-game-wound-craters.mjs — before/after capture driver for the
// wound-crater + gun-pose task. Deterministic scripted sequence so the BEFORE
// (0.10 carve) and AFTER (0.055 carve + severRadius) runs frame the same
// moments. No deps; CDP over WebSocket, same pattern as sdf-game-grapeshot.mjs.
//
//   node scripts/sdf-game-wound-craters.mjs <vitePort> <cdpPort> <outDir> [guns]
//
// "guns" as 4th arg also captures the three view-model heights.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5317);
const CDP = Number(process.argv[3] ?? 9317);
const OUT = process.argv[4] ?? '/tmp/wound-craters';
const DO_GUNS = process.argv[5] === 'guns';
const W = 1100, H = 800;

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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms)),
  ]);
}
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 30000,
    `evaluate timed out: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

mkdirSync(OUT, { recursive: true });
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(`${OUT}/${name}.png`, buf);
  console.log(`  shot ${name}.png (${buf.length} bytes)`);
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });
let api = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  api = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
  if (api) break;
}
if (api !== 'webgpu') fail(`page never booted on webgpu (got ${api})`);
for (let i = 0; i < 40; i++) {
  if (await evaluate('window.__sdfGame.gunReady')) break;
  await sleep(250);
}
if (!(await evaluate('window.__sdfGame.gunReady'))) fail('gun never ready');
console.log('booted: webgpu, gun ready');

// Freeze the wander ASAP so before/after runs see near-identical layouts.
await evaluate('window.__sdfGame.freeze(true)');
await sleep(400);

const EYE = 1.62;

/** Camera pose standing `dist` from (tx,tz) looking at it, at angle `a`
 *  around the target. */
function around(tx, tz, a, dist, ty) {
  const sx = tx + Math.sin(a) * dist;
  const sz = tz + Math.cos(a) * dist;
  const yaw = Math.atan2(tx - sx, -(tz - sz));
  const pitch = Math.atan2(ty - EYE, dist);
  return { x: sx, z: sz, yaw, pitch };
}

/** Sweep a circle around the target, keep the angle with the highest
 *  bodiesOnScreen (analytic single-yaw framing keeps landing in walls). */
async function frameBest(tx, tz, dist, ty) {
  let best = null, bestN = -1;
  for (let k = 0; k < 8; k++) {
    const p = around(tx, tz, (k / 8) * Math.PI * 2, dist, ty);
    await evaluate(`__sdfGame.setPose(${p.x}, ${p.z}, ${p.yaw}, ${p.pitch})`);
    await sleep(250);
    const n = await evaluate('__sdfGame.bodiesOnScreen()');
    if (n > bestN) { bestN = n; best = p; }
  }
  await evaluate(`__sdfGame.setPose(${best.x}, ${best.z}, ${best.yaw}, ${best.pitch})`);
  await sleep(350);
  return { ...best, bodies: bestN };
}

const zs = await evaluate('window.__sdfGame.zombies()');
const z0 = zs[0];
console.log(`target zombie ${z0.id} at (${z0.pos[0].toFixed(2)}, ${z0.pos[2].toFixed(2)})`);

// --- A. two single barrels into the torso from ~2.4 m ----------------------
{
  const p = await frameBest(z0.pos[0], z0.pos[2], 2.4, 1.1);
  console.log(`framed from (${p.x.toFixed(2)}, ${p.z.toFixed(2)}), bodies=${p.bodies}`);
  await shot('a1-clean');
  await evaluate('__sdfGame.fire(1)');
  await sleep(1400);
  await evaluate('__sdfGame.fire(1)');
  await sleep(1400);
  console.log(`wounds after 2 barrels: ${await evaluate(`__sdfGame.zombie(${z0.id}).woundCount()`)}`);
  // Re-frame (recoil moved the camera) and go CLOSE.
  await frameBest(z0.pos[0], z0.pos[2], 1.1, 1.05);
  await shot('a2-craters-close');
  await frameBest(z0.pos[0], z0.pos[2], 0.7, 1.05);
  await shot('a3-craters-point-blank');
}

// --- B. shoulder volleys until an arm severs, then stump close-ups ---------
{
  const shoulderExpr = `(() => {
    const z = __sdfGame.zombie(${z0.id});
    const p = z.posed();
    const cl = p.clusters.find(c => (c.limb === 'armR' && c.alive) || (c.limb === 'armL' && c.alive));
    const torso = p.clusters.find(c => c.limb === 'torso');
    if (!cl || !torso) return null;
    const d2 = (e) => (e[0]-torso.center[0])**2 + (e[1]-torso.center[1])**2 + (e[2]-torso.center[2])**2;
    let bestE = null, bd = Infinity;
    for (let i = cl.start; i < cl.start + cl.count; i++) {
      const pr = p.prims[i];
      if (!pr || pr.op === 'sub' || pr.dead) continue;
      for (const e of [pr.a, pr.b]) { const d = d2(e); if (d < bd) { bd = d; bestE = e; } }
    }
    return bestE ? { x: bestE[0], y: bestE[1], z: bestE[2], limb: cl.limb } : null;
  })()`;
  let severed = false;
  for (let v = 1; v <= 4 && !severed; v++) {
    const sh = await evaluate(shoulderExpr);
    if (!sh) { severed = true; break; }
    const dx = sh.x - z0.pos[0], dz = sh.z - z0.pos[2];
    const l = Math.hypot(dx, dz) || 1;
    const sx = sh.x - (dx / l) * 1.0;
    const sz = sh.z - (dz / l) * 1.0;
    const yaw = Math.atan2(sh.x - sx, -(sh.z - sz));
    const pitch = Math.atan2(sh.y - EYE, 1.0);
    await evaluate(`__sdfGame.setPose(${sx}, ${sz}, ${yaw}, ${pitch})`);
    await sleep(300);
    await evaluate('__sdfGame.fire(2)');
    await sleep(1600);
    severed = await evaluate(`(() => {
      const p = __sdfGame.zombie(${z0.id}).posed();
      const a = l => p.clusters.find(c => c.limb === l);
      return (a('armR') && !a('armR').alive) || (a('armL') && !a('armL').alive);
    })()`);
    console.log(`sever volley ${v}: severed=${severed} wounds=${await evaluate(`__sdfGame.zombie(${z0.id}).woundCount()`)}`);
  }
  console.log(severed ? 'SEVERED' : 'NOT SEVERED in 4 double-barrels');
  // Stump close-up: frame the body from ~0.9 m at shoulder height.
  await frameBest(z0.pos[0], z0.pos[2], 0.9, 1.35);
  await shot('b1-stump-close');
  // A second angle on the stump.
  const me = await evaluate('__sdfGame.pose()');
  const a2 = Math.atan2(me.pos[0] - z0.pos[0], me.pos[2] - z0.pos[2]) + Math.PI * 0.5;
  const p2 = around(z0.pos[0], z0.pos[2], a2, 0.9, 1.35);
  await evaluate(`__sdfGame.setPose(${p2.x}, ${p2.z}, ${p2.yaw}, ${p2.pitch})`);
  await sleep(350);
  await shot('b2-stump-side');
}

// --- C. gun heights (only when asked) --------------------------------------
if (DO_GUNS) {
  await evaluate('__sdfGame.setPose(-4.0, -4.0, 0.7, -0.05)');
  await sleep(400);
  for (const [name, dy] of [['c1-gun-current', 0], ['c2-gun-minus-5cm', -0.05], ['c3-gun-minus-10cm', -0.10]]) {
    await evaluate(`__sdfGame.viewModelAnchor.position.y = ${dy}`);
    await sleep(300);
    await shot(name);
  }
  await evaluate('__sdfGame.viewModelAnchor.position.y = 0');
}

console.log(`done — shots in ${OUT}`);
