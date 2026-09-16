// scripts/sdf-explosion-light-check.mjs - DOES THE EXPLOSION LIGHT THE ROOM? Measured as the WHOLE-FRAME mean, not as a
// changed-pixel count: a transient light lifts every wall a little, which sails
// under any sensible per-pixel change threshold - and that made the light look
// like it did nothing while it was in fact working.
//
// Sweeps ?fxlight= so the peaks can be tuned against a number, and reads the live
// mesh-side intensity, so a light that is on but dim is distinguishable from one
// that never reaches the material at all.
//
// Usage: node scripts/sdf-explosion-light-check.mjs <vitePort> <cdpPort>
// "Does the room light up?" is a WHOLE-FRAME brightness question, not a
// changed-pixel one: a transient light lifts every wall a little, which is
// under any sensible per-pixel change threshold.
import { decodePng } from '/Users/donny/Projects/blud/.claude/worktrees/dynamite-weapon-slot/scripts/lib/demo-presented.mjs';
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
const stats = (buf) => {
  const p = decodePng(buf);
  let sum = 0, n = 0, bright = 0;
  for (let i = 0; i < p.data.length; i += p.ch) {
    const l = 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2];
    sum += l; n++; if (l > 60) bright++;
  }
  return { mean: +(sum / n).toFixed(2), brightPx: bright };
};
for (const [label, url] of [
  ['fxlight 0   (off)  ', `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&fxlight=0`],
  ['fxlight 0.5 (dim)  ', `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&fxlight=0.5`],
  ['fxlight 1   (SHIP) ', `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off`],
  ['fxlight 2   (hot)  ', `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&fxlight=2`],
]) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 240; i++) { await new Promise(r => setTimeout(r, 400)); if (await ev('typeof window.__sdfGame === "object"')) break; }
  for (let i = 0; i < 60; i++) { if (await ev('__sdfGame.gunReady === true')) break; await new Promise(r => setTimeout(r, 400)); }
  await ev('__sdfGame.setDemoHold(true)'); await ev('__sdfGame.setVhs(null)');
  await ev('__sdfGame.teleport(6)');            // the arena: a big room to fill
  await ev('__sdfGame.step(6)');
  const before = stats(Buffer.from(await ev('__sdfGame.presentedShot()'), 'base64'));
  // A ground burst 3.4 m ahead of the arena centre, then 6 frames of light age.
  const r = await ev(`(() => { const b = window.__sdfGame.spawnExplosionFx(28.0, 0.8, -1.4, 2.0, 'ground'); return b; })()`);
  await ev('__sdfGame.step(6)');
  const d = await ev('__sdfGame.dynamite()');
  const after = stats(Buffer.from(await ev('__sdfGame.presentedShot()'), 'base64'));
  console.log(`${label}: room mean ${before.mean} -> ${after.mean}  (+${(after.mean - before.mean).toFixed(2)}), `
    + `scale ${d.fxLightScale}, mesh intensity ${JSON.stringify(d.meshIntensity)}, ages ${JSON.stringify(d.lightAges)}`);
}
console.log('page errors:', errs.length ? errs.slice(0, 3) : 'none');
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
