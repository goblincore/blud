// scripts/sdf-game-entrails-capture.mjs — ENTRAILS combat-range captures.
//
// Task 8 step 4 of the entrails plan: stage a slug to a standing torso in the
// dungeon and capture at 2-3 m under the beam, through the seam that works:
// predictSlugHit() -> stampWoundAt(..., 'slug', actorId)  (stampWounds is a
// lab-only torso-front grid and cannot stage this).
//
// Judged BY LOOKING — no pixel diffs (this harness has 52-82k px of
// same-build flicker). The page-side guts() seam asserts the rope EXISTS,
// where it hangs, and that the wound carried the cavity flag; the PNGs are
// for the human/agent eye.
//
// Also captures the TEAR: a second qualifying hit detaches the rope (spec §2).
//
// Usage: node scripts/sdf-game-entrails-capture.mjs <vitePort> <cdpPort> <outDir> <tag>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const OUT = process.argv[4] ?? '/tmp/entrails-capture';
const TAG = process.argv[5] ?? 'cap';
const W = 1280, H = 800;

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
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 45000,
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
await send('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: 1, mobile: false,
});

// --- boot -----------------------------------------------------------------
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });
let backend = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
  if (backend) break;
}
if (!backend) fail('game page never booted (__sdfGame absent)');
if (backend !== 'webgpu') fail(`backend is ${backend}, not webgpu`);
await sleep(2000);

const log = {};

// Ship-state readback: viscera must be ON by default (the feature ships on),
// spill at its shipped 0.35, gut droplets at the fused-rope size.
log.tuning0 = await evaluate('__sdfGame.woundTuning');
console.log('tuning at boot:', JSON.stringify(log.tuning0));

// Deterministic rope for the staged shot: spillChance 1 (the slug knob).
await evaluate('__sdfGame.setWoundTuning({ spillChance: 1 })');
log.tuningStaged = await evaluate('__sdfGame.woundTuning.spillChance');
if (log.tuningStaged !== 1) fail(`spillChance did not apply: ${log.tuningStaged}`);

// Freeze the wanderers so the staged body holds its pose through the capture.
await evaluate('__sdfGame.freeze(true)');
await evaluate('__sdfGame.step(2)');

// --- pick a body and stand 2-3 m from it, facing it ------------------------
// YAW CONVENTION (aimAtNearestSurface): forward is (sin yaw, -cos yaw), so
// facing a target at offset (dx, dz) is atan2(dx, -dz). The predictor must
// CONFIRM the aim — a dead-on yaw at the torso can still miss with gravity.
const picked = await evaluate(`(() => {
  const zs = __sdfGame.zombies();
  const eyeH = 1.62;
  for (const z of zs) {
    // candidate eye positions on a ring around the body, 2.0-3.2 m
    for (const dist of [2.4, 2.8, 2.0, 3.2]) {
      for (const ang of [0, 0.7, -0.7, 1.4, -1.4]) {
        const ex = z.pos[0] + Math.sin(ang) * dist;
        const ez = z.pos[2] + Math.cos(ang) * dist;
        const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
        const yaw = Math.atan2(dx, -dz);
        const dy = (z.pos[1] ?? 0) + 1.05 - eyeH;   // aim ~1.05 m: lower torso
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
if (!picked) fail('no zombie could be aimed at 2-3 m — nothing staged');
console.log(`picked body ${picked.z.id} (room ${picked.z.room}) at ${Math.hypot(picked.z.pos[0] - picked.eye.x, picked.z.pos[2] - picked.eye.z).toFixed(2)} m; predicted hit`, picked.pred.hit.map(v => +v.toFixed(2)));
log.picked = picked;

await evaluate('__sdfGame.step(5)');
await shot('before-stamp');

// --- stage the slug ---------------------------------------------------------
const stamped = await evaluate(`(() => {
  const p = __sdfGame.predictSlugHit();
  if (p.actorId < 0 || !p.hit) return null;
  const hit = __sdfGame.stampWoundAt(p.origin[0], p.origin[1], p.origin[2],
    p.dir[0], p.dir[1], p.dir[2], 'slug', p.actorId);
  return { actorId: p.actorId, predicted: p.hit, stamped: hit };
})()`);
if (!stamped || !stamped.stamped) fail(`stampWoundAt hit nothing: ${JSON.stringify(stamped)}`);
const miss = Math.hypot(stamped.predicted[0] - stamped.stamped[0],
  stamped.predicted[1] - stamped.stamped[1], stamped.predicted[2] - stamped.stamped[2]);
console.log(`stamped slug on body ${stamped.actorId}; predictor-vs-stamp miss ${ (miss * 100).toFixed(2) } cm`);
log.stamp = { ...stamped, missCm: miss * 100 };

// --- assert the rope exists -------------------------------------------------
const id = stamped.actorId;
await evaluate('__sdfGame.step(3)');
log.guts0 = await evaluate('__sdfGame.guts()');
const g0 = log.guts0.find(g => g.id === id);
if (!g0 || g0.none) fail(`no rope entry after a spillChance-1 torso slug: ${JSON.stringify(g0)}`);
if (!g0.attached) fail(`rope not attached right after stamp: ${JSON.stringify(g0)}`);
if (g0.nodes !== 10) fail(`rope has ${g0.nodes} nodes, want 10`);
if (g0.droplets !== 10) fail(`rope contributed ${g0.droplets} droplets, want 10`);
if (g0.woundCavity !== true) fail(`rope wound is not a cavity wound: ${JSON.stringify(g0)}`);
console.log('rope live:', JSON.stringify(g0));

// the wound itself must carry cavity:true (the viscera half)
log.wound = await evaluate(`(() => {
  const z = __sdfGame.zombie(${id});
  const ws = z.woundList();
  return ws.map(w => ({ type: w.type, cavity: w.cavity === true, spillCalibre: w.spillCalibre, radius: +w.radius.toFixed(3) }));
})()`);
console.log('wounds:', JSON.stringify(log.wound));
if (!log.wound.some(w => w.cavity && w.spillCalibre === 'slug')) {
  fail('no wound carries cavity+slug marker — viscera and roll both starve');
}

// --- let it settle, confirm it hangs, capture -------------------------------
await evaluate('__sdfGame.step(90)');
log.gutsHang = await evaluate('__sdfGame.guts()');
const gh = log.gutsHang.find(g => g.id === id);
if (!gh.attached) fail(`rope detached while the body stood (phase ${gh.phase}) — collapse?`);
const hang = Math.hypot(gh.tail[0] - gh.head[0], gh.tail[1] - gh.head[1], gh.tail[2] - gh.head[2]);
console.log(`hanging: head ${gh.head.map(v => +v.toFixed(2))} tail ${gh.tail.map(v => +v.toFixed(2))} span ${hang.toFixed(2)} m, droplets ${gh.droplets}, phase ${gh.phase}`);
log.hang = { ...gh, spanM: hang };
await shot('rope-hanging');

// close crop for the viscera read: same pose, but check the crater region
await shot('rope-hanging-2');

// --- the tear ---------------------------------------------------------------
const tear = await evaluate(`(() => {
  const p = __sdfGame.predictSlugHit();
  if (p.actorId !== ${id}) return { skipped: 'predictor now aims at body ' + p.actorId };
  const hit = __sdfGame.stampWoundAt(p.origin[0], p.origin[1], p.origin[2],
    p.dir[0], p.dir[1], p.dir[2], 'slug', ${id});
  return { stamped: hit };
})()`);
log.tear = tear;
await evaluate('__sdfGame.step(3)');
log.gutsTear = await evaluate('__sdfGame.guts()');
const gt = log.gutsTear.find(g => g.id === id);
if (!gt || gt.none) fail('rope entry vanished on tear');
if (gt.attached) fail(`rope still attached after second qualifying hit: ${JSON.stringify(gt)}`);
if (gt.nodes !== 10) fail(`torn rope lost nodes: ${gt.nodes}`);
console.log('torn:', JSON.stringify({ attached: gt.attached, head: gt.head, tail: gt.tail }));
await evaluate('__sdfGame.step(240)');
log.gutsFallen = await evaluate('__sdfGame.guts()');
const gf = log.gutsFallen.find(g => g.id === id);
console.log('fallen:', JSON.stringify({ settled: gf.settled, tail: gf.tail, droplets: gf.droplets }));
log.fallenSettled = gf.settled;
await shot('after-tear-fallen');

writeFileSync(`${OUT}/${TAG}-log.json`, JSON.stringify(log, null, 2));
console.log(`\nOK — log ${OUT}/${TAG}-log.json`);
