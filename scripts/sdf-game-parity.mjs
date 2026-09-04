// scripts/sdf-game-parity.mjs — seam-off pixel-parity gate for the
// flat-albedo seam (close-up diagnostics task 1, 2026-09-04).
//
// THE INSTRUMENT, AND WHY IT IS A MARCH-TARGET READBACK AND NOT A SCREENSHOT.
// The gate the task sets is "pixel-identical to main on a frozen capture,
// both rooms". A viewport screenshot cannot be byte-stable across boots on
// this page: the dungeon accent lights' flicker reads performance.now()
// (game-main, the flickerLights block) with no freeze gate, so two boots
// always differ in the POLYGONAL pixels — noise that has nothing to do with
// the seam under test. The seam modifies the MARCH fragment, so the march
// target is both the sharper instrument and a deterministic one: with the
// page booted ?frozen=1 the actors never step, view.setTime never advances,
// and every march uniform is a pure function of the staged pose.
//
// WHAT IT CAPTURES, per room:
//   roomN            — seam off (the parity payload)
//   roomN-repeat     — same state again after 2 steps (determinism proof)
//   roomN-flat       — seam ON (must differ: the seam must actually cut)
//   roomN-off-again  — seam off again (must equal roomN: live toggle restores)
//   room1-wounded    — 3 stamped wounds, seam off
//   room1-wounded-flat / room1-wounded-off — same dance, wounded
//
// Usage: node scripts/sdf-game-parity.mjs <vitePort> <cdpPort> <outJson>
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5377);
const CDP = Number(process.argv[3] ?? 9377);
const OUT = process.argv[4] ?? '/tmp/sdf-closeup/parity.json';
const W = 1280, H = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (10 min)'); process.exit(3); }, 600_000).unref();

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
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, timeout: 120_000,
  });
  if (r.result?.exceptionDetails) fail(`page threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// March-target capture, hashed IN-PAGE (a Float32Array would serialize
// through returnByValue as an object with 2.3M numeric keys — the summary
// must be computed on the page and only the digest sent). FNV-1a over the
// raw bytes plus a couple of cheap summaries; a one-ULP change flips the
// hash, which is the point.
const capture = () => evaluate('window.__sdfGameDebug.hashMarchTarget()');

/**
 * The page-side helper the capture needs. Installed once per boot via the
 * __sdfGame.installDebugProbe() seam (game-main): hashMarchTarget() does the
 * padded-row readback (WebGPU aligns bytesPerRow to 256 — walking w*h*4
 * reads misaligned rows, the exact plausible-but-wrong-number trap
 * occupancy() documents) and the FNV hash on the page.
 */
await evaluate('__sdfGame.installDebugProbe()');

const url = `http://localhost:${VITE}/sdf-game.html?frozen=1`;
console.log(`parity ${url}`);
await send('Page.navigate', { url });
let backend = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
  if (backend) break;
}
if (!backend) fail('game page never booted');
if (backend !== 'webgpu') fail(`backend is ${backend}, not webgpu`);
await sleep(2500); // shader compile + first-use pipeline stalls settle

const stage = (room) => evaluate(`(async () => {
  __sdfGame.teleport(${room});
  const z = __sdfGame.zombies().find(z => z.room === ${room});
  if (!z) return null;
  // Fixed diagnostic pose: eye-level camera 1.3 m in front of the body's
  // spawn point, pitched at its chest. No coverage search here — parity
  // wants a FIXED pose, not a best one.
  const eyeH = 1.62, d = 1.3, aimY = 1.0;
  const ex = z.pos[0], ez = z.pos[2] + d;
  const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
  const yaw = Math.atan2(dx, -dz);
  const pitch = Math.atan2(aimY - eyeH, Math.hypot(dx, dz));
  __sdfGame.setPose(ex, ez, yaw, pitch, 0);
  __sdfGame.freeze(true);
  __sdfGame.step(30);
  return { body: z.id, pos: z.pos };
})()`);

const stampWounds = () => evaluate(`(async () => {
  __sdfGame.setWoundTuning({ spillChance: 0 });
  const eyeH = 1.62;
  const hits = [];
  for (const [dyaw, dpitch, kind] of [
    [0, 0, 'slug'], [0.12, 0.05, 'pellet'], [-0.12, -0.05, 'pellet'],
  ]) {
    const base = __sdfGame.pose();
    const yaw = base.yaw + dyaw, pitch = base.pitch + dpitch;
    __sdfGame.setPose(base.pos[0], base.pos[2], yaw, pitch, 0);
    const p = __sdfGame.predictSlugHit();
    if (p.actorId < 0 || !p.hit) continue;
    __sdfGame.stampWoundAt(p.origin[0], p.origin[1], p.origin[2],
      p.dir[0], p.dir[1], p.dir[2], kind, p.actorId);
    hits.push({ kind, at: p.hit, actorId: p.actorId });
  }
  __sdfGame.step(5);
  const wl = hits.length ? __sdfGame.zombie(hits[0].actorId)?.woundList().length : null;
  return { stamped: hits.length, wounds: wl, bleed: __sdfGame.bleed };
})()`);

const results = { meta: { url, W, H, when: new Date().toISOString() }, captures: {} };
async function dance(room) {
  const s = await stage(room);
  if (!s) fail(`no body in room ${room}`);
  results.captures[`room${room}-stage`] = s;
  results.captures[`room${room}`] = await capture();
  await evaluate('__sdfGame.step(2)');
  results.captures[`room${room}-repeat`] = await capture();
  await evaluate('__sdfGame.setFlatAlbedo(true)');
  await evaluate('__sdfGame.step(2)');
  results.captures[`room${room}-flat`] = await capture();
  await evaluate('__sdfGame.setFlatAlbedo(false)');
  await evaluate('__sdfGame.step(2)');
  results.captures[`room${room}-off-again`] = await capture();
  if (room === 1) {
    results.captures[`room${room}-wound-stamp`] = await stampWounds();
    results.captures[`room${room}-wounded`] = await capture();
    await evaluate('__sdfGame.setFlatAlbedo(true)');
    await evaluate('__sdfGame.step(2)');
    results.captures[`room${room}-wounded-flat`] = await capture();
    await evaluate('__sdfGame.setFlatAlbedo(false)');
    await evaluate('__sdfGame.step(2)');
    results.captures[`room${room}-wounded-off-again`] = await capture();
  }
}

await dance(1);
await dance(2);

// ---- verdicts the script can state itself --------------------------------
const c = results.captures;
const eq = (a, b) => c[a] && c[b] && c[a].hash === c[b].hash;
results.verdict = {
  deterministicWithinBoot: eq('room1', 'room1-repeat'),
  seamOffInertClean: eq('room1', 'room1-off-again'),
  seamOffInertWounded: eq('room1-wounded', 'room1-wounded-off-again'),
  seamOnActuallyCutsClean: !eq('room1', 'room1-flat'),
  seamOnActuallyCutsWounded: !eq('room1-wounded', 'room1-wounded-flat'),
};
console.log(JSON.stringify(results.verdict, null, 2));

writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`wrote ${OUT}`);
for (const [k, v] of Object.entries(results.captures)) {
  if (v && v.hash) console.log(`  ${k}: ${v.hash} (nz ${v.nonZero})`);
}
await fetch(`http://localhost:${CDP}/json/close/${tab.id}`);
process.exit(results.verdict.seamOffInertClean && results.verdict.seamOffInertWounded
  && results.verdict.seamOnActuallyCutsClean && results.verdict.deterministicWithinBoot ? 0 : 1);
