// scripts/sdf-gib-head-look.mjs — THE DETACHED HEAD, FOLLOWED AND FRAMED.
//
// 2026-09-16 playtest follow-ups task 2. The rupture rig frames the whole body
// from a fixed standoff, so the head is a small ball and, once the blast throws
// it, leaves the frame. This rig FOLLOWS the head piece: it re-aims the player
// (and therefore the flashlight) at the head chunk's own centre every captured
// frame, so the face is close and lit during the window, in flight, and after
// the piece settles and BAKES. It also reports the face-aware telemetry the
// task asks for (`chunkStats().faceBaked`, the baked piece's own id/centre) so
// the images and the census are read together.
//
// Same two rigging traps the sibling rigs document: `presentedShot()` (not
// Page.captureScreenshot, stale between steps) and a FROZEN loop.
//
// Usage: node scripts/sdf-gib-head-look.mjs <vitePort> <cdpPort> <outDir> [qs]
// Env:
//   HEAD_LOOK_DIST=1.3      standoff from the head, metres
//   HEAD_LOOK_VIEW=front    bearing from the head (front|back|threequarter).
//                           `face` rides the head's OWN quaternion, so the
//                           camera looks straight at the painted face however
//                           the piece tumbles — the only way to judge whether
//                           the face survived flight.
//   HEAD_LOOK_FRAMES=6      flight frames to follow after release
//   HEAD_LOOK_SETTLE=900    max sim steps to wait for the head to bake
//   HEAD_LOOK_VHS=blud      if set, final clear+VHS stills use this preset
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { decodePng } from './lib/demo-presented.mjs';
import { writePng } from './lib/png-write.mjs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const OUT = process.argv[4] ?? '/tmp/gib-head';
const QS = process.argv[5] ?? '';
const DIST = Number(process.env.HEAD_LOOK_DIST ?? 1.3);
const VIEW = process.env.HEAD_LOOK_VIEW ?? 'front';
const FLIGHT = Number(process.env.HEAD_LOOK_FRAMES ?? 6);
const SETTLE = Number(process.env.HEAD_LOOK_SETTLE ?? 900);
const VHS = process.env.HEAD_LOOK_VHS ?? '';
const W = 960, H = 720;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, e) => { ws.onopen = ok; ws.onerror = e; });
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (mm, p = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method: mm, params: p })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
const capture = async () => {
  const b64 = await ev('window.__sdfGame.presentedShot()');
  if (typeof b64 !== 'string' || b64.length < 100) throw new Error('presentedShot() returned nothing usable');
  return Buffer.from(b64, 'base64');
};
const shot = async (name) => {
  const png = await capture();
  writeFileSync(`${OUT}/${name}.png`, png);
  const d = decodePng(png);
  return { name, png, w: d.w, h: d.h };
};

const pageErrors = [];
await send('Runtime.enable');
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params).slice(0, 240));
});
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const url = `http://localhost:${VITE}/sdf-game.html?room=arena&frozen=1&vhs=off&seed=7${QS}`;
console.log(`opening ${url}`);
await send('Page.navigate', { url });
for (let i = 0; i < 240; i++) {
  await sleep(500);
  if (await ev('typeof window.__sdfGame === "object"').catch(() => false)) break;
  if (i === 239) fail('__sdfGame never appeared');
}
for (let i = 0; i < 60; i++) {
  if (await ev('window.__sdfGame.gunReady === true').catch(() => false)) break;
  await sleep(500);
  if (i === 59) fail('the view-model never became ready');
}
for (let i = 0; i < 80; i++) {
  if (await ev('!!window.__warmDone').catch(() => false)) break;
  await sleep(250);
  if (i === 79) console.log('WARNING: __warmDone never appeared; timings may drift');
}
await sleep(600);
await ev('window.__sdfGame.setDemoHold(true)');
await ev('window.__sdfGame.setVhs(null)');
await ev('window.__sdfGame.setLoopRunning(false)');
await ev('window.__sdfGame.step(40)');
await ev('window.__sdfGame.teleport(6)');
await ev('window.__sdfGame.step(1)');

const pick = await ev(`(() => {
  const pp = window.__sdfGame.playerPos();
  const list = window.__sdfGame.actorList().filter(a => a.room === 6 && a.kind === 'zombie');
  if (!list.length) return null;
  list.sort((a, b) =>
    Math.hypot(a.pos[0] - pp[0], a.pos[2] - pp[2]) - Math.hypot(b.pos[0] - pp[0], b.pos[2] - pp[2]));
  return { target: list[0], count: list.length };
})()`);
if (!pick) fail('no zombie in the arena to gib');
const t = pick.target;
const fx = Math.sin(t.yaw), fz = -Math.cos(t.yaw);
const rot = VIEW === 'front' ? 0 : VIEW === 'threequarter' ? (40 * Math.PI / 180) : Math.PI;
const bx = fx * Math.cos(rot) - fz * Math.sin(rot);
const bz = fx * Math.sin(rot) + fz * Math.cos(rot);
// The bearing direction in WORLD space, so the follow frames can reuse it.
const bearing = { x: bx, z: bz };

// The player's eye height is constant; measure it once so the aim pitch is
// right without stepping the world for every reframe.
const eyeY = await ev(`(() => {
  window.__sdfGame.placePlayer({ x: ${t.pos[0] + bx * DIST}, z: ${t.pos[2] + bz * DIST}, yaw: 0, pitch: 0 });
  window.__sdfGame.step(1);
  return window.__sdfGame.cameraWorld()[1];
})()`);
const yawTo = (px, pz, tx, tz) => Math.atan2(tx - px, -(tz - pz));
const pitchTo = (px, py, pz, tx, ty, tz) => Math.atan2(ty - py, Math.hypot(tx - px, tz - pz));
/** Rotate a vector by quaternion [x,y,z,w]. */
const rotQ = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
};
const frame = async (c, opts = {}) => {
  const standoff = opts.standoff ?? DIST;
  let dir = bearing;
  if (VIEW === 'face' && opts.quat) {
    // Camera on the head's OWN forward: the face is on the head's local +z
    // (faceCfg.z = 1), so this looks straight at it however it tumbles.
    const f = rotQ(opts.quat, [0, 0, 1]);
    const hl = Math.hypot(f[0], f[2]);
    dir = hl > 1e-3 ? { x: f[0] / hl, z: f[2] / hl } : bearing;
  }
  const px = c[0] + dir.x * standoff, pz = c[2] + dir.z * standoff;
  const yaw = yawTo(px, pz, c[0], c[2]);
  const pitch = pitchTo(px, eyeY, pz, c[0], c[1], c[2]);
  await ev(`window.__sdfGame.placePlayer(${JSON.stringify({ x: px, z: pz, yaw, pitch })})`);
  await ev('window.__sdfGame.setLoopRunning(false)');
  await ev('window.__sdfGame.step(1)');
};

// Onset: framed on the body's head, labelled for the reviewer.
await frame([t.pos[0], t.pos[1] + 1.6, t.pos[2]], { standoff: DIST });
const onset = await shot('head-onset');
console.log(`onset captured ${onset.w}x${onset.h}; target id ${t.id} view ${VIEW}`);

await ev(`window.__sdfGame.detonate(${t.pos[0]}, ${t.pos[1] + 0.6}, ${t.pos[2]})`);
await ev('window.__sdfGame.setLoopRunning(false)');

const headIndexOf = async () => {
  const d = await ev('window.__sdfGame.dynamite()');
  const i = (d.lastGibParts ?? []).indexOf('head');
  return { index: i, parts: d.lastGibParts ?? [], tier: d.lastGibTier, spawned: d.lastGibSpawned };
};
let headIdx = -1;
let headId = -1;
let releaseAt = -1;
const set = [];
for (let i = 0; i < FLIGHT + 24; i++) {
  await ev('window.__sdfGame.setLoopRunning(false)');
  await ev('window.__sdfGame.step(1)');
  const d = await ev('window.__sdfGame.dynamite()');
  const stats = await ev('window.__sdfGame.chunkStats()');
  if (headIdx < 0 && stats.live > 0) {
    const h = await headIndexOf();
    headIdx = h.index;
    headId = stats.livePieces[headIdx]?.id ?? -1;
    releaseAt = i;
    console.log(`release: tier ${h.tier} spawned ${h.spawned}; head index ${headIdx} id ${headId} of [${h.parts.join(' ')}]`);
    if (headIdx < 0) fail('the head piece is not in the spawn list');
  }
  // Track by ID, not index: a piece that bakes before the head shifts indices.
  const live = stats.livePieces.find(p => p.id === headId);
  if (headIdx >= 0 && live) {
    const c = live.centre;
    await frame(c, { quat: live.quat });
    const s = await shot(`head-flight-${String(i).padStart(2, '0')}`);
    set.push({ label: `flight-${i}`, file: `head-flight-${String(i).padStart(2, '0')}.png`, centre: c, live: stats.live, baked: stats.baked });
    if (i % 2 === 0) console.log(`  flight +${i}: head ${c.map(v => v.toFixed(2)).join(', ')} live ${stats.live} baked ${stats.baked}`);
  } else if (headIdx >= 0) {
    console.log(`  head left the live list at +${i} (tearing ${d.tearing}, live ${stats.live})`);
    break;
  }
  if (releaseAt >= 0 && i - releaseAt >= FLIGHT) break;
}

// Settle + bake, keeping the camera on the head's live position until it is
// baked, then on the baked centre.
let baked = null;
let steps = 0;
let headQuat = null;
while (steps < SETTLE) {
  const stats = await ev('window.__sdfGame.chunkStats()');
  const live = stats.livePieces.find(p => p.id === headId) ?? null;
  baked = stats.pieces.find(p => p.id === headId && p.face) ?? stats.pieces.find(p => p.face) ?? null;
  if (baked && !live) break;
  const at = live ? live.centre : baked ? baked.centre : null;
  if (live) headQuat = live.quat;
  if (at) await frame(at, { quat: live?.quat ?? baked?.quat ?? headQuat });
  await ev('window.__sdfGame.setLoopRunning(false)');
  await ev(`window.__sdfGame.step(20)`);
  await sleep(150); // let the bake worker answer between chunks
  steps += 20;
}
const stats = await ev('window.__sdfGame.chunkStats()');
baked = stats.pieces.find(p => p.id === headId && p.face) ?? stats.pieces.find(p => p.face) ?? null;
const bakeInfo = stats.lastBakeInfo;
console.log(`settle: ${steps} steps; live ${stats.live} baked ${stats.baked} faceBaked ${stats.faceBaked}`
  + ` lastBakeMs ${stats.lastBakeMs?.toFixed?.(1)} swapFrame ${stats.lastBakeSwapFrame}`);
if (bakeInfo) console.log(`  lastBakeInfo centre ${(bakeInfo.radius ?? 0).toFixed(3)}m r, face piece ${baked ? 'yes' : 'no'}`);

let bakedShot = null;
if (baked) {
  await frame(baked.centre, { quat: baked.quat ?? headQuat });
  bakedShot = await shot('head-baked-clear');
  console.log(`baked head framed at ${baked.centre.map(v => v.toFixed(2)).join(', ')} r ${baked.radius.toFixed(3)}`);
  if (VHS) {
    await ev(`window.__sdfGame.setVhs(${JSON.stringify(VHS)})`);
    await ev('window.__sdfGame.setLoopRunning(false)');
    await ev('window.__sdfGame.step(1)');
    await shot('head-baked-vhs');
    await ev('window.__sdfGame.setVhs(null)');
    await ev('window.__sdfGame.setLoopRunning(false)');
    await ev('window.__sdfGame.step(1)');
  }
} else {
  console.log('WARNING: no baked face piece appeared within the settle budget');
}

// A labeled contact sheet of the followed flight frames, cropped to the head.
const picks = set.filter((_, i) => i % Math.max(1, Math.ceil(set.length / 8)) === 0).slice(0, 8);
if (picks.length) {
  const TILE = 200;
  const pngs = picks.map(p => decodePng(readFileSync(`${OUT}/${p.file}`)));
  const cols = 4, rows = Math.ceil(pngs.length / cols);
  const out = new Uint8Array(TILE * cols * TILE * rows * 4);
  for (let i = 0; i < pngs.length; i++) {
    const p = pngs[i];
    const cx = Math.round(p.w / 2 - TILE / 2), cy = Math.round(p.h / 2 - TILE / 2);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const si = ((cy + y) * p.w + (cx + x)) * 4;
      const dx = (i % cols) * TILE + x, dy = Math.floor(i / cols) * TILE + y;
      const di = (dy * TILE * cols + dx) * 4;
      out[di] = p.data[si]; out[di + 1] = p.data[si + 1]; out[di + 2] = p.data[si + 2]; out[di + 3] = 255;
    }
  }
  writeFileSync(`${OUT}/head-flight-sheet.png`, writePng(TILE * cols, TILE * rows, out));
  console.log(`sheet: ${OUT}/head-flight-sheet.png (${picks.length} tiles)`);
}

writeFileSync(`${OUT}/head-telemetry.json`, JSON.stringify({
  view: VIEW, dist: DIST, qs: QS, vhs: VHS, targetId: t.id,
  release: { headIdx, tier: (await headIndexOf()).tier, parts: (await headIndexOf()).parts },
  flight: set,
  settle: { steps, live: stats.live, baked: stats.baked, faceBaked: stats.faceBaked,
    lastBakeMs: stats.lastBakeMs, lastBakeSwapFrame: stats.lastBakeSwapFrame },
  baked: baked ? { id: baked.id, centre: baked.centre, radius: baked.radius, face: baked.face } : null,
  census: await ev('window.__sdfGame.chunkCensus()'),
  pageErrors,
}, null, 2));

if (pageErrors.length) {
  console.error(`PAGE ERRORS (${pageErrors.length})`); for (const e of pageErrors.slice(0, 5)) console.error('  ' + e);
  fail('the page reported errors');
}
console.log(`PASS: head look written to ${OUT}`);
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
