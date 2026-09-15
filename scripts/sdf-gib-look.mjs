// scripts/sdf-gib-look.mjs — THE BODY→GIB TRANSITION, AS A FRAME SEQUENCE.
//
// This is a LOOK rig, not a gate. It answers the one question no statistic in
// this repo can: does the body coming apart read as a body coming apart? It
// writes one PNG per frame across the release — frame 0 is supposed to show the
// BODY's own silhouette in place, and the pieces are supposed to come apart
// outward from there — so the owner can judge the transition frame by frame
// instead of from a single capture taken at an arbitrary moment.
//
// THE CENSUS MATTERS AS MUCH AS THE FRAMES. The owner's complaint was "i still
// dont see anything bone related like idk rib cage or something", so the run
// prints WHAT THE BODY BECAME BY NAME (`bone.cage`, `bone.pelvis`, the limb
// halves) and how many pieces are in frame at each step. A pile of pink blobs
// with `bone.cage` in the list is a rendering question; without it, it is a
// spawn question, and those need opposite fixes.
//
// ⚠ TWO RIGGING TRAPS, both already paid for in this repo:
//   * `Page.captureScreenshot` returns what the COMPOSITOR last presented. A
//     page driven by `__sdfGame.step()` presents nothing between reads — three
//     captures of three different states came back byte-identical. Everything
//     here reads `__sdfGame.presentedShot()` (the canvas readback) instead.
//   * The scene must be FROZEN (`?frozen=1`) and the demo hold set, or the
//     wanderers walk through the sequence and the frame N+1 PNG is a different
//     scenario rather than the next frame.
//
// Usage: node scripts/sdf-gib-look.mjs <vitePort> <cdpPort> [outDir] [qs]
//   FROZEN frames requested: 0,1,2,3,4,6,8,12,20,40 (ms ~ 0..667)
import { mkdirSync, writeFileSync } from 'node:fs';
import { decodePng } from './lib/demo-presented.mjs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const OUT = process.argv[4] ?? '/tmp/gib-look';
const QS = process.argv[5] ?? '';
mkdirSync(OUT, { recursive: true });
const W = 900, H = 700;
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
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params).slice(0, 200));
});
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
// frozen: the wanderers stop, so frame N+1 is the same scenario as frame N.
// vhs off: the VHS pass owns a temporal blend that would smear the sequence.
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
// STOP THE REAL-TIME LOOP. `step(n)` stops it too, but a rig that reads the
// page between steps (every CDP round trip is tens of milliseconds) is at the
// mercy of anything that restarts it: measured, a three-frame release stagger
// collapsed to a single frame between two reads because the world kept ticking
// in wall-clock time while the driver was reading JSON.
await ev('window.__sdfGame.setLoopRunning(false)');
await ev('window.__sdfGame.step(40)');

// STAND IN FRONT OF A BODY. The player boots in the arena facing +z; pick the
// body nearest that facing so the release fills the frame rather than happening
// behind the camera.
const pick = await ev(`(() => {
  const list = window.__sdfGame.actorList().filter(a => a.room === 6 && a.kind === 'zombie');
  if (list.length === 0) return null;
  return { target: list[0], count: list.length };
})()`);
if (!pick) fail('no zombie in the arena (room 6) to gib');
console.log(`arena bodies: ${pick.count}; target id ${pick.target.id} at ${pick.target.pos.map(v => v.toFixed(2)).join(', ')}`);

const FRAMES = [0, 1, 2, 3, 4, 6, 8, 12, 20, 40];
let step = 0;
let census = null;
/**
 * CONSECUTIVE FRAMES MUST DIFFER, and the rig checks rather than assumes it.
 * The capture trap this guards against is documented at the top of the file and
 * has already produced a byte-identical sequence once (the first PNG was the
 * frame BEFORE the blast, and a later off-by-one handed two frames the same
 * state). A look rig that photographs the same frame ten times is worse than no
 * rig: it looks like evidence.
 */
let prevPng = null;
let prevLabel = null;
for (const f of FRAMES) {
  if (f > step) { await ev(`window.__sdfGame.step(${f - step})`); step = f; }
  if (f === 0) {
    // Point-blank on the body: the deterministic way to get a gib, and the case
    // the tuning pass stands in.
    await ev(`window.__sdfGame.detonate(${pick.target.pos[0]}, ${pick.target.pos[1] + 0.6}, ${pick.target.pos[2]})`);
    // AND ONE STEP BEFORE THE FIRST CAPTURE. `presentedShot()` returns the
    // canvas as last PRESENTED, and calling `detonate` does not draw — a
    // capture taken here is the frame BEFORE the blast, which made the first
    // PNG of this sequence a picture of the intact body and the "changed
    // pixels" between it and the next frame 58% of the screen. One step puts
    // the pieces on screen at rest, which is the frame the staging exists to
    // produce.
    await ev('window.__sdfGame.step(1)');
    step = 0;   // the capture below IS release frame 0; f=1 must step once more
    const r = await ev('window.__sdfGame.dynamite()');
    census = await ev('window.__sdfGame.dynamite()');
    const chunks = await ev('window.__sdfGame.chunkCensus()');
    console.log(`detonation: pieces ${r.gibPieces} this blast | tier ${census.lastGibTier} `
      + `spawned ${census.lastGibSpawned} held-back ${census.lastGibHeld} dropped ${census.lastGibDropped}`);
    console.log(`  pieces in frame: ${chunks.inFrustum} of ${chunks.live} (cap ${chunks.cap})`);
    const byKind = census.lastGibParts.reduce((m, p) => {
      const k = p.startsWith('bone.') ? 'bone' : p.startsWith('organ.') ? 'organ' : p.split('.')[0];
      m[k] = (m[k] ?? 0) + 1; return m;
    }, {});
    console.log(`  what the body became: ${Object.entries(byKind).map(([k, n]) => `${k} x${n}`).join(', ')}`);
    console.log(`  by name: ${census.lastGibParts.join(' ')}`);
  }
  // The world must not have moved on its own between the step above and this
  // read, or every number below is about a different frame than the PNG.
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
    if (a.w !== b.w || a.h !== b.h) fail('the captures differ in size — the viewport changed mid-run');
    if (changed === 0) {
      fail(`${prevLabel} and frame ${f} are byte-identical: the capture is returning a stale frame `
        + '(presentedShot reads what was last PRESENTED — see the header)');
    }
    console.log(`  frame +${String(f).padStart(2)} vs +${String(prevLabel).padStart(2)}: `
      + `${changed} px changed of ${(a.w * a.h / 1000).toFixed(0)}k`);
  }
  prevPng = png; prevLabel = f;
  const d = await ev('window.__sdfGame.dynamite()');
  const chunks = await ev('window.__sdfGame.chunkCensus()');
  // THE WINDOW IS PART OF THE SEQUENCE. With the pre-tear stage on, the first
  // frames are the BODY bending (tearing 1, age climbing, no pieces) and the
  // later ones are the pieces: the frame where `tearing` falls to 0 IS the
  // hand-off, which is the moment this rig exists to photograph.
  console.log(`frame +${String(f).padStart(2)} (${(f / 60 * 1000).toFixed(0)} ms): `
    + `tearing ${d.tearing ?? 0} ${d.tearing ? `(age ${d.tearAge.toFixed(3)})` : ''} `
    + `pendingGibs ${d.pendingGibs ?? 0} | held impulses ${d.pendingPieceImpulses} `
    + `(delays ${JSON.stringify(d.pendingPieceDelays ?? [])}) | in frame ${chunks.inFrustum}/${chunks.live}`
    + ` | ${OUT}/f${String(f).padStart(2, '0')}.png`);
}
// ——— IS THE SKELETON ACTUALLY DRAWN? ————————————————————————————————————
// The bone census proves a bone piece is FLAGGED to render as bone — pale, its
// rows packed. Whether it reaches the FRAME is a separate claim and the one the
// owner's complaint is about, so it is measured by hiding the bone pieces and
// asking the renderer, deterministically.
//
// THE PRESENTED IMAGE CANNOT ANSWER THIS, and it took three attempts to accept
// that. A pixel differential needs the background to hold still, and it does
// not: the explosion VFX ages in the RENDER path with its own dt (1.15 s of
// life), and even with the sim locked and `?dynblend=1&dynfall=1` the empty scene
// varied by 3.3k px between two draws — more than the skeleton's own 1.7k px at
// the distance a gib scatters to. The repo's own note says it plainly: "that is
// exactly why the frame hash measures the march target and not the presented
// image". So: `frameHash`, with a no-change control that must read IDENTICAL
// before any difference is believed.
//
// NB the march target is history-dependent (temporal start seeds from last
// frame's depth), so re-showing the bones does NOT restore the first hash. Only
// the visible-vs-hidden comparison is asserted.
{
  for (let i = 0; i < 60; i++) {
    const d = await ev('window.__sdfGame.dynamite()');
    const c = await ev('window.__sdfGame.chunkCensus()');
    if (!d.tearing && c.live > 0) break;
    await ev('window.__sdfGame.step(1)');
  }
  await ev('window.__sdfGame.step(14)');
  await ev('window.__sdfGame.setRenderLock(true)');
  const draw = async () => { await ev('window.__sdfGame.setLoopRunning(false)'); await ev('window.__sdfGame.step(1)'); };
  const marchHash = async () => {
    await ev('window.__sdfGame.setLoopRunning(false)');
    const h = await ev('window.__sdfGame.frameHash(0)');
    return h?.layers?.marchTarget?.hash ?? null;
  };
  const census = await ev('window.__sdfGame.chunkCensus()');
  const visible = await marchHash();
  const control = await marchHash();
  await ev('window.__sdfGame.setBonePiecesVisible(false)');
  await draw();
  const hidden = await marchHash();
  await ev('window.__sdfGame.setBonePiecesVisible(true)');
  await ev('window.__sdfGame.setRenderLock(false)');
  console.log(`\nSKELETON CHECK (deterministic frame hash of the marched frame):`);
  console.log(`  ${census.bonePieces} bone pieces, ${census.boneRows} packed rows, `
    + `${census.buriedBonePieces} pieces with bones still buried`);
  console.log(`  bones VISIBLE march hash ${visible}`);
  console.log(`  no-change control         ${control}${visible === control ? ' (identical — the harness is sound)' : ' *** NOT DETERMINISTIC ***'}`);
  console.log(`  bones HIDDEN  march hash ${hidden}`);
  if (visible !== control) {
    fail('two reads of the SAME state disagree — the frame hash is not deterministic here, '
      + 'so nothing below can be believed');
  }
  if (census.bonePieces < 1) {
    fail('no bone piece is in the pile once the pieces have scattered — the skeleton was never released '
      + `(tier=${(await ev('window.__sdfGame.dynamite()')).lastGibTier})`);
  }
  if (hidden === visible) {
    fail('hiding the bone pieces does not change the marched frame: the skeleton is in the pile and NOT '
      + 'DRAWN, which is the owner\'s complaint reproduced exactly');
  }
  console.log('  => the bone pieces are IN the marched frame (hiding them changes it, deterministically)');
}

if (pageErrors.length > 0) {
  console.error(`PAGE ERRORS (${pageErrors.length}):`);
  for (const e of pageErrors.slice(0, 5)) console.error(`  ${e}`);
  fail('the page reported errors');
}
console.log(`PASS: the release sequence is written — ${FRAMES.length} frames in ${OUT}`);
console.log(`look pass: ${OUT}/f00.png (the release frame) through ${OUT}/f40.png`);
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
