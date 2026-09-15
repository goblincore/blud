// scripts/sdf-dynamite-soak.mjs — THE GIB AND THE BLAST UNDER THE REAL LOOP.
//
// Every other rig in this repo drives the page with `__sdfGame.step()` and the
// render loop STOPPED. The game does not run that way. It runs a rAF loop whose
// dt is real and variable, and that is where the bugs written this session
// would hide: the pre-tear window's clock, the deferred spawn that turns a bent
// body into pieces several frames after the blast, and the view pool that both
// of them draw from. Under `step()` those all advance in tidy 1/60 s slices; on
// a real loop a hitch hands them a 200 ms dt, several blasts overlap in wall
// clock, and the actor that owns a window may be retired by something else
// while it is open.
//
// So this rig does not call `step` and does not stop the loop. It throws real
// bundles (select slot 2, cook, release — the same edges a mouse gives), and it
// detonates on live bodies to guarantee the tear+gib path runs repeatedly. It
// then asserts the things that would be stuck or leaking if any of that were
// wrong, and it samples DURING the run so a transient bad state cannot hide.
//
// EVERY WAIT IS BOUNDED (the lesson from scripts/sdf-game-bench.mjs, which
// wedged for 19 silent minutes, and from this session's own rig, which hung
// twice): a page that stops answering fails, naming what it was waiting for.
//
// Usage: node scripts/sdf-dynamite-soak.mjs <vitePort> <cdpPort> [rounds]
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const ROUNDS = Number(process.argv[4] ?? 4);
const OUT = '/tmp/dynamite-soak';
mkdirSync(OUT, { recursive: true });
const SEND_TIMEOUT_MS = Number(process.env.SOAK_SEND_TIMEOUT_MS ?? 30000);
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
  if (r?.error) throw new Error(`evaluate failed: ${JSON.stringify(r.error).slice(0, 200)}`);
  return r.result?.result?.value;
};
process.on('unhandledRejection', (e) => { console.error(`FAIL: ${e?.message ?? e}`); process.exit(1); });

const pageErrors = [];
await send('Runtime.enable');
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params).slice(0, 240));
});

// SOAK_QS points this rig at a knobbed arm, the same convention as the gate's
// GATE_QS. `SOAK_QS='&gibrender=sprite'` soaks the BILLBOARD path under a real
// rAF loop, which is that mode's own worst case: a sprite piece is never baked,
// so it never stops being a billboard, and anything that leaks a mesh or a
// material per blast shows up here and nowhere else.
const soakQs = process.env.SOAK_QS ?? '';
/** Whether this run soaks the BILLBOARD path — swaps the marched census assertions
 *  for the sprite ones (see `sample`). */
const spriteSoak = soakQs.includes('gibrender=sprite');
const url = `http://localhost:${VITE}/sdf-game.html?room=arena`
  + (soakQs.startsWith('&') ? soakQs : soakQs.startsWith('?') ? `&${soakQs.slice(1)}` : soakQs);
console.log(`opening ${url} (REAL LOOP — this rig never calls step())`);
await send('Page.navigate', { url });
for (let i = 0; i < 240; i++) { await sleep(500); if (await ev('typeof window.__sdfGame === "object"')) break; if (i === 239) fail('__sdfGame never appeared'); }
for (let i = 0; i < 60; i++) { if (await ev('window.__sdfGame.gunReady === true')) break; await sleep(500); if (i === 59) fail('the view-model never became ready'); }
if (soakQs.includes('gibrender=sprite')) {
  // The sheet must be preloaded or the first blast silently falls back to marched
  // pieces and this rig would soak the wrong path while reporting a PASS.
  for (let i = 0; i < 60; i++) {
    if (await ev('window.__sdfGame.gibRenderMode().ready === true')) break;
    await sleep(500);
  }
  const m = await ev('window.__sdfGame.gibRenderMode()');
  if (!m.ready) fail('?gibrender=sprite booted without an atlas');
  console.log(`sprite render mode armed: ${m.frames} frames, live cap ${m.liveCap}`);
}
await sleep(1500);

// ─—— THE SAMPLER. Every sample is checked, not just the last one: a stuck
// window or an over-full pool that clears itself by the end of the run is still
// a frame the player would have seen.
const samples = [];
let worst = { views: 0, live: 0, bonesShadingAsMeat: 0, sprites: 0, spriteMeshes: 0 };
async function sample(label) {
  const d = await ev('window.__sdfGame.dynamite()');
  const c = await ev('window.__sdfGame.chunkCensus()');
  // THE SPRITE RENDER MODE HAS ITS OWN CENSUS, and its own bound. Under
  // `SOAK_QS='&gibrender=sprite'` the marched view pool is 0 BY CONSTRUCTION, so
  // the cap checks below would pass vacuously and the bone check would fail
  // outright (there are no marched views to inspect). The sprite cap and the
  // mesh/material counts are this mode's leak gate instead: a parked sprite is
  // never baked away, so its lists are what grows if anything does.
  const sc = await ev('window.__sdfGame.spriteCensus()');
  const actors = await ev('window.__sdfGame.actorList().length');
  const s = {
    label, tearing: d.tearing, pendingGibs: d.pendingGibs, gibs: d.gibbed, pieces: d.gibPieces,
    detonations: d.detonations, live: c.live, views: c.views, cap: c.cap, baked: c.baked,
    bonePieces: c.bonePieces, buried: c.buriedBonePieces, meatBones: c.bonesShadingAsMeat,
    organsAsBone: c.organsShadingAsBone, actors,
    sprites: sc.live, spriteRest: sc.rest, spriteMeshes: sc.meshes,
    spriteCap: sc.liveCap, spriteRestCap: sc.restCap,
    spriteGeometries: sc.geometries, spriteMaterials: sc.materials,
  };
  samples.push(s);
  worst.views = Math.max(worst.views, s.views);
  worst.live = Math.max(worst.live, s.live);
  worst.bonesShadingAsMeat = Math.max(worst.bonesShadingAsMeat, s.meatBones);
  worst.sprites = Math.max(worst.sprites, s.sprites);
  worst.spriteMeshes = Math.max(worst.spriteMeshes, s.spriteMeshes);
  if (s.views > s.cap) fail(`the view pool grew past its cap: ${s.views} > ${s.cap} (${label})`);
  if (s.live > s.cap) fail(`${s.live} live pieces against a ${s.cap} cap (${label})`);
  if (s.meatBones > 0) fail(`${s.meatBones} bone piece(s) are shading as meat (${label}) — the skeleton is in the pile and invisible`);
  if (s.organsAsBone > 0) fail(`${s.organsAsBone} organ piece(s) flagged as bone (${label})`);
  // ——— THE SPRITE MODE'S LEAK GATE. Three separate leaks, three checks:
  // live pieces over the cap (stepping never parks), meshes over what the lists
  // account for (detached but never removed from the group), and shared assets
  // growing (the per-size geometry cache that was measured leaking 232 geometries).
  if (spriteSoak) {
    if (s.sprites > s.spriteCap) fail(`${s.sprites} live sprites against a ${s.spriteCap} cap (${label})`);
    if (s.spriteRest > s.spriteRestCap) fail(`${s.spriteRest} parked sprites against a ${s.spriteRestCap} cap (${label})`);
    if (s.spriteMeshes !== s.sprites + s.spriteRest) {
      fail(`${s.spriteMeshes} meshes in the scene group but the lists account for `
        + `${s.sprites + s.spriteRest} (${label}) — a mesh leaked`);
    }
    if (s.spriteGeometries > 1) fail(`${s.spriteGeometries} cached geometries (${label}) — the unit plane is not shared`);
    if (s.spriteMaterials > 154) fail(`${s.spriteMaterials} cached materials (${label}) — more than the sheet has frames`);
  }
  return s;
}

// ─—— PHASE 1: REAL THROWS. The seams are the same edges a mouse gives.
async function throwOne(cookMs) {
  const before = await ev('window.__sdfGame.dynamite().detonations');
  // THE SLOT IS A NAME, NOT A KEY NUMBER. `selectSlot(2)` looks right — 2 is
  // the key, the HUD says 2 — and it POISONS the state: the switch runs, the
  // phase reads 'up', nothing is live, and every press is dropped in silence.
  // That is what this rig spent an hour chasing ("throws never detonate"), which
  // is why the seam now refuses it outright.
  const sel = await ev("window.__sdfGame.selectSlot('dynamite')");
  if (!sel?.ok) { console.log(`  selectSlot refused (${sel?.reason}) — waiting`); await sleep(800); return false; }
  for (let i = 0; i < 40; i++) {
    const st = await ev('window.__sdfGame.dynamite()');
    if (st.phase === 'up' && st.ready) break;
    await sleep(100);
  }
  await ev('window.__sdfGame.dynamitePress()');
  await sleep(cookMs);
  await ev('window.__sdfGame.dynamiteRelease()');
  // The bundle flies on the live loop; wait for it to go off (fuse is 5 s).
  for (let i = 0; i < 90; i++) {
    await sleep(200);
    const now = await ev('window.__sdfGame.dynamite().detonations');
    if (now > before) return true;
  }
  return false;
}

console.log(`\nPHASE 1 — ${ROUNDS} real throws (select 2, cook, release), sampled live`);
let thrown = 0;
for (let i = 0; i < ROUNDS; i++) {
  const cook = 500 + i * 400;
  const ok = await throwOne(cook);
  if (ok) thrown++;
  const s = await sample(`throw ${i + 1} (cook ${cook} ms)`);
  console.log(`  throw ${i + 1} cook ${String(cook).padStart(4)} ms -> detonations ${s.detonations}, gibs ${s.gibs}, `
    + `pieces ${s.pieces}, live ${s.live}/${s.cap}, bone ${s.bonePieces} buried ${s.buried}, `
    + `tearing ${s.tearing} pendingGibs ${s.pendingGibs}, actors ${s.actors}`);
  await sleep(900);
}

// ─—— PHASE 2: GUARANTEED GIBS ON LIVE BODIES, STILL ON THE LIVE LOOP. Phase 1
// may not have landed a killing blow; this drives the tear window and the
// deferred spawn repeatedly, which is the machinery under test.
console.log(`\nPHASE 2 — ${ROUNDS} point-blank detonations on live bodies (live loop, real dt)`);
for (let i = 0; i < ROUNDS; i++) {
  const roster = await ev('window.__sdfGame.actorList()');
  const t = roster.find(a => a.room === 6) ?? roster[0];
  if (!t) { console.log('  no live body left to blow up'); break; }
  const r = await ev(`window.__sdfGame.detonate(${t.pos[0]}, ${t.pos[1] + 0.6}, ${t.pos[2]})`);
  // Sample THROUGH the window: the bent body must be up and nothing stuck.
  const mid = await sample(`gib ${i + 1} at the blast frame`);
  await sleep(400);
  const after = await sample(`gib ${i + 1} after the window`);
  console.log(`  gib ${i + 1} (${t.kind}): gibbed ${r.gibbed} pieces ${r.gibPieces} | at blast: tearing ${mid.tearing} `
    + `pendingGibs ${mid.pendingGibs} live ${mid.live} | after: bone ${after.bonePieces} buried ${after.buried} `
    + `live ${after.live} pendingGibs ${after.pendingGibs}`);
  await sleep(700);
}

// ─—— LET EVERYTHING SETTLE, then judge the end state.
await sleep(6000);
const settled = await sample('settled');
console.log(`\nsettled: detonations ${settled.detonations}, gibs ${settled.gibs}, pieces ${settled.pieces}, `
  + `live ${settled.live}/${settled.cap} (baked ${settled.baked}), tearing ${settled.tearing}, pendingGibs ${settled.pendingGibs}, actors ${settled.actors}`);
writeFileSync(`${OUT}/soak.json`, JSON.stringify({ samples, worst, pageErrors }, null, 2));

// ─—— THE VERDICT ─———————————————————————————————————————————————————————
if (pageErrors.length > 0) {
  for (const e of pageErrors.slice(0, 5)) console.error(`  page error: ${e}`);
  fail(`${pageErrors.length} page error(s) during the soak`);
}
if (settled.tearing !== 0) fail(`${settled.tearing} bod(ies) are still mid-tear after settling — the window never closed`);
if (settled.pendingGibs !== 0) fail(`${settled.pendingGibs} gib(s) are still queued after settling — a body will never become pieces`);
if (!(settled.detonations >= ROUNDS)) fail(`only ${settled.detonations} detonations from ${ROUNDS} throws + ${ROUNDS} forced gibs`);
if (!(settled.actors > 0)) fail('the roster is empty — the world blew itself apart');
const withBones = samples.filter(s => s.bonePieces >= 1).length;
const withSprites = samples.filter(s => s.sprites + s.spriteRest >= 1).length;
if (spriteSoak) {
  // THE BONE CHECK IS A MARCHED-MODE CHECK. It reads `chunkCensus()`, which in
  // sprite mode is empty by construction — there are no marched views to
  // inspect, and the piece KIND is a property of the marched SDF field. The
  // sprite path's equivalent obligation is that pieces REACH THE WORLD AND STAY
  // BOUNDED, which is asserted per sample in `sample()`; here it is only that
  // some sample actually saw them, so a soak that soaked nothing cannot pass.
  if (withSprites === 0) {
    fail('no sample ever had a sprite piece in the pile — the billboards never reached the world');
  }
} else if (withBones === 0) {
  fail('no sample ever had a bone piece in the pile — the skeleton is not being released');
}
const gibbedSamples = samples.filter(s => s.tearing > 0 || s.pendingGibs > 0).length;
if (gibbedSamples === 0) fail('no sample ever caught a body mid-tear — the window did not run on the live loop');
console.log(`\nlive-loop soak: ${samples.length} samples, ${settled.detonations} detonations, `
  + (spriteSoak
    ? `${withSprites} samples with sprite pieces in the world, `
    : `${withBones} samples with bone pieces in the pile, `)
  + `${gibbedSamples} samples mid-window`);
if (spriteSoak) {
  console.log(`peak sprite pieces ${worst.sprites} live + ${worst.spriteMeshes} meshes total `
    + `(cap ${settled.spriteCap}), cached geometry/material counts held at `
    + `${settled.spriteGeometries}/${settled.spriteMaterials}`);
} else {
  console.log(`peak view pool ${worst.views} of ${settled.cap}, peak live pieces ${worst.live}, bone pieces shading as meat: NONE`);
}
console.log('PASS: the tear, the deferred gib and the pool all survive the real loop');
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
