// scripts/sdf-game-organs-closeup.mjs — ORGANS diagnostic close-ups (task 6).
//
// The 2-3 m captures left two questions open, so this pass answers them
// directly:
//   1. Does the crater floor read as coiled tubes, and the chest as ribs?
//      (At 2.4 m the crater is a few pixels — step to ~1.4 m.)
//   2. Is the rope's gut mask actually reaching the surface pass? Absorption
//      `trans` turns even pale salmon red-dominant, so at shipped absorb the
//      rope reads red either way. At absorb 0 the filter is 1: a gut-masked
//      rope reads PALE SALMON, an unmasked one stays dark maroon. One shot,
//      decisive. absorb is restored afterwards.
//
// Usage: node scripts/sdf-game-organs-closeup.mjs <vitePort> <cdpPort> <outDir> <tag>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5471);
const CDP = Number(process.argv[3] ?? 9337);
const OUT = process.argv[4] ?? 'docs/dev-notes/2026-09-02-organs-guts/captures';
const TAG = process.argv[5] ?? 'close';
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
if (!backend) fail('game page never booted');
if (backend !== 'webgpu') fail(`backend is ${backend}, not webgpu`);
await sleep(2000);

const log = { tag: TAG };

// Stage a qualifying gut wound the same way the main capture does.
await evaluate('__sdfGame.setWoundTuning({ spillChance: 1 })');
await evaluate('__sdfGame.freeze(true)');
await evaluate('__sdfGame.step(2)');
const gut = await evaluate(`(() => {
  const eyeH = 1.62;
  for (const z of __sdfGame.zombies()) {
    for (const aimY of [1.08, 1.05, 1.02, 0.98]) {
      for (const dist of [1.5, 1.4, 1.6, 2.0]) {
        for (const ang of [0, 0.2, -0.2]) {
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
          if (last?.cavity === true && last?.spillCalibre === 'slug') {
            return { id: z.id, hit, pos: z.pos, eye: { x: ex, z: ez, yaw, pitch } };
          }
        }
      }
    }
  }
  return null;
})()`);
if (!gut) fail('no qualifying gut wound staged');
console.log(`gut wound on body ${gut.id} at`, gut.hit.map(v => +v.toFixed(2)));
log.gut = { id: gut.id, hit: gut.hit };

// Let the rope settle, then CLOSE-UP the crater + rope from ~1.2-1.4 m.
await evaluate('__sdfGame.step(90)');
const hx = gut.hit[0], hy = gut.hit[1], hz = gut.hit[2];
const posed = await evaluate(`(() => {
  const hit = ${JSON.stringify(gut.hit)};
  const eyeH = 1.62;
  // No predictor validation: the ray aims INTO the fresh crater and can be
  // swallowed by the bowl. The camera sits 1.1-1.7 m from the wound — take
  // the first candidate.
  const back = 1.3, ang = 0;
  const ex = hit[0] + Math.sin(ang) * back;
  const ez = hit[2] + Math.cos(ang) * back;
  const dx = hit[0] - ex, dz = hit[2] - ez;
  const yaw = Math.atan2(dx, -dz);
  const pitch = Math.atan2(hit[1] + 0.05 - eyeH, Math.hypot(dx, dz));
  __sdfGame.setPose(ex, ez, yaw, pitch, 0);
  return { ok: true, ex, ez, yaw, pitch };
})()`);
if (!posed.ok) fail('no close-up pose found');
await evaluate('__sdfGame.step(2)');
await shot('crater-closeup');
await shot('crater-closeup-2');

// absorb-0 discriminator: trans=1, so gutFrac 1 reads PALE SALMON and
// gutFrac 0 stays dark maroon. One shot decides whether the mask reaches the
// surface pass at all. Restore the shipped absorb afterwards.
log.absorb0 = await evaluate('__sdfGame.setGooTuning({ absorb: 0 })');
await evaluate('__sdfGame.step(1)');
await shot('rope-absorb0-discriminator');
await evaluate('__sdfGame.setGooTuning({ absorb: 1.6 })');
await evaluate('__sdfGame.step(1)');

// organAmp 0 close-up of the SAME crater: organ prims must read as plain bone.
await evaluate('__sdfGame.setWoundTuning({ organAmp: 0 })');
await evaluate('__sdfGame.step(1)');
await shot('crater-closeup-organamp0');
await evaluate('__sdfGame.setWoundTuning({ organAmp: 1 })');

// CHEST close-up on another body: the crater floor must read as ribs.
const chest = await evaluate(`(() => {
  const eyeH = 1.62;
  for (const z of __sdfGame.zombies()) {
    if (z.id === ${gut.id}) continue;
    for (const aimY of [1.32, 1.28, 1.35]) {
      for (const dist of [1.5, 1.4, 1.7, 2.0]) {
        for (const ang of [0, 0.25, -0.25]) {
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
          if (last?.cavity === true) return { id: z.id, hit };
        }
      }
    }
  }
  return null;
})()`);
if (!chest) fail('no qualifying chest wound staged');
console.log(`chest wound on body ${chest.id} at`, chest.hit.map(v => +v.toFixed(2)));
log.chest = { id: chest.id, hit: chest.hit };
await evaluate('__sdfGame.step(2)');
const chestPose = await evaluate(`(() => {
  const hit = ${JSON.stringify(chest.hit)};
  const eyeH = 1.62;
  // No predictor validation here: the ray is aimed INTO an existing crater,
  // and a carved bowl can deflect or swallow it even though the camera is
  // 1.1-1.7 m from the wound. Take the first candidate pose.
  const back = 1.3, ang = 0;
  const ex = hit[0] + Math.sin(ang) * back;
  const ez = hit[2] + Math.cos(ang) * back;
  const dx = hit[0] - ex, dz = hit[2] - ez;
  const yaw = Math.atan2(dx, -dz);
  const pitch = Math.atan2(hit[1] + 0.05 - eyeH, Math.hypot(dx, dz));
  __sdfGame.setPose(ex, ez, yaw, pitch, 0);
  return { ok: true, ex, ez, yaw, pitch };
})()`);
if (!chestPose.ok) fail('no chest close-up pose');
await evaluate('__sdfGame.step(2)');
await shot('chest-closeup');
await shot('chest-closeup-2');

writeFileSync(`${OUT}/${TAG}-log.json`, JSON.stringify(log, null, 2));
console.log(`\nOK — log ${OUT}/${TAG}-log.json`);
ws.close();
process.exit(0);
