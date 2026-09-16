// scripts/sdf-plume-shape.mjs — WHAT SHAPE IS THE PLUME, IN METRES?
//
// The frame-differential rig (sdf-explosion-fx-shot.mjs) answers "does it draw,
// how bright, how big on screen". It CANNOT answer "is it a mushroom", twice
// over: the ground shockwave ring is a large low-lying annulus whose changed
// pixels dominate the frame's mass centroid, and any band split by height is
// cut by the changed region's BOUNDING BOX, which one stray pixel re-cuts. Both
// of those produced confident, wrong numbers before this rig existed.
//
// So this asks the module instead. `explosionFx().layerExtents` reports, per
// layer, the world box its billboards DREW this frame (not just their centres)
// and the mean height of their bottom and top quartiles — deterministic, in
// metres, with no GPU readback and nothing to reorder between runs. Read
// against `burstHalfHeightM`, which is the unit the whole burst is laid out in,
// and against the ATLAS reference: a camera-facing quad 2 x halfHeight tall
// whose width tracks each frame's pixel aspect (1.29-2.01 m at the shipped
// size), i.e. a ~1.68 x 1.3-2.0 m silhouette.
//
// Usage: node scripts/sdf-plume-shape.mjs <vitePort> <cdpPort> [qs]
//   FX_QS='&fxplume=0'  the round-ball control
//   PLUME_KIND=air      the reference's OTHER sequence: the air SEQ is a
//                       fireball, and measured, this stays one (fire
//                       1.47 x 1.52 m against the ground plume's 2.72 x 2.18)
import { mkdirSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const QS = process.argv[4] ?? '';
const OUT = '/tmp/plume-shape';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, e) => { ws.onopen = ok; ws.onerror = e; });
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
// EVERY WAIT IS BOUNDED. The house precedent is scripts/sdf-game-bench.mjs,
// which wedged for 19 silent minutes because its `send()` had no timeout and
// nothing rejected its pending map on socket death. This rig hung the same way
// (two runs, 10 minutes each, no output) with several game pages open in one
// Chrome competing for the GPU — a page that stops answering must FAIL, naming
// the expression it was waiting on, not hang.
const SEND_TIMEOUT_MS = Number(process.env.PLUME_SEND_TIMEOUT_MS ?? 30000);
const send = (mm, p = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(new Error(`CDP ${mm} timed out after ${SEND_TIMEOUT_MS} ms (page unresponsive? open targets: see /json/list)`));
  }, SEND_TIMEOUT_MS);
  pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
  ws.send(JSON.stringify({ id, method: mm, params: p }));
});
ws.addEventListener('close', () => {
  for (const [, r] of pending) r({ error: 'socket closed' });
  pending.clear();
});
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
  if (r?.error) throw new Error(`evaluate failed: ${JSON.stringify(r.error).slice(0, 200)}`);
  return r.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?frozen=1${QS}` });
for (let i = 0; i < 240; i++) { await sleep(500); if (await ev('typeof window.__sdfGame === "object"')) break; if (i === 239) fail('__sdfGame never appeared'); }
for (let i = 0; i < 60; i++) { if (await ev('window.__sdfGame.gunReady === true')) break; await sleep(500); if (i === 59) fail('the view-model never became ready'); }
// FROZEN and loop-stopped, so `step(n)` is the only thing that advances the
// burst and an "age" below means exactly n/60 seconds.
await ev('window.__sdfGame.setDemoHold(true)');
await ev('window.__sdfGame.setLoopRunning(false)');
await ev('window.__sdfGame.step(20)');

process.on('unhandledRejection', (e) => { console.error(`FAIL: ${e?.message ?? e}`); process.exit(1); });

const fx = await ev('window.__sdfGame.explosionFx()');
if (fx.mode !== 'procedural') fail(`expected the procedural burst, got ${fx.mode}`);
// KIND, because the reference has TWO sequences and they are different shapes:
// the ground SEQ is the mushroom the owner asked for, and the AIR SEQ is a
// fireball. `?kind=air` (or PLUME_KIND) measures the other one.
const KIND = process.env.PLUME_KIND ?? 'ground';
await ev(`window.__sdfGame.spawnExplosionFx(-5.2, ${KIND === 'air' ? 2.4 : 0.02}, -4.4, 2.0, "${KIND}")`);
await ev('window.__sdfGame.setLoopRunning(false)');
const halfH = await ev('window.__sdfGame.explosionFx().burstHalfHeightM');
if (!(halfH > 0)) fail('the module reported no burst half-height — layerExtents is not wired');

const w = (v) => v.toFixed(2).padStart(5);
console.log(`KIND=${KIND}`);
console.log(`burst half-height ${halfH.toFixed(3)} m — the atlas reference is a quad 2x that tall `
  + `(${(2 * halfH).toFixed(2)} m) and 1.29-2.01 m wide`);
console.log('  age   layer   n   width  height  depth |  mass mean / low quartile / high quartile (m)');
const rows = [];
let stepDone = 0;
for (const frames of [6, 12, 24, 42, 66]) {
  await ev(`window.__sdfGame.step(${frames - stepDone})`);
  stepDone = frames;
  for (const k of ['ring', 'ember', 'fire', 'smoke']) {
    const x = await ev(`window.__sdfGame.explosionFx().layerExtents.${k}`);
    if (!x || x.count === 0) { console.log(`  ${(frames / 60).toFixed(2)}s ${k.padEnd(6)}   0   —`); continue; }
    const dx = x.max[0] - x.min[0], dy = x.max[1] - x.min[1], dz = x.max[2] - x.min[2];
    console.log(`  ${(frames / 60).toFixed(2)}s ${k.padEnd(6)} ${String(x.count).padStart(2)}  `
      + `${w(dx)}  ${w(dy)}  ${w(dz)} |  ${w(x.meanY)} / ${w(x.lowQuartileY)} / ${w(x.highQuartileY)}`);
    if (rows.length < 40) rows.push({
      age: frames / 60, layer: k, count: x.count,
      dx, dy, dz, meanY: x.meanY, low: x.lowQuartileY, high: x.highQuartileY,
    });
  }
}

// ——— THE VERDICT ————————————————————————————————————————————————————————
// THE FOUR PROPERTIES THAT MAKE IT A PLUME RATHER THAN A BALL, and all four are
// falsifiable from the module's own geometry — no pixels, no threshold, nothing
// that reorders between runs:
//   1. the fire's mass RISES over its life (a ball's sits where it is born);
//   2. the fire layer has vertical SPREAD and a column, not a dot;
//   3. the smoke is a LATE BLOOMER — it peaks after the fire does;
//   4. the smoke cap ends WIDER THAN TALL (the flatten).
// What is NOT gated, and must not be claimed from this: whether it looks like
// Blood. These extents are the BILLBOARD extents; the fire material's round
// falloff means the VISIBLE fire is well inside them, so this is a layout
// measurement, not a visible-size measurement — the PNGs in
// /tmp/explosion-fx are for the size and colour call.
// The CONTROL ARM IS EXPECTED TO FAIL these, and saying so is the point: the
// round ball and the plume are supposed to be distinguishable, and this is the
// assertion that distinguishes them (measured, the ball's cap is TALLER than
// wide — 2.72 x 3.75 m against the plume's 3.75 x 3.10). So the control arm
// reports its diagnosis and passes; only the plume arm's properties are gated.
const expectPlume = !/fxplume=0/.test(`${QS} ${process.env.FX_QS ?? ''} ${process.env.PLUME_EXPECT ?? ''}`);
const fires = rows.filter(r => r.layer === 'fire');
const smokes = rows.filter(r => r.layer === 'smoke');
if (fires.length < 2) fail('the fire layer barely emitted — nothing to judge');
const early = fires[0], late = fires[fires.length - 1];
if (!(late.meanY > early.meanY + 0.2)) {
  fail(`the fire's mass does not rise (${early.meanY.toFixed(2)} m at ${early.age.toFixed(2)}s -> `
    + `${late.meanY.toFixed(2)} m at ${late.age.toFixed(2)}s) — that is a fireball, not a plume`);
}
if (late.high - late.low < halfH * 0.2) fail('the fire layer has no vertical spread at all');
if (late.dy > halfH * 4) fail(`the fire is ${late.dy.toFixed(2)} m tall, over 4 half-heights — it has become a room-filler`);
if (smokes.length > 0) {
  const firstSmoke = smokes[0], lastSmoke = smokes[smokes.length - 1];
  if (firstSmoke.age <= early.age) fail('the smoke starts with or before the fire — it is not a late bloomer');
  const flatCap = lastSmoke.dx > lastSmoke.dy;
  if (!flatCap && expectPlume) {
    fail(`the smoke cap is ${lastSmoke.dx.toFixed(2)} x ${lastSmoke.dy.toFixed(2)} m — wider than tall is the `
      + 'flatten that makes a cap, and it is not happening');
  }
  console.log(`smoke cap at the end: ${lastSmoke.dx.toFixed(2)} x ${lastSmoke.dy.toFixed(2)} m `
    + `(${flatCap ? 'wider than tall — the cap' : 'TALLER than wide — no flatten'})`);
}
console.log(`fire mass rises ${early.meanY.toFixed(2)} m (${early.age.toFixed(2)}s) -> ${late.meanY.toFixed(2)} m (${late.age.toFixed(2)}s), `
  + `silhouette ${late.dx.toFixed(2)} x ${late.dy.toFixed(2)} m at the end`);
console.log(expectPlume
  ? 'PASS: it is a plume by construction — rising mass, spread, a late cap, and a flattened cap'
  : 'CONTROL ARM: this is the round-ball A/B, and it reports the properties it is SUPPOSED to lack');
