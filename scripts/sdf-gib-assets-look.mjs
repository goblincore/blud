// scripts/sdf-gib-assets-look.mjs — TASK 3's VISUAL GATE RIG for the offline
// gib assets (docs/superpowers/plans/2026-09-16-offline-gib-assets.md).
//
// WHAT IT IS FOR. Task 2 wired `?gibrender=assets` but ran no GPU pass, so the
// questions this rig exists to answer are the ones a CPU test cannot:
//
//   * does the released mesh keep the DRAWN silhouette across the rupture->flight
//     hand-off (no rest-pose snap), for the ordinary default split?
//   * do the pieces settle ON the floor, and does nothing stay stuck airborne?
//   * is the HEAD still a textured face rather than a blank gore blob?
//   * does a wounded body still lose nothing (fallback counted, not silent)?
//   * what does the load/parse and the moving-gib frame actually cost?
//
// ONE BOOT = ONE ARM. The A/B is `?gibrender=march` vs `?gibrender=assets` with
// the SAME `?seed=`, room, camera bearing, preroll and detonation point, driven
// by the SAME code path — so the frames are matched seed/camera/frame and the
// per-frame telemetry is directly comparable. The gate shell runs an A/A pair as
// the noise floor (see scripts/gib-assets-gate.sh).
//
// RIGGING RULES, both already paid for in this repo:
//   * `presentedShot()` (canvas toDataURL), NOT `Page.captureScreenshot` — the
//     compositor is stale between hand-stepped frames.
//   * the loop is STOPPED and every frame is one `step(1/60)`.
//
// Usage: node scripts/sdf-gib-assets-look.mjs <vitePort> <cdpPort> <outDir> [qs]
// Env:
//   GA_KIND=zombie|soldier   target archetype (default zombie)
//   GA_ROOM=6                room id to teleport to and filter bodies in (6 = arena;
//                            5 = annex, which is the room that HAS soldiers)
//   GA_VIEW=front|threequarter|side|back  camera bearing (default front)
//   GA_DIST=4                camera standoff, metres
//   GA_FRAMES=96             frames captured after the detonation
//   GA_PREROLL=30            settle frames before the blast
//   GA_SETTLE=300            fast-step this many frames, then shoot the pile
//   GA_HIDE_FX=1             kill fire/smoke/ring so the anatomy reads
//   GA_HIDE_VM=0             keep the held view model (default hidden: it covers the body)
//   GA_PRE='<js>'            run this page-side JS just before the detonation
//   GA_WOUNDS=0              stamp this many slug-class wounds on the target first
//   GA_EXTRA=0               detonate this many ADDITIONAL nearby bodies, same frame
//   GA_POST_RESET=0          resetGibAssets() after settle, then re-arm + shoot
//   GA_SETTLE_LOW=1          re-aim at the floor for the settle shot (default 1)
//   GA_SEED=7                demo seed (must match across arms)
import { mkdirSync, writeFileSync } from 'node:fs';
import { decodePng, hashPresented } from './lib/demo-presented.mjs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const OUT = process.argv[4] ?? '/tmp/gib-assets-look';
const QS = process.argv[5] ?? '';

const KIND = process.env.GA_KIND ?? 'zombie';
const ROOM = Number(process.env.GA_ROOM ?? 6);
const VIEW = process.env.GA_VIEW ?? 'front';
const DIST = Number(process.env.GA_DIST ?? 4);
const FRAMES = Number(process.env.GA_FRAMES ?? 96);
const PREROLL = Number(process.env.GA_PREROLL ?? 30);
const SETTLE = Number(process.env.GA_SETTLE ?? 300);
const HIDE_FX = process.env.GA_HIDE_FX === '1';
const HIDE_VM = process.env.GA_HIDE_VM !== '0';
const SETTLE_LOW = process.env.GA_SETTLE_LOW !== '0';
const PRE = process.env.GA_PRE ?? '';
const WOUNDS = Number(process.env.GA_WOUNDS ?? 0);
const EXTRA = Number(process.env.GA_EXTRA ?? 0);
const POST_RESET = process.env.GA_POST_RESET === '1';
const SEED = Number(process.env.GA_SEED ?? 7);
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
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
  if (r?.result?.exceptionDetails) {
    throw new Error(`page threw: ${r.result.exceptionDetails.exception?.description
      ?? r.result.exceptionDetails.text}`);
  }
  return r.result?.result?.value;
};
const captureB64 = async () => {
  const b64 = await ev('window.__sdfGame.presentedShot()');
  if (typeof b64 !== 'string' || b64.length < 100) throw new Error('presentedShot() returned nothing usable');
  return b64;
};
const shot = async (name) => {
  const b64 = await captureB64();
  const png = Buffer.from(b64, 'base64');
  writeFileSync(`${OUT}/${name}.png`, png);
  const d = decodePng(png);
  return { name, file: `${name}.png`, w: d.w, h: d.h, hash: hashPresented(b64).hash };
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
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const url = `http://localhost:${VITE}/sdf-game.html?room=${ROOM}&frozen=1&seed=${SEED}&vhs=off`
  + (QS ? `&${QS.replace(/^\?/, '')}` : '');
console.log(`[${OUT}] opening ${url}`);
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

const modeAtBoot = await ev('window.__sdfGame.gibRenderMode()');
console.log(`gibRenderMode at boot: ${JSON.stringify(modeAtBoot)}`);

await ev('window.__sdfGame.setDemoHold(true)');
await ev('window.__sdfGame.setVhs(null)');
await ev('window.__sdfGame.setLoopRunning(false)');
await ev('window.__sdfGame.step(90)');
if (HIDE_VM) {
  const vm = await ev('window.__sdfGame.setViewModelVisible(false)');
  console.log(`view model visible: ${vm}`);
}
await ev(`window.__sdfGame.teleport(${ROOM})`);
await ev('window.__sdfGame.step(1)');
if (HIDE_FX) {
  const t = await ev(`window.__sdfGame.setExplosionFxTuning({ gain: 0, smokeOpacity: 0, ringOpacity: 0 })`);
  console.log(`hide-fx tuning: gain ${t?.gain} smokeOpacity ${t?.smokeOpacity} ringOpacity ${t?.ringOpacity}`);
}

// Wait for the assets arm to actually arm, so a "load" leg is not silently
// measuring the fallback. The boot preload starts before the first detonation.
if (modeAtBoot?.mode === 'assets') {
  for (let i = 0; i < 120; i++) {
    if (modeAtBoot.assets?.armed) break;
    await sleep(250);
    const m = await ev('window.__sdfGame.gibRenderMode()');
    if (m?.assets?.armed) { console.log(`assets armed after ~${i * 250} ms`); break; }
    if (i === 119) console.log(`WARNING: assets never armed: ${JSON.stringify(m)}`);
  }
}

const pick = await ev(`(() => {
  const pp = window.__sdfGame.playerPos();
  const want = ${JSON.stringify(KIND)};
  const list = window.__sdfGame.actorList().filter(a => a.room === ${ROOM} && a.kind === want);
  if (!list.length) return null;
  list.sort((a, b) =>
    Math.hypot(a.pos[0] - pp[0], a.pos[2] - pp[2]) - Math.hypot(b.pos[0] - pp[0], b.pos[2] - pp[2])
    || a.id - b.id);
  return { target: list[0], count: list.length, kinds: [...new Set(list.map(a => a.kind))] };
})()`);
if (!pick) fail(`no ${KIND} in the arena to detonate on`);
const t = pick.target;
console.log(`target id ${t.id} (${t.kind}) at ${t.pos.map(v => v.toFixed(2)).join(', ')} yaw ${t.yaw.toFixed(2)}; ${pick.count} in arena`);

const fx = Math.sin(t.yaw), fz = -Math.cos(t.yaw);
const rot = VIEW === 'front' ? 0
  : VIEW === 'threequarter' ? (42 * Math.PI / 180)
    : VIEW === 'side' ? (88 * Math.PI / 180)
      : VIEW === 'back' ? Math.PI
        : 0;
const requested = { x: fx * Math.cos(rot) - fz * Math.sin(rot), z: fx * Math.sin(rot) + fz * Math.cos(rot) };

// ——— FRAMING: KEEP ANOTHER BODY OUT OF THE SHOT ————————————————————————
// The arena holds eight zombies. The body NEAREST the camera on the chosen
// bearing used to occupy the right half of the frame (measured 2026-09-16: a
// whole torso between the lens and the target), which hides the very silhouette
// the gate judges. The sim is deterministic across the arms, so a bearing chosen
// from the actor list is identical in both — match preserved. Score every
// candidate by how much of the camera->target segment another body blocks, then
// keep the requested bearing when it ties.
const others = (await ev('window.__sdfGame.actorList()')).filter(a => a.id !== t.id && a.room === ROOM);
const scoreBearing = (bx, bz) => {
  const camX = t.pos[0] + bx * DIST, camZ = t.pos[2] + bz * DIST;
  const dx = t.pos[0] - camX, dz = t.pos[2] - camZ;
  const len2 = dx * dx + dz * dz;
  let score = 0;
  for (const o of others) {
    const tt = ((o.pos[0] - camX) * dx + (o.pos[2] - camZ) * dz) / len2;
    if (tt < 0.02 || tt > 1.05) continue;
    const px = camX + dx * tt, pz = camZ + dz * tt;
    const perp = Math.hypot(o.pos[0] - px, o.pos[2] - pz);
    if (perp < 0.95) score += 0.95 - perp;
  }
  return score;
};
let bx = requested.x, bz = requested.z;
let best = scoreBearing(bx, bz);
for (let i = 1; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  const cx = Math.sin(a), cz = Math.cos(a);
  const s = scoreBearing(cx, cz);
  if (s < best - 0.01) { best = s; bx = cx; bz = cz; }
}
const bearingPick = { requested: { x: requested.x, z: requested.z }, chosen: { x: bx, z: bz }, blockedScore: best, others: others.length };
console.log(`framing bearing chosen ${JSON.stringify(bearingPick)}`);

const AIM_Y = t.pos[1] + 1.05;
const eyeY = await ev(`(() => {
  window.__sdfGame.placePlayer({ x: ${t.pos[0] + bx * DIST}, z: ${t.pos[2] + bz * DIST}, yaw: 0, pitch: 0 });
  window.__sdfGame.step(1);
  return window.__sdfGame.cameraWorld()[1];
})()`);
const yawTo = (px, pz, tx, tz) => Math.atan2(tx - px, -(tz - pz));
const pitchTo = (px, py, pz, tx, ty, tz) => Math.atan2(ty - py, Math.hypot(tx - px, tz - pz));
const blast = [t.pos[0], AIM_Y, t.pos[2]];
const yaw0 = yawTo(t.pos[0] + bx * DIST, t.pos[2] + bz * DIST, t.pos[0], t.pos[2]);
const pitch0 = pitchTo(t.pos[0] + bx * DIST, eyeY, t.pos[2] + bz * DIST, t.pos[0], AIM_Y, t.pos[2]);
const place = async () => {
  const px = t.pos[0] + bx * DIST, pz = t.pos[2] + bz * DIST;
  await ev(`window.__sdfGame.setPose(${JSON.stringify(px)}, ${JSON.stringify(pz)}, ${JSON.stringify(yaw0)}, ${JSON.stringify(pitch0)}, 0)`);
  await ev('window.__sdfGame.setLoopRunning(false)');
};
await place();
await ev(`window.__sdfGame.step(${PREROLL})`);
await place();
await ev('window.__sdfGame.step(1)');

if (WOUNDS > 0) {
  // Slug-class craters through the same `stampWoundAt` seam the pellet path
  // uses — "partial wounds" without the shove/sever of a real hit. Deterministic
  // (the bleed stream draws the same number of times in both arms).
  const ox = t.pos[0] + bx * DIST, oz = t.pos[2] + bz * DIST;
  const w = await ev(`(() => {
    const g = window.__sdfGame;
    const out = [];
    const ox = ${ox}, oy = ${eyeY}, oz = ${oz};
    for (let i = 0; i < ${WOUNDS}; i++) {
      const ty = ${AIM_Y} + ((i % 2) ? 0.12 : -0.12);
      const tx = ${t.pos[0]} + (i % 3 - 1) * 0.10;
      const tz = ${t.pos[2]};
      const dx = tx - ox, dy = ty - oy, dz = tz - oz;
      const L = Math.hypot(dx, dy, dz) || 1;
      out.push(!!g.stampWoundAt(ox, oy, oz, dx / L, dy / L, dz / L, 'slug', ${t.id}));
    }
    return out;
  })()`);
  console.log(`GA_WOUNDS ${WOUNDS}: ${JSON.stringify(w)}`);
  await ev('window.__sdfGame.setLoopRunning(false)');
}

if (PRE) {
  const preResult = await ev(PRE);
  console.log(`GA_PRE -> ${JSON.stringify(preResult)?.slice(0, 400)}`);
  await ev('window.__sdfGame.setLoopRunning(false)');
}

const pre = await shot('f000-pre');
const screenBlast = await ev(`window.__sdfGame.screenPosOf(${blast[0]}, ${blast[1]}, ${blast[2]})`);
console.log(`pre frame ${pre.w}x${pre.h}; blast point ${blast.map(v => v.toFixed(2)).join(', ')} `
  + `screen ${JSON.stringify(screenBlast)}`);
if (screenBlast && (Math.abs(screenBlast.x) > 0.9 || Math.abs(screenBlast.y) > 0.9)) {
  console.log('WARNING: the blast point is near/off frame edge — the crop may miss the body');
}

// LOADER COST. Read the library's own builtMs (decode+BufferAttribute wrapping)
// and, on the assets arm, re-time a full reset -> preload cycle so a rig run
// reports cold and warm loader cost without a second boot.
let loader = null;
if (modeAtBoot?.mode === 'assets') {
  loader = await ev(`(async () => {
    const g = window.__sdfGame;
    const warm = await (async () => {
      const t0 = performance.now();
      g.resetGibAssets();
      const armed = await g.preloadGibAssets();
      return { ms: performance.now() - t0, armed, library: g.gibAssetLibrary() };
    })();
    return { warm, library: g.gibAssetLibrary(), stats: g.gibAssetStats() };
  })()`);
  try {
    await ev('window.__sdfGame.setGibRenderMode("assets")');
    await ev('window.__sdfGame.setLoopRunning(false)');
  } catch (e) { console.log(`WARNING: re-arm after loader probe failed: ${e.message}`); }
  await place();
  await ev('window.__sdfGame.step(1)');
}

const det = await ev(`window.__sdfGame.detonate(${blast[0]}, ${blast[1]}, ${blast[2]})`);
console.log(`detonate: ${JSON.stringify(det)}`);
let extraDet = null;
if (EXTRA > 0) {
  // MULTIPLE SIMULTANEOUS BODIES: detonate the next-nearest bodies in the SAME
  // frame, before any step, so the pieces from all of them share the frame. The
  // RNG draw order is identical in both arms, so the arms stay matched.
  extraDet = await ev(`(() => {
    const g = window.__sdfGame;
    const list = g.actorList().filter(a => a.room === ${ROOM} && a.kind === ${JSON.stringify(KIND)} && a.id !== ${t.id});
    list.sort((a, b) =>
      Math.hypot(a.pos[0] - ${blast[0]}, a.pos[2] - ${blast[2]})
      - Math.hypot(b.pos[0] - ${blast[0]}, b.pos[2] - ${blast[2]}) || a.id - b.id);
    return list.slice(0, ${EXTRA}).map(a =>
      g.detonate(a.pos[0], a.pos[1] + 0.6, a.pos[2]));
  })()`);
  console.log(`extra detonations (${EXTRA}): ${JSON.stringify(extraDet)}`);
}

const frames = [];
for (let i = 1; i <= FRAMES; i++) {
  await ev('window.__sdfGame.setLoopRunning(false)');
  await ev('window.__sdfGame.step(1)');
  const s = await shot(`f${String(i).padStart(3, '0')}`);
  const tel = await ev(`(() => {
    const d = window.__sdfGame.dynamite();
    const cs = window.__sdfGame.chunkStats();
    const cc = window.__sdfGame.chunkCensus();
    const sc = window.__sdfGame.spriteCensus();
    const states = window.__sdfGame.chunkStates();
    const bp = window.__sdfGame.screenPosOf(${blast[0]}, ${blast[1]}, ${blast[2]});
    return {
      tearing: d.tearing, tearAge: Number((d.tearAge ?? 0).toFixed(3)),
      gibbed: d.gibbed, gibPieces: d.gibPieces, lastGibTier: d.lastGibTier,
      lastGibParts: d.lastGibParts?.length ?? null, pendingGibs: d.pendingGibs,
      live: cs.live, baked: cs.baked, views: cs.views, faceBaked: cs.faceBaked,
      censusLive: cc.live, censusCap: cc.cap, inFrustum: cc.inFrustum,
      bonePieces: cc.bonePieces, boneRows: cc.boneRows, organPieces: cc.organPieces,
      bonesShadingAsMeat: cc.bonesShadingAsMeat,
      spriteLive: sc.live, spriteRest: sc.rest, spriteMeshes: sc.meshes,
      moving: states.length, settled: states.filter(p => p.settled).length,
      minY: states.length ? Math.min(...states.map(p => p.pos[1])) : null,
      gibAssets: cs.gibAssets,
      screenBlast: bp, camera: window.__sdfGame.cameraWorld(),
    };
  })()`);
  tel.file = s.file;
  tel.hash = s.hash;
  frames.push(tel);
  if (i <= 6 || i % 12 === 0) {
    console.log(`  f${String(i).padStart(3, '0')} tear ${tel.tearing} age ${tel.tearAge} `
      + `live ${tel.live} sprite ${tel.spriteLive}/${tel.spriteRest} baked ${tel.baked} `
      + `face ${tel.faceBaked} assets ${tel.gibAssets.assetPieces} settled ${tel.settled}/${tel.moving}`);
  }
}

// SETTLE: fast-step and shoot the pile from floor height.
let settle = null;
if (SETTLE > 0) {
  await ev(`window.__sdfGame.step(${SETTLE})`);
  await ev('window.__sdfGame.setLoopRunning(false)');
  if (SETTLE_LOW) {
    const aimLow = Math.max(0.12, AIM_Y - 0.75);
    const px = t.pos[0] + bx * DIST, pz = t.pos[2] + bz * DIST;
    const yaw = yawTo(px, pz, t.pos[0], t.pos[2]);
    const pitch = pitchTo(px, eyeY, pz, t.pos[0], aimLow, t.pos[2]);
    await ev(`window.__sdfGame.setPose(${JSON.stringify(px)}, ${JSON.stringify(pz)}, ${JSON.stringify(yaw)}, ${JSON.stringify(pitch)}, 0)`);
  }
  await ev('window.__sdfGame.step(1)');
  const s = await shot('settle-floor');
  const settleTel = await ev(`(() => {
    const cs = window.__sdfGame.chunkStats();
    const states = window.__sdfGame.chunkStates();
    const airborne = states.filter(p => !p.settled && p.pos[1] > 0.05);
    return {
      live: cs.live, baked: cs.baked, faceBaked: cs.faceBaked,
      spriteLive: window.__sdfGame.spriteCensus().live,
      settled: states.filter(p => p.settled).length, total: states.length,
      airborne: airborne.length,
      lowY: states.map(p => Number(p.pos[1].toFixed(3))).sort((a, b) => a - b).slice(0, 8),
      highY: states.map(p => Number(p.pos[1].toFixed(3))).sort((a, b) => b - a).slice(0, 4),
      gibAssets: cs.gibAssets,
    };
  })()`);
  settle = { ...settleTel, file: s.file, hash: s.hash };
  console.log(`settle +${SETTLE}: live ${settle.live} sprite ${settle.spriteLive} settled `
    + `${settle.settled}/${settle.total} airborne ${settle.airborne} lowY ${settle.lowY.join(', ')}`);
}

const finalMode = await ev('window.__sdfGame.gibRenderMode()');
const finalStats = await ev('window.__sdfGame.gibAssetStats()');

// RESET LEG: drop every piece and every cached library, then re-arm and shoot.
// Proves the pooled buffers come back and a reload leaves a working library.
let postReset = null;
if (POST_RESET) {
  postReset = await ev(`(async () => {
    const g = window.__sdfGame;
    const dropped = g.resetGibAssets();
    const c = g.spriteCensus();
    const libAfterReset = g.gibAssetLibrary();
    const armed = await g.preloadGibAssets();
    return { dropped, censusAfterReset: c, libAfterReset, rearmed: armed,
             stats: g.gibAssetStats(), library: g.gibAssetLibrary() };
  })()`);
  await ev('window.__sdfGame.setLoopRunning(false)');
  await ev('window.__sdfGame.step(1)');
  const s = await shot('post-reset');
  postReset.file = s.file;
  console.log(`post-reset: dropped ${postReset.dropped}, census ${JSON.stringify(postReset.censusAfterReset)}, `
    + `rearmed ${postReset.rearmed}`);
}

writeFileSync(`${OUT}/telemetry.json`, JSON.stringify({
  qs: QS, kind: KIND, view: VIEW, dist: DIST, frames: FRAMES, preroll: PREROLL,
  seed: SEED, hideFx: HIDE_FX, hideVm: HIDE_VM, pre: PRE, wounds: WOUNDS, extra: EXTRA,
  modeAtBoot, finalMode, loader, finalStats, bearingPick, extraDet,
  target: t, blast, screenBlast, detonate: det, postReset,
  width: pre.w, height: pre.h, settle, perFrame: frames, pageErrors,
}, null, 2));

if (pageErrors.length) {
  console.error(`PAGE ERRORS (${pageErrors.length})`);
  for (const e of pageErrors.slice(0, 5)) console.error('  ' + e);
  fail('the page reported errors');
}
console.log(`PASS: ${FRAMES} frames + settle -> ${OUT}`);
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
