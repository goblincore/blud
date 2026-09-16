// scripts/sdf-game-dynamite-gate.mjs — SLOT 2 (dynamite) boot + throw + gib gate.
//
// What this gate is FOR: the feature exists so the blast and the gib can be
// judged in play, so the gate has to prove the two things that make judging
// possible at all —
//
//   1. THE SLOT SWITCH IS REAL. Pressing 2 must lower the grapeshot, change the
//      live weapon, and leave the slot machine in a settled state that may
//      fire. A switch that completes but leaves `ready` false is the failure
//      mode that would make the whole feature untestable by hand.
//   2. A THROWN BUNDLE DETONATES AND GIBBS. Throw at charge 1, step the sim,
//      and require: exactly one detonation, at least one actor removed from the
//      roster, and the chunk count risen by roughly a body's worth of pieces.
//      A blast that only stamps wounds is the pre-existing diagnostic seam, not
//      this feature.
//
// It is NOT a look gate and it does not measure frame cost — the gib cost is
// reported (`lastBlastMs`) so a perf pass has a number to chase, but a
// CPU-side millisecond reading off a headless boot is not a bench.
//
// Usage: node scripts/sdf-game-dynamite-gate.mjs <vitePort> <cdpPort> [outDir]
// Exits non-zero on a failed assertion. Servers via scripts/lab-servers.sh.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const OUT = process.argv[4] ?? '/tmp/dynamite-gate';
mkdirSync(OUT, { recursive: true });

const W = 1100, H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`, ], { stdio: 'ignore' }); } catch {}
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const pageErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrors.push(m.params?.exceptionDetails?.exception?.description
      ?? m.params?.exceptionDetails?.text ?? 'unknown exception');
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
    pageErrors.push((m.params.args ?? []).map(a => a.value ?? a.description ?? '').join(' '));
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const withTimeout = (p, ms, what) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms)),
]);
const evaluate = async (expression) => {
  const r = await withTimeout(
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
    30000, `evaluate: ${expression.slice(0, 90)}`,
  );
  if (r.result?.exceptionDetails) {
    throw new Error(`page threw: ${JSON.stringify(r.result.exceptionDetails.exception?.description
      ?? r.result.exceptionDetails.text)}`);
  }
  return r.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
// NEVER MEASURE A CACHED MODULE GRAPH. This gate is run repeatedly while the
// source is being edited, and the browser's disk cache will happily serve the
// PREVIOUS transform of `game-main.ts` — a falsification run of this very gate
// (default pool set back to 24, expecting the new assertion to fail) instead
// reported the new default, i.e. it measured the old file. A long-open tab
// serving a stale graph is also the leading explanation for an owner look pass
// that does not match the numbers, so the gate now refuses to be that tab.
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// GATE_QS runs the SAME gate against one of the feature's own A/B controls
// (`GATE_QS='&gibtear=0'` is the pre-tear window off, `&gib=clusters` the legacy
// piece set). The gate pins the SHIPPED configuration as the contract, so a knob
// run is a deliberate check that a documented control still works — not a second
// contract. Knobs that change the piece set also change what the bone census can
// say, so those rows are reported rather than asserted when GATE_QS is set.
const gateQs = process.env.GATE_QS ?? '';
const url = `http://localhost:${VITE}/sdf-game.html`
  // Accept either '?a=1' or '&a=1': a leading '&' against a URL with no query is
  // a path, not a parameter, and the page 404s — which reads as "__sdfGame never
  // appeared" and looks like a crash.
  + (gateQs.startsWith('&') ? `?${gateQs.slice(1)}` : gateQs);
const knobbed = Boolean(process.env.GATE_QS);
console.log(`opening ${url}`);
await send('Page.navigate', { url });

// ——— BOOT ————————————————————————————————————————————————————————————————
// The page shows a loader and warms its pipelines before `__sdfGame` appears.
let booted = false;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  const ok = await evaluate('typeof window.__sdfGame === "object" && window.__sdfGame !== null').catch(() => false);
  if (ok) { booted = true; break; }
}
if (!booted) fail(`__sdfGame never appeared (pageErrors: ${pageErrors.slice(0, 3).join(' | ') || 'none'})`);
let gunReady = false;
for (let i = 0; i < 60; i++) {
  gunReady = await evaluate('window.__sdfGame.gunReady === true').catch(() => false);
  if (gunReady) break;
  await sleep(500);
}
console.log(`booted (gunReady: ${gunReady})`);
if (!gunReady) fail('the view-model never became ready');

const before = await evaluate('window.__sdfGame.dynamite()');
console.log('slot state at boot:', JSON.stringify({ live: before.live, phase: before.phase, inHand: before.inHand }));
if (before.live !== 'shotgun') fail(`booted holding ${before.live}, expected shotgun`);
if (!before.ready) fail('slot machine is not settled at boot');

// ——— 1. THE SLOT SWITCH ————————————————————————————————————————————————
// Driven through the REAL key handler (a synthetic keydown), not the seam, so a
// broken key map fails here.
await evaluate(`(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', bubbles: true }));
  return true;
})()`);
const midSwitch = await evaluate('window.__sdfGame.dynamite()');
console.log('immediately after Digit2:', JSON.stringify({ live: midSwitch.live, target: midSwitch.target, phase: midSwitch.phase, ready: midSwitch.ready }));
if (midSwitch.target !== 'dynamite') fail('Digit2 did not target the dynamite slot');
if (midSwitch.ready) fail('the switch completed instantly — the lower/raise travel is not running');
if (midSwitch.live !== 'shotgun') fail('the shotgun stopped being live before it was lowered out');

// Step past lowerSec + raiseSec (0.18 + 0.24) with margin.
await evaluate('window.__sdfGame.step(30)');
const afterSwitch = await evaluate('window.__sdfGame.dynamite()');
console.log('after 30 steps:', JSON.stringify({
  live: afterSwitch.live, phase: afterSwitch.phase, ready: afterSwitch.ready,
  gunLower: afterSwitch.gunLower, bundleLower: afterSwitch.bundleLower, inHand: afterSwitch.inHand,
}));
if (afterSwitch.live !== 'dynamite') fail(`switch did not hand over (live=${afterSwitch.live})`);
if (!afterSwitch.ready) fail('the switch never settled — the dynamite could never be fired');
if (afterSwitch.gunLower !== 1) fail(`the grapeshot is not fully holstered (gunLower=${afterSwitch.gunLower})`);
if (afterSwitch.bundleLower !== 0) fail(`the bundle did not come fully up (bundleLower=${afterSwitch.bundleLower})`);
if (!afterSwitch.inHand) fail('no bundle in hand after the switch');

// ——— 2. FIRE THE SHOTGUN AT THE DYNAMITE SLOT (must be refused) ——————————
const shotgunThroughDyn = await evaluate('window.__sdfGame.fire(1)');
if (shotgunThroughDyn !== false) fail('fire() succeeded while the dynamite was the live weapon');
console.log('shotgun refused while dynamite is out: ok');

// ——— 2b. THE SLOT IS A NAME, AND THE SEAM REFUSES ANYTHING ELSE ——————————
// `selectSlot(2)` looks right — 2 is the key, the HUD says 2 — and it used to
// POISON the state: the switch ran, the phase read 'up', nothing was live, and
// every later press was dropped by `liveDyn` with no error anywhere. A soak rig
// lost an hour to it ("the throws never detonate"). The refusal is the fix, and
// this is what keeps it a refusal.
{
  const bad = await evaluate('window.__sdfGame.selectSlot(2)');
  console.log('selectSlot(2) (a key number, not a name):', JSON.stringify(bad));
  if (bad?.ok) fail('selectSlot accepted the NUMBER 2 — the slot machine will go inert in silence');
  if (!String(bad?.reason ?? '').startsWith('unknown-slot')) {
    fail(`selectSlot refused a number for the wrong reason: ${bad?.reason}`);
  }
  const restore = await evaluate("window.__sdfGame.selectSlot('dynamite')");
  if (!restore?.ok) fail(`the slot could not be restored after the bad-argument check (${restore?.reason})`);
}

// ——— 3. COOK THEN THROW, THROUGH THE REAL EDGES ——————————————————————————
await evaluate('window.__sdfGame.dynamitePress()');
await evaluate('window.__sdfGame.step(20)');
const cooking = await evaluate('window.__sdfGame.dynamite()');
console.log('while cooking:', JSON.stringify({ cookPhase: cooking.cookPhase, charge: Number(cooking.charge.toFixed(3)) }));
if (cooking.cookPhase !== 'cooking') fail(`press did not start a cook (phase=${cooking.cookPhase})`);
// 20 steps at 1/60 s is 0.333 s of a 2.0 s charge = 0.167 nominal.
if (!(cooking.charge > 0.1)) fail(`charge did not build (${cooking.charge})`);
await evaluate('window.__sdfGame.step(60)');
const cookedMore = await evaluate('window.__sdfGame.dynamite()');
console.log(`charge after 80 steps: ${cookedMore.charge.toFixed(3)} (of 1.0)`);
if (!(cookedMore.charge > cooking.charge)) {
  fail(`charge did not keep building (${cooking.charge} → ${cookedMore.charge})`);
}

await evaluate('window.__sdfGame.dynamiteRelease()');
await evaluate('window.__sdfGame.step(2)');
const thrown = await evaluate('window.__sdfGame.dynamite()');
console.log('after release:', JSON.stringify({
  thrown: thrown.thrown, inFlight: thrown.inFlight, inHand: thrown.inHand,
  cookPhase: thrown.cookPhase, fuse: thrown.flights[0]?.fuse,
}));
if (thrown.thrown !== 1) fail(`release did not throw (thrown=${thrown.thrown})`);
if (thrown.inFlight !== 1) fail(`no bundle in flight (inFlight=${thrown.inFlight})`);
if (thrown.inHand) fail('the bundle is still in hand after the throw');

// The bundle must LEAVE THE HAND and then DETONATE. Rooms here are 8 x 8 m, so
// a full-charge throw hits a wall within a fraction of a second — the loop is
// written to sample the flight as it goes rather than to assume a long arc.
const rosterBefore = await evaluate('window.__sdfGame.actorList()');
const nearestAtRelease = rosterBefore
  .map(a => Math.hypot(a.pos[0] - thrown.flights[0].pos[0], a.pos[1] + 0.95 - thrown.flights[0].pos[1], a.pos[2] - thrown.flights[0].pos[2]))
  .sort((x, y) => x - y)[0];
console.log(`release point y=${thrown.flights[0].pos[1].toFixed(2)}; nearest body ${Number(nearestAtRelease).toFixed(2)} m away`);
let lastFlight = null;
let maxTravel = 0;
let sawFlight = false;
let detonated = null;
const origin = thrown.flights[0].pos;
for (let i = 0; i < 120; i++) {
  // ONE frame at a time: the player starts in a corner of an 8 x 8 m room, so a
  // full-charge throw can reach a wall inside a couple of frames and a coarse
  // sample would never see the bundle in the air at all.
  await evaluate('window.__sdfGame.step(1)');
  const d = await evaluate('window.__sdfGame.dynamite()');
  const f = d.flights[0];
  if (f) {
    sawFlight = true;
    lastFlight = f;
    maxTravel = Math.max(maxTravel, Math.hypot(f.pos[0] - origin[0], f.pos[1] - origin[1], f.pos[2] - origin[2]));
    if (!(f.fuse < 5.0)) fail(`the fuse is not counting down (${f.fuse})`);
    if (!f.drawn) console.log('note: a bundle is in flight but not drawn (prop pool exhausted)');
  }
  if (d.detonations > 0) { detonated = d; break; }
}
console.log(`bundle travelled ${maxTravel.toFixed(2)} m before detonating; last sample `
  + (lastFlight ? JSON.stringify({ pos: lastFlight.pos.map(v => Number(v.toFixed(2))), vel: lastFlight.vel.map(v => Number(v.toFixed(2))) }) : 'none'));
if (!sawFlight) fail('the bundle never appeared in flight at all');
if (maxTravel <= 0.05) fail(`the bundle barely moved (${maxTravel} m) — the flight is not integrating`);
if (!detonated) fail('the bundle never detonated (no impact, no fuse-out — check the level colliders)');
console.log('detonation:', JSON.stringify({
  detonations: detonated.detonations, gibbed: detonated.gibbed, gibPieces: detonated.gibPieces,
  lastBlastMs: Number(detonated.lastBlastMs.toFixed(2)), maxChunks: detonated.maxChunks,
  gibMode: detonated.gibMode, rosterBefore: rosterBefore.length,
}));
if (detonated.detonations !== 1) fail(`expected exactly one detonation, got ${detonated.detonations}`);
// The hand refills once the throw's recovery beat is over.
await evaluate('window.__sdfGame.step(40)');
const recovered = await evaluate('window.__sdfGame.dynamite()');
console.log('after recovery:', JSON.stringify({ inHand: recovered.inHand, cookPhase: recovered.cookPhase, inFlight: recovered.inFlight }));
if (!recovered.inHand) fail('the hand never got its next bundle after the throw recovery');

// ——— 4b. THE SKELETON IS IN THE PILE, AND IT DRAWS AS BONE ——————————————
// The owner's complaint was "i still dont see anything bone related like idk rib
// cage or something". TWO claims answer it and only the first was covered:
// `gib-parts.test.ts` proves the ribcage leaves the body as a bone-only chunk;
// these counters are the one a PAGE can see, and they are the ones that would
// catch the wiring the other test cannot reach:
//
//   * `bonePieces`   a bone piece renders pale ONLY while its view carries
//                    meltCfg.x = 1 (the pale matte branch is the only thing in
//                    the shader that paints bone as bone), and only has bone to
//                    paint if its rows are packed (counts2.x).
//   * `bonesShadingAsMeat` counts a bone piece that lost either — the skeleton
//                    spawned, present, and invisible, which is exactly the
//                    failure the piece set was built to end.
//   * `buriedBonePieces` is the cheap `clusters` tier's signature (bones packed
//                    INSIDE a flesh piece's own field). NOT asserted to zero: a
//                    pool that cannot afford the split set legitimately
//                    degrades, and the tier is reported in the line below.
{
  const c = await evaluate('window.__sdfGame.chunkCensus()');
  const d = await evaluate('window.__sdfGame.dynamite()');
  console.log('bone census:', JSON.stringify({
    bonePieces: c.bonePieces, boneRows: c.boneRows, organs: c.organPieces,
    buriedBonePieces: c.buriedBonePieces, bonesShadingAsMeat: c.bonesShadingAsMeat,
    organsShadingAsBone: c.organsShadingAsBone, lastTier: d.lastGibTier,
  }));
  if (!(c.bonePieces >= 1) && !knobbed) {
    fail(`no bone piece is in the pile (bonePieces=${c.bonePieces}, tier=${d.lastGibTier}) — `
      + 'the skeleton is not being released as its own pieces');
  }
  // CONDITIONAL, because the legacy piece sets (`?gib=clusters|pieces`) have no
  // bone pieces AT ALL and are legitimate A/B controls: the contract is "a bone
  // piece that EXISTS has rows packed", not "bone pieces always exist" — which is
  // what the assertion above is for.
  if (c.bonePieces > 0 && !(c.boneRows > 0)) {
    fail('a bone piece is drawing with no bone rows packed — packBones is off for it, so it '
      + 'marches an empty field and the skeleton is invisible');
  }
  if (c.bonesShadingAsMeat !== 0) {
    fail(`${c.bonesShadingAsMeat} bone piece(s) lost the pale-bone flag or their packed rows and `
      + 'will shade as meat — a recycled chunk view that kept a stale meltCfg is the usual cause');
  }
  if (c.organsShadingAsBone !== 0) {
    fail(`${c.organsShadingAsBone} organ piece(s) are flagged pale-bone and will render as bare bone`);
  }
  if (d.lastGibTier === 'parts' && c.buriedBonePieces !== 0 && !knobbed) {
    fail(`the full piece set was used but ${c.buriedBonePieces} pieces still carry their bones `
      + 'buried inside flesh');
  }
}

// ——— 5. THE DETERMINISTIC GIB PROBE ——————————————————————————————————————
// The thrown bundle's landing is not guaranteed to be inside the gib radius of
// a body, so the gib is asserted SEPARATELY and deliberately: detonate on top of
// a live actor through the same real path (`detonate`), and require the roster
// to lose bodies and the chunk list to gain pieces.
const gibProbe = await evaluate(`(() => {
  // Put the blast ON a live body and blow it. This is the patch of ground the
  // tuning pass will be standing on, so it is asserted rather than eyeballed.
  const before = window.__sdfGame.actorList();
  const chunksBefore = window.__sdfGame.chunkCensus();
  const st0 = window.__sdfGame.dynamite();
  if (before.length === 0) return { skipped: true };
  const target = before[0];
  const r = window.__sdfGame.detonate(target.pos[0], target.pos[1] + 0.6, target.pos[2]);
  // ——— THE PRE-TEAR WINDOW, ASSERTED AS A WINDOW. The blast no longer swaps
  // the body for debris in its own frame: the body is BENT by the shockwave for
  // ?gibtear seconds and the pieces appear when that closes. So the frame of the
  // blast is checked for the body STILL BEING THERE and bending, and the pieces
  // for arriving after — which is the whole point of the stage, and something
  // the old "the roster shrank" assertion cannot see either way.
  const dw0 = window.__sdfGame.dynamite();
  const duringWindow = {
    actors: window.__sdfGame.actorList().length,
    tearing: dw0.tearing, pendingGibs: dw0.pendingGibs, tearSec: dw0.gibTearSec,
    pieces: dw0.gibPieces, liveChunks: window.__sdfGame.chunkCensus().live,
  };
  window.__sdfGame.setLoopRunning(false);
  window.__sdfGame.step(16);   // the default window is 0.1 s = 6 frames
  const after = window.__sdfGame.actorList();
  const chunksAfter = window.__sdfGame.chunkCensus();
  const dw1 = window.__sdfGame.dynamite();
  // THE POST-WINDOW READS GO AFTER THE SPREAD. The spread r is the detonate result,
  // taken at the BLAST frame, and it carries its own gibPieces — so a
  // post-window gibPieces written before it is silently overwritten by the
  // blast-frame value, which is how this probe first reported "no pieces were
  // spawned" for a gib whose own live-view row had gone 19 -> 24.
  return {
    ...r,
    skipped: false, targetKind: target.kind, before: before.length, after: after.length,
    gibPiecesBefore: st0.gibPieces,
    // Read AFTER the window: with ?gibtear on, the blast frame legitimately has
    // ZERO new pieces — that IS the stage — so the census has to be taken once
    // the window that defers them has closed.
    gibPieces: dw1.gibPieces,
    lastGibSpawned: dw1.lastGibSpawned, lastGibTier: dw1.lastGibTier,
    lastGibParts: dw1.lastGibParts?.length ?? null, lastGibDropped: dw1.lastGibDropped,
    scheduledGibBodies: dw1.scheduledGibBodies, scheduledGibPieces: dw1.scheduledGibPieces,
    liveChunksBefore: chunksBefore.live, liveChunksAfter: chunksAfter.live,
    views: chunksAfter.views, cap: chunksAfter.cap, duringWindow,
    tearingAfter: dw1.tearing, pendingGibsAfter: dw1.pendingGibs,
    // THE SPRITE RENDER MODE'S OWN ROW (query param gibrender=sprite). Reported,
    // not asserted: this gate's contract is the SHIPPED configuration, and
    // sprites are opt-in. It is here because the marched rows go to zero in that
    // mode, and a gate that prints "0 views, 48 recycled" for a blast that
    // spawned 24 billboards is telling its reader something false.
    spriteLive: window.__sdfGame.spriteCensus().live,
    spriteRest: window.__sdfGame.spriteCensus().rest,
    spriteMeshes: window.__sdfGame.spriteCensus().meshes,
  };
})()`);
console.log('gib probe:', JSON.stringify(gibProbe));
writeFileSync(`${OUT}/gib-probe.json`, JSON.stringify(gibProbe, null, 2));

if (!gibProbe.skipped) {
  // The window first: at the blast frame the body is still alive and bending,
  // and nothing has become a piece yet.
  if (gibProbe.duringWindow.tearSec > 0) {
    if (gibProbe.duringWindow.tearing < 1) {
      fail(`?gibtear=${gibProbe.duringWindow.tearSec} is on but no body is tearing at the blast frame `
        + `(tearing=${gibProbe.duringWindow.tearing}) — the pre-tear window is not running`);
    }
    if (gibProbe.duringWindow.actors !== gibProbe.before) {
      fail(`the body was retired in the blast frame (${gibProbe.before} → `
        + `${gibProbe.duringWindow.actors}) — the pre-tear window needs it to outlive the swap`);
    }
    if (gibProbe.duringWindow.pieces !== gibProbe.gibPiecesBefore
      || gibProbe.duringWindow.liveChunks !== gibProbe.liveChunksBefore) {
      fail('pieces were spawned during the pre-tear window — the body and its pieces cannot both be drawn');
    }
    if (!(gibProbe.pendingGibsAfter === 0 && gibProbe.tearingAfter === 0)) {
      fail(`the window never closed (pendingGibs=${gibProbe.pendingGibsAfter}, `
        + `tearing=${gibProbe.tearingAfter}) — bodies are stuck mid-tear and will never gib`);
    }
  }
  if (gibProbe.after >= gibProbe.before) {
    fail(`a point-blank blast removed no actors (${gibProbe.before} → ${gibProbe.after}); `
      + `gibbed=${gibProbe.gibbed}`);
  }
  if (gibProbe.gibbed < 1) fail(`the resolver did not flag the body for gibbing (gibbed=${gibProbe.gibbed})`);
  if (!(gibProbe.gibPieces > gibProbe.gibPiecesBefore)) {
    fail(`no pieces were spawned (${gibProbe.gibPiecesBefore} → ${gibProbe.gibPieces})`);
  }
  // The LIVE-VIEW count is capped, so it is allowed to saturate: what the cap
  // costs is reported, not failed. `?maxchunks=N` is the knob.
  const recycled = Math.max(0, gibProbe.gibPieces - gibProbe.gibPiecesBefore - (gibProbe.liveChunksAfter - gibProbe.liveChunksBefore));
  if (gibProbe.lastGibTier === 'sprite') {
    // The marched view pool does not exist in this mode, so the recycled
    // arithmetic above is meaningless — report the pool that DOES bound it.
    console.log(`sprite pieces ${gibProbe.spriteLive} live + ${gibProbe.spriteRest} parked `
      + `(${gibProbe.spriteMeshes} meshes); the ?maxchunks= view pool is not in this path`);
  } else {
    console.log(`chunk views ${gibProbe.liveChunksBefore} → ${gibProbe.liveChunksAfter} of ${gibProbe.cap}; `
      + `${recycled} of this gib's pieces recycled immediately (raise ?maxchunks= to keep them)`);
  }
  // ——— THE ASSERTION THAT WOULD HAVE CAUGHT THE OWNER'S REPORT. ——————————
  // "i didnt see any skeleton chunks and the gib parts still looked like tubes
  // and orbs" was NOT a broken piece set: at the then-default 24-view pool a
  // three-body blast could not afford the split set for its last body, gave it
  // `clusters+cage` (six tubes with the bones packed INSIDE them) and recycled
  // 18 of its pieces on the frame they were born. This gate PASSED through all
  // of that, because the census assertion further down is skipped when the tier
  // is not `parts` — i.e. skipped in exactly the case the degradation happens.
  // So the SHIPPED configuration now asserts the thing the owner actually looks
  // at: the last body of a multi-body blast gets the full split piece set. Knob
  // runs are exempt (`?maxchunks=24` is a legitimate cost control), which is
  // what `knobbed` is for; the numbers are printed either way.
  if (!knobbed && gibProbe.lastGibTier !== 'parts') {
    fail(`the shipped pool (${gibProbe.cap} views) could not afford the split piece set for the last `
      + `body of a ${gibProbe.gibbed}-body blast: tier=${gibProbe.lastGibTier}, `
      + `${gibProbe.lastGibDropped} pieces dropped and ${recycled} recycled on the blast frame. `
      + 'That body renders as tubes and orbs with its bones buried inside them — the '
      + 'owner-reported bug. Raise the DEFAULT ?maxchunks= or the tier ladder.');
  }
}

// ——— 6. THE FOCUS + LIGHT KNOBS REACH THE SYSTEM ————————————————————————
// The owner's report after playing: "it seems the effective radius of the
// explosion is quite large ... the area of effect should be abit more focused"
// and "i feel the explosion needs to light up the room". The radius is now a
// panel knob, and a knob that the panel can move but the resolver never sees is
// the exact bug class this project has shipped twice — so the gate reads the
// radius the RESOLVER returned, at two slider positions, through the same
// `setDynamiteTuning` seam the panel's sliders use.
{
  const readAt = async (scale) => {
    await evaluate(`window.__sdfGame.setDynamiteTuning({ aoesize: ${scale}, edgekick: 0 })`);
    const st = await evaluate('window.__sdfGame.dynamite()');
    // Detonate on a live body — the returned radiusM is the resolver's own.
    const r = await evaluate(`(() => {
      const a = window.__sdfGame.actorList()[0];
      if (!a) return null;
      return window.__sdfGame.detonate(a.pos[0], a.pos[1] + 0.6, a.pos[2]);
    })()`);
    await evaluate('window.__sdfGame.step(10)');
    return { radiusM: r?.radiusM ?? null, scale: st.aoeRadiusScale, floor: st.aoeLaunchFloor };
  };
  const full = await readAt(1);
  const half = await readAt(0.5);
  await evaluate('window.__sdfGame.setDynamiteTuning({ aoesize: 1, edgekick: 0.45 })');
  console.log('focus knobs:', JSON.stringify({ full, half }));
  if (full.scale !== 1 || half.scale !== 0.5) {
    fail(`the panel's AOE slider did not reach the page (scale read back ${full.scale} / ${half.scale})`);
  }
  if (!(full.radiusM > 0) || !(half.radiusM > 0)) {
    fail(`detonate() did not report a radius (full=${full.radiusM}, half=${half.radiusM})`);
  }
  if (Math.abs(half.radiusM / full.radiusM - 0.5) > 0.02) {
    fail(`the AOE scale did not reach the RESOLVER: radiusM ${full.radiusM} at 1x vs `
      + `${half.radiusM} at 0.5x — the ratio should be 0.5`);
  }
  if (full.floor !== 0 || half.floor !== 0) {
    fail(`the edge-fling knob did not reach the page (read back ${full.floor}/${half.floor}, expected 0)`);
  }
}

// ——— CAPTURE ————————————————————————————————————————————————————————————
await evaluate('window.__sdfGame.step(1)');
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${OUT}/dynamite-slot2.png`, Buffer.from(shot.result.data, 'base64'));
console.log(`capture: ${OUT}/dynamite-slot2.png`);

if (pageErrors.length > 0) {
  console.error(`PAGE ERRORS (${pageErrors.length}):`);
  for (const e of pageErrors.slice(0, 6)) console.error(`  ${e}`);
  fail('the page reported errors');
}
console.log('PASS: slot 2 switches, throws, detonates and gibs');
process.exit(0);
