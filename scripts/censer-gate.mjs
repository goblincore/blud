// scripts/censer-gate.mjs — the censer flail lands, carves and severs in the game
// (Task 9 of docs/superpowers/plans/2026-09-26-censer-flail.md; notes and photos in
// docs/dev-notes/2026-09-26-censer/NOTES.md).
//
// Headless gate on /sdf-game.html?seed=1&vhs=off&loader=0 (the sandbox; its arena, room 6,
// holds 8 zombies — the default ROOM is whichever room holds the most). Zombies are
// frozen in place (__sdfGame.freeze), hit-stop is off (frame counts stay
// deterministic), and strokes are driven with __sdfGame.censer.press/release while the
// weapon is parked in the dead zone with censer.setAim.
//
// STAGING TO THE REAL REACH. The head is fastest ~1.1–1.4 m in front of the eye and
// 0.4–0.8 m below it, and WHERE depends on the stroke (a hook sweeps level, a slam
// comes down, an uppercut comes up) and on the pitch (the swing is authored in view
// space; gravity is not). So each stroke is first CALIBRATED at the arena's empty
// centre, swung at the air at pitches −0.6…0.3: the fastest point where the head's
// path crosses the target's height, in front and moving the stroke's way, picks the
// pitch, and the player is stood so that point lands on the target (see stage()). The
// neck slam must cross steeply (>= 75% vertical), so it arrives from above.
//
// Asserts:
//   1. a tap from each dead-zone side (high, low, right, left) lands >= 1 new wound on
//      a fresh zombie, and at least one tap GOUGED (>= 2 wounds) with its trail running
//      the stroke's way ON SCREEN (dot >= 0.3, through the fisheye);
//   2. one full-charge overhead slam beside the neck (onto the shoulder's top, where the
//      skull does not shield it) severs the head (0 head prims alive);
//   3. three hook taps (weapon parked right) to the upper arm's lower end — the elbow
//      joint, from the arm's own side — kill prims on that arm (a sever);
//   4. negative control: a tap with nothing in reach adds no wounds anywhere;
//   5. zero console errors / exceptions.
// Measures (printed, not asserted): the head speed and the red-minus-green rise in a
// 40x40 crop on each crater (the plan's "a wound that reads raises it by > 10").
// Shoots each stroke mid-swing and each result into OUT.
//
// Usage (vite + a WebGPU Chrome already listening — from BASH, e.g.
//   . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up):
//   node scripts/censer-gate.mjs <vitePort> <cdpPort>
// Env: OUT (docs/dev-notes/2026-09-26-censer/gate), ROOM (most zombies), W/H (1280x800);
// while tuning: ONLY=taps,slam,arm,negative (a subset), SLAM_SIDE/SLAM_BACK/SLAM_UP (the
// slam's aim off the neck base, m), ARM_AIM ([1,0]), WOUNDLOG=1 (the slam's wound records
// and connectivity's own cutLimbs verdict, imported in the page).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5233);
const CDP = Number(process.argv[3] ?? 9223);
const OUT = process.env.OUT ?? 'docs/dev-notes/2026-09-26-censer/gate';
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800);
const TAP_HOLD = 3;         // frames the button is down for a tap (< holdSec 0.18 s)
const FULL_HOLD = 80;       // frames for a full charge (holdSec 0.18 + chargeSec 1.0 = 71)
/** ONLY=taps,slam,arm,negative runs a subset while tuning (a subset never prints GATE PASSED). */
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const runs = (k) => !ONLY || ONLY.includes(k);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const fail = (msg) => { console.error(`FAIL: ${msg}`); failures++; };
const pass = (msg) => console.log(`PASS: ${msg}`);
const die = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
}

// ---- CDP ------------------------------------------------------------------------
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {}
});
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, ms = 90000) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), ms,
    `evaluate: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
mkdirSync(OUT, { recursive: true });

// ---- PNG decode (screenshots are the only pixels a WebGPU canvas gives up) --------
function decodePng(buf) {
  let off = 8; let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported png: depth ${bitDepth} color ${colorType}`);
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride); p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= ch && prev ? prev[x - ch] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
  }
  return { w, h, ch, data: out };
}
/** Mean red minus mean green in a size x size crop centred on (cx, cy). */
function redMinusGreen(img, cx, cy, size = 40) {
  let n = 0, r = 0, g = 0;
  const x0 = Math.max(0, Math.round(cx - size / 2)), y0 = Math.max(0, Math.round(cy - size / 2));
  const x1 = Math.min(img.w, x0 + size), y1 = Math.min(img.h, y0 + size);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * img.w + x) * img.ch; r += img.data[i]; g += img.data[i + 1]; n++;
  }
  return n ? (r - g) / n : 0;
}

/** Screenshots lag hand-stepped frames by one: lock the sim, re-render twice, then shoot. */
async function capture(name) {
  await evaluate('__sdfGame.setRenderLock(true)');
  await evaluate('__sdfGame.step(2, 1 / 60)');
  const s = await send('Page.captureScreenshot', { format: 'png' });
  await evaluate('__sdfGame.setRenderLock(false)');
  const buf = Buffer.from(s.result.data, 'base64');
  if (name) { writeFileSync(`${OUT}/${name}.png`, buf); console.log(`  shot ${OUT}/${name}.png`); }
  return decodePng(buf);
}

// ---- Boot -----------------------------------------------------------------------
await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?seed=1&vhs=off&loader=0` });

let backend = null;
for (let i = 0; i < 240 && !backend; i++) {
  await sleep(500);
  try { backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null'); } catch { backend = null; }
}
if (backend !== 'webgpu') die(`backend ${backend}, expected webgpu`);
for (let i = 0; i < 480; i++) {
  if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') === 'ready') break;
  await sleep(500);
}
if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') !== 'ready') die('warm gate never reached ready');
await evaluate('__sdfGame.setLoopRunning(false)');
for (const p of ['woundPanel', 'gooPanel', 'vhsPanel']) {
  await evaluate(`typeof __sdfGame.${p} === "function" ? (__sdfGame.${p}(false), 1) : 0`);
}
await evaluate('__sdfGame.freeze(true)');
await evaluate('__sdfGame.censer.setHitStop(false)');
const sel = await evaluate(`__sdfGame.selectSlot('censer')`);
if (!sel?.ok) die(`selectSlot('censer') refused: ${JSON.stringify(sel)}`);
// ONE frame per call at first: the first frames compile pipelines, and step(n) timed out there.
for (let i = 0; i < 40; i++) await evaluate('__sdfGame.step(1, 1 / 60)');
// The censer's blur layer warms in the background; the gate's photos should show the real swing.
for (let i = 0; i < 900; i++) {
  if ((await evaluate('__sdfGame.censer.state().blurWarm')) === 'done') break;
  await evaluate('__sdfGame.step(1, 1 / 60)'); await sleep(20);
}
const st0 = await evaluate('__sdfGame.censer.state()');
if (!st0 || st0.phase !== 'idle') die(`censer not idle after the raise: ${JSON.stringify(st0)}`);
console.log(`censer ready (blur ${st0.blurWarm})`);

// ---- Vector helpers ---------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
function qRot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
const qInv = (q) => [-q[0], -q[1], -q[2], q[3]];
const f2 = (v) => v.map((c) => c.toFixed(2)).join(', ');

// ---- The arena --------------------------------------------------------------------
const zombies = (await evaluate('__sdfGame.actorList()')).filter((a) => a.kind === 'zombie');
const byRoom = new Map();
for (const z of zombies) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
const ROOM = process.env.ROOM ? Number(process.env.ROOM)
  : [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
const pool = byRoom.get(ROOM) ?? [];
if (pool.length < 6) die(`room ${ROOM} has ${pool.length} zombies; the gate needs 6`);
const room = (await evaluate('__sdfGame.rooms')).find((r) => r.id === ROOM);
const centre = [(room.bounds.minX + room.bounds.maxX) / 2, 0, (room.bounds.minZ + room.bounds.maxZ) / 2];
const nearestZombie = (x, z) => Math.min(...zombies.map((a) => Math.hypot(a.pos[0] - x, a.pos[2] - z)));
console.log(`room ${ROOM} (${room.name}): ${pool.length} zombies; the empty centre (${f2(centre)}) is ${nearestZombie(centre[0], centre[2]).toFixed(1)} m from the nearest`);
if (nearestZombie(centre[0], centre[2]) < 3) die('the room centre is not clear enough to calibrate in');

const state = () => evaluate('__sdfGame.censer.state()');
const stepOne = () => evaluate('__sdfGame.step(1, 1 / 60)');
async function stepN(n) { for (let i = 0; i < n; i++) await stepOne(); }
async function place(x, z, yaw, pitch) {
  await evaluate(`__sdfGame.placePlayer({ x: ${x}, z: ${z}, yaw: ${yaw}, pitch: ${pitch} })`);
}
/** Back to idle and a head hanging still (the grip needs no help, but the calibration does). */
async function settle(n = 60) {
  for (let i = 0; i < 240; i++) { if ((await state()).phase === 'idle') break; await stepOne(); }
  await stepN(n);
}
const totalWounds = () => evaluate('__sdfGame.actorList().reduce((n, a) => n + __sdfGame.actorWounds(a.id).length, 0)');

/**
 * Run one stroke. Returns per-frame samples {i, phase, speed, head, eye, eyeQuat, hits}
 * from the release on. `onFrame(sample)` may return a shot name to capture that frame.
 */
async function stroke(kind, aim, onFrame) {
  await evaluate(`__sdfGame.censer.setAim(${aim[0]}, ${aim[1]})`);
  await evaluate('__sdfGame.censer.press()');
  const hold = kind === 'heavy' ? FULL_HOLD : TAP_HOLD;
  for (let i = 0; i < hold; i++) {
    await stepOne();
    if (kind === 'heavy' && i === hold - 12 && onFrame) { const n = onFrame({ windup: true }); if (n) await capture(n); }
  }
  await evaluate('__sdfGame.censer.release()');
  const out = [];
  for (let i = 0; i < 60; i++) {
    await stepOne();
    const s = await state();
    const sample = { i, phase: s.phase, speed: s.headSpeed, head: s.head, eye: s.eye, eyeQuat: s.eyeQuat, hits: s.hits, lastHit: s.lastHit };
    out.push(sample);
    if (onFrame) { const n = onFrame(sample); if (n) await capture(n); }
    if (s.phase === 'idle') break;
  }
  return out;
}

/** The yaw that looks along −approach (from the player, standing out along
 *  `approach`, back at the target). The convention is READ off the game's camera,
 *  not assumed: forward(yaw) = (x1 sin yaw, 0, z0 cos yaw). */
let facingYaw = null;
{
  await place(centre[0], centre[2], 0, 0); await stepOne();
  const f0 = qRot((await state()).eyeQuat, [0, 0, -1]);
  await place(centre[0], centre[2], Math.PI / 2, 0); await stepOne();
  const f1 = qRot((await state()).eyeQuat, [0, 0, -1]);
  const z0 = Math.sign(f0[2]), x1 = Math.sign(f1[0]);
  facingYaw = (a) => Math.atan2(-a[0] / x1, -a[1] / z0);
  console.log(`camera: yaw 0 looks ${z0 < 0 ? '−z' : '+z'}, yaw π/2 looks ${x1 < 0 ? '−x' : '+x'}`);
}

/** Swing at the air at the empty centre: the head's path relative to the EYE (world
 *  axes — the placement below only translates the player, so these offsets carry
 *  over), and the eye's offset from the feet. */
async function calibrate(kind, aim, yaw, pitch) {
  await place(centre[0], centre[2], yaw, pitch);
  await evaluate(`__sdfGame.censer.setAim(${aim[0]}, ${aim[1]})`);
  await settle(60);
  const s0 = await state();
  const feet = await evaluate('__sdfGame.playerPos()');
  const samples = await stroke(kind, aim);
  if ((await state()).hits !== s0.hits) die(`calibration ${kind} ${aim} hit something at the arena centre`);
  const path = samples.filter((q) => q.phase === 'stroke' || q.phase === 'recover')
    .map((q) => ({ i: q.i, rel: sub(q.head, q.eye), speed: q.speed }));
  return { path, eyeOff: sub(s0.eye, feet), eyeY: s0.eye[1] };
}

/**
 * STAGE a stroke onto a target point. Strokes are deterministic (the grip erases
 * whatever the head was doing before the press), but their path in the world depends
 * on the pitch — the swing is authored in view space and gravity is not, and a
 * pendulum's rest sits differently in view as the view tilts. So: for each pitch in a
 * sweep, swing at the air and find where the head's path crosses the target's HEIGHT
 * while in front of the player and near its peak speed (moving the stroke's way —
 * down for a slam, up for an uppercut); take the fastest such crossing over all
 * pitches; then stand the player so that crossing lands on the target. Returns the
 * pose and the frame (after the release) at which the head is there.
 */
async function stage(kind, aim, target, approach, travelY, steep = false) {
  const yaw = facingYaw(approach);
  let best = null;
  for (let pitch = -0.6; pitch <= 0.31; pitch += 0.1) {
    const cal = await calibrate(kind, aim, yaw, pitch);
    const want = target[1] - cal.eyeY;
    const peak = Math.max(0, ...cal.path.map((q) => q.speed));
    for (let k = 1; k < cal.path.length; k++) {
      const qa = cal.path[k - 1], qb = cal.path[k];
      const ya = qa.rel[1] - want, yb = qb.rel[1] - want;
      if (ya * yb > 0 || ya === yb) continue;
      // A slam must come DOWN (an uppercut up); the neck slam steeply too — at a
      // slant it clips whatever stands beside the target first (the skull).
      const seg = sub(qb.rel, qa.rel), segL = Math.hypot(...seg) || 1;
      if (travelY && Math.sign(seg[1]) !== Math.sign(travelY)) continue;
      if (steep && Math.abs(seg[1]) < 0.75 * segL) continue;
      const t = ya / (ya - yb);
      const rel = qa.rel.map((c, j) => c + (qb.rel[j] - c) * t);
      const speed = qa.speed + (qb.speed - qa.speed) * t;
      const reach = Math.hypot(rel[0], rel[2]);
      if (reach < 0.6 || reach > 1.7 || speed < 0.6 * peak) continue;
      if (!best || speed > best.speed) best = { pitch, rel, speed, frame: t < 0.5 ? qa.i : qb.i, eyeOff: cal.eyeOff, reach };
    }
  }
  if (!best) die(`stage ${kind} ${JSON.stringify(aim)}: no pitch in -0.6..0.3 brings the head through the target's height at speed`);
  const x = target[0] - best.rel[0] - best.eyeOff[0], z = target[2] - best.rel[2] - best.eyeOff[2];
  await place(x, z, yaw, best.pitch);
  await settle(60);
  console.log(`  staged ${kind} ${JSON.stringify(aim)}: pitch ${best.pitch.toFixed(1)}, the head crosses the target ` +
    `${best.reach.toFixed(2)} m out at ${best.speed.toFixed(1)} m/s (frame ${best.frame} after the release)`);
  return { x, z, yaw, pitch: best.pitch, cal: best };
}

/** Unit xz from the room centre toward a point, reversed: the side the player approaches from. */
function approachFromCentre(p) {
  const dx = centre[0] - p[0], dz = centre[2] - p[2], l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}
const wounds = (id) => evaluate(`__sdfGame.actorWounds(${id})`);
/** Joint landmarks off the posed body (world): the NECK BASE (the head chain's root —
 *  where connectivity.ts cutLimbs tests the head's section), the face's forward, and the
 *  right ELBOW (the upper arm → forearm joint cutChains tests). A cut is decided AT the
 *  joints, so the strikes are aimed there, not at the limbs' middles. */
const landmarks = (id) => evaluate(`(() => {
  const p = __sdfGame.zombie(${id}).posed();
  const of = (limb) => p.prims.filter(q => q.limb === limb && q.op !== 'sub' && !q.dead);
  const head = of('head'), arm = of('armR');
  const neck = head[0], base = neck.a[1] < neck.b[1] ? neck.a : neck.b;
  const hc = p.clusters.find(c => c.limb === 'head').center;
  const fx = hc[0] - base[0], fz = hc[2] - base[2], fl = Math.hypot(fx, fz) || 1;
  // The upper arm is the capsule hanging from the shoulder ball; its lower end is the elbow.
  const upper = arm.find(q => Math.hypot(q.a[0] - q.b[0], q.a[1] - q.b[1], q.a[2] - q.b[2]) > 0.1);
  const elbow = upper.a[1] < upper.b[1] ? upper.a : upper.b;
  return { neckBase: [...base], neckR: neck.radius, forward: [fx / fl, fz / fl], elbow: [...elbow], upperR: upper.radius };
})()`);
async function woundPx(pos) {
  const n = await evaluate(`__sdfGame.censer.toScreen(${pos[0]}, ${pos[1]}, ${pos[2]})`);
  return n ? [(n[0] + 1) * 0.5 * W, (1 - n[1]) * 0.5 * H] : null;
}
/** THE LOOK CAMERA for the wound photos and the red-minus-green metric: the stroke's
 *  own framing often has the target at the lens's edge (a slam is staged looking down
 *  0.5 rad), so stand where the stroke was swung but LOOK straight at the target. The
 *  same look before and after the hit, so the crops compare like with like. */
async function lookAt(pose, point) {
  const s = await state();
  const eye = s.eye;
  const dx = point[0] - eye[0], dz = point[2] - eye[2], l = Math.hypot(dx, dz) || 1;
  await place(pose.x, pose.z, facingYaw([-dx / l, -dz / l]), Math.atan2(point[1] - eye[1], l));
  await settle(30);
}
/** A shot name for the frame the head is closest to its calibrated sweet point. */
const midShot = (name, frame) => (s) => (s.i === frame ? name : null);
const rows = [];

// THE REST POSE, for the photo strip: 1.6 m from a spare zombie, looking at its chest.
{
  const z = pool[6];
  const t = await evaluate(`__sdfGame.actorLimbCentre(${z.id}, 'torso')`);
  const a = approachFromCentre(t);
  await place(t[0] + a[0] * 1.6, t[2] + a[1] * 1.6, facingYaw(a), -0.2);
  await settle(90);
  await capture('censer-rest');
}

// ---- 1. Taps from the four sides ---------------------------------------------------
// [name, dead-zone offset, the stroke's travel on screen]
const SIDES = [['high', [0, 1], [0, -1]], ['low', [0, -1], [0, 1]], ['right', [1, 0], [-1, 0]], ['left', [-1, 0], [1, 0]]];
let gouged = 0, aligned = 0, landed = 0;
for (let i = 0; i < (runs('taps') ? SIDES.length : 0); i++) {
  const [name, off, travel] = SIDES[i];
  const z = pool[i];
  const target = await evaluate(`__sdfGame.actorLimbCentre(${z.id}, 'torso')`);
  const pose = await stage('tap', off, target, approachFromCentre(target), travel[1]);
  const before = await wounds(z.id);
  await lookAt(pose, target);
  const img0 = await capture(null);
  await place(pose.x, pose.z, pose.yaw, pose.pitch);
  await settle(60);
  const samples = await stroke('tap', off, midShot(`tap-${name}-mid`, pose.cal.frame));
  await settle(20);
  const fresh = (await wounds(z.id)).slice(before.length);
  const peak = Math.max(...samples.map((s) => s.speed));
  const st = await state();
  await lookAt(pose, target);
  const img1 = await capture(`tap-${name}-wound`);
  let rg = null;
  if (fresh.length) {
    const px = await woundPx(fresh[0].pos);
    if (px) rg = redMinusGreen(img1, px[0], px[1]) - redMinusGreen(img0, px[0], px[1]);
  }
  console.log(`tap ${name}: zombie ${z.id} +${fresh.length} wounds (radii ${fresh.map((w) => w.radius.toFixed(3)).join(' ')}); ` +
    `peak ${peak.toFixed(1)} m/s; last hit ${JSON.stringify(st.lastHit)}; R-G rise ${rg === null ? 'n/a' : rg.toFixed(1)}`);
  rows.push({ case: `tap ${name}`, zombie: z.id, wounds: fresh.length, peak, speedIn: st.lastHit?.speedIn ?? null, rg, pitch: pose.pitch });
  if (fresh.length < 1) { fail(`tap ${name} landed no wound`); continue; }
  landed++;
  if (fresh.length >= 2) {
    gouged++;
    const a = await woundPx(fresh[0].pos), b = await woundPx(fresh[fresh.length - 1].pos);
    if (a && b) {
      const sx = b[0] - a[0], sy = -(b[1] - a[1]);         // screen, y up
      const m = Math.hypot(sx, sy) || 1;
      const dot = (sx * travel[0] + sy * travel[1]) / m;
      console.log(`  gouge on screen (${(sx / m).toFixed(2)}, ${(sy / m).toFixed(2)}) over ${m.toFixed(0)} px vs stroke (${travel}) → dot ${dot.toFixed(2)}`);
      rows[rows.length - 1].dot = dot;
      if (dot >= 0.3) aligned++;
    }
  }
}
if (runs('taps') && landed === SIDES.length) {
  if (gouged === 0) fail('no tap gouged — every hit was a single crater');
  else if (aligned === 0) fail("no gouge ran the stroke's way");
  else pass(`taps land from all four sides; ${aligned}/${gouged} gouges run the stroke's way`);
}

// ---- 2. A full-charge overhead slam to the neck ---------------------------------------
if (runs('slam')) {
  const z = pool[4];
  // From BEHIND, down onto the TOP OF THE SHOULDER right beside the neck. The head's
  // section is tested at the NECK BASE (connectivity.ts cutLimbs), which sits sunk
  // ~8 cm into the shoulders, and the skull hides the neck from above: a slam straight
  // down on the nape hit the skull (glancing, 6–12 m/s into it), and one 13–24 cm
  // behind the neck landed on the upper back at a glancing 8 m/s or missed. Beside the
  // skull the head comes down square onto the trapezius (≈ 19 m/s into it), ~0.15 m
  // from the neck base. So the flail's CENTRE is aimed SLAM_SIDE 0.15 m to the side,
  // SLAM_BACK 0.02 m behind and SLAM_UP 0.10 m above the neck base.
  const lm = await landmarks(z.id);
  const back = [-lm.forward[0], -lm.forward[1]];
  const SB = Number(process.env.SLAM_BACK ?? 0.02), SU = Number(process.env.SLAM_UP ?? 0.1);
  const SS = Number(process.env.SLAM_SIDE ?? 0.15);
  const side = [back[1], -back[0]];
  const neck = [lm.neckBase[0] + back[0] * SB + side[0] * SS, lm.neckBase[1] + SU, lm.neckBase[2] + back[1] * SB + side[1] * SS];
  const alive0 = await evaluate(`__sdfGame.censer.limbAlive(${z.id}, 'head')`);
  const pose = await stage('heavy', [0, 1], neck, back, -1, true);
  const before = (await wounds(z.id)).length;
  const lookPoint = [lm.neckBase[0], lm.neckBase[1], lm.neckBase[2]];
  await lookAt(pose, lookPoint);
  const img0 = await capture(null);
  await place(pose.x, pose.z, pose.yaw, pose.pitch);
  await settle(60);
  const samples = await stroke('heavy', [0, 1], (s) => (s.windup ? 'slam-spin' : s.i === pose.cal.frame ? 'slam-strike' : null));
  await settle(40);
  await lookAt(pose, lookPoint);
  const alive = await evaluate(`__sdfGame.censer.limbAlive(${z.id}, 'head')`);
  const fresh = (await wounds(z.id)).slice(before);
  const peak = Math.max(...samples.map((s) => s.speed));
  const st = await state();
  const img1 = await capture('slam-after');
  let rg = null;
  if (fresh.length) { const px = await woundPx(fresh[0].pos); if (px) rg = redMinusGreen(img1, px[0], px[1]) - redMinusGreen(img0, px[0], px[1]); }
  // The body may have been shoved and turned by the blow: measure in its pose NOW.
  // (Once the head is off, its landmarks are gone with it: measure against the pre-hit pose.)
  const lmA = await landmarks(z.id).catch(() => lm);
  const backA = [-lmA.forward[0], -lmA.forward[1]];
  console.log(`  body moved ${Math.hypot(...sub(lmA.neckBase, lm.neckBase)).toFixed(2)} m; facing turned ${(Math.acos(Math.max(-1, Math.min(1, lm.forward[0] * lmA.forward[0] + lm.forward[1] * lmA.forward[1]))) * 180 / Math.PI).toFixed(0)}°`);
  const rel = (w) => { const d = sub(w.pos, lmA.neckBase); const back = backA; return `(back ${(d[0] * back[0] + d[2] * back[1]).toFixed(2)} side ${(d[0] * back[1] - d[2] * back[0]).toFixed(2)} up ${d[1].toFixed(2)})`; };
  console.log(`  slam wounds from the neck base (r ${lm.neckR.toFixed(3)}): ${fresh.map((w) => `${Math.hypot(...sub(w.pos, lmA.neckBase)).toFixed(3)}${rel(w)}@r${w.radius.toFixed(3)}${w.type === 'blast' ? '' : `[${w.type}]`}`).join(' ')}`);
  if (process.env.WOUNDLOG) console.log('  sever view:', JSON.stringify(await evaluate(`(async () => {
    const D = await import('/src/lab/sdf-zombie/damage.ts');
    const C = await import('/src/lab/sdf-zombie/connectivity.ts');
    const z = __sdfGame.zombie(${z.id}); const body = z.body;
    const head = body.prims.filter(q => q.limb === 'head'); const neck = head[0];
    const torsoC = body.clusters.find(c => c.limb === 'torso').center;
    const ws = z.woundList();
    const hc = body.clusters.find(c => c.limb === 'head');
    const girth = C.endpointGirth(body.prims.slice(hc.start, hc.start + hc.count), neck.a);
    return { alive: body.clusters.map(c => c.limb + ':' + c.alive + ':' + c.start + '+' + c.count), girth, neckIdx: body.prims.indexOf(neck), neckA: neck.a, neckB: neck.b, torsoC, cut: C.cutLimbs(body, ws, torsoC),
      d: ws.map(w => { const p = D.woundWorldPos(body.prims, w, 0); return [+Math.hypot(p[0]-neck.a[0], p[1]-neck.a[1], p[2]-neck.a[2]).toFixed(3), w.severRadius ?? w.radius]; }) };
  })()`)));
  if (process.env.WOUNDLOG) console.log('  wound records:', JSON.stringify(await evaluate(`__sdfGame.zombie(${z.id}).woundList().map(w => ({ prim: w.primIdx, limb: __sdfGame.zombie(${z.id}).posed().prims[w.primIdx].limb, r: +w.radius.toFixed(3), sever: w.severRadius && +w.severRadius.toFixed(3), type: w.type, decal: !!w.decal }))`)));
  console.log(`slam: zombie ${z.id} head prims ${alive0} → ${alive}; +${fresh.length} wounds; peak ${peak.toFixed(1)} m/s; last hit ${JSON.stringify(st.lastHit)}; R-G rise ${rg === null ? 'n/a' : rg.toFixed(1)}`);
  rows.push({ case: 'slam (full charge)', zombie: z.id, wounds: fresh.length, peak, speedIn: st.lastHit?.speedIn ?? null, rg, pitch: pose.pitch, sever: `${alive0} → ${alive}` });
  if (alive !== 0) fail(`a full-charge slam to the neck left ${alive} of ${alive0} head prims alive`);
  else pass('a full-charge slam severs the head');
}

// ---- 3. Three taps to an upper arm ----------------------------------------------------
if (runs('arm')) {
  const z = pool[5];
  const alive0 = await evaluate(`__sdfGame.censer.limbAlive(${z.id}, 'armR')`);
  const arm = await evaluate(`__sdfGame.actorLimbCentre(${z.id}, 'armR')`);
  const torso = await evaluate(`__sdfGame.actorLimbCentre(${z.id}, 'torso')`);
  // The ELBOW, the upper arm's lower end — a cut is decided at a joint — from the
  // arm's own side (the torso behind it).
  const lm = await landmarks(z.id);
  const target = lm.elbow;
  const ox = arm[0] - torso[0], oz = arm[2] - torso[2], ol = Math.hypot(ox, oz) || 1;
  const ARM_AIM = JSON.parse(process.env.ARM_AIM ?? '[1,0]');
  const pose = await stage('tap', ARM_AIM, target, [ox / ol, oz / ol], 0);
  let total = 0, peaks = [];
  for (let k = 0; k < 3; k++) {
    const before = (await wounds(z.id)).length;
    await place(pose.x, pose.z, pose.yaw, pose.pitch);
    await settle(60);
    const samples = await stroke('tap', ARM_AIM, k === 2 ? midShot('arm-third-tap', pose.cal.frame) : null);
    await settle(20);
    const n = (await wounds(z.id)).length - before;
    total += n; peaks.push(Math.max(...samples.map((s) => s.speed)));
    const fw = (await wounds(z.id)).slice(before);
    const lmA = await landmarks(z.id).catch(() => lm);
    console.log(`    from the elbow (r ${lm.upperR.toFixed(3)}; body moved ${Math.hypot(...sub(lmA.elbow, lm.elbow)).toFixed(2)} m): ${fw.map((w) => `${Math.hypot(...sub(w.pos, lmA.elbow)).toFixed(3)}@r${w.radius.toFixed(3)}`).join(' ')}`);
    console.log(`  arm tap ${k + 1}: +${n} wounds; armR prims alive ${await evaluate(`__sdfGame.censer.limbAlive(${z.id}, 'armR')`)}`);
  }
  const alive1 = await evaluate(`__sdfGame.censer.limbAlive(${z.id}, 'armR')`);
  console.log(`arm: zombie ${z.id} armR prims ${alive0} → ${alive1}; ${total} wounds; peaks ${peaks.map((p) => p.toFixed(1)).join(' ')} m/s`);
  await lookAt(pose, lm.elbow);
  await capture('arm-after');
  rows.push({ case: 'arm x3 taps', zombie: z.id, wounds: total, peak: Math.max(...peaks), pitch: pose.pitch, sever: `${alive0} → ${alive1}` });
  if (!(alive1 < alive0)) fail(`three taps to the arm severed nothing (${alive0} → ${alive1})`);
  else pass('three taps sever the arm');
}

// ---- 4. Negative control: the empty centre, a tap at nothing --------------------------
if (runs('negative')) {
  await place(centre[0], centre[2], facingYaw([0, 1]), 0);
  await settle(40);
  const before = await totalWounds();
  await stroke('tap', [0, 0], (s) => (s.i === 6 ? 'negative-mid' : null));
  await settle(20);
  const after = await totalWounds();
  if (after !== before) fail(`a tap at nothing added ${after - before} wounds`);
  else pass(`a tap at nothing adds no wounds (nearest zombie ${nearestZombie(centre[0], centre[2]).toFixed(1)} m)`);
}

// ---- 5. Console -------------------------------------------------------------------------
const errors = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errors.length) fail(`${errors.length} console errors: ${errors.slice(0, 3).map((e) => e.text).join(' | ')}`);
else pass('no console errors');

writeFileSync(`${OUT}/gate-rows.json`, JSON.stringify(rows, null, 2));
console.log(failures ? `GATE FAILED (${failures})` : ONLY ? `subset ${ONLY} passed (not the gate)` : 'GATE PASSED');
ws.close();
process.exit(failures ? 1 : 0);
