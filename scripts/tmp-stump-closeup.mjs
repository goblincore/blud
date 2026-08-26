// One-off: frame the SEVERED SHOULDER STUMP point-blank, several angles.
// Reuses the booted page pattern; assumes nothing about prior state — fires
// its own volleys at a fresh zombie until an arm goes.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5317);
const CDP = Number(process.argv[3] ?? 9317);
const OUT = process.argv[4] ?? '/tmp/wound-craters/stump';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {}
});
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.result.data, 'base64'));
  console.log(`  shot ${name}.png`);
}

await send('Page.enable'); await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });
for (let i = 0; i < 240; i++) {
  await sleep(500);
  if (await evaluate('typeof window.__sdfGame === "object" && window.__sdfGame.gunReady')) break;
}
console.log('booted');
await evaluate('__sdfGame.freeze(true)');
await sleep(400);

const EYE = 1.62;
const zs = await evaluate('__sdfGame.zombies()');
const z = zs[0];

// Shoulder root for whichever arm is alive (proximal-to-torso endpoint).
const shoulderExpr = (id) => `(() => {
  const p = __sdfGame.zombie(${id}).posed();
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

let severed = false; let sh = null;
for (let v = 1; v <= 8 && !severed; v++) {
  sh = await evaluate(shoulderExpr(z.id));
  if (!sh) { severed = true; break; }
  const dx = sh.x - z.pos[0], dz = sh.z - z.pos[2];
  const l = Math.hypot(dx, dz) || 1;
  const sx = sh.x - (dx / l) * 1.0, sz = sh.z - (dz / l) * 1.0;
  const yaw = Math.atan2(sh.x - sx, -(sh.z - sz));
  const rx = Math.cos(yaw), rz = Math.sin(yaw);
  const ax = sh.x - rx * 0.2, ay = sh.y + 0.12, az = sh.z - rz * 0.2;
  const yaw2 = Math.atan2(ax - sx, -(az - sz));
  const pitch2 = Math.atan2(ay - EYE, Math.hypot(ax - sx, az - sz));
  await evaluate(`__sdfGame.setPose(${sx}, ${sz}, ${yaw2}, ${pitch2})`);
  await sleep(300);
  await evaluate('__sdfGame.fire(2)');
  await sleep(1600);
  severed = await evaluate(`(() => {
    const p = __sdfGame.zombie(${z.id}).posed();
    const a = l => p.clusters.find(c => c.limb === l);
    return (a('armR') && !a('armR').alive) || (a('armL') && !a('armL').alive);
  })()`);
  console.log(`volley ${v}: severed=${severed}`);
}
if (!severed) { console.log('NO SEVER — no stump to frame'); process.exit(1); }

// The stump sits where the shoulder root WAS. Re-derive it from the DEAD
// cluster's prims (they stay in the array; alive flag moved).
const stump = await evaluate(`(() => {
  const p = __sdfGame.zombie(${z.id}).posed();
  const torso = p.clusters.find(c => c.limb === 'torso');
  const dead = p.clusters.find(c => (c.limb === 'armR' && !c.alive) || (c.limb === 'armL' && !c.alive));
  if (!dead || !torso) return null;
  const d2 = (e) => (e[0]-torso.center[0])**2 + (e[1]-torso.center[1])**2 + (e[2]-torso.center[2])**2;
  let bestE = null, bd = Infinity;
  for (let i = dead.start; i < dead.start + dead.count; i++) {
    const pr = p.prims[i];
    if (!pr || pr.op === 'sub') continue;
    for (const e of [pr.a, pr.b]) { const d = d2(e); if (d < bd) { bd = d; bestE = e; } }
  }
  return bestE ? { x: bestE[0], y: bestE[1], z: bestE[2], limb: dead.limb } : null;
})()`);
console.log('stump at', JSON.stringify(stump));

// Point-blank orbit of the stump, 4 angles at 0.55 m.
for (let k = 0; k < 4; k++) {
  const a = (k / 4) * Math.PI * 2 + 0.4;
  const sx = stump.x + Math.sin(a) * 0.55;
  const sz = stump.z + Math.cos(a) * 0.55;
  const yaw = Math.atan2(stump.x - sx, -(stump.z - sz));
  const pitch = Math.atan2(stump.y - EYE, 0.55);
  await evaluate(`__sdfGame.setPose(${sx}, ${sz}, ${yaw}, ${pitch})`);
  await sleep(350);
  const bodies = await evaluate('__sdfGame.bodiesOnScreen()');
  console.log(`angle ${k}: bodies=${bodies}`);
  await shot(`stump-orbit-${k}`);
}
console.log('done');
process.exit(0);
