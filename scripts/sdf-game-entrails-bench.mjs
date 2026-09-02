// scripts/sdf-game-entrails-bench.mjs — ENTRAILS cost bench (task 8 step 5).
//
// Measures goo's baseline (never measured — the outstanding X1.blood-viscosity
// item) and then N disembowelled bodies, as ALTERNATING legs inside one run:
//
//   goo-base : ship defaults (goo ON, bleed ON), spillChance 0 — the
//              firefight rolls spills (RNG spent identically) but no ropes.
//   guts-all : same, plus ropes staged on EVERY body in the room BEFORE the
//              measured frames (spillChance 1 while staging, then 0, so the
//              firefight adds no ropes and the workload difference is exactly
//              the staged ropes: their verlet step, their 10 'gut' droplets
//              each in the goo pass, and their viscera-shaded cavities).
//
// Legs alternate across repeats (base guts base guts base guts), fresh page
// per leg-run (damage persists across runs on a shared page). Reported, NOT
// blocking: if the delta is under the within-run spread the verdict is
// UNRESOLVED — the amplitude guards are the containment.
//
// Usage: node scripts/sdf-game-entrails-bench.mjs <vitePort> <cdpPort> <outDir>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5388);
const CDP = Number(process.argv[3] ?? 9388);
const OUT = process.argv[4] ?? 'docs/dev-notes/2026-09-02-entrails';
const W = Number(process.env.GAME_W ?? 1280);
const H = Number(process.env.GAME_H ?? 800);
const REPEATS = Number(process.env.BENCH_REPEATS ?? 3);
const ROOM = Number(process.env.BENCH_ROOM ?? 4);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, timeoutMs = 120000) => {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs }),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`eval timeout: ${expression.slice(0, 60)}`)), timeoutMs + 5000)),
  ]);
  if (r.result?.exceptionDetails) fail(`page threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 300)}`);
  return r.result?.result?.value;
};

mkdirSync(OUT, { recursive: true });

// Fresh page per leg-run. Boot + settle.
async function bootPage() {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });
  let backend = null;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
    if (backend) break;
  }
  if (backend !== 'webgpu') fail(`backend ${backend}, not webgpu`);
  await sleep(2000);
}

// Stage ropes until every aim-able body in the room has one. Decoupled from
// specific targets: the room spawns its bodies as a CLUSTER, so a ray aimed
// at body X usually resolves on nearer body Y first — aiming "at X" fights
// the geometry and cost the first two runs 5 of 9 ropes even frozen. Instead:
// aim a ring at the first ropeless body; whatever ROPELESS body the predictor
// confirms takes the stamp (a body that already has an entry is SKIPPED — a
// second qualifying stamp would TEAR its rope, the one-rope-per-body rule).
async function stageRopes() {
  const r = await evaluate(`(async () => {
    const spillKeep = __sdfGame.woundTuning.spillChance;
    __sdfGame.setWoundTuning({ spillChance: 1 });   // deterministic staging
    __sdfGame.freeze(true);
    __sdfGame.step(2);
    const eyeH = 1.62;
    const ROOM_ID = ${ROOM};
    const skipped = new Set();
    const limbStamps = { n: 0 };
    for (let attempt = 0; attempt < 80; attempt++) {
      const pending = __sdfGame.guts().filter(g => g.none && g.room === ROOM_ID && !skipped.has(g.id));
      if (!pending.length) break;
      const target = __sdfGame.zombies().find(z => z.id === pending[0].id);
      let ok = false;
      outer:
      for (const H_AIM of [1.2, 1.05, 1.3]) {
        for (const dist of [2.4, 2.8, 2.0, 3.2]) {
          for (const ang of [0, 0.7, -0.7, 1.4, -1.4, 2.1]) {
            const ex = target.pos[0] + Math.sin(ang) * dist;
            const ez = target.pos[2] + Math.cos(ang) * dist;
            const yaw = Math.atan2(target.pos[0] - ex, -(target.pos[2] - ez));
            const pitch = Math.atan2(H_AIM - eyeH, dist);
            __sdfGame.setPose(ex, ez, yaw, pitch, 0);
            const p = __sdfGame.predictSlugHit();
            if (p.actorId < 0 || !p.hit) continue;
            const g = __sdfGame.guts().find(q => q.id === p.actorId);
            if (g && !g.none) continue;   // has a rope (or entry) — do not tear it
            __sdfGame.stampWoundAt(p.origin[0], p.origin[1], p.origin[2],
              p.dir[0], p.dir[1], p.dir[2], 'slug', p.actorId);
            const g2 = __sdfGame.guts().find(q => q.id === p.actorId);
            if (g2 && g2.attached) { ok = true; break outer; }
            limbStamps.n++;               // limb hit: wound but no rope, retry
          }
        }
      }
      if (!ok) skipped.add(target.id);
    }
    __sdfGame.setWoundTuning({ spillChance: 0 });   // firefight adds no ropes
    // One stepped frame materialises the ropes' gut droplets, THEN unfreeze
    // so the bench measures walking bodies with swinging ropes.
    __sdfGame.step(2);
    __sdfGame.freeze(false);
    const guts = __sdfGame.guts().filter(g => !g.none);
    const dropped = guts.reduce((a, g) => a + g.droplets, 0);
    return { ropes: guts.filter(g => g.attached).length, bodies: guts.length,
      droplets: dropped, spillKeep, limbStamps: limbStamps.n,
      skipped: [...skipped],
      maxAttachedPerBody: Math.max(0, ...guts.map(g => g.attached ? 1 : 0)),
      attachedTotal: guts.filter(g => g.attached).length };
  })()`);
  if (r.maxAttachedPerBody !== 1 && r.attachedTotal > 0) fail(`rope cap broken during staging: ${JSON.stringify(r)}`);
  return r;
}

async function runLeg(name) {
  await bootPage();
  let staged = { ropes: 0, droplets: 0, bodies: 0 };
  if (name === 'guts-all') {
    staged = await stageRopes();
    if (staged.ropes < staged.bodies) console.warn(`  WARN guts-all: ${staged.ropes}/${staged.bodies} room bodies staged`);
    console.log(`  staged ${staged.ropes} attached ropes on ${staged.bodies} bodies (${staged.droplets} gut droplets)`);
  } else {
    await evaluate('__sdfGame.setWoundTuning({ spillChance: 0 })');
  }
  await evaluate(`__sdfGame.bench({ room: ${ROOM}, mode: "throughput", warmup: 120, chunkFrames: 10, label: ${JSON.stringify(name)} })`);
  const raw = await evaluate('JSON.stringify(window.__gameBench)');
  const r = JSON.parse(raw);
  if (!r.valid) fail(`${name}: ${r.hiddenSteps} hidden frames — INVALID`);
  const seen = Math.max(0, ...r.segments.flatMap((sg) => sg.census ? [sg.census.first.bodies, sg.census.last.bodies] : [0]));
  if (seen === 0) console.warn(`  WARN ${name}: census saw ZERO bodies`);
  const guts = await evaluate('__sdfGame.guts().filter(g => !g.none).map(g => ({ a: g.attached, s: g.settled, n: g.nodes }))');
  const attached = guts.filter(g => g.a).length;
  if (attached > ROOM) fail(`attached ropes (${attached}) exceed bodies — cap leaked`);
  r.bodiesSeen = seen;
  r.staged = staged;
  r.gutsAtEnd = { ropes: guts.length, attached };
  return r;
}

// ---------------------------------------------------------------------------
// Alternating legs across repeats.
// ---------------------------------------------------------------------------
const LEGS = ['goo-base', 'guts-all'];
const results = [];
for (let rep = 0; rep < REPEATS; rep++) {
  for (const leg of LEGS) {
    const r = await runLeg(leg);
    results.push({ rep, leg, ...r });
    process.stdout.write(`  rep${rep} ${leg}: p50 ${r.overall.p50.toFixed(2)} ms, p95 ${r.overall.p95.toFixed(2)} ms (bodies ${r.bodiesSeen}, ropes ${r.gutsAtEnd.ropes}/${r.gutsAtEnd.attached} attached)\n`);
  }
}

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const baselines = {};
for (const leg of LEGS) {
  const rs = results.filter((r) => r.leg === leg);
  baselines[leg] = {
    runs: rs.length,
    p50: +med(rs.map((r) => r.overall.p50)).toFixed(2),
    p95: +med(rs.map((r) => r.overall.p95)).toFixed(2),
    fireP50: +med(rs.map((r) => r.segments.find((s) => s.name === 'fire')?.p50 ?? NaN)).toFixed(2),
    walkP50: +med(rs.map((r) => r.segments.find((s) => s.name === 'walk')?.p50 ?? NaN)).toFixed(2),
    ropes: rs[0].staged.ropes,
    gutDroplets: rs[0].staged.droplets,
  };
}
const deltaPct = +((baselines['guts-all'].p50 / baselines['goo-base'].p50 - 1) * 100).toFixed(1);
const spread = {};
for (const leg of LEGS) {
  const vals = results.filter((r) => r.leg === leg).map((r) => r.overall.p50);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  spread[leg] = { lo: +lo.toFixed(2), hi: +hi.toFixed(2), pct: +(((hi - lo) / lo) * 100).toFixed(0) };
}
const verdict = Math.abs(deltaPct) < spread['goo-base'].pct || Math.abs(deltaPct) < spread['guts-all'].pct
  ? 'UNRESOLVED (delta under within-run spread)'
  : `RESOLVED (${deltaPct}% over baseline, spread base ${spread['goo-base'].pct}% / guts ${spread['guts-all'].pct}%)`;

const report = { baselines, deltaPct, spread, verdict, room: ROOM, repeats: REPEATS, results };
writeFileSync(`${OUT}/bench.json`, JSON.stringify(report, null, 2));
console.log('\n=== ENTRAILS BENCH (room', ROOM, ') ===');
console.log(`goo-base : p50 ${baselines['goo-base'].p50} ms (spread ${spread['goo-base'].lo}-${spread['goo-base'].hi}, ${spread['goo-base'].pct}%)`);
console.log(`guts-all : p50 ${baselines['guts-all'].p50} ms over baseline, ropes ${baselines['guts-all'].ropes}, gut droplets ${baselines['guts-all'].gutDroplets} (spread ${spread['guts-all'].lo}-${spread['guts-all'].hi}, ${spread['guts-all'].pct}%)`);
console.log(`delta ${deltaPct}% — ${verdict}`);
