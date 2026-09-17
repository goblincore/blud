// scripts/sdf-rupture-look.mjs — THE BLAST, FRAMED AND STEPPED AT NORMAL SPEED.
//
// 2026-09-16 rupture/slough/refraction task 2. One committed rig that produces
// the frames the owner's two complaints need judged against:
//
//   * the SLOUGH — does the flesh visibly change silhouette and slough off the
//     cage (not a chest translating up into the head)? A/B against
//     `?tearslough=0` at the same seed/camera/frame.
//   * the REFRACTION — is `?blastdistort=1` visibly different from OFF at
//     normal playback, with the background bending OUTSIDE the opaque fireball?
//     A/B against no flag at the same seed/camera/frame, plus an anatomy-only
//     leg with every fireball/smoke/ring layer killed so the wave is the only
//     moving thing.
//
// TWO RIGGING RULES, both already paid for in this repo:
//   * `presentedShot()` (the canvas readback), NOT `Page.captureScreenshot` —
//     the compositor is stale between hand-stepped frames and three different
//     states came back byte-identical.
//   * the render loop is STOPPED and every frame is one `step(1/60)`, so a
//     "normal-speed" clip is genuinely 60 fps of sim time whether it plays back
//     as PNGs or as an mp4.
//
// Usage: node scripts/sdf-rupture-look.mjs <vitePort> <cdpPort> <outDir> [qs]
// Env:
//   RUPTURE_VIEW=front|threequarter|side|back|high   camera bearing (default front)
//   RUPTURE_DIST=4          camera standoff, metres (3–6 per the task)
//   RUPTURE_FRAMES=96       frames captured after the detonation
//   RUPTURE_PREROLL=30      settle frames before the blast
//   RUPTURE_BLAST_OFF=0     lateral blast offset from the chest, metres
//   RUPTURE_BLAST_UP=0      extra blast height above the chest, metres
//   RUPTURE_HIDE_FX=1       kill fire/smoke/ring so the anatomy + wave read
//   RUPTURE_HIDE_VM=0       hide the held view model (default 1: it covers the body)
//   RUPTURE_CAM_Y=0         absolute camera height, metres (0 = eye height)
//   RUPTURE_STRAFE=0        metres/second the camera slides sideways during the wave
//   RUPTURE_STRAFE_FIXED=1  strafe with a FIXED yaw so the blast drifts off-centre
//   RUPTURE_SETTLE=240      fast-step this many frames after the clip, then shoot
//                           the rest from floor height (piece-on-floor check)
//   RUPTURE_VHS=            VHS preset for the whole run (default off)
import { mkdirSync, writeFileSync } from 'node:fs';
import { decodePng } from './lib/demo-presented.mjs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const OUT = process.argv[4] ?? '/tmp/rupture-look';
const QS = process.argv[5] ?? '';
const VIEW = process.env.RUPTURE_VIEW ?? 'front';
const DIST = Number(process.env.RUPTURE_DIST ?? 4);
const FRAMES = Number(process.env.RUPTURE_FRAMES ?? 96);
const PREROLL = Number(process.env.RUPTURE_PREROLL ?? 30);
const BLAST_OFF = Number(process.env.RUPTURE_BLAST_OFF ?? 0);
const BLAST_UP = Number(process.env.RUPTURE_BLAST_UP ?? 0);
const HIDE_FX = process.env.RUPTURE_HIDE_FX === '1';
const HIDE_VM = process.env.RUPTURE_HIDE_VM !== '0';
const CAM_Y = Number(process.env.RUPTURE_CAM_Y ?? 0);
const STRAFE = Number(process.env.RUPTURE_STRAFE ?? 0);
const STRAFE_FIXED_YAW = process.env.RUPTURE_STRAFE_FIXED === '1';
const VHS = process.env.RUPTURE_VHS ?? '';
const W = 1280, H = 720;
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
  return { name, file: `${name}.png`, w: d.w, h: d.h };
};

const pageErrors = [];
await send('Runtime.enable');
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params).slice(0, 240));
});
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const url = `http://localhost:${VITE}/sdf-game.html?room=arena&frozen=1&seed=7`
  + (VHS ? `&vhs=${VHS}` : '&vhs=off') + (QS ? `&${QS}` : '');
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
  if (await ev('!!window.__sdfGame.roomProbesReady && window.__sdfGame.roomProbesReady()').catch(() => false)) break;
  await sleep(250);
  if (i === 79) console.log('WARNING: room probes never reported ready');
}
for (let i = 0; i < 80; i++) {
  if (await ev('!!window.__warmDone').catch(() => false)) break;
  await sleep(250);
  if (i === 79) console.log('WARNING: __warmDone never appeared; timings may drift');
}
await sleep(500);
await ev('window.__sdfGame.setDemoHold(true)');
if (!VHS) await ev('window.__sdfGame.setVhs(null)');
await ev('window.__sdfGame.setLoopRunning(false)');
await ev('window.__sdfGame.step(90)');
if (HIDE_VM) {
  const vm = await ev('window.__sdfGame.setViewModelVisible(false)');
  console.log(`view model visible: ${vm} (hidden for the body read)`);
}
await ev('window.__sdfGame.teleport(6)');
await ev('window.__sdfGame.step(1)');

// Anatomy-only leg: kill every additive/normal VFX layer so the wave and the
// body are the only things in frame. Tuning is live and read per frame.
if (HIDE_FX) {
  const t = await ev(`window.__sdfGame.setExplosionFxTuning({ gain: 0, smokeOpacity: 0, ringOpacity: 0 })`);
  console.log(`hide-fx tuning: gain ${t?.gain} smokeOpacity ${t?.smokeOpacity} ringOpacity ${t?.ringOpacity}`);
}

const pick = await ev(`(() => {
  const pp = window.__sdfGame.playerPos();
  const list = window.__sdfGame.actorList().filter(a => a.room === 6 && a.kind === 'zombie');
  if (!list.length) return null;
  list.sort((a, b) =>
    Math.hypot(a.pos[0] - pp[0], a.pos[2] - pp[2]) - Math.hypot(b.pos[0] - pp[0], b.pos[2] - pp[2]));
  return { target: list[0], count: list.length };
})()`);
if (!pick) fail('no zombie in the arena to detonate on');
const t = pick.target;
console.log(`target id ${t.id} at ${t.pos.map(v => v.toFixed(2)).join(', ')} yaw ${t.yaw.toFixed(2)}; ${pick.count} zombies`);

// Camera bearing in WORLD space, chosen relative to the body's own facing so
// "front" means standing where the face points.
const fx = Math.sin(t.yaw), fz = -Math.cos(t.yaw);
const rot = VIEW === 'front' ? 0
  : VIEW === 'threequarter' ? (42 * Math.PI / 180)
  : VIEW === 'side' ? (88 * Math.PI / 180)
  : VIEW === 'back' ? Math.PI
  : 0;
const bx = fx * Math.cos(rot) - fz * Math.sin(rot);
const bz = fx * Math.sin(rot) + fz * Math.cos(rot);
// body-right, for the lateral blast offsets.
const rx = -bz, rz = bx;

const AIM_Y = t.pos[1] + 1.05;
const eyeY = await ev(`(() => {
  window.__sdfGame.placePlayer({ x: ${t.pos[0] + bx * DIST}, z: ${t.pos[2] + bz * DIST}, yaw: 0, pitch: 0 });
  window.__sdfGame.step(1);
  return window.__sdfGame.cameraWorld()[1];
})()`);
const yawTo = (px, pz, tx, tz) => Math.atan2(tx - px, -(tz - pz));
const pitchTo = (px, py, pz, tx, ty, tz) => Math.atan2(ty - py, Math.hypot(tx - px, tz - pz));
const camY = CAM_Y > 0 ? CAM_Y : eyeY;
// The blast point: chest, optionally pushed sideways/up for the off-centre and
// elevated-blast framings.
const blast = [t.pos[0] + rx * BLAST_OFF, AIM_Y + BLAST_UP, t.pos[2] + rz * BLAST_OFF];

// The body-aimed yaw/pitch from the ORIGINAL camera spot; a fixed-yaw strafe
// keeps these so the blast DRIFTS across the frame, which is the only way to
// see whether the wave is reprojected rather than pinned to the screen centre.
const yaw0 = yawTo(t.pos[0] + bx * DIST, t.pos[2] + bz * DIST, t.pos[0], t.pos[2]);
const pitch0 = pitchTo(t.pos[0] + bx * DIST, camY, t.pos[2] + bz * DIST, t.pos[0], AIM_Y, t.pos[2]);

/** Place the camera on the body-facing bearing, `strafeM` metres to the body's
 *  right. Aims at the chest so the blast stays framed, unless `fixedYaw`. */
const place = async (strafeM, fixedYaw = false) => {
  const px = t.pos[0] + bx * DIST + rx * strafeM;
  const pz = t.pos[2] + bz * DIST + rz * strafeM;
  const yaw = fixedYaw ? yaw0 : yawTo(px, pz, t.pos[0], t.pos[2]);
  const pitch = fixedYaw ? pitch0 : pitchTo(px, camY, pz, t.pos[0], AIM_Y, t.pos[2]);
  await ev(`window.__sdfGame.setPose(${JSON.stringify(px)}, ${JSON.stringify(pz)}, ${JSON.stringify(yaw)}, ${JSON.stringify(pitch)}, ${JSON.stringify(Math.max(0, camY - eyeY))})`);
  await ev('window.__sdfGame.setLoopRunning(false)');
};

await place(0);
await ev('window.__sdfGame.setLoopRunning(false)');
await ev(`window.__sdfGame.step(${PREROLL})`);
await place(0);
await ev('window.__sdfGame.step(1)');
const pre = await shot('f000-pre');
console.log(`pre frame ${pre.w}x${pre.h}; blast point ${blast.map(v => v.toFixed(2)).join(', ')}`);
const screenBlast = await ev(`window.__sdfGame.screenPosOf(${blast[0]}, ${blast[1]}, ${blast[2]})`);
const screenChest = await ev(`window.__sdfGame.screenPosOf(${t.pos[0]}, ${AIM_Y}, ${t.pos[2]})`);
console.log(`screen blast ${JSON.stringify(screenBlast)} chest ${JSON.stringify(screenChest)}`);

await ev(`window.__sdfGame.setLoopRunning(false)`);
const det = await ev(`window.__sdfGame.detonate(${blast[0]}, ${blast[1]}, ${blast[2]})`);
console.log(`detonate: ${JSON.stringify(det)}`);
const fxMode = await ev('window.__sdfGame.explosionFx()');
console.log(`explosion fx mode ${fxMode?.mode} burstHalfHeightM ${fxMode?.burstHalfHeightM}`);

const frames = [];
const reframesEach = STRAFE !== 0 || camY > eyeY + 1e-3;
for (let i = 1; i <= FRAMES; i++) {
  if (reframesEach) {
    await place((STRAFE * i) / 60, STRAFE_FIXED_YAW);
  }
  await ev('window.__sdfGame.setLoopRunning(false)');
  await ev('window.__sdfGame.step(1)');
  const s = await shot(`f${String(i).padStart(3, '0')}`);
  const tel = await ev(`(() => {
    const d = window.__sdfGame.dynamite();
    const cs = window.__sdfGame.chunkStats();
    const ex = window.__sdfGame.explosionFx();
    const bp = window.__sdfGame.screenPosOf(${blast[0]}, ${blast[1]}, ${blast[2]});
    return {
      tearing: d.tearing, tearAge: Number((d.tearAge ?? 0).toFixed(3)),
      ruptureMaxM: Number((d.ruptureMaxM ?? 0).toFixed(4)),
      ruptureMaxRad: Number((d.ruptureMaxRad ?? 0).toFixed(4)),
      gibbed: d.gibbed, gibPieces: d.gibPieces, lastGibTier: d.lastGibTier,
      lastGibParts: d.lastGibParts, pendingGibs: d.pendingGibs,
      pendingPlanPieces: d.pendingPlanPieces, blastDistortCount: window.__sdfGame.blastDistortCount,
      live: cs.live, baked: cs.baked, faceBaked: cs.faceBaked,
      livePieces: cs.livePieces,
      burstHalfHeightM: ex.burstHalfHeightM, activeBursts: ex.liveBursts,
      screenBlast: bp, camera: window.__sdfGame.cameraWorld(),
      blastSlots: window.__sdfGame.blastDistortInfo ? window.__sdfGame.blastDistortInfo() : null,
    };
  })()`);
  tel.file = s.file;
  frames.push(tel);
  if (i % 12 === 0 || (tel.live > 0 && frames[i - 2]?.live === 0)) {
    console.log(`  f${String(i).padStart(3, '0')} tear ${tel.tearing} age ${tel.tearAge} rupture ${tel.ruptureMaxM}m/${tel.ruptureMaxRad}rad live ${tel.live} baked ${tel.baked} burst ${tel.activeBursts} distortCount ${tel.blastDistortCount}`);
  }
}

// SETTLE: fast-step the world and shoot the pile from floor height, so the
// "does a piece rest ON the floor" check has a frame where the pieces have
// actually stopped. The per-frame telemetry above is the flight; this is the
// rest. `chunkStates().settled` is the same predicate the renderer floors with.
let settle = null;
const settleSteps = Number(process.env.RUPTURE_SETTLE ?? 0);
if (settleSteps > 0) {
  await ev(`window.__sdfGame.step(${settleSteps})`);
  await ev('window.__sdfGame.setLoopRunning(false)');
  const aimLow = Math.max(0.12, AIM_Y - 0.75);
  const px = t.pos[0] + bx * DIST, pz = t.pos[2] + bz * DIST;
  const yaw = yawTo(px, pz, t.pos[0], t.pos[2]);
  const pitch = pitchTo(px, eyeY, pz, t.pos[0], aimLow, t.pos[2]);
  await ev(`window.__sdfGame.setPose(${JSON.stringify(px)}, ${JSON.stringify(pz)}, ${JSON.stringify(yaw)}, ${JSON.stringify(pitch)}, 0)`);
  await ev('window.__sdfGame.step(1)');
  await shot('settle-floor');
  settle = await ev(`(() => {
    const cs = window.__sdfGame.chunkStats();
    const states = window.__sdfGame.chunkStates();
    return {
      live: cs.live, baked: cs.baked, faceBaked: cs.faceBaked,
      settled: states.filter(p => p.settled).length, total: states.length,
      lowY: states.map(p => Number(p.pos[1].toFixed(3))).sort((a, b) => a - b).slice(0, 6),
      file: 'settle-floor.png',
    };
  })()`);
  console.log(`settle +${settleSteps}: live ${settle.live} baked ${settle.baked} settled ${settle.settled}/${settle.total} lowest y ${settle.lowY.join(', ')}`);
}

writeFileSync(`${OUT}/telemetry.json`, JSON.stringify({
  view: VIEW, dist: DIST, frames: FRAMES, preroll: PREROLL, qs: QS, vhs: VHS,
  hideFx: HIDE_FX, hideVm: HIDE_VM, camY: camY, strafe: STRAFE,
  strafeFixedYaw: STRAFE_FIXED_YAW,
  target: t, blast, screenBlast, screenChest, detonate: det,
  fxMode, width: pre.w, height: pre.h, settle, perFrame: frames, pageErrors,
}, null, 2));

if (pageErrors.length) {
  console.error(`PAGE ERRORS (${pageErrors.length})`);
  for (const e of pageErrors.slice(0, 5)) console.error('  ' + e);
  fail('the page reported errors');
}
console.log(`PASS: ${FRAMES} frames -> ${OUT}`);
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
