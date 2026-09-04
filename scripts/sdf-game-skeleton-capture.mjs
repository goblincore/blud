// scripts/sdf-game-skeleton-capture.mjs — skeleton review captures on the
// game page (2026-09-03 zombie skeleton re-author).
//
// Two things the owner judges by looking, so two kinds of frame:
//   1. SKIN frames — bone tubes ON, flesh visible, from the front and side at
//      ~1.6 m: nothing pale may show through intact skin.
//   2. SKELETON frames — same camera, every zombie's flesh hidden
//      (`zombie(id).view.object.visible = false`), so the tubes alone are
//      judged against the reference torso: twelve rib hoops, clavicles, a
//      pelvis with iliac wings.
// The scene is frozen (`freeze(true)`) and hand-stepped so the pose does not
// drift between the paired frames.
//
// Usage: node scripts/sdf-game-skeleton-capture.mjs <vitePort> <cdpPort> <outDir>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5261);
const CDP = Number(process.argv[3] ?? 9261);
const OUT = process.argv[4] ?? 'docs/dev-notes/2026-09-03-zombie-skeleton';
const W = 1280, H = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (6 min)'); process.exit(3); }, 360_000).unref();

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT', signal: AbortSignal.timeout(15000) })
).json();
const closeUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', closeUrl], { stdio: 'ignore' }); } catch {} });

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const pageErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 60_000 });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

mkdirSync(OUT, { recursive: true });
async function shot(name) {
  await evaluate('__sdfGame.step(3)');
  await sleep(400);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const p = `${OUT}/${name}.png`;
  writeFileSync(p, Buffer.from(s.result.data, 'base64'));
  console.log(`  shot ${p}`);
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

await evaluate('__sdfGame.freeze(true)');
await evaluate('__sdfGame.step(2)');
await evaluate('__sdfGame.setBoneMesh(true)');
if (!(await evaluate('__sdfGame.boneMesh'))) fail('setBoneMesh(true) did not stick');

// Pick a body with a clear line of sight from the front AND the side at
// ~1.7 m. YAW CONVENTION (game-main camera.lookAt): forward is
// (sin yaw, -cos yaw). A zombie's own facing follows the same rule, so
// "in front of it" is its pos + facing * dist.
const pick = await evaluate(`(() => {
  const eyeH = 1.62, AIM_Y = 1.15, DIST = 1.7;
  const views = (z) => {
    const fwd = [Math.sin(z.yaw), -Math.cos(z.yaw)];
    const right = [Math.cos(z.yaw), Math.sin(z.yaw)];
    return {
      front: [z.pos[0] + fwd[0] * DIST, z.pos[2] + fwd[1] * DIST],
      side:  [z.pos[0] + right[0] * DIST, z.pos[2] + right[1] * DIST],
      back:  [z.pos[0] - fwd[0] * DIST, z.pos[2] - fwd[1] * DIST],
    };
  };
  const aimFrom = (z, ex, ez) => {
    const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
    const yaw = Math.atan2(dx, -dz);
    const pitch = Math.atan2((z.pos[1] ?? 0) + AIM_Y - eyeH, Math.hypot(dx, dz));
    __sdfGame.setPose(ex, ez, yaw, pitch, 0);
    // The predictor fires from the MUZZLE (free-aim, main 2026-09-03), and
    // the viewmodel's transform is one frame behind setPose — without a step
    // the ray leaves from wherever the gun was last drawn.
    __sdfGame.step(1);
    const p = __sdfGame.predictSlugHit();
    return p.actorId === z.id ? { x: ex, z: ez, yaw, pitch } : null;
  };
  for (const z of __sdfGame.zombies()) {
    const v = views(z);
    const front = aimFrom(z, ...v.front);
    const side = aimFrom(z, ...v.side);
    const back = aimFrom(z, ...v.back);
    if (front && side) return { id: z.id, room: z.room, pos: z.pos, yaw: z.yaw, front, side, back };
  }
  return null;
})()`);
if (!pick) fail('no zombie with a clear front + side view at 1.7 m');
console.log(`body ${pick.id} (room ${pick.room}) at`, pick.pos.map(v => +v.toFixed(2)), 'yaw', +pick.yaw.toFixed(2));

const pose = async (v) => evaluate(`__sdfGame.setPose(${v.x}, ${v.z}, ${v.yaw}, ${v.pitch}, 0)`);

// 1. Skin frames, tubes on.
await pose(pick.front); await shot('01-skin-front');
await pose(pick.side); await shot('02-skin-side');

// 2. Skeleton frames: hide every body's flesh.
await evaluate(`__sdfGame.zombies().forEach(z => { const q = __sdfGame.zombie(z.id); if (q) q.view.object.visible = false; })`);
await pose(pick.front); await shot('03-skeleton-front');
await pose(pick.side); await shot('04-skeleton-side');
if (pick.back) { await pose(pick.back); await shot('05-skeleton-back'); }
// Chest close-up, front, 1.1 m.
{
  const fwd = [Math.sin(pick.yaw), -Math.cos(pick.yaw)];
  const ex = pick.pos[0] + fwd[0] * 1.1, ez = pick.pos[2] + fwd[1] * 1.1;
  const dx = pick.pos[0] - ex, dz = pick.pos[2] - ez;
  const yaw = Math.atan2(dx, -dz);
  const pitch = Math.atan2((pick.pos[1] ?? 0) + 1.2 - 1.62, Math.hypot(dx, dz));
  await pose({ x: ex, z: ez, yaw, pitch }); await shot('06-skeleton-chest-closeup');
}
// Side close-up, 1.1 m, aimed at the flank of the cage.
{
  const right = [Math.cos(pick.yaw), Math.sin(pick.yaw)];
  const ex = pick.pos[0] + right[0] * 1.1, ez = pick.pos[2] + right[1] * 1.1;
  const dx = pick.pos[0] - ex, dz = pick.pos[2] - ez;
  const yaw = Math.atan2(dx, -dz);
  const pitch = Math.atan2((pick.pos[1] ?? 0) + 1.15 - 1.62, Math.hypot(dx, dz));
  await pose({ x: ex, z: ez, yaw, pitch }); await shot('07-skeleton-side-closeup');
}
const tubes = await evaluate('__sdfGame.boneTubes()');
console.log('boneTubes', JSON.stringify(tubes));
if (tubes.overflowed) fail('bone instancer overflowed');
if (pageErrors.length) console.log('page errors: ' + pageErrors.join(' | '));
process.exit(0);
