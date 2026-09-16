// scripts/sdf-blast-profile.mjs - WHERE DOES THE BLAST'S TIME GO? The phase split of one detonation, plus the
// resolver's own trace/wound/cut split, over a warm-up and three blasts in the
// arena.
//
// MEASUREMENT DISCIPLINE, and this script exists because I got it wrong: report a
// MEDIAN over several blasts, never one reading. The same build's resolve moved
// 39 -> 55 ms between two runs on this machine, and a single-run A/B of the wound
// cap inverted on re-run. The only trustworthy comparison is two arms measured
// INTERLEAVED IN ONE BOOT (see sdf-wound-probe-ab.mjs).
//
// Usage: node scripts/sdf-blast-profile.mjs <vitePort> <cdpPort>
// Where does the 45 ms go? Blow up the arena's horde and read the phase split.
const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, e) => { ws.onopen = ok; ws.onerror = e; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (mm, p = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method: mm, params: p })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Runtime.enable');
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?room=arena` + (process.env.QS ?? '') });
for (let i = 0; i < 240; i++) { await new Promise(r => setTimeout(r, 400)); if (await ev('typeof window.__sdfGame === "object"')) break; }
for (let i = 0; i < 80; i++) { if (await ev('__sdfGame.gunReady === true')) break; await new Promise(r => setTimeout(r, 400)); }
await ev('__sdfGame.step(20)');

// Warm the pool first, so the first-ever allocation is not what we measure.
await ev('__sdfGame.detonate(28, 1.0, -6.0)');
await ev('__sdfGame.step(200)');
console.log('--- after warm-up ---');
console.log(JSON.stringify(await ev('__sdfGame.dynamite().blastProfile')));

// Now three detonations in the middle of the horde, reading the profile each time.
for (let i = 1; i <= 3; i++) {
  const roster = await ev('__sdfGame.actorList()');
  const t = roster.find(a => a.room === 6) ?? roster[0];
  if (!t) break;
  const r = await ev(`__sdfGame.detonate(${t.pos[0]}, ${t.pos[1] + 0.6}, ${t.pos[2]})`);
  const p = await ev('__sdfGame.dynamite().blastProfile');
  const cen = await ev('__sdfGame.chunkCensus()');
  const rp = await ev('__sdfGame.dynamite().resolveProfile');
  console.log(`blast ${i}: gibbed ${r.gibbed} pieces ${r.gibPieces} | total ${p.total.toFixed(1)} `
    + `= resolve ${p.resolve.toFixed(1)} [trace ${rp.traceMs.toFixed(1)} + wound ${rp.woundMs.toFixed(1)} `
    + `+ cut ${rp.cutMs.toFixed(1)}] + gib ${p.gib.toFixed(1)} | in-range ${p.bodies} `
    + `traced ${rp.bodiesTraced} pruned ${rp.bodiesPruned} traces ${rp.traces} | views ${cen.views}`);
  await ev('__sdfGame.step(60)');
}
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
