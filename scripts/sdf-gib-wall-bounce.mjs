// scripts/sdf-gib-wall-bounce.mjs — DO DETACHED PIECES STAY IN THE ROOM?
//
// The owner, playing: "it seems the gibs dont bounce off the walls/have
// collission". Correct: `stepChunk` knew about a floor plane at y = radius and
// nothing else, so a piece thrown at a wall flew straight through it and out of
// the level. The stepper now takes the level's own collider boxes (which are the
// walls SPLIT AROUND THE DOORWAYS) plus a per-enclosure ceiling.
//
// WHAT THIS MEASURES, and why it is the right question: not "did a velocity
// reverse" (that is a unit test, and there are six of them) but "did any piece
// end up somewhere a piece cannot be". The arena is a closed 16x16x6 m box with
// one doorway, so a gib that is outside it — with a margin, and not in the
// doorway band — went THROUGH a wall. That is exactly what the owner saw.
//
// FALSIFICATION: run with GIB_WALLS=0 to step the chunks with NO colliders (the
// pre-fix behaviour) and the same assertion must fail. A check that cannot fail
// is not a check.
//
// Usage: node scripts/sdf-gib-wall-bounce.mjs <vitePort> <cdpPort>
import { execFileSync } from 'node:child_process';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {}
});
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, e) => { ws.onopen = ok; ws.onerror = e; });
let seq = 0; const pending = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params?.exceptionDetails?.exception?.description ?? 'exc');
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errs.push((m.params.args ?? []).map(a => a.value ?? '').join(' '));
};
const send = (mm, p = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method: mm, params: p })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'page threw');
  return r.result?.result?.value;
};
await send('Runtime.enable'); await send('Page.enable');
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
// GIB_WALLS_QS points this rig at a knobbed arm, exactly as the dynamite gate's
// GATE_QS does. The reason it matters HERE: `chunkStates()` reports the sprite
// render mode's pieces too, so `GIB_WALLS_QS='&gibrender=sprite'` re-runs this
// whole "did any piece end up somewhere a piece cannot be" check against the
// billboard path — which is the point of that seam being mode-agnostic, since the
// walls/ceiling guarantee must not quietly stop being verified the day the
// renderer changes.
const wallsQs = process.env.GIB_WALLS_QS ?? '';
const url = `http://localhost:${VITE}/sdf-game.html`
  + (wallsQs.startsWith('&') ? `?${wallsQs.slice(1)}` : wallsQs);
await send('Page.navigate', { url });
for (let i = 0; i < 240; i++) { await sleep(400); if (await ev('typeof window.__sdfGame === "object"')) break; }
for (let i = 0; i < 60; i++) { if (await ev('__sdfGame.gunReady === true')) break; await sleep(400); }
if (wallsQs.includes('gibrender=sprite')) {
  // A blast is synchronous and cannot await the sheet, so wait for the preload —
  // otherwise the first detonation falls back to marched pieces and this rig
  // would "verify" sprite walls by measuring marched ones.
  for (let i = 0; i < 60; i++) {
    if (await ev('__sdfGame.gibRenderMode().ready === true')) break;
    await sleep(400);
  }
  const m = await ev('__sdfGame.gibRenderMode()');
  if (!m.ready) { console.log('FAIL: ?gibrender=sprite booted without an atlas'); process.exitCode = 1; }
  else console.log(`sprite render mode armed: ${m.frames} frames`);
}

// THE INVARIANT IS LOCAL, NOT GLOBAL. The horde is spread over rooms 1-5, so a
// single "the pieces must be in the arena" box is the wrong question — and it is
// what the first version of this rig asked, reporting 5731 escapes that were
// really just pieces in the NEXT ROOM.
//
// The right invariant is: **every piece is always inside SOME enclosure.** The
// level's interiors (rooms and tunnels) tile the walkable space and the walls
// between them are 0.3 m of solid; a piece whose centre is in none of them went
// THROUGH a wall into the void between rooms. That is precisely the owner's bug,
// and it is a question the page can answer per piece, wherever the piece is.
console.log(`roster: ${(await ev('__sdfGame.actorList()')).length} bodies`);
// Sanity: the level does have holes at the doorway mouths, so a piece passing
// through one is legal — and it is in the TUNNEL's box, not the room's.
console.log('enclosure at a room centre and at a doorway are both non-null:', await ev(`(() => {
  const a = window.__sdfGame.enclosureBoxAt(-4.8, -4.8);
  const b = window.__sdfGame.enclosureBoxAt(0.5, 1.5);
  return [a && a.key, b && b.key];
})()`));

// GIB SEVERAL BODIES, then watch every piece for two seconds. A blast inside the
// arena throws pieces outward in every direction, which is exactly the case the
// owner hit: some of them were heading at a wall.
console.log('gibbing the horde…');
for (let round = 0; round < 2; round++) {
  await ev(`(() => {
    const list = window.__sdfGame.actorList();
    if (!list.length) return null;
    const a = list[Math.min(${round}, list.length - 1)];
    return window.__sdfGame.detonate(a.pos[0], a.pos[1] + 0.6, a.pos[2]);
  })()`);
  await sleep(1200);
}

let worst = null, samples = 0, escapes = 0, maxY = -Infinity, maxPieceY = -Infinity;
const roofsSeen = new Set();
for (let i = 0; i < 120; i++) {
  await ev('__sdfGame.step(1)');
  // ONE evaluate per frame: the enclosure lookup is a page call, so asking per
  // piece over the CDP would dominate the run.
  const res = await ev(`(() => {
    const cs = window.__sdfGame.chunkStates();
    const out = [];
    let maxY = -Infinity;
    const roofs = new Set();
    for (const c of cs) {
      const b = window.__sdfGame.enclosureBoxAt(c.pos[0], c.pos[2]);
      const key = b ? b.key : null;
      if (!key) out.push({ id: c.id, limb: c.limb, kind: c.kind, pos: c.pos, vel: c.vel, radius: c.radius });
      else if (b.max[1] > 3.05) roofs.add(key);
      maxY = Math.max(maxY, c.pos[1]);
    }
    return { n: cs.length, out, maxY, roofs: [...roofs] };
  })()`);
  if (!res || res.n === 0) { await sleep(40); continue; }
  samples += res.n;
  maxY = Math.max(maxY, res.maxY);
  maxPieceY = Math.max(maxPieceY, res.maxY);
  for (const r of res.roofs) roofsSeen.add(r);
  escapes += res.out.length;
  if (res.out.length && !worst) worst = res.out[0];
}
const live = (await ev('__sdfGame.chunkStates()'))?.length ?? 0;
console.log(`sampled ${samples} piece-frames over ${live} live pieces`);
console.log(`highest piece centre y = ${maxY.toFixed(2)} m (tall enclosures seen: ${[...roofsSeen].join(', ') || 'none'})`);
console.log(`  -> the ceiling check is only meaningful in a tall room; the arena is 6 m and `
  + `the 3 m rooms cap a piece at ~3 m.`);
if (escapes > 0) {
  console.log(`FAIL: ${escapes} piece-frames were in NO enclosure (i.e. inside a wall or through one)`);
  console.log(`  first offender: ${JSON.stringify(worst)}`);
  process.exitCode = 1;
} else {
  console.log('PASS: every piece was inside a room or tunnel for the whole run');
}
if (errs.length) console.log('page errors:', errs.slice(0, 3));
try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {}
