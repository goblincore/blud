// scripts/sdf-dynamite-cycle.mjs - SIX THROW CYCLES, reporting the prop pool after each. The repro for the
// "after like the first 2 throws i dont see the dynamite" bug, kept because the
// pool is where that class of bug lives and none of it is visible from outside:
// held prop visibility/parent/local transform, spares, drawn bundles, detonations.
//
// THE LOCAL TRANSFORM IS THE TELL. A prop reparented back into the camera rig
// keeps the WORLD transform its flight pose wrote, so a re-acquired bundle draws
// at its last detonation position interpreted as a rig-local offset. Any non-zero
// `local` after a throw is that bug returning.
//
// Usage: node scripts/sdf-dynamite-cycle.mjs <vitePort> <cdpPort>
// Six full throw cycles with realistic timing, reporting the prop pool after
// each. This is the repro for "after like the first 2 throws i dont see the
// dynamite or throwing it".
const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, e) => { ws.onopen = ok; ws.onerror = e; });
let seq = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params?.exceptionDetails?.exception?.description ?? 'exc');
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errs.push((m.params.args ?? []).map(a => a.value ?? '').join(' '));
};
const send = (mm, p = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method: mm, params: p })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Runtime.enable');
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?room=arena` });
for (let i = 0; i < 240; i++) { await new Promise(r => setTimeout(r, 400)); if (await ev('typeof window.__sdfGame === "object"')) break; }
for (let i = 0; i < 80; i++) { if (await ev('__sdfGame.gunReady === true')) break; await new Promise(r => setTimeout(r, 400)); }
await ev('__sdfGame.step(10)');

const snap = async () => {
  const d = await ev('__sdfGame.dynamite()');
  return { held: d.inHand ? (d.heldVisible ? 'VISIBLE' : 'HIDDEN') : 'none',
           local: d.heldLocal, spares: d.spares, drawn: d.drawnBundles, inFlight: d.inFlight,
           thrown: d.thrown, det: d.detonations };
};
console.log('boot:', JSON.stringify(await snap()));
await ev('__sdfGame.selectSlot("dynamite")');
await ev('__sdfGame.step(30)');
console.log('after switch:', JSON.stringify(await snap()));

for (let n = 1; n <= 6; n++) {
  // press -> cook ~40 frames -> release, then let the flight resolve + recover.
  await ev('__sdfGame.dynamitePress()');
  await ev('__sdfGame.step(40)');
  await ev('__sdfGame.dynamiteRelease()');
  await ev('__sdfGame.step(2)');
  const justThrown = await snap();
  await ev('__sdfGame.step(150)');   // 2.5 s: flight lands, blast, recovery over
  const settled = await snap();
  console.log(`throw ${n}: right after -> ${JSON.stringify(justThrown)}`);
  console.log(`         settled    -> ${JSON.stringify(settled)}`);
}
console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none');
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
