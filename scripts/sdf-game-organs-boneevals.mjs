// scripts/sdf-game-organs-boneevals.mjs — ORGANS counter delta (task 6 step 3).
//
// Stages the gore-r3 baseline wound set (12 slug wounds across 4 of 10 bodies,
// 3 per body at staggered heights) and reads __sdfGame.boneEvals() — the
// COUNTER, not the clock, because the timing bench cannot resolve the bone
// fold (+0.0% under a 4% spread is not a measurement).
//
// Run once per build with everything else identical (same recipe, fresh page
// per run, alternating legs): organs add ~8 prims to the bone array, so every
// ray inside a wound halo pays (17+k)/17 for them. The expected delta is the
// PRIM COUNT, and the plan predicts roughly +45%.
//
// --amp-check additionally reads the counter again at organAmp 0 on the same
// staged set: organAmp only gates MATERIAL, so the counter must not move.
// That is what proves the delta is the prims, not the shading.
//
// Usage: node scripts/sdf-game-organs-boneevals.mjs <vitePort> <cdpPort> <outJson> <tag> [--amp-check]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5471);
const CDP = Number(process.argv[3] ?? 9297);
const OUT = process.argv[4] ?? `/tmp/organs-boneevals-${Date.now()}.json`;
const TAG = process.argv[5] ?? 'run';
const AMP_CHECK = process.argv.includes('--amp-check');
const BODIES = 4;
const WOUNDS_PER_BODY = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
// WATCHDOG: this script has hung silently before (a stalled CDP endpoint with
// no timeout anywhere). 6 minutes is generous for boot + 12 stamps + 2 reads;
// past that, die LOUD so the loop moves on instead of squatting a tab.
setTimeout(() => { console.error('FAIL: watchdog (6 min) — killing a hung run'); process.exit(3); }, 360_000).unref();

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

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

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
const zcount = await evaluate('__sdfGame.zombies().length');
if (!zcount) fail('no zombies spawned');

const log = { tag: TAG, ampCheck: AMP_CHECK };

// Freeze the wanderers so the staged wounds hold their halos through the read.
await evaluate('__sdfGame.freeze(true)');
await evaluate('__sdfGame.step(2)');

// Stage 12 slugs across up to 4 bodies (walk the zombie list; skip a body
// that cannot be aimed) — 3 per body, staggered height and yaw so the craters
// do not stack into one hole. The predictor CONFIRMS each aim (gravity + yaw);
// a stamp that misses its predicted point is logged. Same recipe on both
// builds is what makes the counter legs comparable.
const eyeH = 1.62;
const landed = [];
const misses = [];
const perBody = new Map();
const DIST = [2.4, 2.8, 2.0, 3.2];
const ANG = [0, 0.06, -0.06, 0.12, -0.12, 0.2, -0.2, 0.35, -0.35];
for (let bi = 0; bi < 10 && landed.length < 12; bi++) {
  for (let wj = 0; wj < WOUNDS_PER_BODY && landed.length < 12; wj++) {
    const res = await evaluate(`(() => {
      const zs = __sdfGame.zombies();
      const z = zs[${bi}];
      if (!z) return null;
      const eyeH = ${eyeH};
      const aimY = 1.05 + (${wj} - 1) * 0.05;   // 1.00 / 1.05 / 1.10 — gut band
      for (const dist of ${JSON.stringify(DIST)}) {
        for (const ang of ${JSON.stringify(ANG)}) {
          const ex = z.pos[0] + Math.sin(ang) * dist;
          const ez = z.pos[2] + Math.cos(ang) * dist;
          const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
          const yaw = Math.atan2(dx, -dz);
          const dy = (z.pos[1] ?? 0) + aimY - eyeH;
          const pitch = Math.atan2(dy, Math.hypot(dx, dz));
          __sdfGame.setPose(ex, ez, yaw, pitch, 0);
          const p = __sdfGame.predictSlugHit();
          if (p.actorId === z.id && p.hit) {
            const hit = __sdfGame.stampWoundAt(p.origin[0], p.origin[1], p.origin[2],
              p.dir[0], p.dir[1], p.dir[2], 'slug', p.actorId);
            if (!hit) return { staged: false };
            const miss = Math.hypot(p.hit[0] - hit[0], p.hit[1] - hit[1], p.hit[2] - hit[2]);
            return { staged: true, body: z.id, missM: miss };
          }
        }
      }
      return { staged: false };
    })()`);
    if (!res || !res.staged) { misses.push({ bi, wj, res }); continue; }
    perBody.set(res.body, (perBody.get(res.body) ?? 0) + 1);
    landed.push(res);
  }
}
log.staged = landed.length;
log.bodies = [...perBody.entries()].map(([id, n]) => ({ id, wounds: n }));
log.misses = misses;
console.log(`staged ${landed.length}/12 slugs on ${perBody.size} bodies; max miss ${(Math.max(...landed.map(l => l.missM)) * 100).toFixed(2)} cm`);
if (landed.length !== 12) fail(`only ${landed.length} of 12 slugs landed`);

await evaluate('__sdfGame.step(3)');
log.evals = await evaluate('__sdfGame.boneEvals()');
console.log(`${TAG} bonesTotal ${log.evals.bonesTotal}  meanPerPayingRay ${(+log.evals.meanPerPayingRay).toFixed(1)}  payingShare ${(+log.evals.payingShare).toFixed(3)}`);

if (AMP_CHECK) {
  await evaluate('__sdfGame.setWoundTuning({ organAmp: 0 })');
  await evaluate('__sdfGame.step(1)');
  log.evalsAmp0 = await evaluate('__sdfGame.boneEvals()');
  console.log(`${TAG} organAmp 0: bonesTotal ${log.evalsAmp0.bonesTotal}  (must match amp-1 read: amp gates material only)`);
}

writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log(`OK — ${OUT}`);
// Node will NOT exit on its own while the CDP WebSocket is held open — and a
// lingering process cost a leg of the A/B to the watchdog before this line
// existed. Leave deterministically.
ws.close();
process.exit(0);
