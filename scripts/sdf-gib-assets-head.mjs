// scripts/sdf-gib-assets-head.mjs — TASK 3's DETACHED-HEAD gate, renderer-
// agnostic. The sibling look rig frames the whole body from a fixed standoff, so
// the head is a small ball; this rig FOLLOWS the head piece and re-aims at it
// every frame, during flight and after it settles.
//
// IT WORKS IN BOTH ARMS, which is the point. The marched head lives in
// `chunkStats().livePieces` and then BAKES into `chunkStats().pieces` (where it
// picks up its face material). The asset head is a sprite-piece mesh and never
// bakes. `chunkStates()` already unifies live+sprite rows by `limb`, so the
// head is found there first, and the baked row is the fallback.
//
// Usage: node scripts/sdf-gib-assets-head.mjs <vitePort> <cdpPort> <outDir> [qs]
// Env: HEAD_DIST=1.25  HEAD_FRAMES=8  HEAD_SETTLE=900  HEAD_KIND=zombie
import { mkdirSync, writeFileSync } from 'node:fs';
import { decodePng } from './lib/demo-presented.mjs';

const VITE = Number(process.argv[2] ?? 5297);
const CDP = Number(process.argv[3] ?? 9297);
const OUT = process.argv[4] ?? '/tmp/gib-assets-head';
const QS = process.argv[5] ?? '';
const DIST = Number(process.env.HEAD_DIST ?? 1.25);
const FRAMES = Number(process.env.HEAD_FRAMES ?? 8);
const SETTLE = Number(process.env.HEAD_SETTLE ?? 900);
const KIND = process.env.HEAD_KIND ?? 'zombie';
const SEED = Number(process.env.HEAD_SEED ?? 7);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, e) => { ws.onopen = ok; ws.onerror = e; });
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (mm, p = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method: mm, params: p })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
  if (r?.result?.exceptionDetails) throw new Error(`page threw: ${r.result.exceptionDetails.exception?.description}`);
  return r.result?.result?.value;
};
const shot = async (name) => {
  const b64 = await ev('window.__sdfGame.presentedShot()');
  const png = Buffer.from(b64, 'base64');
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
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 720, deviceScaleFactor: 1, mobile: false });

const url = `http://localhost:${VITE}/sdf-game.html?room=arena&frozen=1&seed=${SEED}&vhs=off`
  + (QS ? `&${QS.replace(/^\?/, '')}` : '');
console.log(`opening ${url}`);
await send('Page.navigate', { url });
for (let i = 0; i < 240; i++) { await sleep(500); if (await ev('typeof window.__sdfGame === "object"').catch(() => false)) break; if (i === 239) fail('__sdfGame never appeared'); }
for (let i = 0; i < 60; i++) { if (await ev('window.__sdfGame.gunReady === true').catch(() => false)) break; await sleep(500); if (i === 59) fail('view-model never ready'); }
for (let i = 0; i < 80; i++) { if (await ev('!!window.__warmDone').catch(() => false)) break; await sleep(250); }
await sleep(500);

const modeAtBoot = await ev('window.__sdfGame.gibRenderMode()');
console.log(`mode ${modeAtBoot.mode} assets ${JSON.stringify(modeAtBoot.assets)}`);
if (modeAtBoot.mode === 'assets') {
  for (let i = 0; i < 120; i++) { if ((await ev('window.__sdfGame.gibRenderMode()')).assets.armed) break; await sleep(250); }
}
await ev('window.__sdfGame.setDemoHold(true)');
await ev('window.__sdfGame.setVhs(null)');
await ev('window.__sdfGame.setLoopRunning(false)');
await ev('window.__sdfGame.setViewModelVisible(false)');
await ev('window.__sdfGame.step(40)');
await ev('window.__sdfGame.teleport(6)');
await ev('window.__sdfGame.step(1)');

const pick = await ev(`(() => {
  const pp = window.__sdfGame.playerPos();
  const list = window.__sdfGame.actorList().filter(a => a.room === 6 && a.kind === ${JSON.stringify(KIND)});
  if (!list.length) return null;
  list.sort((a, b) => Math.hypot(a.pos[0]-pp[0], a.pos[2]-pp[2]) - Math.hypot(b.pos[0]-pp[0], b.pos[2]-pp[2]) || a.id - b.id);
  return list[0];
})()`);
if (!pick) fail(`no ${KIND} in the arena`);
const t = pick;
const fx = Math.sin(t.yaw), fz = -Math.cos(t.yaw);
const bx = fx, bz = fz; // body front bearing
const eyeY = await ev(`(() => {
  window.__sdfGame.placePlayer({ x: ${t.pos[0] + bx * 3}, z: ${t.pos[2] + bz * 3}, yaw: 0, pitch: 0 });
  window.__sdfGame.step(1);
  return window.__sdfGame.cameraWorld()[1];
})()`);
const yawTo = (px, pz, tx, tz) => Math.atan2(tx - px, -(tz - pz));
const pitchTo = (px, py, pz, tx, ty, tz) => Math.atan2(ty - py, Math.hypot(tx - px, tz - pz));
const frameAt = async (c) => {
  const px = c[0] + bx * DIST, pz = c[2] + bz * DIST;
  const yaw = yawTo(px, pz, c[0], c[2]);
  const pitch = pitchTo(px, eyeY, pz, c[0], c[1], c[2]);
  await ev(`window.__sdfGame.setPose(${JSON.stringify(px)}, ${JSON.stringify(pz)}, ${JSON.stringify(yaw)}, ${JSON.stringify(pitch)}, 0)`);
  await ev('window.__sdfGame.setLoopRunning(false)');
  await ev('window.__sdfGame.step(1)');
};
const headState = async () => ev(`(() => {
  const g = window.__sdfGame;
  const st = g.chunkStates();
  const live = st.find(p => String(p.limb) === 'head') ?? null;
  const cs = g.chunkStats();
  const baked = cs.pieces.find(p => p.id === (live ? live.id : -1) && p.face) ?? cs.pieces.find(p => p.face) ?? null;
  const anyBaked = cs.pieces.find(p => p.id === (live ? live.id : -1)) ?? null;
  return { live, baked, anyBaked, faceBaked: cs.faceBaked, spriteLive: g.spriteCensus().live,
           liveChunks: cs.live, bakedCount: cs.baked, gibAssets: cs.gibAssets, mode: g.gibRenderMode().mode };
})()`);

await frameAt([t.pos[0], t.pos[1] + 1.6, t.pos[2]]);
await shot('head-onset');
console.log(`onset target ${t.id} at ${t.pos.map(v => v.toFixed(2)).join(', ')}`);

await ev(`window.__sdfGame.detonate(${t.pos[0]}, ${t.pos[1] + 0.6}, ${t.pos[2]})`);
await ev('window.__sdfGame.setLoopRunning(false)');

const flight = [];
for (let i = 0; i < FRAMES + 20; i++) {
  await ev('window.__sdfGame.setLoopRunning(false)');
  await ev('window.__sdfGame.step(1)');
  const h = await headState();
  const c = h.live ? h.live.pos : null;
  if (c) {
    await frameAt(c);
    const s = await shot(`head-flight-${String(i).padStart(2, '0')}`);
    flight.push({ i, file: s.file, pos: c, quat: h.live.quat, faceBaked: h.faceBaked, spriteLive: h.spriteLive });
    if (i % 2 === 0) console.log(`  flight +${i}: head ${c.map(v => v.toFixed(2)).join(', ')} faceBaked ${h.faceBaked}`);
  }
  if (flight.length >= FRAMES) break;
}

// SETTLE + BAKE. The face material is only created when the marched head chunk
// BAKES (the same is true in normal play), so the loop keeps following the head
// until `headState().baked` reports a face material — not merely until the live
// chunk stops moving. That early stop is why the first run reported faceBaked 0
// on both arms: it photographed the SAME head one step before its face existed.
let settled = null;
let settledLive = null;
let steps = 0;
while (steps < SETTLE) {
  const h = await headState();
  const c = h.live ? h.live.pos : (h.baked ? h.baked.centre : null);
  if (c) await frameAt(c);
  if (h.live?.settled && !settledLive) {
    settledLive = await shot('head-settled');
    settledLive.pos = h.live.pos;
    settledLive.settled = true;
  }
  if (h.baked) {
    await frameAt(h.baked.centre);
    settled = { file: (await shot('head-baked')).file, pos: h.baked.centre, faceBaked: h.faceBaked,
                bakedFaceId: h.baked.id, spriteLive: h.spriteLive, atSteps: steps };
    break;
  }
  await ev('window.__sdfGame.setLoopRunning(false)');
  await ev('window.__sdfGame.step(20)');
  await sleep(150); // let the bake worker answer between chunks
  steps += 20;
}
if (!settled && settledLive) settled = settledLive;
if (!settled) {
  const h = await headState();
  const c = h.live ? h.live.pos : null;
  if (c) { await frameAt(c); settled = { file: (await shot('head-settled')).file, pos: c, faceBaked: h.faceBaked, atSteps: steps, forced: true }; }
}
console.log(`settle after ${steps} steps: ${JSON.stringify(settled)}`);

const finalState = await headState();
writeFileSync(`${OUT}/head-telemetry.json`, JSON.stringify({
  qs: QS, mode: modeAtBoot.mode, dist: DIST, frames: FRAMES, seed: SEED,
  target: t, modeAtBoot, flight, settled, finalState, pageErrors,
}, null, 2));

if (pageErrors.length) { console.error(`PAGE ERRORS (${pageErrors.length})`); pageErrors.slice(0, 5).forEach(e => console.error('  ' + e)); }
console.log(`PASS: head gate -> ${OUT}`);
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
