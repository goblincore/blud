// scripts/sdf-gib-rupture.mjs — THE RUPTURE AS A FRAME SEQUENCE.
//
// The companion of sdf-gib-look.mjs, narrowed to the body-to-gib transition the
// 2026-09-16 task added: the planned regions separating over ~0.2 s before they
// become chunks, with the skeleton exposed in the opening seams. It answers two
// questions no census can:
//   * is the body ACTUALLY separating (the largest region offset climbs), or is
//     it still the intact body held for 200 ms?
//   * does the displayed region become the spawned piece (the hand-off frame)?
//
// The census is printed too: the owner's complaint was "i still dont see
// anything bone related like idk rib cage or something", so the rig prints what
// the body became by name and whether bone rows are in the marched frame.
//
// ⚠ Same two rigging traps the look rig documents: `presentedShot()` (not
// Page.captureScreenshot, which returns a stale compositor frame between steps)
// and a FROZEN loop (or the wanderers walk through the sequence).
//
// Usage: node scripts/sdf-gib-rupture.mjs <vitePort> <cdpPort> [outDir] [qs]
import { mkdirSync, writeFileSync } from 'node:fs';
import { decodePng } from './lib/demo-presented.mjs';

const VITE = Number(process.argv[2] ?? 5399);
const CDP = Number(process.argv[3] ?? 9399);
const OUT = process.argv[4] ?? '/tmp/gib-rupture';
const QS = process.argv[5] ?? '';
mkdirSync(OUT, { recursive: true });
const W = 960, H = 720;
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

const pageErrors = [];
await send('Runtime.enable');
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params).slice(0, 240));
});
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const url = `http://localhost:${VITE}/sdf-game.html?room=arena&frozen=1&vhs=off${QS}`;
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
await ev('window.__sdfGame.setDemoHold(true)');
await ev('window.__sdfGame.setVhs(null)');
await ev('window.__sdfGame.setLoopRunning(false)');
await ev('window.__sdfGame.step(40)');

// STAND IN FRONT OF A BODY. Teleport to the arena centre, then pick the
// zombie NEAREST the player so the rupture fills the frame; the old first-in-
// list pick could be 30 m away and the whole sequence was a few pixels. Then
// aim the camera at that body's torso.
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
await ev(`window.__sdfGame.aimSurface(undefined, ${pick.target.id})`);
await ev('window.__sdfGame.step(2)');
const dist = Math.hypot(pick.target.pos[0] - pick.player[0], pick.target.pos[2] - pick.player[2]);
console.log(`arena bodies: ${pick.count}; target id ${pick.target.id} at `
  + `${pick.target.pos.map(v => v.toFixed(2)).join(', ')} (${dist.toFixed(2)} m from the player)`);
const tearSec = await ev('window.__sdfGame.dynamite().gibTearSec');
console.log(`gibTearSec=${tearSec}  ${QS || '(defaults)'}`);

// 0..30 frames at 60 Hz = 0..500 ms. The release is at ~200 ms = frame ~12, so
// the run brackets the separation, the hand-off and the first flight frames.
const FRAMES = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 13, 14, 16, 20, 24, 30];
let step = 0;
let prevPng = null, prevLabel = null;
let sawSeparating = false, sawPieces = false;
for (const f of FRAMES) {
  if (f > step) { await ev(`window.__sdfGame.step(${f - step})`); step = f; }
  if (f === 0) {
    await ev(`window.__sdfGame.detonate(${pick.target.pos[0]}, ${pick.target.pos[1] + 0.6}, ${pick.target.pos[2]})`);
    await ev('window.__sdfGame.step(1)');
    step = 0;
    const c = await ev('window.__sdfGame.dynamite()');
    console.log(`detonation: mode ${c.gibMode} bones ${c.gibBones} tear ${c.gibTearSec}s `
      + `pendingGibs ${c.pendingGibs} tearing ${c.tearing}`);
  }
  await ev('window.__sdfGame.setLoopRunning(false)');
  const png = await capture();
  const file = `${OUT}/f${String(f).padStart(2, '0')}.png`;
  writeFileSync(file, png);
  if (prevPng) {
    const a = decodePng(prevPng), b = decodePng(png);
    let changed = 0;
    const n = Math.min(a.data.length, b.data.length);
    for (let i = 0; i < n; i += 4) {
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1])
        + Math.abs(a.data[i + 2] - b.data[i + 2]) > 12) changed++;
    }
    if (changed === 0) fail(`${prevLabel} and frame ${f} are byte-identical: the capture is returning a stale frame`);
  }
  prevPng = png; prevLabel = f;
  const d = await ev('window.__sdfGame.dynamite()');
  const chunks = await ev('window.__sdfGame.chunkCensus()');
  if (d.tearing > 0 && d.ruptureMaxM > 0.002) sawSeparating = true;
  if (chunks.live > 0) sawPieces = true;
  console.log(`frame +${String(f).padStart(2)} (${(f / 60 * 1000).toFixed(0)} ms): `
    + `tearing ${d.tearing}${d.tearing ? ` age ${d.tearAge.toFixed(3)} maxOffset ${d.ruptureMaxM.toFixed(4)}m` : ''} `
    + `pendingGibs ${d.pendingGibs} | chunks inFrustum ${chunks.inFrustum}/${chunks.live} `
    + `bonePieces ${chunks.bonePieces} boneRows ${chunks.boneRows} | ${file}`);
}
if (tearSec > 0 && !sawSeparating) fail('no frame showed the body separating (ruptureMaxM never exceeded 2 mm)');
if (!sawPieces) fail('no chunks were ever live — the rupture never completed');
if (tearSec <= 0) console.log('CONTROL: gibtear=0 — pieces spawn in the blast frame, like the old path');
console.log('by name (last):', (await ev('window.__sdfGame.dynamite()')).lastGibParts.join(' '));

if (pageErrors.length > 0) {
  console.error(`PAGE ERRORS (${pageErrors.length}):`);
  for (const e of pageErrors.slice(0, 5)) console.error(`  ${e}`);
  fail('the page reported errors');
}
console.log(`PASS: rupture sequence written — ${FRAMES.length} frames in ${OUT}`);
console.log(`review: ${OUT}/f00.png (blast) through ${OUT}/f12.png (release) to ${OUT}/f30.png`);
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
ws.close();
process.exit(0);
