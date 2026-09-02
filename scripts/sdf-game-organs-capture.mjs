// scripts/sdf-game-organs-capture.mjs — ORGANS combat-range captures (task 6 step 4).
//
// The evidence task. Stages through the seam that works:
//   predictSlugHit() -> stampWoundAt(..., 'slug', actorId)
// with spillChance 1 so the rope is guaranteed rather than rolled.
//
// Shot list, all at 2-3 m under the beam, judged BY LOOKING (this harness has
// 52-82k px of same-build flicker — never a pixel diff):
//   1. LOWER-TORSO slug (gut band ~1.0 m): the cavity must read as pale coiled
//      tubes, and the spilled rope as a springy coil of the same material —
//      not goo-maroon, not a straight T. Shots at +3/+30/+90 steps show the
//      spring tightening as it settles.
//   2. Same view with organAmp 0: organ prims must shade as plain bone (the
//      off-state is one knob).
//   3. organAmp back to 1, then a CHEST slug (~1.3 m) on the NEXT body: must
//      still open onto ribs, not coils.
//
// Usage: node scripts/sdf-game-organs-capture.mjs <vitePort> <cdpPort> <outDir> <tag>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5471);
const CDP = Number(process.argv[3] ?? 9337);
const OUT = process.argv[4] ?? 'docs/dev-notes/2026-09-02-organs-guts/captures';
const TAG = process.argv[5] ?? 'cap';
const W = 1280, H = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (8 min)'); process.exit(3); }, 480_000).unref();

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT', signal: AbortSignal.timeout(15000) })
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
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 60000,
    `evaluate timed out: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

mkdirSync(OUT, { recursive: true });
let shotN = 0;
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  const p = `${OUT}/${String(++shotN).padStart(2, '0')}-${TAG}-${name}.png`;
  writeFileSync(p, buf);
  console.log(`  shot ${p}`);
  return p;
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });
let backend = null;
for (let i = 0; i < 180; i++) {
  await sleep(500);
  backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
  if (backend) break;
}
if (!backend) fail('game page never booted (__sdfGame absent)');
if (backend !== 'webgpu') fail(`backend is ${backend}, not webgpu`);
await sleep(2000);

const log = { tag: TAG };

// Guaranteed rope for the staged shot.
await evaluate('__sdfGame.setWoundTuning({ spillChance: 1 })');
if ((await evaluate('__sdfGame.woundTuning.spillChance')) !== 1) fail('spillChance did not apply');
await evaluate('__sdfGame.freeze(true)');
await evaluate('__sdfGame.step(2)');

// --- aim at a body's LOWER TORSO (gut band ~1.0 m) from 2-3 m --------------
// YAW CONVENTION (aimAtNearestSurface): forward is (sin yaw, -cos yaw).
const picked = await evaluate(`(() => {
  const zs = __sdfGame.zombies();
  const eyeH = 1.62;
  const AIM_Y = 1.0;   // lower torso — the gut band
  for (const z of zs) {
    for (const dist of [2.4, 2.8, 2.0, 3.2]) {
      for (const ang of [0, 0.7, -0.7, 1.4, -1.4]) {
        const ex = z.pos[0] + Math.sin(ang) * dist;
        const ez = z.pos[2] + Math.cos(ang) * dist;
        const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
        const yaw = Math.atan2(dx, -dz);
        const dy = (z.pos[1] ?? 0) + AIM_Y - eyeH;
        const pitch = Math.atan2(dy, Math.hypot(dx, dz));
        __sdfGame.setPose(ex, ez, yaw, pitch, 0);
        const p = __sdfGame.predictSlugHit();
        if (p.actorId === z.id && p.hit) {
          return { z: { id: z.id, room: z.room, pos: z.pos }, eye: { x: ex, z: ez, yaw, pitch }, pred: p };
        }
      }
    }
  }
  return null;
})()`);
if (!picked) fail('no zombie aimable at the lower torso from 2-3 m');
const dist = Math.hypot(picked.z.pos[0] - picked.eye.x, picked.z.pos[2] - picked.eye.z);
console.log(`gut body ${picked.z.id} (room ${picked.z.room}) at ${dist.toFixed(2)} m; hit`, picked.pred.hit.map(v => +v.toFixed(2)));
log.gut = picked;
await evaluate('__sdfGame.step(5)');
await shot('gut-before-stamp');

// --- stage the gut slug -----------------------------------------------------
// The spill verdict is TORSO-gated: a slug that lands on hip/thigh/arm stamps
// a wound but opens no cavity and rolls no spill. The predictor confirms its
// own aim, but gravity can still bend the landing point below the band — the
// first attempt landed at y 0.82 (hip). So: stamp, READ THE WOUND BACK, and
// keep the first aim whose wound actually carries cavity:true.
const stamped = await evaluate(`(() => {
  const z = __sdfGame.zombies().find(q => q.id === ${picked.z.id});
  if (!z) return null;
  const eyeH = 1.62;
  const tries = [];
  for (const aimY of [1.08, 1.05, 1.02, 0.98, 1.12]) {
    for (const dist of [2.4, 2.8, 2.0, 3.2]) {
      for (const ang of [0, 0.15, -0.15, 0.35, -0.35]) {
        const ex = z.pos[0] + Math.sin(ang) * dist;
        const ez = z.pos[2] + Math.cos(ang) * dist;
        const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
        const yaw = Math.atan2(dx, -dz);
        const dy = (z.pos[1] ?? 0) + aimY - eyeH;
        const pitch = Math.atan2(dy, Math.hypot(dx, dz));
        __sdfGame.setPose(ex, ez, yaw, pitch, 0);
        const p = __sdfGame.predictSlugHit();
        if (p.actorId !== z.id || !p.hit) continue;
        const hit = __sdfGame.stampWoundAt(p.origin[0], p.origin[1], p.origin[2],
          p.dir[0], p.dir[1], p.dir[2], 'slug', p.actorId);
        if (!hit) continue;
        const zs = __sdfGame.zombie(z.id);
        const last = zs.woundList()[zs.woundList().length - 1];
        tries.push({ aimY, hitY: +hit[1].toFixed(2), cavity: last?.cavity === true, spill: last?.spillCalibre ?? null });
        if (last?.cavity === true && last?.spillCalibre === 'slug') {
          return { actorId: z.id, stamped: hit, hitY: +hit[1].toFixed(2), tries };
        }
      }
    }
  }
  return { actorId: -1, tries };
})()`);
if (!stamped || !stamped.stamped) fail(`no lower-torso slug qualified (cavity+slug): ${JSON.stringify(stamped?.tries ?? stamped)}`);
console.log(`stamped gut slug on body ${stamped.actorId} at y ${stamped.hitY} (tried ${stamped.tries.length} aims)`);
log.gutStamp = stamped;
const gid = stamped.actorId;

// rope must exist immediately (spillChance 1)
await evaluate('__sdfGame.step(3)');
log.guts0 = await evaluate('__sdfGame.guts()');
const g0 = log.guts0.find(g => g.id === gid);
if (!g0 || g0.none) fail(`no rope after a spillChance-1 lower-torso slug: ${JSON.stringify(log.guts0)}`);
if (!g0.attached) fail(`rope not attached right after stamp: ${JSON.stringify(g0)}`);
console.log('rope live:', JSON.stringify(g0));
await shot('gut-rope-early');

// let the spring settle; the coil tightens as it pulls in
await evaluate('__sdfGame.step(30)');
await shot('gut-rope-30steps');
await evaluate('__sdfGame.step(60)');
log.gutsHang = await evaluate('__sdfGame.guts()');
const gh = log.gutsHang.find(g => g.id === gid);
if (!gh.attached) fail(`rope detached while body stood (phase ${gh.phase})`);
const span = Math.hypot(gh.tail[0] - gh.head[0], gh.tail[1] - gh.head[1], gh.tail[2] - gh.head[2]);
console.log(`hanging rope: span ${span.toFixed(2)} m, nodes ${gh.nodes}, droplets ${gh.droplets}, phase ${gh.phase}`);
log.hang = { ...gh, spanM: span };
await shot('gut-rope-settled');
await shot('gut-rope-settled-2');

// --- off-state: organAmp 0 must shade the organ prims as plain bone --------
await evaluate('__sdfGame.setWoundTuning({ organAmp: 0 })');
await evaluate('__sdfGame.step(1)');
log.organAmp = await evaluate('__sdfGame.woundTuning.organAmp');
if (log.organAmp !== 0) fail('organAmp did not apply');
await shot('gut-organamp0-offstate');
await evaluate('__sdfGame.setWoundTuning({ organAmp: 1 })');
await evaluate('__sdfGame.step(1)');

// --- CHEST slug on the NEXT body: ribs must survive ------------------------
// Same readback discipline: a chest aim that lands on a hanging arm proves
// nothing. Keep the first stamp whose wound carries cavity:true at chest
// height.
const chest = await evaluate(`(() => {
  const zs = __sdfGame.zombies();
  const z = zs.find(q => q.id !== ${gid});
  if (!z) return null;
  const eyeH = 1.62;
  const tries = [];
  for (const aimY of [1.32, 1.28, 1.35, 1.25]) {
    for (const dist of [2.4, 2.8, 2.0, 3.2]) {
      for (const ang of [0, 0.3, -0.3, 0.7, -0.7]) {
        const ex = z.pos[0] + Math.sin(ang) * dist;
        const ez = z.pos[2] + Math.cos(ang) * dist;
        const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
        const yaw = Math.atan2(dx, -dz);
        const dy = (z.pos[1] ?? 0) + aimY - eyeH;
        const pitch = Math.atan2(dy, Math.hypot(dx, dz));
        __sdfGame.setPose(ex, ez, yaw, pitch, 0);
        const p = __sdfGame.predictSlugHit();
        if (p.actorId !== z.id || !p.hit) continue;
        const hit = __sdfGame.stampWoundAt(p.origin[0], p.origin[1], p.origin[2],
          p.dir[0], p.dir[1], p.dir[2], 'slug', p.actorId);
        if (!hit) continue;
        const zs2 = __sdfGame.zombie(z.id);
        const last = zs2.woundList()[zs2.woundList().length - 1];
        tries.push({ aimY, hitY: +hit[1].toFixed(2), cavity: last?.cavity === true });
        if (last?.cavity === true) {
          return { z: { id: z.id }, stamped: hit, hitY: +hit[1].toFixed(2), tries };
        }
      }
    }
  }
  return { z: { id: -1 }, tries };
})()`);
if (!chest || !chest.stamped) fail(`no chest slug qualified (cavity): ${JSON.stringify(chest?.tries ?? chest)}`);
console.log(`stamped chest slug on body ${chest.z.id} at y ${chest.hitY}`);
log.chest = chest;
await evaluate('__sdfGame.step(3)');
const chestHit = await evaluate(`(() => {
  const z = __sdfGame.zombie(${chest.z.id});
  return z.woundList().map(w => ({ type: w.type, cavity: w.cavity === true }));
})()`);
log.chestWounds = chestHit;
console.log('chest wounds:', JSON.stringify(chestHit));
await shot('chest-ribs');
await evaluate('__sdfGame.step(60)');
await shot('chest-ribs-2');

// gut wounds carry the cavity marker (the viscera + roll both key off it)
log.gutWounds = await evaluate(`(() => {
  const z = __sdfGame.zombie(${gid});
  return z.woundList().map(w => ({ type: w.type, cavity: w.cavity === true, spillCalibre: w.spillCalibre }));
})()`);
console.log('gut wounds:', JSON.stringify(log.gutWounds));
if (!log.gutWounds.some(w => w.cavity && w.spillCalibre === 'slug')) {
  fail('gut wound missing cavity+slug marker — viscera and roll both starve');
}
const gutY = log.gutWounds.map(w => w.cavity);
console.log(`gut wound cavity flags: ${JSON.stringify(gutY)}`);

writeFileSync(`${OUT}/${TAG}-log.json`, JSON.stringify(log, null, 2));
console.log(`\nOK — log ${OUT}/${TAG}-log.json`);
ws.close();
process.exit(0);
