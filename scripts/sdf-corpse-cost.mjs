// scripts/sdf-corpse-cost.mjs — WHAT DOES A SETTLED CORPSE COST?
//
// The owner: "i think we need some kind of efficient way to ragdoll the SDF+mesh
// combined bodies". The ragdoll itself already exists (collapse.ts ramps
// stepRig's rest-pose pull to 0, ropes keep the limbs attached, the floor contact
// mirrors the gibs), and the SDF flesh follows the rig through applyRig. The open
// question is the COST of a body that has stopped being interesting: the actor
// step has no short-circuit for `phase === 'settled'`, so a corpse keeps running
// the whole motion pipeline, and a ZOMBIE corpse is never baked (the bake is
// gated on `soldierDamage`).
//
// PAIRED IN ONE BOOT, which is the only honest way to compare on this machine:
// the same bodies, the same camera, the same room — first LIVE, then after the
// same bodies have collapsed and SETTLED. Nothing is added or removed, so the
// difference is exactly "what a live body costs over a corpse".
//
// Reads the REAL inter-frame cadence from the live loop plus the pass timings, so
// a cost that is absorbed by the frame budget shows up as such instead of being
// reported as a difference.
//
// BLOCKED, AND THE BLOCKER IS THE INTERESTING PART: there is no way to collapse a
// body on demand in the GAME. `collapse.ts` has a `forced` trigger, but the page
// never sets it — the only live triggers are the wound METER and both-legs-severed
// (`forcedCollapse` is wired in lab-main.ts only). So the only way to make a corpse
// is a blast, and a blast also GIBBS the neighbours and leaves debris: measured,
// two blast rounds took the roster 23 -> 12 actors and left 9 live chunks, so every
// arm changed the actor count and the cadence comparison measured nothing (the same
// claim read +7.6 ms and -1.4 ms in consecutive runs, i.e. noise).
//
// This rig becomes meaningful the moment a `__sdfGame.collapse(id)` seam exists —
// which is step 0 of the design note, and is also what a sleep or a bake test needs.
// See docs/dev-notes/2026-09-11-efficient-ragdoll-for-sdf-mesh-bodies/README.md.
//
// Usage: node scripts/sdf-corpse-cost.mjs <vitePort> <cdpPort> [bursts]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const BURSTS = Number(process.argv[4] ?? 3);
const OUT = process.env.CORPSE_OUT ?? '/tmp/corpse-cost';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

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
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?room=arena` });
for (let i = 0; i < 240; i++) { await sleep(400); if (await ev('typeof window.__sdfGame === "object"')) break; }
for (let i = 0; i < 60; i++) { if (await ev('__sdfGame.gunReady === true')) break; await sleep(400); }

/** Real inter-frame cadence on the LIVE loop, `frames` samples. */
async function cadence(frames = 120) {
  return await ev(`new Promise(res => {
    const ts = []; let last = performance.now();
    const tick = () => { const n = performance.now(); ts.push(n - last); last = n;
      if (ts.length < ${frames}) requestAnimationFrame(tick); else {
        ts.sort((a,b)=>a-b);
        res({ median: +ts[Math.floor(ts.length/2)].toFixed(3), p95: +ts[Math.floor(ts.length*0.95)].toFixed(3) });
      } };
    requestAnimationFrame(tick);
  })`);
}
const roster = async () => {
  const list = await ev('__sdfGame.actorList()');
  const by = {};
  for (const a of list) by[a.phase] = (by[a.phase] ?? 0) + 1;
  return { total: list.length, by };
};
const timings = async () => {
  const t = await ev('__sdfGame.passTimings()');
  const march = t?.['sdf:march'] ?? t?.sdfMarch ?? null;
  return { march: march ? +Number(march).toFixed(2) : null, raw: t };
};

console.log('roster at boot:', JSON.stringify(await roster()));
const liveCadence = await cadence();
const liveTimings = await timings();
console.log(`LIVE:   cadence median ${liveCadence.median} ms (p95 ${liveCadence.p95}), sdf:march ${liveTimings.march}`);

// COLLAPSE THEM WITHOUT GIBBING. The collapse meter climbs per wound, so a body
// has to be hit several times just outside the gib window — and each blast must
// be aimed at a DIFFERENT body, or the same one takes every hit and the rest
// never leave 'standing' (measured: 3 blasts at one body left 22 standing and 1
// settled, which is not a corpse sample).
//
// The AOE is also narrowed (?aoesize 0.6) so a blast wounds its target instead of
// gibbing the neighbours — a gibbed neighbour becomes DEBRIS, and debris is a
// confound this rig cannot subtract.
await ev('__sdfGame.setDynamiteTuning({ aoesize: 0.6 })');
for (let round = 0; round < BURSTS; round++) {
  const done = await ev(`(() => {
    const list = window.__sdfGame.actorList().filter(a => a.phase === 'standing');
    const hit = [];
    for (const a of list) {
      const r = window.__sdfGame.detonate(a.pos[0] + 3.4, a.pos[1] + 0.7, a.pos[2]);
      hit.push({ id: a.id, gibbed: r.gibbed });
    }
    return hit;
  })()`);
  console.log(`  blast round ${round + 1}: gibbed ${done.reduce((n, h) => n + h.gibbed, 0)} of ${done.length} targeted`);
  await sleep(1200);
}
await sleep(3000);   // falling -> settled
// WAIT OUT THE DEBRIS. The blasts above gib some bodies whatever we do, and a
// single live chunk costs frame time; comparing cadence with debris in flight
// measures the chunks, not the corpses.
let live = 1;
for (let i = 0; i < 40 && live > 0; i++) {
  live = (await ev('__sdfGame.chunkCensus()')).live;
  if (live > 0) await sleep(500);
}
console.log(`debris settled to ${live} live chunk(s) before the corpse cadence read`);
const after = await roster();
console.log('roster after the blasts:', JSON.stringify(after));
const corpseCadence = await cadence();
const corpseTimings = await timings();
console.log(`CORPSE: cadence median ${corpseCadence.median} ms (p95 ${corpseCadence.p95}), sdf:march ${corpseTimings.march}`);
console.log(`\nΔ cadence (corpse - live): ${(corpseCadence.median - liveCadence.median).toFixed(3)} ms`);
console.log(`Δ sdf:march: ${corpseTimings.march !== null && liveTimings.march !== null
  ? (corpseTimings.march - liveTimings.march).toFixed(2) : 'n/a'} ms`);
console.log('bake stats:', JSON.stringify(await ev('typeof __sdfGame.corpseBakes === "function" ? __sdfGame.corpseBakes() : (__sdfGame.corpseStats ? __sdfGame.corpseStats() : null)')));
if (errs.length) console.log('page errors:', errs.slice(0, 3));
writeFileSync(`${OUT}/corpse-cost.json`, JSON.stringify({ liveCadence, liveTimings, after, corpseCadence, corpseTimings }, null, 2));
console.log(`wrote ${OUT}/corpse-cost.json`);
try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {}
