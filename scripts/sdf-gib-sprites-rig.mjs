// scripts/sdf-gib-sprites-rig.mjs — DOES A BLAST ACTUALLY SPAWN SPRITES, AND ARE
// THEY DRAWN?
//
// The sheet shipped as a BENCH: `?gibparts=sheet` lays 154 billboards in front of
// the player and that was the whole delivery. Wiring it into a real detonation is
// the next task's job, and the claims that wiring makes are exactly the ones this
// rig checks — each of them a claim that a screenshot alone cannot settle:
//
//   1. A blast in `?gibrender=sprite` spawns BILLBOARDS AND NO MARCHED PIECES.
//      The tempting bug is a mode that spawns both (every marched assertion keeps
//      passing while the frame fills with the thing we are trying to replace), so
//      the marched count is asserted to be ZERO, not merely ignored.
//   2. The pieces are PHYSICALLY REAL: they fall to the floor, come to rest, and
//      stop being stepped — i.e. the sprite path really is the same `Chunk` state
//      through the same stepper, and the park-on-settle rule runs. This is the
//      assertion that would catch a "sprite" implementation that is just a quad
//      hung off a body with no physics at all, which would look right for exactly
//      one frame.
//   3. They are DRAWN — hidden-vs-shown on the PRESENTED frame, read through
//      `presentedShot` (the canvas, i.e. what the owner sees), not from the scene
//      graph. A mesh can be in the scene and never composited; the sprite path is
//      unlit `MeshBasicNodeMaterial` and that is precisely the kind of thing the
//      deferred router is entitled to drop.
//   4. The cap HOLDS — the sprite path's stand-in for the marched view pool, and
//      the thing that replaced the tier ladder. A pool that never binds is a pool
//      nobody has tested.
//   5. The mode is OPT-IN: booting with no query spawns marched pieces and zero
//      sprites. This is the whole reason the change was allowed to land.
//
// Usage: node scripts/sdf-gib-sprites-rig.mjs [vitePort] [cdpPort]
//   SPRITE_RIG_QS='&gibtear=0'   drive a knobbed arm
import { mkdirSync, writeFileSync } from 'node:fs';
import { decodePng } from './lib/demo-presented.mjs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const OUT = '/tmp/gib-sprites-rig';
mkdirSync(OUT, { recursive: true });
const SEND_TIMEOUT_MS = Number(process.env.SPRITE_RIG_TIMEOUT_MS ?? 60000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, e) => { ws.onopen = ok; ws.onerror = e; });
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (mm, p = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(new Error(`CDP ${mm} timed out after ${SEND_TIMEOUT_MS} ms (page unresponsive?)`));
  }, SEND_TIMEOUT_MS);
  pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
  ws.send(JSON.stringify({ id, method: mm, params: p }));
});
ws.addEventListener('close', () => { for (const [, r] of pending) r({ error: 'socket closed' }); pending.clear(); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) {
    throw new Error(`page threw: ${JSON.stringify(r.result.exceptionDetails.exception?.description
      ?? r.result.exceptionDetails.text)}`);
  }
  return r.result?.result?.value;
};
process.on('unhandledRejection', (e) => { console.error(`FAIL: ${e?.message ?? e}`); process.exit(1); });

const pageErrors = [];
const consoleLines = [];
await send('Runtime.enable');
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrors.push(m.params?.exceptionDetails?.exception?.description
      ?? m.params?.exceptionDetails?.text ?? 'unknown');
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleLines.push(`${m.params?.type}: ${(m.params?.args ?? []).map(a => a.value ?? '').join(' ')}`);
  }
});
// NEVER MEASURE A CACHED MODULE GRAPH — the repo's own documented trap: a rig
// that skips this has reported a NEW default from a STALE file.
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });

const rigQs = process.env.SPRITE_RIG_QS ?? '';
const qs = rigQs.startsWith('&') ? `?${rigQs.slice(1)}` : rigQs;
const arm = process.env.SPRITE_RIG_ARM ?? 'sprite';
// `SPRITE_RIG_ARM=carve` runs the SAME assertions against the carved-mesh path.
// That is deliberate: a third renderer that spawns pieces, steps them, parks them
// and trails blood is claiming exactly the same contract, so it should have to
// pass the same rig rather than a bespoke one that could quietly be weaker.
const modeQs = arm === 'sprite' || arm === 'carve' ? `&gibrender=${arm}` : '';
const url = `http://localhost:${VITE}/sdf-game.html`
  + (modeQs ? (qs ? `${qs}${modeQs}` : `?${modeQs.slice(1)}`) : qs);
console.log(`[${arm}] opening ${url}`);
await send('Page.navigate', { url });

let booted = false;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  if (await ev('typeof window.__sdfGame === "object" && window.__sdfGame !== null').catch(() => false)) {
    booted = true; break;
  }
}
if (!booted) fail(`__sdfGame never appeared (pageErrors: ${pageErrors.slice(0, 3).join(' | ') || 'none'})`);
let gunReady = false;
for (let i = 0; i < 60; i++) {
  gunReady = await ev('window.__sdfGame.gunReady === true').catch(() => false);
  if (gunReady) break;
  await sleep(500);
}
if (!gunReady) fail('the view-model never became ready');
console.log(`[${arm}] booted`);

// ——— 0. THE MODE SEAM ————————————————————————————————————————————————————
// In sprite mode the atlas must be loaded BEFORE the first detonation: a blast is
// synchronous and cannot await a fetch. `ready` is the difference between "the
// mode is on" and "the mode is on and armed", and a rig that conflated them would
// measure the marched fallback and call it a sprite pass.
//
// IT IS A BOUNDED WAIT, NOT A READ. `gunReady` fires when the VIEW-MODEL lands,
// and the sheet is a separate 756 KB fetch — so a ready read at that moment is a
// race that passes on a warm server and fails on a cold one (observed: the same
// rig passed repeatedly and then read `ready:false, frames:0` on a fresh page).
// Waiting is not papering over a failure: the console lines below are printed if
// it never resolves, so "slow" and "the asset 404'd" stay distinguishable.
let mode = await ev('__sdfGame.gibRenderMode()');
if (arm === 'carve' && !mode.ready) {
  // The library is a ~2 s CPU build kicked off at boot; wait for it rather than
  // reading once and calling the mode broken (the same race the sprite atlas had).
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    mode = await ev('__sdfGame.gibRenderMode()');
    if (mode.ready) break;
  }
}
if (arm === 'sprite' && !mode.ready) {
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    mode = await ev('__sdfGame.gibRenderMode()');
    if (mode.ready) break;
  }
}
console.log(`[${arm}] render mode:`, JSON.stringify(mode));
if (arm === 'sprite' || arm === 'carve') {
  if (mode.mode !== arm) fail(`booted in ${mode.mode}, expected ${arm}`);
  if (!mode.ready) {
    console.error('console lines:', consoleLines.filter(l => l.includes('gib-sprite')).slice(0, 4).join(' | ') || 'none');
    fail('?gibrender=sprite booted without an atlas after 10 s — the sheet never loaded');
  }
  if (arm === 'sprite' && !(mode.frames >= 100)) fail(`only ${mode.frames} frames in the sheet`);
  if (arm === 'carve') {
    if (!mode.carve) fail('?gibrender=carve booted without a library');
    console.log(`[${arm}] library: ${JSON.stringify(mode.carve)}`);
    // The skeleton is the reason this path exists: a carve with no bone prims in
    // the field is the per-piece bake's failure wearing a new name.
    if (!(mode.carve.bonePrims > 0)) fail('the carved library has no bone prims in its field');
    if (!(mode.carve.piecesWithBones > 0)) fail('no carved piece reaches the skeleton');
  }
}

// ——— 1. THE BLAST ————————————————————————————————————————————————————————
// Through `detonate` (the real resolver path) on top of a live body, exactly as
// the dynamite gate does it: a THROWN bundle is not guaranteed to land inside a
// body's gib radius, and "the throw missed" must never read as "the mode is
// broken".
const blast = await ev(`(() => {
  const before = window.__sdfGame.actorList();
  if (before.length === 0) return { skipped: true };
  const target = before[0];
  const r = window.__sdfGame.detonate(target.pos[0], target.pos[1] + 0.6, target.pos[2]);
  // The pre-tear window defers the pieces by design (?gibtear, default 0.1 s), so
  // the census has to be read AFTER the window closes or it legitimately reads 0.
  window.__sdfGame.setLoopRunning(false);
  window.__sdfGame.step(20);
  const d = window.__sdfGame.dynamite();
  return {
    skipped: false, ...r,
    tier: d.lastGibTier, spawned: d.lastGibSpawned, dropped: d.lastGibDropped,
    actors: window.__sdfGame.actorList().length,
    census: window.__sdfGame.spriteCensus(),
    marched: window.__sdfGame.chunkCensus(),
    pieces: window.__sdfGame.spritePieceStates(),
  };
})()`);
writeFileSync(`${OUT}/${arm}-blast.json`, JSON.stringify(blast, null, 2));
if (blast.skipped) fail('no live actors to gib — the rig cannot make a claim');
console.log(`[${arm}] blast:`, JSON.stringify({
  tier: blast.tier, spawned: blast.spawned, dropped: blast.dropped,
  spriteLive: blast.census.live, spriteRest: blast.census.rest,
  marchedLive: blast.marched.live, actorsAfter: blast.actors,
}));

const sprites = blast.pieces ?? [];
// `spritePieceStates()` is already sprite-only (the `render` tag only exists on
// the merged `chunkStates()` rows, which is what the wall rig reads).
const realSprites = sprites;
if (arm === 'sprite' || arm === 'carve') {
  // (1) SPRITES, AND NOTHING ELSE.
  if (!(blast.census.live > 0)) {
    fail(`the blast spawned no sprite pieces (tier=${blast.tier}, spawned=${blast.spawned})`);
  }
  if (blast.tier !== arm) fail(`the blast took tier "${blast.tier}", expected "${arm}"`);
  if (blast.marched.live !== 0) {
    fail(`the blast ALSO spawned ${blast.marched.live} marched pieces — the mode is not exclusive`);
  }
  // The ladder is what degraded the shape; it must never fire here.
  if (blast.dropped !== 0) fail(`${blast.dropped} pieces were dropped by a tier budget the sprite path does not have`);
  // The whole piece set comes out, and the physical pieces are exactly the ones
  // the census counts — a mismatch means a piece exists in one list and not the
  // other, i.e. a leak in the making.
  if (blast.census.live !== realSprites.filter(p => !p.rest).length) {
    fail(`spriteCensus.live ${blast.census.live} != ${realSprites.filter(p => !p.rest).length} live pieces`);
  }
  console.log(`[${arm}] piece set: ${blast.census.live} live `
    + `${arm === 'carve' ? 'carved MESHES' : 'sprite billboards'}, 0 marched, 0 dropped`);
} else {
  // (5) OPT-IN: the shipped default is untouched.
  if (blast.census.live !== 0 || blast.marched.live === 0) {
    fail(`default boot spawned ${blast.census.live} sprites and ${blast.marched.live} marched pieces `
      + '— the sprite path is not opt-in');
  }
  console.log(`[${arm}] opt-in confirmed: ${blast.marched.live} marched pieces, 0 sprites`);
}

// ——— 2. THE PIECES BLEED. ——————————————————————————————————————————————————
// The owner, playing this mode: "there are no blood trails — the blood trails
// should be in there as before." They were right: `emitTrails` was fed only
// `liveChunks`, which is EMPTY in sprite mode by construction, so sprite gore
// threw nothing behind it. This is the assertion that keeps that fixed, and it is
// deliberately about the SIM's droplet count rather than about pixels: a trail is
// a stream of drops, and "did any appear" is exactly the question.
if (arm === 'sprite' || arm === 'carve') {
  const trails = await ev(`(() => {
    const g = window.__sdfGame;
    // Clear the sim so the count below is THIS blast's, not the rig's history.
    g.setBleed(false);
    g.setBleed(true);
    const list = g.actorList();
    if (!list.length) return { skipped: true };
    const a = list[0];
    g.detonate(a.pos[0], a.pos[1] + 0.6, a.pos[2]);
    g.step(4);
    const early = g.bleed.droplets;
    // The trail emits on a CLOCK (BLOOD_TRAIL.emitHz), so a couple of frames is
    // not enough to distinguish "no emitter" from "not due yet" — fly it a while.
    g.step(30);
    const late = g.bleed.droplets;
    return {
      skipped: false, early, late, splats: g.bleed.splats,
      // Drops in flight this long after the blast can only come from pieces
      // still moving: the impact gout's own droplets have the same lifetime but
      // were emitted at t=0, several frames of expiry ago.
      pieces: g.spriteCensus().live,
    };
  })()`);
  writeFileSync(`${OUT}/${arm}-trails.json`, JSON.stringify(trails, null, 2));
  console.log(`[${arm}] trails:`, JSON.stringify(trails));
  if (trails.skipped) fail('no live actors left to test the blood trail');
  if (!(trails.late > trails.early)) {
    fail(`the blood sim gained no droplets while ${trails.pieces} pieces were flying `
      + `(${trails.early} → ${trails.late}) — the pieces are not trailing blood`);
  }
  if (!(trails.late > 0)) fail('the blood sim is empty during a gib — bleeding is off?');
}

// ——— 3. THEY ARE PHYSICALLY REAL: FALL, SETTLE, PARK ——————————————————————
// Step long enough for the pieces to land. Asserting the PARK (not just that y
// went down) is what distinguishes "same `Chunk` state through the same stepper"
// from "a quad parented to something falling".
if (arm === 'sprite' || arm === 'carve') {
  const settle = await ev(`(() => {
    const t0 = window.__sdfGame.spriteCensus();
    const y0 = window.__sdfGame.spritePieceStates().map(p => p.pos[1]);
    window.__sdfGame.step(400);
    const t1 = window.__sdfGame.spriteCensus();
    const st = window.__sdfGame.spritePieceStates();
    const ys = st.map(p => p.pos[1]);
    return {
      liveBefore: t0.live, liveAfter: t1.live, restAfter: t1.rest,
      minYBefore: Math.min(...y0.filter(Number.isFinite)),
      maxYBefore: Math.max(...y0.filter(Number.isFinite)),
      maxYAfter: Math.max(...ys.filter(Number.isFinite)),
      minYAfter: Math.min(...ys.filter(Number.isFinite)),
      // EVERY piece, live or parked, and the radius it must be sitting on.
      under: st.filter(p => p.pos[1] < p.radius - 1e-3).length,
      settled: st.filter(p => p.settled).length,
      rest: st.filter(p => p.rest).length,
      total: st.length,
    };
  })()`);
  writeFileSync(`${OUT}/${arm}-settle.json`, JSON.stringify(settle, null, 2));
  console.log(`[${arm}] settle:`, JSON.stringify(settle));
  if (!(settle.restAfter > 0)) {
    fail(`no piece parked after 400 frames (live=${settle.liveAfter}, rest=${settle.restAfter}) `
      + '— gravity or the settle rule is not running on sprite pieces');
  }
  // NOT ONE PIECE MAY BE BELOW THE FLOOR. `stepChunk` pins y to radius on contact,
  // so a piece under that is one the sprite path never stepped at all.
  if (settle.under > 0) fail(`${settle.under} sprite pieces are below the floor (y < radius)`);
  if (settle.rest !== settle.settled) {
    fail(`${settle.settled} pieces report settled but only ${settle.rest} are parked — the park rule lags`);
  }
  if (settle.total !== settle.liveAfter + settle.restAfter) {
    fail(`piece lists disagree with the census (${settle.total} vs ${settle.liveAfter}+${settle.restAfter})`);
  }
}

// ——— 4. ARE THEY DRAWN? (presented frame, hidden vs shown) ————————————————
// presentedShot returns the last PRESENTED frame, so a draw must follow the
// visibility change. setRenderLock + step(1) is the repo's documented way to
// force exactly one drawn frame without the rAF loop interleaving.
if (arm === 'sprite' || arm === 'carve') {
  const shoot = async () => {
    await ev('__sdfGame.setRenderLock(true)');
    await ev('__sdfGame.step(1)');
    const b64 = await ev('__sdfGame.presentedShot()');
    await ev('__sdfGame.setRenderLock(false)');
    return decodePng(Buffer.from(b64, 'base64'));
  };
  await ev('__sdfGame.setSpritePiecesVisible(true)');
  const shown = await shoot();
  await ev('__sdfGame.setSpritePiecesVisible(false)');
  const hidden = await shoot();
  await ev('__sdfGame.setSpritePiecesVisible(true)');
  if (!shown || !hidden || shown.w !== hidden.w || shown.h !== hidden.h) {
    fail('the two presented frames are not comparable');
  }
  let differing = 0, total = 0;
  for (let i = 0; i < shown.data.length; i += 4) {
    total++;
    const d = Math.abs(shown.data[i] - hidden.data[i])
      + Math.abs(shown.data[i + 1] - hidden.data[i + 1])
      + Math.abs(shown.data[i + 2] - hidden.data[i + 2]);
    if (d > 8) differing++;
  }
  const pct = (100 * differing) / total;
  console.log(`[${arm}] drawn: ${differing}/${total} pixels changed with the sprites hidden = ${pct.toFixed(2)}%`);
  writeFileSync(`${OUT}/${arm}-drawn.json`, JSON.stringify({ differing, total, pct }, null, 2));
  if (!(pct > 0.05)) {
    fail(`hiding every sprite piece changed only ${pct.toFixed(3)}% of the presented frame — `
      + 'they are in the scene but not in the picture');
  }
}

// ——— 5. THE CAP HOLDS ————————————————————————————————————————————————————
// The sprite path's stand-in for the marched view pool. Exercised by blasting
// repeatedly until the live list must have overflowed, then asserting the bound.
if (arm === 'sprite' || arm === 'carve') {
  const cap = await ev(`(() => {
    const cap = window.__sdfGame.gibRenderMode().liveCap;
    let blasts = 0;
    for (let i = 0; i < 6; i++) {
      const list = window.__sdfGame.actorList();
      if (list.length === 0) break;
      const a = list[0];
      window.__sdfGame.detonate(a.pos[0], a.pos[1] + 0.6, a.pos[2]);
      window.__sdfGame.step(20);
      blasts++;
    }
    const c = window.__sdfGame.spriteCensus();
    return { cap, blasts, live: c.live, rest: c.rest, meshes: c.meshes,
             geometries: c.geometries, materials: c.materials };
  })()`);
  writeFileSync(`${OUT}/${arm}-cap.json`, JSON.stringify(cap, null, 2));
  console.log(`[${arm}] cap:`, JSON.stringify(cap));
  if (cap.blasts === 0) fail('no bodies were left to blast — the cap was never exercised');
  if (cap.live > cap.cap) fail(`live sprites ${cap.live} exceed the cap ${cap.cap}`);
  // The meshes in the scene group must equal the pieces the lists account for: a
  // group larger than the lists is a mesh leak (detached but never removed).
  if (cap.meshes !== cap.live + cap.rest) {
    fail(`scene group holds ${cap.meshes} meshes but the lists account for ${cap.live + cap.rest}`);
  }
  // Assets are SHARED, so they must stay bounded by what has been drawn, not grow
  // with the number of pieces ever spawned. THE COUNTERS ARE SPRITE-ONLY: a
  // carved piece brings its own library geometry, so it caches none of these (the
  // bound that matters for the carve is the LIBRARY's piece count, checked above).
  if (arm === 'sprite') {
    if (cap.materials > 154) fail(`${cap.materials} cached materials — more than the sheet has frames`);
    if (cap.geometries > 64) fail(`${cap.geometries} cached geometries — the aspect/size key is not binding`);
  } else if (cap.geometries !== 0 || cap.materials !== 0) {
    fail(`carve mode cached ${cap.geometries} sprite geometries / ${cap.materials} sprite materials — `
      + 'a carved piece must use the LIBRARY geometry, not a per-piece sprite asset');
  }
}

console.log(`[${arm}] page errors: ${pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : 'none'}`);
if (pageErrors.length) fail('the page threw during the run');
console.log(`PASS[${arm}]`);
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
process.exit(0);
