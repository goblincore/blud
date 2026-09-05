// scripts/sdf-chunk-bake-look.mjs — the LOOK capture for the settled-chunk
// bake (close-up task 5): the SAME deterministic severed-limb scene staged
// twice — bake OFF, then bake ON — and photographed from the same camera
// offset off the same piece. The staging is deterministic (the parity gate
// proves identical march-target hashes across boots), so any pixel
// difference between the two captures is the bake itself.
//
// Usage: node scripts/sdf-chunk-bake-look.mjs <vitePort> <cdpPort> [outDir]
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5377);
const CDP = Number(process.argv[3] ?? 9377);
const OUT = process.argv[4] ?? '/tmp/sdf-chunk-bake';
const W = 1280, H = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (15 min)'); process.exit(3); }, 900_000).unref();
mkdirSync(OUT, { recursive: true });

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {}
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
const evaluate = async (expression, timeoutMs = 180_000) => {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs,
  });
  if (r.result?.exceptionDetails) fail(`page threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 300)}`);
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

async function boot(bakeOn) {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(250);
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?frozen=1` });
  let backend = null;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
    if (backend) break;
  }
  if (!backend) fail('page never booted');
  if (backend !== 'webgpu') fail(`backend is ${backend}`);
  await sleep(2500);
  await evaluate(`(() => {
    __sdfGame.setOccluder(false); __sdfGame.setCone(false); __sdfGame.setFxaa(true);
    __sdfGame.setSdfScale(1.0); __sdfGame.setAdaptive(false); __sdfGame.setMarchSteps(96);
    __sdfGame.setShell(true); __sdfGame.setRelax(1.0); __sdfGame.setBleed(true);
    __sdfGame.setWoundTuning({ spillChance: 0 }); __sdfGame.setHullExitBound(false);
    __sdfGame.setDepthGate(false); __sdfGame.setHalfRate(false); __sdfGame.setFlatAlbedo(false);
    __sdfGame.setChunkBake(${bakeOn ? 'true' : 'false'});
    return 1;
  })()`);
}

/** The deterministic sever staging (identical to the gate's). */
const stageChunks = () => evaluate(`(async () => {
  __sdfGame.teleport(3);
  const z = __sdfGame.zombies().find(q => q.room === 3);
  __sdfGame.freeze(true);
  const eyeH = 1.62, d = 2.2;
  const ex = z.pos[0], ez = z.pos[2] + d;
  __sdfGame.setPose(ex, ez, 0, 0, 0);
  __sdfGame.step(30);
  const posed = __sdfGame.zombie(z.id).posed();
  const torsoC = posed.clusters.find(c => c.limb === 'torso')?.center;
  const roots = {};
  for (const p of posed.prims) {
    const limb = String(p.limb ?? '');
    if (!/arm|leg/i.test(limb)) continue;
    if (p.op === 'sub' || p.op === 'groove') continue;
    for (const end of [p.a, p.b]) {
      const dd = Math.hypot(end[0] - torsoC[0], end[1] - torsoC[1], end[2] - torsoC[2]);
      if (!roots[limb] || dd < roots[limb].d) roots[limb] = { d: dd, at: [end[0], end[1], end[2]] };
    }
  }
  let fired = 0;
  const total = () => { const s = __sdfGame.chunkStats(); return s.live + s.baked; };
  const before = total();
  for (const limb of Object.keys(roots).sort()) {
    if (total() - before >= 2) break;
    const at = roots[limb].at;
    for (let n = 0; n < 10; n++) {
      if (total() - before >= 2) break;
      const dx = at[0] - ex, dy2 = at[1] - eyeH, dz = at[2] - ez;
      const l = Math.hypot(dx, dy2, dz) || 1;
      __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.asin(dy2 / l), 0);
      __sdfGame.step(2);
      const ok = __sdfGame.fireSlug();
      fired++;
      __sdfGame.step(ok ? 30 : 15);
    }
  }
  __sdfGame.step(35);
  const s = __sdfGame.chunkStats();
  return { fired, chunks: s.live + s.baked, baked: s.baked };
})()`);

for (const mode of ['marched', 'baked']) {
  console.log(`boot (${mode})`);
  await boot(mode === 'baked');
  const staged = await stageChunks();
  console.log(`  staged: ${JSON.stringify(staged)}`);
  if (staged.chunks < 2) fail(`sever staging produced ${staged.chunks} chunks`);

  // Settle (bake on) / plain wait (off), then park the camera at a FIXED
  // offset from piece 0: 0.55 m toward the body, eye at the piece's height
  // + 0.18, pitched gently down — the piece fills ~a quarter of the frame.
  const framed = await evaluate(`(async () => {
    const s = __sdfGame.chunkStats();
    const p = (s.pieces[0] ?? s.livePieces[0]);
    if (!p) return { error: 'no pieces (baked or live)' };
    const z = __sdfGame.zombies().find(q => q.room === 3);
    const dx = z.pos[0] - p.centre[0], dz = z.pos[2] - p.centre[2];
    const l = Math.hypot(dx, dz) || 1;
    const ex = p.centre[0] - dx / l * 0.55;
    const ez = p.centre[2] - dz / l * 0.55;
    const eyeY = p.centre[1] + 0.18;
    const ty = p.centre[1] - 0.02;
    __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.atan2(ty - eyeY, 0.55), 0);
    __sdfGame.step(2);
    return { piece: p, pos: __sdfGame.pose() };
  })()`);
  if (framed.error) fail(framed.error);
  console.log(`  piece: ${JSON.stringify(framed.piece)}  camera: ${JSON.stringify(framed.pos)}`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (!shot.result?.data) fail('screenshot failed');
  writeFileSync(`${OUT}/look-${mode}.png`, Buffer.from(shot.result.data, 'base64'));
  console.log(`  wrote look-${mode}.png`);
}
console.log('done');
