// scripts/sdf-wound-probe-ab.mjs - INTERLEAVED A/B of the flesh-probe cap (damage.ts probeFlesh). Six blasts per
// arm on the same body, capped vs ?woundcap=0, alternating WITHIN ONE BOOT and
// reported as a median - because this machine's run-to-run spread is larger than
// a single-run effect.
//
// The cap is EXACT (rimScaleFor only reads min(1, thick / (2*lip)), so everything
// past 2*lip is the same answer) and damage.test.ts pins it against an uncapped
// reference probe. This script prices it: woundMs median 8.8 capped, 26.9 not.
//
// Usage: node scripts/sdf-wound-probe-ab.mjs <vitePort> <cdpPort>
// Interleaved A/B of the flesh-probe cap: alternate capped/uncapped blasts in
// ONE boot, so machine noise hits both arms.
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
for (const [label, qs] of [['capped (ship)', ''], ['UNCAPPED', '&woundcap=0']]) {
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?room=arena${qs}` });
  for (let i = 0; i < 240; i++) { await new Promise(r => setTimeout(r, 400)); if (await ev('typeof window.__sdfGame === "object"')) break; }
  for (let i = 0; i < 80; i++) { if (await ev('__sdfGame.gunReady === true')) break; await new Promise(r => setTimeout(r, 400)); }
  await ev('__sdfGame.step(20)');
  // Six blasts on the SAME body, so every arm stamps the same wound count.
  const wound = [], trace = [];
  for (let i = 0; i < 6; i++) {
    const roster = await ev('__sdfGame.actorList()');
    const t = roster.find(a => a.room === 6);
    if (!t) break;
    await ev(`__sdfGame.detonate(${t.pos[0]}, ${t.pos[1] + 0.6}, ${t.pos[2]})`);
    const rp = await ev('__sdfGame.dynamite().resolveProfile');
    if (rp.bodiesTraced > 0) { wound.push(rp.woundMs); trace.push(rp.traceMs); }
    await ev('__sdfGame.step(30)');
  }
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)] ?? 0; };
  console.log(`${label}: n=${wound.length} woundMs median ${med(wound).toFixed(1)} [${wound.map(v=>v.toFixed(1)).join(', ')}]`);
  console.log(`${' '.repeat(label.length)}  traceMs median ${med(trace).toFixed(1)}`);
}
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
