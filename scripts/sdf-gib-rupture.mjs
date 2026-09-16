// scripts/sdf-gib-rupture.mjs — THE RUPTURE AS A FRAME SEQUENCE.
//
// The companion of sdf-gib-look.mjs, narrowed to the body-to-gib transition the
// 2026-09-16 task added: the planned regions separating over ~0.2 s before they
// become chunks, with the skeleton exposed in the opening seams. It answers
// questions no census can:
//   * is the body ACTUALLY separating (the largest region offset climbs), or is
//     it still the intact body held for 200 ms?
//   * does the displayed region become the spawned piece (the hand-off frame)?
//   * what does the transition look like at each sim time, at a framed camera?
//
// WHAT THIS RIG OWNS (Task 2, 2026-09-16):
//   * A CONTIGUOUS sequence. Frames 0..N are captured one fixed step apart, so
//     the release tick and its neighbours exist as real frames rather than the
//     sparse sample the first version took. Every frame logs its ACTUAL sim
//     time (`tearAge`, seconds into the window) beside the nominal 60 Hz label,
//     because a capture started a tick late must say so.
//   * A FRAMED CAMERA. The player is placed at a known standoff and bearing
//     from the target (`RUP_VIEW=back|front|threequarter`) instead of inheriting
//     the arena spawn, so the body is legible rather than 100 px tall. The crop
//     is derived from the projected torso, not hand-typed.
//   * A LABELED CONTACT SHEET. The tiles are cropped and upscaled in Node, then
//     composited in the page (canvas 2D has real fonts) so the owner gets a grid
//     whose cells are labelled with the frame's time.
//
// ⚠ Same two rigging traps the look rig documents: `presentedShot()` (not
// Page.captureScreenshot, which returns a stale compositor frame between steps)
// and a FROZEN loop (or the wanderers walk through the sequence).
//
// Usage: node scripts/sdf-gib-rupture.mjs <vitePort> <cdpPort> [outDir] [qs] [tag]
// Env:
//   RUP_SEED=7          fixed demo seed so runs frame the same body
//   RUP_VIEW=back|front|threequarter   camera bearing from the target (default back)
//   RUP_DIST=2.4        standoff in metres (default 2.4)
//   RUP_FRAMES=30       contiguous 60 Hz frames to capture (default 30 = 500 ms)
//   RUP_VFX=            extra query string for the run (e.g. "&explosionfx=standin")
//   RUP_CROP=           "cx,cy,w,h" pixel crop override
import { mkdirSync, writeFileSync } from 'node:fs';
import { decodePng } from './lib/demo-presented.mjs';
import { writePng } from './lib/png-write.mjs';

const VITE = Number(process.argv[2] ?? 5399);
const CDP = Number(process.argv[3] ?? 9399);
const OUT = process.argv[4] ?? '/tmp/gib-rupture';
const QS = process.argv[5] ?? '';
const TAG = process.argv[6] ?? 'run';
const SEED = Number(process.env.RUP_SEED ?? 7);
const VIEW = process.env.RUP_VIEW ?? 'back';
const DIST = Number(process.env.RUP_DIST ?? 2.4);
const NFRAMES = Number(process.env.RUP_FRAMES ?? 30);
const VFX = process.env.RUP_VFX ?? '';
const CROP_OVERRIDE = process.env.RUP_CROP ?? '';
mkdirSync(OUT, { recursive: true });
const W = 960, H = 720;
const DT = 1 / 60;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const TAG_FILE = TAG.replace(/[^a-z0-9_.-]+/gi, '_');

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

const pageErrors = [];
await send('Runtime.enable');
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params).slice(0, 240));
});
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const url = `http://localhost:${VITE}/sdf-game.html?room=arena&frozen=1&vhs=off&seed=${SEED}${QVS()}${VFX}`;
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
// ⚠ THE WARM-UP OWNS THE LOOP UNTIL IT FINISHES. `warmPipelines` pauses the
// loop and its `.finally` calls `setLoopRunning(true)`; a rig that stops the
// loop before that lands has it silently RE-ARMED a moment later and the tear
// clock advances on wall time between CDP reads (measured 2026-09-16: after
// detonate + no step, tearAge reached 0.052 in 300 ms). Waiting on `__warmDone`
// makes `step(n)` the only thing that advances the sim: after the gate, the
// same probe held tearAge at 0.017 across 300 ms with no step.
for (let i = 0; i < 80; i++) {
  if (await ev('!!window.__warmDone').catch(() => false)) break;
  await sleep(250);
  if (i === 79) console.log('WARNING: __warmDone never appeared; timings may drift');
}
await sleep(600); // let the last warm-up frame's finally settle
await ev('window.__sdfGame.setDemoHold(true)');
await ev('window.__sdfGame.setVhs(null)');
await ev('window.__sdfGame.setLoopRunning(false)');
await ev(`window.__sdfGame.step(40)`);

// STAND IN FRONT OF A BODY AT A KNOWN BEARING. Teleport to the arena so room 6
// is loaded, pick the zombie nearest the arena spawn, then place the player at
// DIST metres on the requested bearing and aim at that body. Aiming is the
// page's own confirmed aim (`aimSurface`), not a hand-rolled angle.
await ev('window.__sdfGame.teleport(6)');
const pick = await ev(`(() => {
  const pp = window.__sdfGame.playerPos();
  const list = window.__sdfGame.actorList().filter(a => a.room === 6 && a.kind === 'zombie');
  if (list.length === 0) return null;
  list.sort((a, b) =>
    Math.hypot(a.pos[0] - pp[0], a.pos[2] - pp[2]) - Math.hypot(b.pos[0] - pp[0], b.pos[2] - pp[2]));
  return { target: list[0], count: list.length, player: pp };
})()`);
if (!pick) fail('no zombie in the arena (room 6) to rupture');
{
  const t = pick.target;
  // Bearings in the body's own frame: forward is (sin yaw, -cos yaw). `back`
  // stands behind the body (what a player sees approaching), `front` faces it,
  // `threequarter` is 40° off the front.
  const fx = Math.sin(t.yaw), fz = -Math.cos(t.yaw);
  const rot = VIEW === 'front' ? 0 : VIEW === 'threequarter' ? (40 * Math.PI / 180) : Math.PI;
  const bx = fx * Math.cos(rot) - fz * Math.sin(rot);
  const bz = fx * Math.sin(rot) + fz * Math.cos(rot);
  const px = t.pos[0] + bx * DIST, pz = t.pos[2] + bz * DIST;
  const where = await ev(`window.__sdfGame.placePlayer(${JSON.stringify({ x: px, z: pz, yaw: 0 })})`);
  if (where !== 'room6' && where !== 'room5' && where !== 'room4' && where !== 'arena') {
    // Not fatal: report it and continue, so a slightly off-room standoff still
    // produces frames the reviewer can judge rather than no run at all.
    console.log(`WARNING: player placement landed in '${where}'`);
  }
}
await ev(`window.__sdfGame.aimSurface(undefined, ${pick.target.id})`);
await ev(`window.__sdfGame.step(2)`);
const dist = Math.hypot(pick.target.pos[0] - pick.player[0], pick.target.pos[2] - pick.player[2]);
console.log(`arena bodies: ${pick.count}; target id ${pick.target.id} at `
  + `${pick.target.pos.map(v => v.toFixed(2)).join(', ')} yaw ${pick.target.yaw.toFixed(2)} `
  + `(arena spawn ${dist.toFixed(2)} m); view ${VIEW} standoff ${DIST} m`);
const tearSec = await ev('window.__sdfGame.dynamite().gibTearSec');
console.log(`${TAG}: gibTearSec=${tearSec}  seed=${SEED}  ${QS || '(defaults)'}${VFX}`);

// ——— THE ONSET FRAME, BEFORE THE BLAST ————————————————————————————————————
// The contract is that the onset silhouette is the pre-blast posed body. This
// capture is the "before" it is compared against, taken at the framed camera.
await ev('window.__sdfGame.setLoopRunning(false)');
const onsetPng = await capture();
writeFileSync(`${OUT}/${TAG_FILE}-onset.png`, onsetPng);
const proj = await ev(`(() => {
  const a = window.__sdfGame.actorList().find(x => x.id === ${pick.target.id});
  if (!a) return null;
  return {
    chest: window.__sdfGame.screenPosOf(a.pos[0], a.pos[1] + 1.05, a.pos[2]),
    head: window.__sdfGame.screenPosOf(a.pos[0], a.pos[1] + 1.6, a.pos[2]),
    feet: window.__sdfGame.screenPosOf(a.pos[0], a.pos[1] + 0.05, a.pos[2]),
  };
})()`);
const png0 = decodePng(onsetPng);
const IW = png0.w, IH = png0.h;
const ndcToPx = (p) => [ (p.x * 0.5 + 0.5) * IW, (1 - (p.y * 0.5 + 0.5)) * IH ];
let crop;
if (CROP_OVERRIDE) {
  crop = CROP_OVERRIDE.split(',').map(Number);
} else if (proj && proj.chest && proj.head && proj.feet) {
  const [, cy] = ndcToPx(proj.chest);
  const [, hy] = ndcToPx(proj.head);
  const [, fy] = ndcToPx(proj.feet);
  const bodyPx = Math.max(Math.abs(fy - hy), 60);
  const h = Math.min(IH, Math.round(bodyPx * 1.7));
  const w = Math.round(h * 0.72);
  crop = [
    Math.max(0, Math.round(IW / 2 - w / 2)),
    Math.max(0, Math.round(cy - h * 0.42)),
    Math.min(w, IW), Math.min(h, IH),
  ];
} else {
  crop = [Math.round(IW * 0.32), Math.round(IH * 0.20), Math.round(IW * 0.36), Math.round(IH * 0.55)];
}
console.log(`frame ${IW}x${IH}; crop ${crop.join(',')}`);

// ——— DETONATE, THEN CAPTURE CONTIGUOUS FIXED STEPS ————————————————————————
await ev(`window.__sdfGame.detonate(${pick.target.pos[0]}, ${pick.target.pos[1] + 0.6}, ${pick.target.pos[2]})`);
await ev('window.__sdfGame.setLoopRunning(false)');

const frames = [{ label: 'onset', png: onsetPng, simMs: 0, tearAge: 0, sim: null }];
let prevPng = onsetPng, prevLabel = 'onset';
for (let i = 0; i <= NFRAMES; i++) {
  // One fixed step per captured frame. `i` is the number of steps since the
  // detonation, so the tick that releases the pieces is a captured tick.
  await ev(`window.__sdfGame.step(1)`);
  const png = await capture();
  const label = `${Math.round((i + 1) * DT * 1000)}ms`;
  writeFileSync(`${OUT}/${TAG_FILE}-f${String(i).padStart(2, '0')}.png`, png);
  const d = await ev('window.__sdfGame.dynamite()');
  const chunks = await ev('window.__sdfGame.chunkCensus()');
  const stats = await ev('window.__sdfGame.chunkStats()');
  const sim = {
    tears: d.tearing, tearAge: d.tearAge, ruptureMaxM: d.ruptureMaxM,
    pendingGibs: d.pendingGibs, held: d.pendingPieceImpulses, delays: d.pendingPieceDelays,
    live: chunks.live, baked: chunks.baked, cap: chunks.cap,
    tier: d.lastGibTier, spawned: d.lastGibSpawned, heldBack: d.lastGibHeld,
    parts: d.lastGibParts,
    livePieces: stats.livePieces.map(p => p.centre.map(v => +v.toFixed(4))),
  };
  frames.push({ label, png, simMs: (i + 1) * DT * 1000, tearAge: d.tearAge, sim });
  // STALE FRAME GUARD: presentedShot reads what was last PRESENTED, and a
  // repeated capture of the same state is worse than no rig at all.
  {
    const a = prevPng, b = png;
    const da = decodePng(a), db = decodePng(b);
    let changed = 0;
    const n = Math.min(da.data.length, db.data.length);
    for (let k = 0; k < n; k += 4) {
      if (Math.abs(da.data[k] - db.data[k]) + Math.abs(da.data[k + 1] - db.data[k + 1])
        + Math.abs(da.data[k + 2] - db.data[k + 2]) > 12) changed++;
    }
    if (changed === 0) fail(`${prevLabel} and frame ${label} are byte-identical: the capture is returning a stale frame`);
  }
  prevPng = png; prevLabel = label;
  console.log(`frame ${String(i).padStart(2)} (~${label.padStart(6)}): `
    + `tearing ${d.tearing}${d.tearing ? ` age ${d.tearAge.toFixed(3)} maxOffset ${d.ruptureMaxM.toFixed(4)}m` : ''} `
    + `pendingGibs ${d.pendingGibs} impulses ${d.pendingPieceImpulses}${d.pendingPieceImpulses ? ` delays ${JSON.stringify(d.pendingPieceDelays)}` : ''} `
    + `| chunks ${chunks.inFrustum}/${chunks.live} baked ${chunks.baked}`
    + `${d.tearing ? '' : ` tier ${d.lastGibTier} parts ${d.lastGibParts.length}`}`);
}
writeFileSync(`${OUT}/${TAG_FILE}-telemetry.json`, JSON.stringify({
  tag: TAG, qs: QS, vfx: VFX, seed: SEED, view: VIEW, dist: DIST, tearSec,
  targetId: pick.target.id, targetPos: pick.target.pos, crop, image: [IW, IH],
  frames: frames.map(f => ({ label: f.label, simMs: f.simMs, tearAge: f.tearAge, ...f.sim })),
}, null, 2));

// ——— LABELED CONTACT SHEET ————————————————————————————————————————————————
// 12 cells is enough for the window plus the release and early flight, and
// keeps the payload small. Tiles are cropped+scaled in Node; the page draws
// the labels (it has fonts; this rig has no image dependency).
const SHEET_PICK = [0, 1, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13, 15, 18, 24, 30].filter(i => i < frames.length - 1);
function cropScale(png, rect, scale) {
  const { w, h, ch, data } = decodePng(png);
  const [cx, cy, cw, chh] = rect;
  const ow = Math.round(cw * scale), oh = Math.round(chh * scale);
  const out = Buffer.alloc(ow * oh * 4);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const sx = Math.min(w - 1, cx + Math.floor(x / scale));
    const sy = Math.min(h - 1, cy + Math.floor(y / scale));
    const si = (sy * w + sx) * ch;
    const di = (y * ow + x) * 4;
    out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2];
    out[di + 3] = ch === 4 ? data[si + 3] : 255;
  }
  return writePng(ow, oh, out);
}
if (SHEET_PICK.length > 0) {
  const scale = Math.max(1, Math.round(320 / crop[2]));
  const tiles = SHEET_PICK.map(i => ({
    label: `f${i} ~${Math.round(frames[i + 1].simMs)}ms`,
    b64: cropScale(frames[i + 1].png, crop, scale).toString('base64'),
  }));
  await ev('window.__sheet = []');
  for (const t of tiles) await ev(`window.__sheet.push(${JSON.stringify(t)})`);
  const dataUrl = await ev(`(async () => {
    const tiles = window.__sheet;
    const imgs = await Promise.all(tiles.map(t => new Promise((ok, err) => {
      const im = new Image(); im.onload = () => ok(im); im.onerror = () => err(new Error('decode'));
      im.src = 'data:image/png;base64,' + t.b64;
    })));
    const cw = imgs[0].naturalWidth, ch = imgs[0].naturalHeight;
    const cols = 4, lh = 26;
    const rows = Math.ceil(imgs.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * cw; cv.height = rows * (ch + lh);
    const g = cv.getContext('2d');
    g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, cv.width, cv.height);
    g.imageSmoothingEnabled = false;
    tiles.forEach((t, i) => {
      const x = (i % cols) * cw, y = Math.floor(i / cols) * (ch + lh);
      g.drawImage(imgs[i], x, y + lh);
      g.fillStyle = '#e8e8e8'; g.font = 'bold 15px monospace'; g.textBaseline = 'top';
      g.fillText(t.label, x + 6, y + 5);
      g.strokeStyle = '#444'; g.strokeRect(x + 0.5, y + 0.5, cw - 1, ch + lh - 1);
    });
    return cv.toDataURL('image/png');
  })()`);
  if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
    const sheet = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
    writeFileSync(`${OUT}/${TAG_FILE}-sheet.png`, sheet);
    console.log(`sheet: ${OUT}/${TAG_FILE}-sheet.png (${tiles.length} tiles, crop ${crop.join(',')}, x${scale})`);
  } else {
    console.log('WARNING: contact sheet composition returned nothing');
  }
}

if (pageErrors.length > 0) {
  console.error(`PAGE ERRORS (${pageErrors.length}):`);
  for (const e of pageErrors.slice(0, 5)) console.error(`  ${e}`);
  fail('the page reported errors');
}
// REGRESSION GATES: a run that produced no separation or no pieces is not a
// candidate, whatever the images look like.
const captured = frames.slice(1);
if (tearSec > 0 && !captured.some(f => f.sim && f.sim.ruptureMaxM > 0.002)) {
  fail('no frame showed the body separating (ruptureMaxM never exceeded 2 mm)');
}
if (!captured.some(f => f.sim && f.sim.live > 0)) fail('no chunks were ever live — the rupture never completed');
if (tearSec <= 0) console.log('CONTROL: gibtear=0 — pieces spawn in the blast frame, like the old path');
console.log(`PASS: ${frames.length} frames in ${OUT} (${TAG_FILE})`);
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
ws.close();
process.exit(0);

function QVS() { return QS.startsWith('&') ? QS : (QS ? `&${QS}` : ''); }
