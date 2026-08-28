// scripts/sdf-game-stagger-seq.mjs — HIT-STAGGER frame-sequence captures.
//
// For the stagger-feel task (2026-08-27): one zombie, room 1, hand-stepped
// frames across one hit — slug to torso, slug to a limb, full buckshot
// volley — BEFORE and AFTER the stagger retune. The point is the SEQUENCE:
// a stagger is motion, so judge it as frames across the reaction, not one
// still.
//
// Usage: node scripts/sdf-game-stagger-seq.mjs <vitePort> <cdpPort> <outDir> <tag>
// Servers via lab-servers.sh (own ports).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const OUT = process.argv[4] ?? '/tmp/stagger-seq';
const TAG = process.argv[5] ?? 'seq';
const W = 1100, H = 800;
const EYE = 1.62;

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
let shotN = 0;
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(`${OUT}/${TAG}-${String(shotN++).padStart(2, '0')}-${name}.png`, buf);
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

// Walk to room 1 (one zombie — bodiesOnScreen cannot mislead).
await evaluate('__sdfGame.teleport(1)');
await sleep(200);

// Hand-step ONLY from here: freeze the rAF loop so the wanderer cannot drift
// between an aim and its shot.
await evaluate('__sdfGame.setLoopRunning(false)');

const DIST = 2.4;
/** Aim the crosshair at (tx + dx, ty, tz) from DIST south of the target.
 *
 *  The projectiles do NOT fly along the camera ray: they leave the MUZZLE
 *  (eye + right*0.2 − 0.12y − fwd*0.5 — game-main's muzzleWorld, whose
 *  forward term is +cy*0.5 i.e. BEHIND the facing line) toward the point
 *  where the camera ray meets AIM_CONVERGE_M = 8 m. Aiming the camera at the
 *  target therefore misses at close range by the muzzle offset's share of
 *  the convergence line. This solves the camera pose so the MUZZLE RAY
 *  passes through the desired impact point, replicating the page's exact
 *  muzzleWorld/convergedDir algebra (verified against predictSlugHit). */
async function aim(z, tx, ty, tz) {
  const sx = z.pos[0], sz = z.pos[2] - DIST;
  // Fixed-point: camera aim -> muzzle -> convergence point -> camera aim.
  let yaw = Math.atan2(tx - sx, -(tz - sz));
  let pitch = Math.atan2(ty - EYE, DIST);
  for (let i = 0; i < 4; i++) {
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const mx = sx + cy * 0.2 - sy * 0.5, my = EYE - 0.12, mz = sz + sy * 0.2 + cy * 0.5;
    const ax = tx - mx, ay = ty - my, az = tz - mz;
    const al = Math.hypot(ax, ay, az);
    const cx = mx + ax / al * 8, cyy = my + ay / al * 8, cz = mz + az / al * 8;
    const dx = cx - sx, dy = cyy - EYE, dz = cz - sz;
    const dl = Math.hypot(dx, dy, dz);
    pitch = Math.asin(dy / dl);
    yaw = Math.atan2(dx, -dz);
  }
  await evaluate(`__sdfGame.setPose(${sx.toFixed(4)}, ${sz.toFixed(4)}, ${yaw.toFixed(5)}, ${pitch.toFixed(5)})`);
}

/** A limb shot: try lateral offsets until the predictor lands a hit clearly
 *  OFF the spine (|x − centre| > 0.12) in the arm/leg height band — whatever
 *  limb the ray actually clips is the case. */
async function aimLimb(z) {
  for (const [dx, y] of [[0.3, 0.95], [-0.3, 0.95], [0.22, 1.0], [-0.22, 1.0], [0.16, 0.8], [-0.16, 0.8]]) {
    await aim(z, z.pos[0] + dx, y, z.pos[2]);
    await evaluate('__sdfGame.step(2)');
    const p = await evaluate('__sdfGame.predictSlugHit()');
    if (p.hit && Math.abs(p.hit[0] - z.pos[0]) > 0.12 && p.hit[1] > 0.55 && p.hit[1] < 1.45) {
      console.log(`  limb aim: dx ${dx} y ${y} -> impact (${p.hit.map(v => v.toFixed(2)).join(', ')})`);
      return;
    }
  }
  fail('no limb candidate connected — aim solver offset band is wrong');
}

/** One capture case: aim at a world point, fire, hand-step the reaction and
 *  screenshot every 2nd frame for ~1.2 s. */
async function captureCase(name, fireExpr, target) {
  const zs0 = await evaluate('__sdfGame.zombies()');
  const z0 = zs0[0];
  if (target) {
    const t0 = target(z0);
    await aim(z0, t0[0], t0[1], t0[2]);
  } else {
    await aimLimb(z0);
  }
  await evaluate('__sdfGame.step(6)'); // settle the new pose, still frozen loop
  // Re-aim on the SETTLED pose: the zombie wanders a little across the six
  // hand-stepped frames, and a borderline aim must not go stale.
  const zs = await evaluate('__sdfGame.zombies()');
  const z = zs[0];
  if (target) {
    const t = target(z);
    await aim(z, t[0], t[1], t[2]);
    await evaluate('__sdfGame.step(2)');
  } else {
    await aimLimb(z);
  }
  const pred = await evaluate('__sdfGame.predictSlugHit()');
  console.log(`[${name}] zombie ${z.id} at (${z.pos[0].toFixed(2)}, ${z.pos[2].toFixed(2)}) — predicted impact ${
    pred.hit ? pred.hit.map(v => v.toFixed(2)).join(', ') : 'MISS'}`);
  if (!pred.hit) fail(`[${name}] aim solver missed the body — captures would be empty`);
  await shot(`${name}-pre`);
  await evaluate(fireExpr);
  // ~1.2 s of reaction at 60 Hz, a shot every 2nd frame.
  for (let f = 0; f < 72; f++) {
    await evaluate('__sdfGame.step(1)');
    if (f % 2 === 0) await shot(`${name}-f${String(f).padStart(3, '0')}`);
  }
  const after = await evaluate('__sdfGame.zombies()');
  console.log(`[${name}] post: zombie at (${after[0].pos[0].toFixed(2)}, ${after[0].pos[2].toFixed(2)}), wounds ${await evaluate(`__sdfGame.zombie(${z.id}).woundCount()`)}`);
  // Cooldown: a real 0.5 s of hand-stepped time before the next case.
  await evaluate('__sdfGame.step(30)');
}

// Torso centre of the room-1 zombie, from its live pose.
const torsoTarget = (dy = 0, dx = 0.0, h = 1.05) => (z) => [z.pos[0] + dx, h, z.pos[2] + dy];

await captureCase('slug-torso', '__sdfGame.fireSlug()', torsoTarget());
// A limb: let the predictor pick the lateral offset that actually clips one.
await captureCase('slug-limb', '__sdfGame.fireSlug()', null);
// Full buckshot volley: both barrels, pellet mode.
await evaluate('__sdfGame.setSlugMode(false)');
await captureCase('buckshot-2barrels', '__sdfGame.fire(2)', torsoTarget());

console.log(`done — ${shotN} shots in ${OUT}`);
process.exit(0);
